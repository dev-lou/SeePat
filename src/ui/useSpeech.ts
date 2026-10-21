import { useCallback, useEffect, useSyncExternalStore } from 'react'
import {
  isSpeaking,
  isSpeechSupported,
  lastVoiceWasExact,
  speak,
  stopSpeaking,
  subscribeSpeaking,
  subscribeVoice,
} from '../speech.ts'
import type { SpeechOutcome } from '../speech.ts'
import { readPersisted, writePersisted } from '../storage.ts'
import type { Lang } from '../i18n/index.ts'

/**
 * SeePat's voice, in the UI.
 *
 * The preference is a tiny external store rather than React state, for the same
 * reason the language is: it has to survive a reload, it is read in two places
 * (the Ask screen and Settings), and neither of them owns the other.
 *
 * The default is ON, and it is worth saying why that is not presumptuous: SeePat
 * only speaks *unprompted* when the owner asked the question out loud. That is a
 * person who has already chosen voice for this conversation, and answering in
 * silence would be the surprising behaviour. The toggle is right there, and it
 * remembers.
 */

const STORAGE = { key: 'seepat.speak.v1' }

function readStored(): boolean {
  // Anything other than an explicit "off" means on, so a first run — and any
  // value a future version writes that this one does not understand — speaks.
  return readPersisted(STORAGE) !== 'off'
}

let enabled = readStored()
const prefListeners = new Set<() => void>()

function emitPref(): void {
  for (const listener of prefListeners) listener()
}

export function setSpeakEnabled(next: boolean): void {
  if (next === enabled) return
  enabled = next
  writePersisted(STORAGE, next ? 'on' : 'off')
  // Muting mid-answer has to actually stop the voice. A mute button that leaves
  // SeePat talking is the one bug a mute button cannot have.
  if (!next) stopSpeaking()
  emitPref()
}

export function speakEnabled(): boolean {
  return enabled
}

export function useSpeakEnabled(): boolean {
  return useSyncExternalStore(
    (listener) => {
      prefListeners.add(listener)
      return () => {
        prefListeners.delete(listener)
      }
    },
    () => enabled,
    () => true,
  )
}

export interface Speech {
  /** False when the platform has no speech engine at all — the UI must say so. */
  supported: boolean
  speaking: boolean
  /**
   * Null before anything has been read; false when the voice that read the last
   * answer did not speak the asked language (a phone with no Tagalog voice).
   */
  voiceExact: boolean | null
  /**
   * Reads one answer. Cancels whatever was speaking first. Resolves with what
   * happened — the screen reports a refusal instead of going silently deaf.
   */
  say: (text: string) => Promise<SpeechOutcome>
  stop: () => void
}

export function useSpeech(lang: Lang): Speech {
  const speaking = useSyncExternalStore(subscribeSpeaking, isSpeaking, () => false)
  const voiceExact = useSyncExternalStore(subscribeVoice, lastVoiceWasExact, () => null)

  // The promise is returned, not swallowed: a phone that refuses to speak is
  // a normal outcome, but the screen — not the store — owns telling the owner.
  const say = useCallback((text: string) => speak(text, lang), [lang])

  // Leaving the screen stops the voice. An answer that keeps talking to an empty
  // screen is worse than one that was never read.
  useEffect(() => stopSpeaking, [])

  return {
    supported: isSpeechSupported(),
    speaking,
    voiceExact,
    say,
    stop: stopSpeaking,
  }
}
