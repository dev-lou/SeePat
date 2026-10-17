import { useSyncExternalStore } from 'react'
import { TARGET_SAMPLE_RATE, VoiceError, speechDurationMs, startCapture } from './audio.ts'
import type { Recorder } from './audio.ts'
import type { AsrEngine } from './asr.ts'
import { readPersisted, removePersisted, writePersisted } from './storage.ts'
import { say } from './i18n/index.ts'
import type { Bilingual } from './i18n/index.ts'

/**
 * The offline voice engine — a real, on-device recognizer.
 *
 * This is the file `asr.ts` has always promised to swap in: the browser engine
 * is the *accurate* one but it is a network feature, so the whole offline claim
 * in the concept note rested on there being a locally-runnable alternative.
 * There is one, and it is not the 320MB Tagalog model the earlier note costed
 * out. A multilingual Whisper is MIT licensed and a quantized download in the
 * tens of megabytes — small enough that "download this once to use voice without
 * internet" is a reasonable thing to offer a sari-sari store owner on mobile
 * data. (It started on `whisper-tiny`; see `VOICE_MODEL_REPO` for why the weights
 * are now `whisper-base`.)
 *
 * What this deliberately is NOT:
 *
 * - Not the default. Google's recognizer is far better at Taglish, and the app
 *   keeps it as the default engine. This is the fallback for when there is no
 *   signal, which is exactly when a store owner is most likely to be recording.
 * - Not trusted with numbers. A tiny multilingual model transcribes Taglish
 *   loosely and, like every Whisper-family model, can hallucinate fluent text
 *   from silence or noise. That is already handled upstream: `parseSpoken`
 *   produces a *draft* whose quantities and prices must be confirmed by hand
 *   before anything reaches the ledger. A misheard item is visible on screen; a
 *   misheard quantity would silently corrupt every downstream insight.
 *
 * The weights come from the Hugging Face CDN and are cached by the browser, so
 * the download is a one-time, explicitly consented cost that SeePat does not
 * pay for — which is why this feature is in the free tier rather than behind a
 * subscription. See `billing.ts`.
 *
 * WHY THE DEPENDENCY IS PINNED EXACTLY. `@huggingface/transformers` is pinned to
 * 3.7.6 in package.json, not ranged. Version 4.x bundles an ONNX Runtime whose
 * graph optimiser refuses to build a session for these quantised weights — it
 * fails with `qdq_actions.cc: TransposeDQWeightsForMatMulNBits Missing required
 * scale`, on every dtype including fp32, and it fails identically with a cold
 * cache. 3.7.6 loads the same weights correctly. If a future bump breaks offline
 * voice, this pin is the first thing to check. (Installing still works offline
 * afterwards, because the browser cache — not the library — is the offline
 * mechanism.)
 */

/*
 * THE MODEL, and why this one.
 *
 * `whisper-base` rather than the `whisper-tiny` this started on. Tiny is the
 * smallest Whisper and Tagalog is one of its weakest languages, which showed up
 * as the owner's own sale coming back as a different sentence. Base is 74M
 * parameters instead of 39M — roughly twice the download — and materially better
 * at exactly the short, code-switched utterances this product depends on.
 *
 * It is published by `onnx-community` with ONNX weights already built, which is
 * what makes it usable here at all: a model without ONNX on the Hub cannot be
 * loaded by transformers.js, however good it is. The best Tagalog fine-tunes
 * found (`LWobole/whisper-small-tagalog`, 16.7% WER on FLEURS fil_ph) ship
 * safetensors only, so they are not an option without a conversion step.
 *
 * ONNX conversion of OpenAI's Whisper weights (MIT).
 */
const VOICE_MODEL_REPO = 'onnx-community/whisper-base'

/**
 * The engine's id, exported so callers can route to it by name — the Voice
 * screen switches to this engine when browser recognition cannot work, and a
 * second copy of the string would be a silent breakage the day it changes.
 */
export const OFFLINE_ENGINE_ID = 'offline-whisper'

