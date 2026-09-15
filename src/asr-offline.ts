import { useSyncExternalStore } from 'react'
import { VoiceError, startCapture } from './audio.ts'
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
 * out. `Xenova/whisper-tiny` is multilingual (it transcribes Tagalog), MIT
 * licensed, and a quantized download in the tens of megabytes — small enough
 * that "download this once to use voice without internet" is a reasonable thing
 * to offer a sari-sari store owner on mobile data.
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

/** The documented example model for this pipeline, and multilingual. */
const VOICE_MODEL_REPO = 'Xenova/whisper-tiny'

/** `legacyKey` carries the slot from before the TimbangAI → SeePat rename. */
const MODEL_STORAGE = {
  key: 'seepat.voice.model.v1',
  legacyKey: 'timbangai.voice.model.v1',
}

/** Whisper's language token for Tagalog. Forcing it stops whisper-tiny from
 *  guessing English on short Taglish utterances and translating them. */
const SPOKEN_LANGUAGE = 'tl'

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
  key: 'whisper-tiny',
  label: { en: 'Whisper Tiny (multilingual)', fil: 'Whisper Tiny (multilingual)' },
  repo: VOICE_MODEL_REPO,
  approxMB: 42,
  languages: {
    en: 'Tagalog, Taglish, English — over 90 languages',
    fil: 'Tagalog, Taglish, English — mahigit 90 wika',
  },
  license: { en: 'Model: MIT · Runtime: Apache-2.0', fil: 'Modelo: MIT · Runtime: Apache-2.0' },
  installable: true,
  why: {
    en: 'Small, licensed for commercial use, and it runs entirely on your phone. Less accurate than the browser engine on Taglish, so it is the fallback.',
    fil: 'Maliit, legal gamitin sa komersyo, at tumatakbo nang tuluyan sa phone mo. Hindi kasingtumpak ng browser engine sa Taglish, kaya pang-fallback ito.',
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
      'The on-device runtime failed to load. This usually happens when the runtime version changes while the app is open, so the cached model no longer matches. Reload the app and try again — if it persists, remove the model and download it again.',
      'Nabigo ang pag-load ng on-device na runtime. Karaniwan itong nangyayari kapag nagbago ang bersyon ng runtime habang bukas ang app, kaya hindi na tugma ang naka-cache na modelo. I-reload ang app at subukan muli — kung magpatuloy, alisin muna ang modelo at i-download muli.',
    )
  }
  if (/Could not locate file|Failed to fetch|NetworkError|404/i.test(raw)) {
    return say(
      'The model download failed. Check the connection and try again.',
      'Hindi na-download ang modelo. Suriin ang koneksyon at subukan muli.',
    )
  }
  return say(
    `The offline model did not load: ${raw.slice(0, 150)}`,
    `Hindi na-load ang offline na modelo: ${raw.slice(0, 150)}`,
  )
}

export const VOSK_MODEL: OfflineModelInfo = {
  key: 'vosk-tl-ph',
  label: { en: 'Vosk Filipino (tl-PH)', fil: 'Vosk Filipino (tl-PH)' },
  repo: 'vosk-model-tl-ph-generic-0.6',
  approxMB: 320,
  languages: { en: 'Tagalog only', fil: 'Tagalog lamang' },
  license: { en: 'CC-BY-NC-SA — non-commercial', fil: 'CC-BY-NC-SA — hindi pangkomersyo' },
  installable: false,
  why: {
    en: 'The only pure-Tagalog offline model, and its 320MB size is accurate — but its licence forbids use in a paid product. That is why it is not offered here.',
    fil: 'Ito ang tanging dalisay na Tagalog na offline na modelo, at tama ang 320MB na sukat nito — pero bawal itong gamitin sa produktong may bayad. Kaya hindi ito inaalok dito.',
  },
}

export const OFFLINE_MODELS: OfflineModelInfo[] = [WHISPER_MODEL, VOSK_MODEL]

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
  return typeof c.key === 'string' && typeof c.installedAt === 'string' && typeof c.bytes === 'number'
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

