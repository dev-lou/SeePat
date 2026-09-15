import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTypedEngine, createWebSpeechEngine, describeSpeechError } from './asr.ts'
import { createWhisperOfflineEngine } from './asr-offline.ts'
import type { AsrEngine } from './asr.ts'
import { getLang, setLang } from './i18n/index.ts'

/**
 * Two properties are guarded here, both of which were bugs.
 *
 * 1. A speech failure is *diagnosed*, not just printed. Every network failure
 *    used to be reported as "Internet is needed for browser recognition", which
 *    sent the owner to check a connection that was fine, while the actual cause —
 *    a browser with no speech service — went unnamed.
 *
 * 2. Every session reports that it ended. Two of the on-device engine's branches
 *    returned without calling anything, so the screen sat in "listening" with a
 *    red mic for a session that was already over.
 */

/** A stand-in for `SpeechRecognition`, since node has no window at all. */
class FakeRecognition {
  static latest: FakeRecognition | null = null

  lang = ''
  continuous = false
  interimResults = false
  maxAlternatives = 1
  onresult: ((event: unknown) => void) | null = null
  onerror: ((event: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  started = false
  stopped = false

  constructor() {
    FakeRecognition.latest = this
  }

  start(): void {
    this.started = true
  }

  stop(): void {
    this.stopped = true
  }

  abort(): void {
    this.stopped = true
  }
}

function installFakeBrowser(): void {
  FakeRecognition.latest = null
  ;(globalThis as unknown as { window?: unknown }).window = { SpeechRecognition: FakeRecognition }
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window
  vi.useRealTimers()
})

interface Recorded {
  results: string[]
  errors: { message: string; code?: string }[]
  statuses: string[]
  ends: number
}

function record(engine: AsrEngine): Recorded {
  const rec: Recorded = { results: [], errors: [], statuses: [], ends: 0 }
  engine.start(
    (result) => rec.results.push(result.transcript),
    (message, code) => rec.errors.push({ message, code }),
    (status) => rec.statuses.push(status),
    () => {
      rec.ends += 1
    },
  )
  return rec
}

describe('speech error diagnosis', () => {
  it('names the unreachable-speech-service failure honestly', () => {
    const failure = describeSpeechError('network', 'en')
    expect(failure?.code).toBe('network')
    // The point of the message: it must not blame the connection.
    expect(failure?.message.toLowerCase()).toContain('speech service')
    expect(failure?.message.toLowerCase()).not.toContain('internet is needed')
    expect(failure?.message).toContain('offline')
  })

  it('maps the codes the UI can act on', () => {
    expect(describeSpeechError('not-allowed', 'en')?.code).toBe('permission')
    expect(describeSpeechError('service-not-allowed', 'en')?.code).toBe('blocked')
    expect(describeSpeechError('no-speech', 'en')?.code).toBe('no-speech')
    expect(describeSpeechError('language-not-supported', 'en')?.code).toBe('language')
    expect(describeSpeechError('audio-capture', 'en')?.code).toBe('no-microphone')
  })

  it('treats our own stop, and our own grammar bug, as non-events', () => {
    expect(describeSpeechError('aborted', 'en')).toBeNull()
    expect(describeSpeechError('bad-grammar', 'en')).toBeNull()
  })

  it('keeps the raw code when it has never heard of it', () => {
    const failure = describeSpeechError('something-new', 'en')
    expect(failure?.code).toBe('unknown')
    expect(failure?.message).toContain('something-new')
  })

  it('is translated, not just English with a Tagalog accent', () => {
    const en = describeSpeechError('no-speech', 'en')?.message
    const fil = describeSpeechError('no-speech', 'fil')?.message
    expect(fil).toBeTruthy()
    expect(fil).not.toBe(en)
  })

  it('defaults to the language the app is currently in', () => {
    const original = getLang()
    try {
      setLang('fil')
      expect(describeSpeechError('no-speech')?.message).toBe(
        describeSpeechError('no-speech', 'fil')?.message,
      )
    } finally {
      setLang(original)
    }
  })
})

describe('the browser engine always reports the end of a session', () => {
  it('reports the end when the recognizer simply stops', () => {
    installFakeBrowser()
    const rec = record(createWebSpeechEngine())
    const instance = FakeRecognition.latest
    expect(instance?.started).toBe(true)
    expect(rec.statuses).toEqual(['listening'])

    instance?.onend?.()
    expect(rec.ends).toBe(1)
    expect(rec.errors).toEqual([])
  })

  it('reports the failure and then the end — once, not twice', () => {
    installFakeBrowser()
    const rec = record(createWebSpeechEngine())
    const instance = FakeRecognition.latest

    // Chrome's order on a real failure: `error` first, then `end`.
    instance?.onerror?.({ error: 'network' })
    instance?.onend?.()

    expect(rec.errors).toHaveLength(1)
    expect(rec.errors[0]?.code).toBe('network')
    expect(rec.ends).toBe(1)
  })

  it('reports the end even when starting throws', () => {
    installFakeBrowser()
    // Saved and restored rather than deleted: the class method lives on the
    // prototype, so overwriting it creates an own property and deleting that
    // leaves the method missing for every later test.
    const original = FakeRecognition.prototype.start
    FakeRecognition.prototype.start = () => {
      throw new Error('no device')
    }
    try {
      const rec = record(createWebSpeechEngine())
      expect(rec.errors).toHaveLength(1)
      expect(rec.errors[0]?.message).toContain('could not start')
      expect(rec.ends).toBe(1)
    } finally {
      FakeRecognition.prototype.start = original
    }
  })

  it('reports the end even when the browser never says anything at all', () => {
    // The bug the owner hit: a session left open with no callbacks, because
    // silence is not always delivered as `no-speech`. The cap is what makes the
    // UI recoverable.
    installFakeBrowser()
    vi.useFakeTimers()
    const rec = record(createWebSpeechEngine())
    const instance = FakeRecognition.latest
    expect(instance?.stopped).toBe(false)

    vi.advanceTimersByTime(25_000)
    expect(instance?.stopped).toBe(true)

    // The browser then ends the session as usual, and the screen hears about it.
    instance?.onend?.()
    expect(rec.ends).toBe(1)
  })

  it('goes quiet after stop, so a late error cannot surface as a stale message', () => {
    installFakeBrowser()
    // One instance, held: each engine keeps its own `recognition` in a closure,
    // so stopping a freshly created second engine would stop nothing.
    const engine = createWebSpeechEngine()
    const rec = record(engine)
    const instance = FakeRecognition.latest

    engine.stop()
    expect(instance?.stopped).toBe(true)
    expect(instance?.onend).toBeNull()
    expect(instance?.onerror).toBeNull()
    expect(instance?.onresult).toBeNull()

    // Whatever the browser does next is no longer the screen's business.
    instance?.onend?.()
    expect(rec.ends).toBe(0)
  })
})

describe('an engine that cannot even start still closes the session', () => {
  it('closes for the typed engine', () => {
    const rec = record(createTypedEngine())
    expect(rec.errors).toHaveLength(1)
    expect(rec.ends).toBe(1)
  })

  it('closes for the on-device engine with no model installed', async () => {
    const rec = record(createWhisperOfflineEngine())
    // The engine answers asynchronously; the callbacks themselves are queued
    // before its first await, so a microtask is enough.
    await Promise.resolve()
    expect(rec.errors).toHaveLength(1)
    expect(rec.errors[0]?.message).toContain('not installed')
    expect(rec.ends).toBe(1)
  })
})