/** `legacyKey` carries the slot from before the TimbangAI → SeePat rename. */
const MODEL_STORAGE = {
  key: 'seepat.voice.model.v1',
  legacyKey: 'timbangai.voice.model.v1',
}

/**
 * Whisper's language token for Tagalog. Forcing it stops the model from
 * guessing English on Tagalog utterances and translating them into fluent
 * English that was never said.
 *
 * This is measured, not assumed: on `whisper-base` with transformers 3.7.6,
 * Tagalog clips score ~50% word error with `tl` against ~128% with `en`, and
 * `auto` produces byte-identical output to `en` — i.e. passing no language
 * means English, not detection. Forcing `tl` costs nothing on the English
 * control (0.0%). See OFFLINE_ASR_RESEARCH.md §2.1. Do not "fix" short
 * English utterances by switching to auto; fix the chunking below instead.
 */
const SPOKEN_LANGUAGE = 'tl'

/**
 * Below this much detected speech, a recording is not sent to the model at all.
 *
 * Whisper answers silence with invention rather than with an empty string (see
 * `speechDurationMs`), and a fabricated sentence is indistinguishable from a
 * correct one once it is on screen. 200ms is well under any real utterance —
 * "Coke" alone is longer — and the failure it replaces was a confident, wrong
 * sentence, so the asymmetry is worth being strict about.
 */
const MIN_VOICED_FOR_TRANSCRIPTION_MS = 200

// ---------------------------------------------------------------------------
// Model catalogue — shown in Settings, so the "why not the 320MB one?" question
// is answered inside the product rather than in a footnote.
// ---------------------------------------------------------------------------

export interface OfflineModelInfo {
  key: string
  label: Bilingual
  repo: string
  approxMB: number
  languages: Bilingual
  license: Bilingual
  /** False for models that exist but cannot legally ship in a paid product. */
  installable: boolean
  why: Bilingual
}

export const WHISPER_MODEL: OfflineModelInfo = {
  key: 'whisper-base',
  // The label is read on the Settings screen, where "Whisper Base
  // (multilingual)" is a name for engineers. What the owner needs to know is
  // what it understands, and that it works with no signal.
  label: {
    en: 'Offline voice — Tagalog, Taglish and English',
    fil: 'Boses na offline — Tagalog, Taglish at English',
  },
  repo: VOICE_MODEL_REPO,
  // Measured from the browser cache after a real install: 76MB of weights. (The
  // library's own progress events under-report this, which is why the number
  // comes from the cache rather than from the download callback.)
  approxMB: 76,
  languages: {
    en: 'Tagalog, Taglish and English, plus more than 90 other languages',
    fil: 'Tagalog, Taglish at English, at mahigit 90 pang wika',
  },
  // The licence line is the one place the real product name belongs: it is an
  // attribution, not a description of a feature.
  license: {
    en: 'Built on Whisper. Open source, and free to use in a business.',
    fil: 'Gawa mula sa Whisper. Open source, at libreng gamitin sa negosyo.',
  },
  installable: true,
  why: {
    en: 'It stays on your phone, and you may use it in your business. It hears short Taglish better than the smallest option, but the voice that uses the internet is still more accurate — so this is the one to use when there is no signal.',
    fil: 'Nananatili ito sa phone mo, at puwede mong gamitin sa negosyo. Mas nakakarinig ito ng maikling Taglish kaysa sa pinakamaliit na bersyon, pero mas tumpak pa rin ang boses na gumagamit ng internet — kaya ito ang gamitin kapag walang signal.',
  },
}

/**
 * The opt-in upgrade: the same Whisper family one size up.
 *
 * Measured through this app's own bench (OFFLINE_ASR_RESEARCH.md §2): small
 * scores ~35% word error on clean Tagalog against ~50% for base — a real but
 * modest gain — while costing ~248MB of download (over 3× the data) and
 * 15–18s per 5-second clip on desktop x86, which is the floor for a phone.
 * It is offered, not defaulted to, because only the owner can trade her data
 * and waiting time for accuracy. Same MIT licence, same languages, same
 * offline cache mechanism as base.
 */
