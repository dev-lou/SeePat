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
 * The offline path is now real, and it is not the 320MB Tagalog model the
 * concept note costed out — that one (`vosk-model-tl-ph-generic-0.6`) is
 * licensed CC-BY-NC-SA and so cannot ship in a commercial product at all. See
 * `asr-offline.ts`: a multilingual Whisper Tiny runs on-device from a download
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

export interface AsrEngine {
  id: string
  label: Bilingual
  note: Bilingual
  /** Whether this engine can actually run in the current browser. */
  available: boolean
  start(
    onResult: (result: AsrResult) => void,
    onError: (message: string) => void,
    onStatus?: (status: AsrStatus) => void,
  ): void
  stop(): void
}

import { createWhisperOfflineEngine } from './asr-offline.ts'
import { say } from './i18n/index.ts'
import type { Bilingual } from './i18n/index.ts'

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

  return {
    id: 'web-speech',
    label: { en: 'Browser (Google)', fil: 'Browser (Google)' },
    note: {
      en: 'Most accurate for Taglish. Needs internet. Free — nothing is charged per word.',
      fil: 'Pinakatumpak para sa Taglish. Kailangan ng internet. Libre — walang bayad kada salita.',
    },
    available: getRecognitionCtor() !== null,
    start(onResult, onError, onStatus) {
      const Ctor = getRecognitionCtor()
      if (!Ctor) {
        onError(say('Speech recognition is not available in this browser.', 'Hindi available ang speech recognition sa browser na ito.'))
        return
      }

      recognition = new Ctor()
      onStatus?.('listening')
      recognition.lang = 'fil-PH'
      recognition.continuous = false
      recognition.interimResults = true
      recognition.maxAlternatives = 1

      recognition.onresult = (event) => {
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

      recognition.onerror = (event) => {
        const messages: Record<string, string> = {
          'not-allowed': say('Microphone permission is needed.', 'Kailangan ng pahintulot sa mikropono.'),
          'no-speech': say('Nothing was heard. Try again.', 'Walang narinig. Subukan muli.'),
          'service-not-allowed': say(
            'The browser blocked the speech service.',
            'Hindi pinayagan ng browser ang speech service.',
          ),
          network: say(
            'Internet is needed for browser recognition.',
            'Kailangan ng internet para sa browser recognition.',
          ),
        }
        onError(
          messages[event.error] ??
            say(`Microphone error: ${event.error}`, `Error sa mikropono: ${event.error}`),
        )
      }

      try {
        recognition.start()
      } catch {
        onError(say('The microphone could not start. Try again.', 'Hindi masimulan ang mikropono. Subukan muli.'))
      }
    },
    stop() {
      recognition?.stop()
      recognition = null
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
    start(_onResult, onError) {
      onError(say('Typed input does not use the microphone.', 'Ang typed na input ay hindi gumagamit ng mikropono.'))
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

/** Example utterances used to seed the demo and the empty state. */
export const SAMPLE_UTTERANCES = [
  'Sipat, nakabenta ako ng sampung Coke mismo at limang Lucky Me',
  'Umutang si Aling Nena ng dalawang kilo bigas',
  'Bumili ako ng paninda',
  'Nakabenta ako ng tatlong sardinas at apat na itlog',
]
