/**
 * The ASR boundary.
 *
 * Voice is the product's centrepiece, and it is also its least certain
 * component, so the engine is kept behind one interface. Swapping browser
 * recognition for an on-device model — or a native Android recognizer later — is
 * a change to this file and `asr-offline.ts` only; nothing in the engine or the
 * UI needs to know which engine produced a transcript.
 *
 * Why the browser engine is still first: Google's recognizer is the strongest
 * Taglish model reachable from any client at any price. It is also a *network*
 * feature, which is the one thing an offline-first product cannot ship as its
 * only voice path.
 *
 * One caveat worth stating because it is invisible until it bites: the Web Speech
 * API is a *capability of the browser build*, not of the platform. Chrome ships
 * the speech service; Chromium embedded in another application (desktop app
 * shells, some in-app browsers) exposes the same constructor, accepts the
 * microphone, and then fails with `network` on every utterance. `describeSpeechError`
 * names that case instead of blaming the connection, and the Voice screen routes
 * the owner to the on-device model from there.
 *
 * The offline path is now real, and it is not the 320MB Tagalog model the
 * concept note costed out — that one (`vosk-model-tl-ph-generic-0.6`) is
 * licensed CC-BY-NC-SA and so cannot ship in a commercial product at all. See
 * `asr-offline.ts`: a multilingual Whisper (base) runs on-device from a download
 * one order of magnitude smaller and with a licence that permits commercial use.
 */

export interface AsrResult {
  transcript: string
  confidence: number
  final: boolean
}

/**
 * What the engine is doing right now. The browser engine only ever listens; the
 * on-device engine also has to recognize after the fact, which takes seconds on
 * a phone and would otherwise look like a frozen UI.
 */
export type AsrStatus = 'listening' | 'transcribing'

/**
 * Why recognition stopped, when we can tell.
 *
 * Codes exist so the UI can *act* on a failure instead of only printing it: a
 * network failure is the one case where the fix is a button — switch to, or
 * download, the on-device model — and finding that out by string-matching a
 * translated sentence would be brittle.
 */
export type AsrErrorCode =
  | 'permission'
  | 'no-speech'
  | 'network'
  | 'language'
  | 'no-microphone'
  | 'blocked'
  | 'unknown'

export interface AsrFailure {
  code: AsrErrorCode
  message: string
}

/**
 * SpeechRecognition error code → something the owner can act on.
 *
 * Pure and language-parameterized, so the mapping is testable without a DOM. It
 * is worth the ceremony because the earlier version mis-diagnosed the failure
 * that matters most: every network failure — including the one that happens in
 * any browser built without a speech service, which is every embedded Chromium —
 * was reported as "Internet is needed for browser recognition". That sends an
 * owner to check a connection that was never the problem.
 *
 * `null` means "not a failure": `aborted` is what we get when *we* stop the
 * recognizer, and `bad-grammar` is ours to fix rather than the owner's to read.
 */