export const WHISPER_SMALL_MODEL: OfflineModelInfo = {
  key: 'whisper-small',
  label: {
    en: 'Offline voice — clearer Tagalog (large download)',
    fil: 'Boses na offline — mas malinaw na Tagalog (malaking download)',
  },
  repo: 'onnx-community/whisper-small',
  // Encoder plus merged decoder in int8, per the Hub file listing.
  approxMB: 248,
  languages: {
    en: 'Tagalog, Taglish and English, plus more than 90 other languages',
    fil: 'Tagalog, Taglish at English, at mahigit 90 pang wika',
  },
  license: {
    en: 'Built on Whisper. Open source, and free to use in a business.',
    fil: 'Gawa mula sa Whisper. Open source, at libreng gamitin sa negosyo.',
  },
  installable: true,
  why: {
    en: 'Hears Tagalog clearly better than the smaller download, but it costs about three times the data and answers more slowly — a five-second sentence can take half a minute on a phone. Pick this only if the small one keeps mishearing you and you have data and patience to spare.',
    fil: 'Mas malinaw na nakakarinig ng Tagalog kaysa sa mas maliit na download, pero mga tatlong beses ang gastos sa data at mas mabagal sumagot — ang limang segundong pangungusap ay puwedeng umabot ng kalahating minuto sa phone. Piliin ito kung palaging nagkakamali ang maliit at may data at pasensya ka.',
  },
}

/**
 * ONNX Runtime adds its own WASM binary on first use. Small next to the weights,
 * but still a real download, and a store owner budgeting mobile data deserves
 * the honest total rather than a pleasantly small number. Both figures are
 * estimates; the UI reports the measured size once install finishes.
 */
export const RUNTIME_APPROX_MB = 5

/**
 * Turns a raw failure into something an owner can act on.
 *
 * The important case is ONNX Runtime refusing to create a session, which fails
 * with an opaque `qdq_actions.cc` message from deep inside its graph optimiser.
 * The cause observed in practice is a *stale runtime*: the weights were cached
 * by one version of the runtime and the app is now loading another, so the
 * cached graph and the runtime that must read it disagree. Reloading fixes it,
 * and the message says so rather than echoing C++ at the owner.
 */
export function explainOfflineFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)

  // Already ours — do not wrap our own message in another layer of apology.
  // Tested by TYPE, not by wording: matching on message text meant that rewording
  // or translating any error would silently double-wrap it.
  if (error instanceof VoiceError) return raw

  if (/Can't create a session|qdq_actions|TransposeDQWeights/i.test(raw)) {
    return say(
      'The offline voice could not start. This usually happens when the app was updated while it was open. Close it, open it again, and try once more — if it still happens, remove the offline voice and download it again.',
      'Hindi masimulan ang boses na offline. Karaniwang nangyayari ito kapag nag-update ang app habang bukas ito. Isara, buksan muli, at subukan ulit — kung ganito pa rin, alisin ang boses na offline at i-download muli.',
    )
  }
  if (/Could not locate file|Failed to fetch|NetworkError|404/i.test(raw)) {
    return say(
      'The download did not finish. Check that you have internet, then try again.',
      'Hindi natapos ang download. Siguraduhing may internet, tapos subukan muli.',
    )
  }
  return say(
    `The offline voice did not start: ${raw.slice(0, 150)}`,
    `Hindi nasimulan ang boses na offline: ${raw.slice(0, 150)}`,
  )
}

