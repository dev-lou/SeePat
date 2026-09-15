import { describe, expect, it } from 'vitest'
import { SILENCE_DEFAULTS, createSilenceTracker } from './audio.ts'

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

  it('takes its thresholds as options, so the rule is not buried in the wiring', () => {
    const impatient = createSilenceTracker({ silenceMs: 500, speechRms: 0.05 })
    const spokenSamples = 10
    const result = run([...repeat(0.2, spokenSamples), ...repeat(0, 30)], 60, impatient)
    const gap = (result?.elapsedMs ?? 0) - (spokenSamples - 1) * 60
    expect(gap).toBeGreaterThanOrEqual(500)
    expect(gap).toBeLessThan(620)
  })
})