export function describeSpeechError(raw: string, lang: Lang = getLang()): AsrFailure | null {
  if (raw === 'aborted' || raw === 'bad-grammar') return null

  // Typed as everything *except* `unknown`: the fallback below already owns that
  // case, and the copy table has no entry for it.
  const CODES: Record<string, Exclude<AsrErrorCode, 'unknown'>> = {
    'not-allowed': 'permission',
    'service-not-allowed': 'blocked',
    'no-speech': 'no-speech',
    network: 'network',
    'language-not-supported': 'language',
    'audio-capture': 'no-microphone',
  }

  const COPY: Record<Exclude<AsrErrorCode, 'unknown'>, Bilingual> = {
    permission: {
      en: 'The app needs your permission to use the microphone. Tap Allow when the phone asks, then tap the mic again.',
      fil: 'Kailangan ng app ang pahintulot mong gamitin ang mikropono. Pindutin ang Allow kapag nagtanong ang phone, tapos pindutin ulit ang mic.',
    },
    blocked: {
      en: 'This browser is blocking the Google speech service. Open the app in Chrome, or use the offline voice below.',
      fil: 'Hinaharang ng browser na ito ang speech service ng Google. Buksan ang app sa Chrome, o gamitin ang boses na offline sa ibaba.',
    },
    'no-speech': {
      en: 'Nothing was heard. Tap the mic and speak as soon as it turns red.',
      fil: 'Walang narinig. Pindutin ang mic at magsalita agad pagka-pula nito.',
    },
    /*
     * The honest wording, because this is the failure an owner cannot fix by
     * retrying or by checking wifi. Browsers that embed Chromium without
     * Google's speech service (desktop app shells, some in-app browsers) expose
     * `webkitSpeechRecognition`, accept a microphone, start a session, and then
     * fail here — a silent dead end unless we name it.
     */
    network: {
      en: 'This browser cannot use the Google speech service. Chrome or Edge on a computer can. Voice still works offline once the offline voice below is downloaded.',
      fil: 'Hindi magamit ng browser na ito ang speech service ng Google. Gumagana ito sa Chrome o Edge sa computer. Gumagana pa rin ang boses offline kapag na-download na ang boses na offline sa ibaba.',
    },
    language: {
      en: 'This browser cannot understand Tagalog speech. Open the app in Chrome, or use the offline voice below.',
      fil: 'Hindi maintindihan ng browser na ito ang Tagalog. Buksan ang app sa Chrome, o gamitin ang boses na offline sa ibaba.',
    },
    'no-microphone': {
      en: 'No microphone was found. Check that one is connected, then try again.',
      fil: 'Walang nakitang mikropono. Tingnan kung may nakakabit, tapos subukan muli.',
    },
  }

  const code = CODES[raw]
  if (!code) {
    return {
      code: 'unknown',
      // The first sentence is for the owner; the code at the end is for whoever
      // is helping them, and the test asserts it is kept.
      message: pick(lang, {
        en: `The voice stopped and we are not sure why. Please try again. (detail: ${raw})`,
        fil: `Tumigil ang boses at hindi namin sigurado kung bakit. Subukan muli. (detalye: ${raw})`,
      }),
    }
  }
  return { code, message: pick(lang, COPY[code]) }
}

/**
 * How long a single browser recognition session may run before we cut it off.
 *
 * With `continuous: false` the recognizer is meant to end on its own after the
 * owner stops talking, but silence is not always delivered as `no-speech` — a
 * session can be left open indefinitely with the mic showing red. A store
 * utterance is a sentence, not a speech, so a cap costs a real recording nothing
 * and guarantees the UI can never be stuck in a listening state again.
 */
const LISTEN_CAP_MS = 25_000

/**
 * Retried once if the platform rejects the Filipino locale.
 *
 * Mobile is where this matters: an Android build can report
 * `language-not-supported` for `fil-PH` while its recognizer works perfectly well
 * on `en-PH` — and the utterances this app expects are Taglish anyway ("limang
 * Coke, bayad cash"), which an English-locale recognizer handles. Failing over
 * beats telling an owner their phone cannot do voice.
 */
const FALLBACK_LOCALE = 'en-PH'

/**
 * Vocabulary the recognizer should listen for, when the engine can take a hint.
 *
 * Only the browser engine uses this: Chrome accepts a JSGF grammar biasing
 * recognition toward the given phrases, and every engine that cannot take a
 * hint ignores it. It is optional and last, so existing four-argument callers
 * keep working unchanged.
 */
export interface AsrHints {
  /** Shop words worth hearing — SKU names and aliases, in any language. */
  phrases: string[]
}

export interface AsrEngine {
  id: string
  label: Bilingual
  note: Bilingual
  /** Whether this engine can actually run in the current browser. */
  available: boolean
  start(
    onResult: (result: AsrResult) => void,
    onError: (message: string, code?: AsrErrorCode) => void,
    onStatus?: (status: AsrStatus) => void,
    /**
     * The session is over — whatever the reason, including reasons that fired no
     * other callback at all. Without this the screen had no way back out of
     * "listening", which is exactly what an owner sees when a session dies
     * silently: a red mic and a waveform that never stop.
     */
    onEnd?: () => void,
    hints?: AsrHints,
  ): void
  stop(): void
}