export const VOSK_MODEL: OfflineModelInfo = {
  key: 'vosk-tl-ph',
  label: {
    en: 'Offline voice — Tagalog only (Vosk)',
    fil: 'Boses offline — Tagalog lamang (Vosk)',
  },
  repo: 'vosk-model-tl-ph-generic-0.6',
  approxMB: 320,
  languages: { en: 'Tagalog only', fil: 'Tagalog lamang' },
  // The licence identifier is dropped from the sentence a person reads: what
  // matters here is only that it cannot be used in an app people pay for, and
  // the identifier itself lives in README.md's licence table where a developer
  // looks for it.
  license: {
    en: 'Vosk. Its licence does not allow an app that people pay for.',
    fil: 'Vosk. Hindi pinapayagan ng lisensya nito ang app na may bayad.',
  },
  installable: false,
  why: {
    en: 'This is the only offline voice here that is Tagalog alone — but to use it, this app would have to be free to everyone, because the licence does not allow a paid product. That is the only reason it is not offered.',
    fil: 'Ito lang ang boses offline dito na Tagalog lamang — pero para magamit ito, kailangang libre ang app para sa lahat, dahil hindi pinapayagan ng lisensya nito ang produktong may bayad. Iyon lang ang dahilan kung bakit hindi ito inaalok.',
  },
}

export const OFFLINE_MODELS: OfflineModelInfo[] = [WHISPER_MODEL, WHISPER_SMALL_MODEL, VOSK_MODEL]

/** Catalogue entries the app can actually download. Base stays the default. */
export const INSTALLABLE_MODELS: OfflineModelInfo[] = OFFLINE_MODELS.filter((m) => m.installable)

export function modelInfoForKey(key: string): OfflineModelInfo | null {
  return INSTALLABLE_MODELS.find((m) => m.key === key) ?? null
}

// ---------------------------------------------------------------------------
// Installed-model state
// ---------------------------------------------------------------------------

export interface InstalledVoiceModel {
  key: string
  repo: string
  installedAt: string
  /** Actual bytes materialised, summed across the model files. */
  bytes: number
}

function isInstalled(value: unknown): value is InstalledVoiceModel {
  if (typeof value !== 'object' || value === null) return false
  const c = value as Partial<InstalledVoiceModel>
  return (
    typeof c.key === 'string' &&
    typeof c.repo === 'string' &&
    typeof c.installedAt === 'string' &&
    typeof c.bytes === 'number' &&
    /*
     * The key must be *this* model, not merely a string.
     *
     * A record naming a different model is not this model being installed. When
     * the weights moved from `whisper-tiny` to `whisper-base`, a phone holding
     * the old record would have reported "working offline" while the runtime
     * needed 76MB it did not have — and it would discover that at the instant the
     * owner spoke, which is the one moment there may be no signal to fetch it
     * with. A stale record is therefore treated as no record, so the app asks for
     * the download up front instead of failing in the field.
     */
    modelInfoForKey(c.key)?.repo === c.repo
  )
}

