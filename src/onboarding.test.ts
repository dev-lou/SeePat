import { describe, expect, it } from 'vitest'
import { bootHoldMs } from './boot.ts'
import {
  WELCOME_SLIDES,
  WELCOME_VERSION,
  isLastSlide,
  shouldShowWelcome,
  stepSlide,
  welcomeSlideCount,
} from './onboarding.ts'
import { UI } from './i18n/index.ts'
import type { Lang } from './i18n/index.ts'

/**
 * The splash and the welcome deck are the two things a first-time user sees
 * before anything else, and both fail in ways that are invisible from inside the
 * app: a splash that lingers reads as a hang, and a tour that reappears on every
 * launch is the thing people learn to dismiss without reading. So the rules are
 * pure functions and they are asserted here.
 */

describe('splash timing', () => {
  it('holds to the floor when the app boots instantly', () => {
    // 40ms in, with a 900ms floor: 860ms of hold left. A splash that flashed for
    // 40ms would read as a glitch, which is exactly what the floor prevents.
    expect(bootHoldMs(1000, 1040, 900)).toBe(860)
  })

  it('still holds while the floor is running, and releases once it is spent', () => {
    // Half-way to a 900ms floor, there are 400ms left. The floor means "visible
    // for at least this long", not "dismiss the moment either is satisfied".
    expect(bootHoldMs(1000, 1500, 900)).toBe(400)
    expect(bootHoldMs(1000, 1900, 900)).toBe(0)
    expect(bootHoldMs(1000, 9000, 900)).toBe(0)
  })

  it('never becomes a wall: the cap clamps the hold however long the floor is', () => {
    // The floor is a minimum, the cap is a maximum, and the cap wins. A
    // misconfigured floor larger than the cap cannot hold the splash past it —
    // which is the property that keeps this from ever being a hang.
    expect(bootHoldMs(0, 0, 30_000, 2500)).toBe(2500)
    expect(bootHoldMs(0, 2000, 30_000, 2500)).toBe(500)
    expect(bootHoldMs(0, 2600, 30_000, 2500)).toBe(0)
  })
})

describe('first-run welcome', () => {
  it('shows when it has never been seen', () => {
    expect(shouldShowWelcome(null)).toBe(true)
  })

  it('does not show again on the same version — the deck is once, not every launch', () => {
    expect(shouldShowWelcome(WELCOME_VERSION)).toBe(false)
    expect(shouldShowWelcome(WELCOME_VERSION + 5)).toBe(false)
  })

  it('re-shows exactly once when the story genuinely changes', () => {
    // Someone who saw v1 is shown v2, once. This is the only honest way to bring
    // a tour back without becoming an advertisement.
    expect(shouldShowWelcome(WELCOME_VERSION - 1)).toBe(true)
    expect(shouldShowWelcome(0)).toBe(true)
  })

  it('walks the deck and clamps at both ends', () => {
    const total = welcomeSlideCount()
    expect(total).toBeGreaterThanOrEqual(3)
    expect(stepSlide(0, 1, total)).toBe(1)
    expect(stepSlide(total - 1, 1, total)).toBe(total - 1)
    expect(stepSlide(0, -1, total)).toBe(0)
    expect(stepSlide(1, -1, total)).toBe(0)
    // A deck of zero slides must not produce a negative index for an array.
    expect(stepSlide(0, 1, 0)).toBe(0)
  })

  it('knows the last slide, which is what turns "next" into "open the ledger"', () => {
    const total = welcomeSlideCount()
    expect(isLastSlide(0, total)).toBe(false)
    expect(isLastSlide(total - 1, total)).toBe(true)
  })

  it('has copy for every slide in both languages', () => {
    const langs: Lang[] = ['en', 'fil']
    const keys = [
      'welcome.skip',
      'welcome.next',
      'welcome.start',
      'welcome.step',
      'welcome.languageLabel',
      'welcome.tourAgain',
      'welcome.demoNote',
      'welcome.offlineVoice',
      ...WELCOME_SLIDES.flatMap((id) => [
        `welcome.${id}.eyebrow`,
        `welcome.${id}.tagline`,
        `welcome.${id}.body`,
      ]),
    ] as const

    for (const key of keys) {
      const entry = (UI as Record<string, { en: string; fil: string }>)[key]
      expect(entry, `${key} is missing from the copy table`).toBeTruthy()
      for (const lang of langs) {
        expect(entry[lang].trim().length, `${key} is blank in ${lang}`).toBeGreaterThan(0)
      }
    }
  })
})