import { createWhisperOfflineEngine } from './asr-offline.ts'
import { getLang, pick, say } from './i18n/index.ts'
import type { Bilingual, Lang } from './i18n/index.ts'

// --- Minimal structural types for the Web Speech API -------------------------

interface SpeechAlternativeLike {
  transcript: string
  confidence: number
}
interface SpeechResultLike {
  isFinal: boolean
  length: number
  [index: number]: SpeechAlternativeLike
}
interface SpeechResultListLike {
  length: number
  [index: number]: SpeechResultLike
}
interface SpeechEventLike {
  resultIndex: number
  results: SpeechResultListLike
}
interface SpeechErrorLike {
  error: string
}
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  /** A compiled grammar, when the browser accepts one. Absent most of the time. */
  grammars?: unknown
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechEventLike) => void) | null
  onerror: ((event: SpeechErrorLike) => void) | null
  onend: (() => void) | null
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/**
 * Browser recognition. Fast to ship and the most accurate option for Taglish,
 * but it is a *network* feature — the offline-first claim in the concept
 * document does not extend to it, which is why the deterministic narrator and
 * text entry must stand on their own.
 *
 * It is free to run, in the sense that matters commercially: the browser does
 * the recognizing, so SeePat is billed nothing per utterance. That is why it
 * sits in the free tier rather than behind the subscription — the paid tier is
 * where actual marginal cost lives.
 */
/**
 * A page served over plain http has no working microphone — `getUserMedia`
 * is undefined and recognition fails — so the failure is named up front
 * instead of arriving as a misleading "permission" or "network" error.
 */
function pageIsInsecure(): boolean {
  if (typeof window === 'undefined') return false
  const context = window as unknown as { isSecureContext?: boolean }
  return context.isSecureContext === false
}

function insecurePageMessage(): string {
  return say(
    'Voice needs a secure page (https). Open the installed app or the https address instead.',
    'Kailangan ng boses ang secure na page (https). Buksan ang naka-install na app o ang https na address.',
  )
}

/** How many hypotheses to ask Google for, so a mangled product name can lose. */
const MAX_ALTERNATIVES = 3

/**
 * Picks the hypothesis that sounds most like this shop.
 *
 * Google returns its best guess first, and most of the time that is the right
 * answer. But its best guess was trained on the whole internet, not on a
 * sari-sari store: when the top hypothesis mangles a product name ("coke" →
 * "coat") while a lower one hears it, counting shop-vocabulary hits recovers
 * the take without asking the owner to repeat herself. Ties — including every
 * take with no hints at all — keep Google's order.
 *
 * Votes come from full phrases ("lucky me") and from their long words
 * ("lucky", "coke"): a bare "Coke" in the transcript must still vote even
 * when the shelf name is "Coke Mismo". Short words vote only inside their
 * phrase — "me" is a pronoun as often as a product — so they are excluded
 * as lone needles.
 *
 * Pure and tested without a DOM.
 */
export function pickBestAlternative(alternatives: string[], hints?: AsrHints): string {
  const first = alternatives[0] ?? ''
  if (alternatives.length < 2 || !hints) return first
  const needles = Array.from(
    new Set(
      hints.phrases.flatMap((phrase) => {
        const full = normalizeHint(phrase)
        if (!full) return []
        return [full, ...full.split(' ').filter((word) => word.length >= 3)]
      }),
    ),
  )
  if (needles.length === 0) return first
  let best = first
  let bestScore = -1
  for (const alternative of alternatives) {
    const haystack = normalizeHint(alternative)
    let score = 0
    for (const needle of needles) {
      if (haystack.includes(needle)) score += 1
    }
    if (score > bestScore) {
      bestScore = score
      best = alternative
    }
  }
  return best
}