let transcriberPromise: Promise<Transcriber> | null = null

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
): Promise<Transcriber> {
  if (transcriberPromise) return transcriberPromise

  transcriberPromise = (async () => {
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

    return createPipeline('automatic-speech-recognition', VOICE_MODEL_REPO, {
      // Quantization is left to the library default, which is int8 (`q8`) on
      // WASM — the whole reason this is a tens-of-megabytes download rather
      // than a hundreds-of-megabytes one.
      progress_callback: (event: unknown) => {
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
      },
    })
  })()

  // A failed load must not be cached as a permanent failure — the owner should
  // be able to tap download again after reconnecting.
  transcriberPromise.catch(() => {
    transcriberPromise = null
  })

  return transcriberPromise
}

export async function transcribeOffline(samples: Float32Array): Promise<string> {
  const transcriber = await loadTranscriber()
  const output = await transcriber(samples, {
    language: SPOKEN_LANGUAGE,
    task: 'transcribe',
    chunk_length_s: 30,
    stride_length_s: 5,
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
  onProgress?: (progress: InstallProgress) => void,
  onPhase?: (phase: InstallPhase) => void,
): Promise<InstalledVoiceModel> {
  try {
    return await downloadAndWarm(onProgress, onPhase)
  } catch (error) {
    throw new Error(explainOfflineFailure(error))
  }
}

async function downloadAndWarm(
  onProgress?: (progress: InstallProgress) => void,
  onPhase?: (phase: InstallPhase) => void,
): Promise<InstalledVoiceModel> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false && !snapshot) {
    throw new VoiceError(
      say(
        'Internet is needed for the first model download.',
        'Kailangan ng internet para sa unang pag-download ng modelo.',
      ),
    )
  }

  onPhase?.('downloading')
  const transcriber = await loadTranscriber(onProgress)

  onPhase?.('warming')
  await transcriber(new Float32Array(8000), {
    language: SPOKEN_LANGUAGE,
    task: 'transcribe',
  })

  const record: InstalledVoiceModel = {
    key: WHISPER_MODEL.key,
    repo: VOICE_MODEL_REPO,
    installedAt: new Date().toISOString(),
    // Re-read from the library's own accounting rather than guessing.
    bytes: await cachedBytes(),
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
async function cachedBytes(): Promise<number> {
  try {
    if (typeof caches === 'undefined') return 0
    let total = 0
    for (const name of await caches.keys()) {
      if (!/(transformers|wasm-runtime|onnx-runtime)/.test(name)) continue
      const cache = await caches.open(name)
      for (const request of await cache.keys()) {
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
  transcriberPromise = null
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

  return {
    id: 'offline-whisper',
    label: { en: 'Offline (Whisper Tiny)', fil: 'Offline (Whisper Tiny)' },
    note: model
      ? {
          en: `Installed (${megabytes > 0 ? `${megabytes}MB` : 'small'}). Works with no internet — but it is weak on Taglish, so confirm the numbers.`,
          fil: `Naka-install (${megabytes > 0 ? `${megabytes}MB` : 'maliit'}). Gumagana kahit walang internet — pero mahina sa Taglish, kaya kumpirmahin ang mga numero.`,
        }
      : {
          en: 'Not downloaded yet. Go to Settings → Offline and Voice to install it (~75MB, once).',
          fil: 'Hindi pa naka-download. Pumunta sa Settings → Offline at Boses para i-install (~75MB, isang beses lang).',
        },
    available: model !== null,
    start(onResult, onError, onStatus) {
      void (async () => {
        if (!getInstalledVoiceModel()) {
          onError(say(
            'The offline model is not installed yet. Download it in Settings first.',
            'Hindi pa naka-install ang offline na modelo. I-download muna sa Settings.',
          ))
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
            error instanceof Error ? error.message : say('Recording failed.', 'Nabigo ang pag-record.'),
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

        try {
          const transcript = await transcribeOffline(utterance.samples)
          if (!transcript) {
            onError(
              say(
                'No words were heard. Try again, a little louder.',
                'Walang narinig na salita. Subukan muli nang mas malakas.',
              ),
            )
            return
          }
          onResult({ transcript, confidence: 0, final: true })
        } catch (error) {
          onError(explainOfflineFailure(error))
        } finally {
          recorder = null
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
