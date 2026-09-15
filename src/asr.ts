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
      en: 'Microphone permission is needed. Allow it in the address bar, then tap the mic again.',
      fil: 'Kailangan ng pahintulot sa mikropono. Payagan ito sa address bar, tapos pindutin ulit ang mic.',
    },
    blocked: {
      en: 'The browser blocked the speech service. Use Chrome or Edge, or switch to the offline model below.',
      fil: 'Hinadlangan ng browser ang speech service. Gumamit ng Chrome o Edge, o lumipat sa offline model sa baba.',
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
      en: 'This browser could not reach Google\u2019s speech service. Chrome or Edge on a desktop can; a browser built into another app usually cannot. Voice still works offline once the model below is downloaded.',
      fil: 'Hindi naabot ng browser na ito ang speech service ng Google. Gumagana ito sa Chrome o Edge sa desktop; sa browser na kasama ng ibang app, kadalasan hindi. Gumagana pa rin ang boses offline kapag na-download ang modelo sa baba.',
    },
    language: {
      en: 'This browser cannot recognize Filipino speech. Use Chrome or Edge, or switch to the offline model below.',
      fil: 'Hindi kayang kilalanin ng browser na ito ang Tagalog na pananalita. Gumamit ng Chrome o Edge, o lumipat sa offline model sa baba.',
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
      message: pick(lang, {
        en: `Speech recognition failed (${raw}).`,
        fil: `Nabigo ang speech recognition (${raw}).`,
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
export function createWebSpeechEngine(): AsrEngine {
  let recognition: SpeechRecognitionLike | null = null
  let watchdog: ReturnType<typeof setTimeout> | undefined

  return {
    id: 'web-speech',
    label: { en: 'Browser (Google)', fil: 'Browser (Google)' },
    note: {
      en: 'Most accurate for Taglish. Needs internet. Free — nothing is charged per word.',
      fil: 'Pinakatumpak para sa Taglish. Kailangan ng internet. Libre — walang bayad kada salita.',
    },
    available: getRecognitionCtor() !== null,
    start(onResult, onError, onStatus, onEnd) {
      const Ctor = getRecognitionCtor()
      if (!Ctor) {
        onError(
          say(
            'Speech recognition is not available in this browser.',
            'Hindi available ang speech recognition sa browser na ito.',
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

      onStatus?.('listening')
      instance.lang = SPOKEN_LOCALE
      instance.continuous = false
      instance.interimResults = true
      instance.maxAlternatives = 1

      instance.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i]
          const alternative = result[0]
          if (!alternative) continue
          onResult({
            transcript: alternative.transcript,
            confidence: alternative.confidence || 0,
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
      try {
        instance.stop()
      } catch {
        // Already stopped, or the browser refused. Either way the UI has moved
        // on — `finish` will not run because the handlers are detached below.
      }
      instance.onresult = null
      instance.onerror = null
      instance.onend = null
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
    label: { en: 'Type it (no microphone)', fil: 'I-type (Walang mikropono)' },
    note: {
      en: 'Works with no internet and no microphone.',
      fil: 'Gumagana kahit walang internet at walang mikropono.',
    },
    available: true,
    start(_onResult, onError, _onStatus, onEnd) {
      onError(
        say(
          'Typed input does not use the microphone.',
          'Ang typed na input ay hindi gumagamit ng mikropono.',
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