function normalizeHint(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

interface GrammarListLike {
  addFromString(grammar: string, weight?: number): void
}

type GrammarListCtor = new () => GrammarListLike

/**
 * Hands the shop's vocabulary to the recognizer, when the browser takes it.
 *
 * Chrome exposes `SpeechGrammarList` (usually prefixed); most other browsers
 * do not, and Chrome itself is free to ignore the grammar — so this is strictly
 * a hint, never a dependency. Anything that throws (a missing constructor, a
 * grammar the browser dislikes) leaves recognition running without it, because
 * a bias that fails to attach must never fail the take.
 */
function attachShopGrammar(recognition: SpeechRecognitionLike, hints?: AsrHints): void {
  if (!hints || hints.phrases.length === 0 || typeof window === 'undefined') return
  try {
    const w = window as unknown as {
      SpeechGrammarList?: GrammarListCtor
      webkitSpeechGrammarList?: GrammarListCtor
    }
    const Ctor = w.SpeechGrammarList ?? w.webkitSpeechGrammarList
    if (!Ctor) return
    const words = Array.from(
      new Set(
        hints.phrases
          .map((phrase) => normalizeHint(phrase))
          .filter((phrase) => phrase.length > 0),
      ),
    ).slice(0, 200)
    if (words.length === 0) return
    const list = new Ctor()
    list.addFromString(`#JSGF V1.0; grammar shop; public <item> = ${words.join(' | ')};`, 1)
    recognition.grammars = list
  } catch {
    // Recognition runs fine without the bias.
  }
}

export function createWebSpeechEngine(): AsrEngine {
  let recognition: SpeechRecognitionLike | null = null
  let watchdog: ReturnType<typeof setTimeout> | undefined
  // Latest session's exit path, so `stop()` can settle even when the
  // recognition object itself is unusable. Reassigned every `start()`;
  // `finish` is idempotent, so a stale reference is harmless.
  let finishSession: (() => void) | null = null

  return {
    id: 'web-speech',
    label: { en: 'Internet voice', fil: 'Boses sa internet' },
    note: {
      en: 'Best for Taglish, but it needs internet. Free — you are never charged per word.',
      fil: 'Pinakatumpak sa Taglish, pero kailangan ng internet. Libre — walang bayad kada salita.',
    },
    available: getRecognitionCtor() !== null,
    start(onResult, onError, onStatus, onEnd, hints) {
      if (pageIsInsecure()) {
        onError(insecurePageMessage(), 'unknown')
        onEnd?.()
        return
      }
      const Ctor = getRecognitionCtor()
      if (!Ctor) {
        onError(
          say(
            'You cannot use voice in this browser. Type what was said instead.',
            'Hindi magagamit ang boses sa browser na ito. I-type na lang ang sinabi.',
          ),
          'unknown',
        )
        onEnd?.()
        return
      }

      const instance = new Ctor()
      recognition = instance
      let ended = false

      /*
       * One exit path. Every branch below — error, natural end, watchdog, throw
       * — funnels through here, so the screen is never left holding a listening
       * state that no longer exists. Detaching the handlers is part of it: a
       * late `no-speech` arriving after the owner already moved on would render
       * as a stale error about a session they abandoned.
       */
      const finish = (): void => {
        if (ended) return
        ended = true
        if (watchdog !== undefined) {
          clearTimeout(watchdog)
          watchdog = undefined
        }
        instance.onresult = null
        instance.onerror = null
        instance.onend = null
        if (recognition === instance) recognition = null
        onEnd?.()
      }
      finishSession = finish

      onStatus?.('listening')
      instance.lang = SPOKEN_LOCALE
      instance.continuous = false
      instance.interimResults = true
      instance.maxAlternatives = MAX_ALTERNATIVES
      attachShopGrammar(instance, hints)

      instance.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i]
          if (!result) continue
          const alternatives: { transcript: string; confidence: number }[] = []
          for (let a = 0; a < MAX_ALTERNATIVES; a += 1) {
            const alternative = result[a]
            if (!alternative) break
            alternatives.push({
              transcript: alternative.transcript,
              confidence: alternative.confidence || 0,
            })
          }
          if (alternatives.length === 0) continue
          const best = pickBestAlternative(
            alternatives.map((a) => a.transcript),
            hints,
          )
          const fallback = alternatives[0]
          if (!fallback) continue
          const chosen = alternatives.find((a) => a.transcript === best) ?? fallback
          onResult({
            transcript: chosen.transcript,
            confidence: chosen.confidence,
            final: result.isFinal,
          })
        }
      }

      let locale = SPOKEN_LOCALE
      let triedFallbackLocale = false

      const arm = (): boolean => {
        instance.lang = locale
        try {
          instance.start()
          return true
        } catch {
          return false
        }
      }

      instance.onerror = (event) => {
        const failure = describeSpeechError(event.error)
        // Null means "not a failure" — `aborted` is us stopping it.
        if (!failure) return

        // One silent retry in the other locale, because the alternative is
        // telling the owner their phone cannot do voice when it can.
        if (failure.code === 'language' && !triedFallbackLocale) {
          triedFallbackLocale = true
          locale = FALLBACK_LOCALE
          arm()
          return
        }

        onError(failure.message, failure.code)
      }

      instance.onend = finish

      // `arm` reports failure by returning false, so the try/catch that used to
      // wrap `start()` would now be unreachable — and a microphone that refused
      // to open would sit silently instead of saying so.
      if (!arm()) {
        onError(
          say('The microphone could not start. Try again.', 'Hindi masimulan ang mikropono. Subukan muli.'),
          'unknown',
        )
        finish()
        return
      }

      watchdog = setTimeout(() => {
        try {
          instance.stop()
        } catch {
          finish()
        }
      }, LISTEN_CAP_MS)
    },
    stop() {
      const instance = recognition
      recognition = null
      if (watchdog !== undefined) {
        clearTimeout(watchdog)
        watchdog = undefined
      }
      if (!instance) return
      // Finalize *through* the callbacks, not around them. `stop()` asks the
      // engine for its final transcript, which arrives via onresult → onend →
      // `finish` → onEnd. Detaching the handlers here threw the owner's last
      // words away: tapping stop discarded the sentence it was meant to keep,
      // and the screen went silent with nothing to show. Late events after
      // `finish` are still ignored — `finish` detaches everything exactly once.
      try {
        instance.stop()
      } catch {
        // The recognizer is already dead — settle through the same exit path
        // so the screen never sticks on "transcribing" with no end coming.
        finishSession?.()
      }
    },
  }
}