function readRecord(): InstalledVoiceModel | null {
  const raw = readPersisted(MODEL_STORAGE)
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return isInstalled(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * A cached snapshot plus a subscription, because React needs a referentially
 * stable value from `useSyncExternalStore`. Re-reading localStorage on every
 * render would return a fresh object each time and loop forever.
 */
let snapshot: InstalledVoiceModel | null = readRecord()
const listeners = new Set<() => void>()

function publish(next: InstalledVoiceModel | null): void {
  snapshot = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): InstalledVoiceModel | null {
  return snapshot
}

export function getInstalledVoiceModel(): InstalledVoiceModel | null {
  return snapshot
}

/** Reactive install state, so the Boses tab updates the moment a model lands. */
export function useVoiceModel(): {
  model: InstalledVoiceModel | null
  installed: boolean
  megabytes: number
} {
  const model = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return {
    model,
    installed: model !== null,
    megabytes: model ? Math.round(model.bytes / (1024 * 1024)) : 0,
  }
}

// ---------------------------------------------------------------------------
// Loading and transcribing
// ---------------------------------------------------------------------------

interface TranscriberOutput {
  text: string
}

export interface Transcriber {
  (
    audio: Float32Array,
    options?: Record<string, unknown>,
  ): Promise<TranscriberOutput | TranscriberOutput[]>
}

export interface InstallProgress {
  /** The model file currently downloading. */
  file: string
  /** 0–100 for the current file, or null while the size is unknown. */
  filePercent: number | null
  downloadedBytes: number
  /** Best-known size for the whole model, or null until the manifest is read. */
  totalBytes: number | null
}

export type InstallPhase = 'downloading' | 'warming' | 'ready'

let transcriberPromises = new Map<string, Promise<Transcriber>>()

/**
 * Loads the pipeline once and reuses it. The dynamic import is what keeps
 * ONNX Runtime and the transformers runtime out of the app's main bundle: a
 * store owner who never taps "download" never pays for any of it.
 *
 * The `pipeline` overloads are cast to a local structural type rather than
 * fought with — the runtime contract (a callable that takes 16 kHz float
 * samples and returns `{ text }`) is what this file depends on, and it is the
 * shape the library's own documentation and examples use.
 */
async function loadTranscriber(
  onProgress?: (progress: InstallProgress) => void,
  repo: string = VOICE_MODEL_REPO,
): Promise<Transcriber> {
  const cached = transcriberPromises.get(repo)
  if (cached) return cached

  const loading = (async () => {
    const transformers = await import('@huggingface/transformers')

    // The browser cache IS the offline mechanism: once the weights are here,
    // loading needs no network. `allowLocalModels` points at nothing useful in
    // a PWA, and leaving it on only makes a failed download quieter.
    transformers.env.useBrowserCache = true
    transformers.env.allowLocalModels = false

    const totals = new Map<string, { loaded: number; total: number }>()

    const createPipeline = transformers.pipeline as unknown as (
      task: string,
      model: string,
      options?: Record<string, unknown>,
    ) => Promise<Transcriber>

    const progress_callback = (event: unknown) => {
        if (!onProgress) return
        const e = event as {
          status?: string
          name?: string
          loaded?: number
          total?: number
          progress?: number
        }
        if (e.status !== 'progress' || !e.name) return
        if (typeof e.loaded !== 'number' || typeof e.total !== 'number') return
        totals.set(e.name, { loaded: e.loaded, total: e.total })

        let downloadedBytes = 0
        let totalBytes = 0
        for (const entry of totals.values()) {
          downloadedBytes += entry.loaded
          totalBytes += entry.total
        }

      onProgress({
        file: e.name,
        filePercent: typeof e.progress === 'number' ? e.progress : null,
        downloadedBytes,
        totalBytes: totalBytes > 0 ? totalBytes : null,
      })
    }

    /*
     * Inference runs in a worker rather than on the page's thread.
     *
     * On WASM the ONNX session otherwise executes on the main thread, so a
     * transcription freezes the interface outright — the owner says their sale
     * and then watches the app stop responding for the length of the model run.
     * That cannot be papered over with a nicer spinner, because a blocked thread
     * cannot paint one. `proxy` moves the session to a worker and leaves the
     * interface alive, which is the actual fix for the "hang".
     */
    const wasmBackend = transformers.env.backends?.onnx?.wasm
    if (wasmBackend) wasmBackend.proxy = true

    /*
     * WHY THERE IS NO `device: 'webgpu'` HERE, DESPITE IT LOOKING OBVIOUS.
     *
     * It was tried, and measured rather than assumed. The WebGPU path silently
     * selects fp32 weights instead of the WASM path's q8, so the download went
     * from the promised ~42MB to **154MB (147MiB)** — a 3.5× data cost in a market
     * where prepaid data is the constraint — while a 3-second clip still took
     * **7.7s cold and 7.6s warm** to transcribe on a machine that does expose a
     * WebGPU adapter. A working adapter is not the same as a fast one.
     *
     * So it is not enabled on the strength of an assumption about the owner's
     * GPU. If it is revisited, it needs measurements from real target devices,
     * with an explicit `dtype` so it cannot quietly pull fp32 again.
     */
    return createPipeline('automatic-speech-recognition', repo, {
      // Quantization is left to the library default, which is int8 (`q8`) on
      // WASM — the whole reason base is a tens-of-megabytes download rather
      // than a hundreds-of-megabytes one.
      progress_callback,
    })
  })()

  // A failed load must not be cached as a permanent failure — the owner should
  // be able to tap download again after reconnecting.
  loading.catch(() => {
    if (transcriberPromises.get(repo) === loading) transcriberPromises.delete(repo)
  })
  transcriberPromises.set(repo, loading)

  return loading
}

export async function transcribeOffline(samples: Float32Array): Promise<string> {
  // The installed record names the weights: base and small are different
  // downloads, and transcribing with one while the other is cached would
  // either re-download mid-take or fail offline. No record, no take — the
  // engine above already refuses before this is reached.
  const installed = getInstalledVoiceModel()
  const repo = (installed && modelInfoForKey(installed.key)?.repo) || VOICE_MODEL_REPO
  const transcriber = await loadTranscriber(undefined, repo)
  /*
   * Short takes are transcribed in one pass, without chunking.
   *
   * `chunk_length_s: 30` with a stride exists for long audio: the pipeline
   * windows the input and stitches the pieces back together. On a 1–2 second
   * shop utterance ("1 Coke") there is nothing to window — the windowing only
   * pads the tiny clip out to a 30-second frame, and Whisper answers padding
   * with invention, including fluent text in the wrong language. That is the
   * "I said one word and got back a sentence I never said" failure, and the
   * model is not at fault for it. Anything under 15 seconds goes through as a
   * single chunk; the chunked path stays for takes that actually need it.
   *
   * The language stays forced (see SPOKEN_LANGUAGE): the bench shows `auto`
   * is English-by-another-name in this library version, so un-forcing it
   * would trade one hallucination for a worse one.
   */
  const durationS = samples.length / TARGET_SAMPLE_RATE
  const output =
    durationS > 15
      ? await transcriber(samples, {
          language: SPOKEN_LANGUAGE,
          task: 'transcribe',
          chunk_length_s: 30,
          stride_length_s: 5,
        })
      : await transcriber(samples, {
          language: SPOKEN_LANGUAGE,
          task: 'transcribe',
        })
  const text = Array.isArray(output) ? output.map((o) => o.text).join(' ') : output.text
  return text.trim()
}

/**
 * Downloads the weights and proves they work before claiming success.
 *
 * The proof matters: `pipeline()` resolving means the model is *loaded*, not
 * that every file it needs is cached. Running a fraction of a second of silence
 * through it forces the tokenizer and generation config to materialise too, so
 * the "gumagana offline" badge is only shown once an offline run is genuinely
 * possible. (Whisper on silence may emit a short hallucinated phrase; the
 * output is discarded, and it is the confirmation step that protects the
 * ledger from anything like it.)
 */
export async function installVoiceModel(
  key: string = WHISPER_MODEL.key,
  onProgress?: (progress: InstallProgress) => void,
  onPhase?: (phase: InstallPhase) => void,
): Promise<InstalledVoiceModel> {
  try {
    const info = modelInfoForKey(key)
    if (!info) {
      throw new VoiceError(
        say(
          'That offline voice is no longer offered. Pick one from the list instead.',
          'Hindi na inaalok ang boses na offline na iyan. Pumili na lang sa listahan.',
        ),
      )
    }
    return await downloadAndWarm(info, onProgress, onPhase)
  } catch (error) {
    throw new Error(explainOfflineFailure(error))
  }
}

async function downloadAndWarm(
  info: OfflineModelInfo,
  onProgress?: (progress: InstallProgress) => void,
  onPhase?: (phase: InstallPhase) => void,
): Promise<InstalledVoiceModel> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false && !snapshot) {
    throw new VoiceError(
      say(
        'You need internet for the first download. After that it works with no signal.',
        'Kailangan ng internet sa unang download. Pagkatapos, gagana ito kahit walang signal.',
      ),
    )
  }

  onPhase?.('downloading')
  const transcriber = await loadTranscriber(onProgress, info.repo)

  onPhase?.('warming')
  await transcriber(new Float32Array(8000), {
    language: SPOKEN_LANGUAGE,
    task: 'transcribe',
  })

  const record: InstalledVoiceModel = {
    key: info.key,
    repo: info.repo,
    installedAt: new Date().toISOString(),
    // Measured from this model's own cached files rather than from the shared
    // cache total — see `cachedModelBytes`.
    bytes: await cachedModelBytes(),
  }

  // Private mode: the model is cached anyway, only the badge is lost.
  writePersisted(MODEL_STORAGE, JSON.stringify(record))
  publish(record)
  onPhase?.('ready')
  return record
}


