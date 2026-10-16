import { describe, expect, it } from 'vitest'
import { SILENCE_DEFAULTS, createSilenceTracker, normalisePeak, speechDurationMs } from './audio.ts'

/**
 * When does a take end?
 *
 * This used to be "when the owner taps the mic again, or 30 seconds" — which
 * made the app look broken: you said your sale, and then waited half a minute in
 * silence for it to be transcribed. The tracker is pure and clock-injected
 * precisely so that the stopping rule can be pinned down without a microphone.
 */

/** Feed `levels` at a fixed interval and report how many samples it took to stop. */
function run(levels: number[], intervalMs = 60, tracker = createSilenceTracker()) {
  let now = 0
  for (let i = 0; i < levels.length; i += 1) {
    if (tracker.push(levels[i] as number, now)) return { stoppedAt: i, elapsedMs: now }
    now += intervalMs
  }
  return null
}

const LOUD = 0.2
const QUIET = 0.001

/** `count` samples of a given level. */
function repeat(level: number, count: number): number[] {
  return Array.from({ length: count }, () => level)
}

describe('the take ends when the talking does', () => {
  it('stops roughly 1.8s after speech gives way to silence', () => {
    // 1s of speech (17 samples at 60ms), then silence.
    const spokenSamples = 17
    const result = run([...repeat(LOUD, spokenSamples), ...repeat(QUIET, 80)])
    expect(result).not.toBeNull()

    // Measured from the last *voiced* sample, which is what the window is
    // anchored to — the stop lands on the first sample at or past 1.8s of
    // silence, so the error is bounded by one sampling interval, not more.
    const lastVoiceMs = (spokenSamples - 1) * 60
    const gap = (result?.elapsedMs ?? 0) - lastVoiceMs
    expect(gap).toBeGreaterThanOrEqual(SILENCE_DEFAULTS.silenceMs)
    expect(gap).toBeLessThan(SILENCE_DEFAULTS.silenceMs + 120)
  })

  it('does not stop during a short pause mid-sentence', () => {
    // "limang Coke … bayad cash": a 1-second pause is shorter than the window.
    const result = run([
      ...repeat(LOUD, 10),
      ...repeat(QUIET, 16),
      ...repeat(LOUD, 10),
      ...repeat(QUIET, 60),
    ])
    expect(result).not.toBeNull()
    expect(result?.stoppedAt).toBeGreaterThanOrEqual(36)
  })

  it('never stops while the owner is still talking', () => {
    expect(run(repeat(LOUD, 100))).toBeNull()
  })

  it('ignores a tap or a cough that is too brief to be speech', () => {
    // One frame above the floor is 60ms — furniture, not words.
    const result = run(repeat(QUIET, 200), 60)
    // It still gives up eventually, but by the no-speech rule, not the silence one.
    expect(result?.elapsedMs).toBeGreaterThanOrEqual(SILENCE_DEFAULTS.noSpeechMs)
  })

  it('gives up on an accidentally opened microphone', () => {
    const result = run(repeat(QUIET, 400))
    expect(result?.elapsedMs).toBeGreaterThanOrEqual(SILENCE_DEFAULTS.noSpeechMs)
    expect(result?.elapsedMs).toBeLessThan(SILENCE_DEFAULTS.noSpeechMs + 200)
  })

  it('measures from the previous sample, so a throttled timer cannot cut a take short', () => {
    // A background tab delivers samples late. The tracker must still wait the full
    // silence window of *audio time*, not of sample count.
    const tracker = createSilenceTracker()
    expect(tracker.push(LOUD, 0)).toBe(false)
    expect(tracker.push(LOUD, 1000)).toBe(false)
    // 1.5s of silence in one late sample — still inside the 1.8s window.
    expect(tracker.push(QUIET, 2500)).toBe(false)
    expect(tracker.push(QUIET, 3000)).toBe(true)
  })

  it('reports whether it heard anything, so a silent take is not mistaken for a failed one', () => {
    const silent = createSilenceTracker()
    silent.push(QUIET, 0)
    expect(silent.heardSpeech()).toBe(false)

    const spoken = createSilenceTracker()
    spoken.push(LOUD, 0)
    spoken.push(LOUD, 500)
    expect(spoken.heardSpeech()).toBe(true)
  })

  it('measures how much of a recording actually contains speech', () => {
    // The guard that keeps silence away from Whisper. Fed three seconds of
    // nothing, the model returned `"[Musica]"` in one run and
    // `"[Song ang kawakong]"` in another — confidently worded fabrications, and
    // proof that the words came from the model rather than from the microphone.
    expect(speechDurationMs(new Float32Array(16000 * 3))).toBe(0)

    // 16 kHz, so 0.5s of speech is 8000 samples. Alternating ±0.3 keeps the RMS
    // well clear of the floor without needing a real waveform.
    const half = new Float32Array(8000)
    for (let i = 0; i < half.length; i += 1) half[i] = i % 2 === 0 ? 0.3 : -0.3
    expect(speechDurationMs(half)).toBeGreaterThanOrEqual(400)

    // Room noise below the floor is not speech, however long it runs.
    const hum = new Float32Array(16000)
    for (let i = 0; i < hum.length; i += 1) hum[i] = 0.001
    expect(speechDurationMs(hum)).toBe(0)
  })

  it('takes its thresholds as options, so the rule is not buried in the wiring', () => {
    const impatient = createSilenceTracker({ silenceMs: 500, speechRms: 0.05 })
    const spokenSamples = 10
    const result = run([...repeat(0.2, spokenSamples), ...repeat(0, 30)], 60, impatient)
    const gap = (result?.elapsedMs ?? 0) - (spokenSamples - 1) * 60
    expect(gap).toBeGreaterThanOrEqual(500)
    expect(gap).toBeLessThan(620)
  })
})