/**
 * Typed input, presented as a first-class engine rather than a fallback. If the
 * microphone fails mid-demo, the flow is identical — which is what keeps the
 * pitch from depending on venue wifi.
 */
export function createTypedEngine(): AsrEngine {
  return {
    id: 'typed',
    label: { en: 'Type it instead', fil: 'I-type na lang' },
    note: {
      en: 'Works with no internet and no microphone.',
      fil: 'Gumagana kahit walang internet at walang mikropono.',
    },
    available: true,
    start(_onResult, onError, _onStatus, onEnd) {
      onError(
        say(
          'Typing does not use the microphone — just write what was said.',
          'Hindi gumagamit ng mikropono ang pag-i-type — isulat lang ang sinabi.',
        ),
        'unknown',
      )
      onEnd?.()
    },
    stop() {
      /* no-op */
    },
  }
}

/**
 * Engines, in the order the UI should offer them. The on-device engine reports
 * itself unavailable until its model has actually been downloaded, so the
 * difference between "not built" and "not downloaded" stays visible.
 */
export function getEngines(): AsrEngine[] {
  return [createWebSpeechEngine(), createTypedEngine(), createWhisperOfflineEngine()]
}

/**
 * The locale we ask the browser recognizer for.
 *
 * `fil-PH` is a locale Chrome's speech service supports, and the Code-Switching
 * is handled by the constrained parser rather than by the recognizer: the matcher
 * looks for shop vocabulary ("Coke", "bigas", "utang") and numbers, so taglish
 * mixed with English product names still lands.
 */
const SPOKEN_LOCALE = 'fil-PH'

/** Example utterances used to seed the demo and the empty state. */
export const SAMPLE_UTTERANCES = [
  'Sipat, nakabenta ako ng sampung Coke mismo at limang Lucky Me',
  'Umutang si Aling Nena ng dalawang kilo bigas',
  'Bumili ako ng paninda',
  'Nakabenta ako ng tatlong sardinas at apat na itlog',
]