/**
 * Total size of what the browser actually stored for us, when it will say.
 * Counts both the model weights and the runtime's WASM binaries, because both
 * are only on the device for this one feature.
 */
/**
 * How many bytes this model occupies in the browser cache.
 *
 * This used to sum the whole shared cache — every `transformers-*`,
 * `wasm-runtime` and `onnx-runtime` entry — which produced the wrong number as
 * soon as any second model had ever been fetched: measured at **262MB for a model
 * that occupies 76MB**, because an earlier `whisper-tiny` download was still
 * sitting in the same cache.
 *
 * The badge this feeds reads as "what did this cost me", in a product sold to
 * people paying for mobile data by the megabyte, so it has to be this model's
 * files and nothing else.
 */
async function cachedModelBytes(repo: string = VOICE_MODEL_REPO): Promise<number> {
  try {
    if (typeof caches === 'undefined') return 0
    let total = 0
    for (const name of await caches.keys()) {
      if (!/(transformers|wasm-runtime|onnx-runtime)/.test(name)) continue
      const cache = await caches.open(name)
      for (const request of await cache.keys()) {
        if (!request.url.includes(repo)) continue
        const response = await cache.match(request)
        if (!response) continue
        const length = response.headers.get('content-length')
        if (length) {
          total += Number(length)
          continue
        }
        const blob = await response.clone().blob()
        total += blob.size
      }
    }
    return total
  } catch {
    return 0
  }
}

