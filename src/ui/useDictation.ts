import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getEngines } from '../asr.ts'
import { OFFLINE_ENGINE_ID, useVoiceModel } from '../asr-offline.ts'
import type { AsrEngine, AsrErrorCode, AsrStatus } from '../asr.ts'
import { tNow } from '../i18n/index.ts'
import type { Bilingual } from '../i18n/index.ts'

/**
 * One question, spoken.
 *
 * The Voice screen exists to turn a sentence into a *record*, so it is built
 * around a draft and a confirmation step. This is the other use of a microphone:
 * turn a sentence into a *question*. Nothing is recorded, nothing is parsed into
 * quantities, so the whole draft apparatus is unnecessary — and what is left is
 * small enough to hide behind one hook.
 *
 * Two behaviours are deliberate and worth naming:
 *
 *  1. **A stopped take is still a question.** For the browser recognizer we only
 *     ever get the words Google labelled final; a partial transcript is still
 *     what the owner said, and dropping it would look like the mic "did not
 *     hear" them. A wrong question is cheap — the answer card shows the question
 *     back, so a mishearing is visible and re-askable. A dropped question is
 *     not recoverable at all.
 *  2. **A dead-end browser recognizer is not tried twice.** A build without
 *     Google's speech service exposes the API, accepts the microphone, and fails
 *     on every single utterance. Retrying it on every tap would make the button
 *     feel broken, so one hard failure switches the preference to the on-device
 *     model for the rest of the session.
 */

export interface Dictation {
  /** Some engine can listen right now. */
  available: boolean
  /** The installed on-device model is missing, so the download card applies. */
  canInstall: boolean
  listening: boolean
  transcribing: boolean
  /** Words as they arrive, so the input fills while the owner is still speaking. */
  interim: string
  error: string
  errorCode: AsrErrorCode | null
  /** Which engine is listening, so the screen can name it. */
  engineLabel: Bilingual | null
  /** Stop leaning on the browser recognizer and use the on-device model instead. */
  preferOffline: () => void
  start: () => void
  stop: () => void
}

/** Failures that mean "this browser can never recognize speech", not "try again". */
const FATAL_CODES: AsrErrorCode[] = ['network', 'blocked', 'language']

/**
 * Whether a recognition failure needs a different *engine* rather than another
 * try. Exported because the screen owns the remedy — switching to the on-device
 * model, or downloading it — and duplicating this list there is how the two would
 * drift apart.
 */
export function isFatalSpeechFailure(code: AsrErrorCode): boolean {
  return FATAL_CODES.includes(code)
}

let browserSpeechIsDead = false

export function useDictation({ onQuestion }: { onQuestion: (text: string) => void }): Dictation {
  const voiceModel = useVoiceModel()
  // Rebuilt when a model lands, so the mic starts working the moment the download
  // finishes rather than on the next reload.
  const engines = useMemo(() => getEngines(), [voiceModel.installed])
  const [forceOffline, setForceOffline] = useState(false)

  const offline = engines.find((engine) => engine.id === OFFLINE_ENGINE_ID)
  const browser = engines.find((engine) => engine.id === 'web-speech')

  const engine: AsrEngine | null = useMemo(() => {
    const useBrowser = browser?.available === true && !forceOffline && !browserSpeechIsDead
    if (useBrowser) return browser ?? null
    if (offline?.available) return offline
    // Only the browser engine is left, and it is known to fail. Handing it back
    // lets it report its own failure rather than leaving the screen with nothing
    // to say — but it is the on-device route the remedy points at.
    return browser?.available ? browser : null
  }, [browser, offline, forceOffline])

  const [listening, setListening] = useState(false)
  const [status, setStatus] = useState<AsrStatus | null>(null)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState('')
  const [errorCode, setErrorCode] = useState<AsrErrorCode | null>(null)

  const engineRef = useRef<AsrEngine | null>(null)
  const sessionRef = useRef<{ final: string; failed: boolean; settled: boolean }>({
    final: '',
    failed: false,
    settled: false,
  })
  const interimRef = useRef('')

  /*
   * The callback is held in a ref, not in the dependency list: `onQuestion` is
   * rebuilt by the screen on every render, and a `start` that changed identity
   * every render would tear down a live microphone session mid-sentence.
   */
  const questionRef = useRef(onQuestion)
  useEffect(() => {
    questionRef.current = onQuestion
  }, [onQuestion])

  const handleEnd = useCallback(() => {
    const session = sessionRef.current
    // One question per take: the internet engine now finalizes through this
    // callback after a tap on stop, so a second arrival must not ask twice.
    if (session.settled) return
    session.settled = true
    setListening(false)
    setStatus(null)
    const heard = session.final || interimRef.current
    if (heard.trim().length > 0 && !session.failed) {
      setInterim('')
      questionRef.current(heard.trim())
      return
    }
    if (!session.failed) {
      // Nothing usable came back and the engine did not explain why — say so
      // rather than leaving a silent screen. `tNow` rather than `useT`, because
      // this runs in an engine callback, not during render.
      setError(tNow('voice.error.nothingHeard'))
    }
  }, [])

  const start = useCallback(() => {
    if (!engine || !engine.available) return
    setError('')
    setErrorCode(null)
    setInterim('')
    setStatus(null)
    setListening(true)
    sessionRef.current = { final: '', failed: false, settled: false }
    interimRef.current = ''

    const instance = getEngines().find((candidate) => candidate.id === engine.id) ?? null
    engineRef.current = instance
    instance?.start(
      (result) => {
        interimRef.current = result.transcript
        setInterim(result.transcript)
        if (result.final) sessionRef.current.final = result.transcript
      },
      (message, code) => {
        sessionRef.current.failed = true
        sessionRef.current.settled = true
        if (code && isFatalSpeechFailure(code)) browserSpeechIsDead = true
        setError(message)
        setErrorCode(code ?? null)
        setListening(false)
        setStatus(null)
      },
      (next) => setStatus(next),
      handleEnd,
    )
  }, [engine, handleEnd])

  const stop = useCallback(() => {
    const instance = engineRef.current
    const id = engine?.id
    // A session that already ended has nothing left to stop — raising a
    // "transcribing" state now would stick, because no callback will ever
    // come to clear it.
    if (sessionRef.current.settled) return
    instance?.stop()
    engineRef.current = null
    setListening(false)
    // Stopping asks the engine for its final words; they arrive through the
    // session callbacks (`handleEnd`) — immediately for the internet engine,
    // seconds later for the offline one. The screen stays on "transcribing"
    // until then: clearing it here was the dead screen the owner hit, where
    // tapping stop showed nothing while the words were on their way. Nothing
    // is asked here anymore — the browser engine used to need that because
    // stopping detached its handlers and threw the final transcript away, and
    // that is exactly the bug being fixed. The typed engine never opens a
    // session, so there is nothing to wait for.
    if (id && id !== 'typed') {
      setStatus('transcribing')
      return
    }
    setStatus(null)
  }, [engine])

  const preferOffline = useCallback(() => {
    setForceOffline(true)
    setError('')
    setErrorCode(null)
  }, [])

  // The microphone is released on the way out. A session that outlives the screen
  // keeps the phone's recording indicator lit.
  useEffect(
    () => () => {
      engineRef.current?.stop()
      engineRef.current = null
    },
    [],
  )

  return {
    available: engine !== null && engine.available,
    canInstall: !voiceModel.installed,
    listening,
    transcribing: status === 'transcribing',
    interim,
    error,
    errorCode,
    engineLabel: engine?.label ?? null,
    preferOffline,
    start,
    stop,
  }
}