/**
 * Quiet speech, and the silence it must not be confused with.
 *
 * These cases come from measurement rather than from imagination. Four clean
 * FLEURS `fil_ph` recordings run through the real browser pipeline arrived at
 * 0.018–0.029 RMS — so the absolute 0.02 floor credited barely half of each take —
 * and the same audio 20 dB down credited **0ms**, which the engine turns into "No
 * words were heard" for audio it could have transcribed fine.
 */
function alternating(level: number, ms: number): Float32Array {
  // An alternating ±A waveform has RMS exactly A, which keeps these assertions
  // about levels rather than about a particular waveform.
  const length = Math.round((16000 * ms) / 1000)
  const out = new Float32Array(length)
  for (let i = 0; i < length; i += 1) out[i] = i % 2 === 0 ? level : -level
  return out
}

function concat(parts: Float32Array[]): Float32Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0)
  const out = new Float32Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

describe('a quiet take is heard, and a silent one is still refused', () => {
  // 20 dB down: 0.005 during speech, 0.0005 between phrases.
  const quietSpeech = concat([alternating(0.005, 3000), alternating(0.001, 2000)])
  // A room with no one in it: steady hum at a level the absolute floor ignores.
  const roomNoise = alternating(0.018, 5000)

  it('counts speech that the old absolute floor alone would have refused', () => {
    expect(speechDurationMs(quietSpeech)).toBeGreaterThanOrEqual(2500)
  })

  it('still refuses a take that is nothing but room noise', () => {
    // Every frame is room, so the noise floor and the "speech" are the same level
    // and the relative test cannot pass either — which is the whole reason the
    // absolute floor stays.
    expect(speechDurationMs(roomNoise)).toBe(0)
  })

  it('still refuses digital silence', () => {
    expect(speechDurationMs(new Float32Array(16000 * 5))).toBe(0)
  })
})

describe('software gain (the AGC the browser may not have applied)', () => {
  const quiet = alternating(0.02, 1000)

  const peakOf = (samples: Float32Array): number => {
    let peak = 0
    for (const sample of samples) peak = Math.max(peak, Math.abs(sample))
    return peak
  }

  it('lifts a quiet take by a bounded amount', () => {
    // 0.02 would need 15× to reach the 0.3 target; MAX_GAIN caps it at 8×.
    expect(peakOf(normalisePeak(quiet))).toBeCloseTo(0.16, 5)
  })

  it('leaves alone the level real recordings actually arrive at', () => {
    /*
     * These are the measured peaks of the four FLEURS `fil_ph` clips, and leaving
     * them alone is the whole point: normalizing them to full scale made the
     * shipped model *worse* — 35.6% → 45.2% across the corpus, and 27.3% → 72.7%
     * on one clip. Hence a threshold, not a target alone.
     */
    for (const measured of [0.147, 0.375, 0.181, 0.199]) {
      const clip = alternating(measured, 1000)
      expect(normalisePeak(clip)).toBe(clip)
    }
  })

  it('never attenuates', () => {
    const loud = alternating(0.95, 1000)
    expect(normalisePeak(loud)).toBe(loud)
  })

  it('cannot amplify a silent take into something the gate accepts', () => {
    // The cap is what buys this: uncapped, a 0.002 peak would be lifted to the 0.3
    // target and every frame would clear the floor, handing Whisper room noise to
    // invent a sentence from.
    const silent = alternating(0.002, 3000)
    expect(speechDurationMs(silent)).toBe(0)
    expect(speechDurationMs(normalisePeak(silent))).toBe(0)
  })

  it('lifts a quiet utterance over the gate that used to refuse it', () => {
    // `silent` above is refused outright, so the refusal here cannot be the gate
    // rejecting a level: it is the gate rejecting audibly empty audio.
    expect(speechDurationMs(normalisePeak(concatenatedQuietUtterance()))).toBeGreaterThanOrEqual(2500)
  })
})

/** 20 dB down, with the pauses a real sentence has. */
function concatenatedQuietUtterance(): Float32Array {
  return concat([alternating(0.004, 3000), alternating(0.0008, 2000)])
}