/** Frees the device storage the owner explicitly gave up. */
export async function removeVoiceModel(): Promise<void> {
  try {
    if (typeof caches !== 'undefined') {
      const names = await caches.keys()
      await Promise.all(
        names
          .filter((name) => /(transformers|wasm-runtime|onnx-runtime)/.test(name))
          .map((name) => caches.delete(name)),
      )
    }
  } catch {
    // Nothing to free, or storage is not ours to clear.
  }
  removePersisted(MODEL_STORAGE)
  transcriberPromises.clear()
  publish(null)
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/**
 * The offline engine behind the same `AsrEngine` interface as everything else.
 * It reports itself unavailable until a model is actually installed, so the UI
 * can tell the difference between "not built yet" and "not downloaded yet".
 */
export function createWhisperOfflineEngine(): AsrEngine {
  let recorder: Recorder | null = null

  const model = getInstalledVoiceModel()
  const megabytes = model ? Math.round(model.bytes / (1024 * 1024)) : 0
  // The installed entry names what is actually on the phone, so the note
  // quotes it rather than the catalogue default — base and small differ by
  // hundreds of megabytes, and the wrong name here is a wrong promise.
  const installedInfo = model ? modelInfoForKey(model.key) : null

  return {
    id: OFFLINE_ENGINE_ID,
    label: { en: 'Offline voice (no internet)', fil: 'Boses offline (walang internet)' },
    note: model
      ? installedInfo
        ? {
            en: `${installedInfo.label.en} is on your phone and needs no signal${megabytes > 0 ? ` — about ${megabytes}MB` : ''}. It is less accurate than the internet voice, so check the numbers before you save.`,
            fil: `Ang ${installedInfo.label.fil} ay nasa phone mo at hindi kailangan ng signal${megabytes > 0 ? ` — mga ${megabytes}MB` : ''}. Mas mahina ito kaysa sa boses na may internet, kaya suriin ang mga numero bago i-save.`,
          }
        : {
            en: `Ready, and it needs no signal${megabytes > 0 ? ` — about ${megabytes}MB on your phone` : ''}. It is less accurate than the internet voice, so check the numbers before you save.`,
            fil: `Handa na, at hindi ito kailangan ng signal${megabytes > 0 ? ` — mga ${megabytes}MB sa phone mo` : ''}. Mas mahina ito kaysa sa boses na may internet, kaya suriin ang mga numero bago i-save.`,
          }
      : {
          // Computed from the catalogue rather than written twice: this note used
          // to promise ~75MB while the catalogue said 42MB, and the number an
          // owner has to spend data on is not a good place for two answers. Model
          // plus runtime is the figure that matches what they actually download,
          // which is what the Voice screen and the Offline card both quote.
          en: `Not set up yet. Open Settings → Offline voice and download it once (about ${WHISPER_MODEL.approxMB + RUNTIME_APPROX_MB}MB) — after that it works with no signal.`,
          fil: `Hindi pa naka-set up. Buksan ang Settings → Boses offline at i-download ito nang isang beses (mga ${WHISPER_MODEL.approxMB + RUNTIME_APPROX_MB}MB) — pagkatapos, gagana ito kahit walang signal.`,
        },
    available: model !== null,
    start(onResult, onError, onStatus, onEnd) {
      /*
       * One exit path, wrapped in `try/finally` so *every* branch below reports
       * the end of the session — including the throws we did not anticipate.
       *
       * This is not tidiness. Two of these branches used to return without
       * calling anything at all (an empty recording, a discarded utterance),
       * which left the screen showing "listening" for a session that had already
       * ended. A dead microphone and a dead session have to look different.
       */
      void (async () => {
        try {
          if (!getInstalledVoiceModel()) {
            onError(
              say(
                'The offline voice is not installed yet. Open Settings and download it first — then it works with no signal.',
                'Hindi pa naka-install ang boses na offline. Buksan ang Settings at i-download muna ito — pagkatapos, gagana ito kahit walang signal.',
              ),
              'unknown',
            )
            return
          }

          let session: Recorder
          try {
            session = await startCapture()
          } catch (error) {
            onError(
              error instanceof Error
                ? error.message
                : say('The microphone could not start.', 'Hindi masimulan ang mikropono.'),
              'no-microphone',
            )
            return
          }

          recorder = session
          onStatus?.('listening')

          let utterance
          try {
            utterance = await session.finished
          } catch (error) {
            recorder = null
            onError(
              error instanceof Error
                ? error.message
                : say('Recording failed.', 'Nabigo ang pag-record.'),
              'no-microphone',
            )
            return
          }

          if (!utterance) {
            recorder = null
            return
          }

          // Recognizing on-device is slow — seconds, not milliseconds, and far
          // slower than the browser engine. Saying so is better than a spinner
          // that looks like a freeze.
          onStatus?.('transcribing')

          const voicedMs = speechDurationMs(utterance.samples)
          if (voicedMs < MIN_VOICED_FOR_TRANSCRIPTION_MS) {
            // Refused before the model sees it, so there is nothing to hallucinate
            // from. The owner is told nothing was heard rather than shown words
            // they never said.
            onError(
              say(
                'No words were heard. Try again, a little louder.',
                'Walang narinig na salita. Subukan muli nang mas malakas.',
              ),
              'no-speech',
            )
            return
          }

          try {
            const transcript = await transcribeOffline(utterance.samples)
            if (!transcript) {
              onError(
                say(
                  'No words were heard. Try again, a little louder.',
                  'Walang narinig na salita. Subukan muli nang mas malakas.',
                ),
                'no-speech',
              )
              return
            }
            onResult({ transcript, confidence: 0, final: true })
          } catch (error) {
            onError(explainOfflineFailure(error), 'unknown')
          } finally {
            recorder = null
          }
        } finally {
          onEnd?.()
        }
      })()
    },
    stop() {
      // Stopping mid-transcription must not cancel the recognition itself —
      // only the microphone is released.
      recorder?.stop()
      recorder = null
    },
  }
}
