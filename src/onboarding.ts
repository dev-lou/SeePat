import { readPersisted, removePersisted, writePersisted } from './storage.ts'

/**
 * The first-run welcome.
 *
 * Shown **once**, not every launch. This is the whole design argument: a tour
 * that reappears on open is an advertisement, and owners learn to dismiss it
 * without reading — which then costs you the one time it actually mattered. So
 * it is gated on a stored, *versioned* flag: bump `WELCOME_VERSION` when the
 * story genuinely changes (a new pillar, a new free tier) and everyone who has
 * ever seen it gets it once more. That is the honest version of "show it again".
 */

/** Bump to re-show the welcome to everyone exactly once. */
export const WELCOME_VERSION = 1

const STORAGE = { key: 'seepat.welcome.v1' }

/** The slides, in order. Copy lives in the i18n table under these keys. */
export const WELCOME_SLIDES = ['speak', 'see', 'yours'] as const
export type WelcomeSlideId = (typeof WELCOME_SLIDES)[number]

export function welcomeSlideCount(): number {
  return WELCOME_SLIDES.length
}

/** The stored flag, as a number, or null when it has never been answered. */
export function welcomeSeenVersion(): number | null {
  const raw = readPersisted(STORAGE)
  if (raw === null) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Whether to show the welcome on this launch. Pure given the stored value, so
 * the rule is testable without touching storage.
 */
export function shouldShowWelcome(seenVersion: number | null, version = WELCOME_VERSION): boolean {
  return seenVersion === null || seenVersion < version
}

export function markWelcomeSeen(version = WELCOME_VERSION): void {
  writePersisted(STORAGE, String(version))
}

/**
 * Forget that the welcome was seen, so it plays again on the next launch.
 * Exposed in Settings rather than hidden, because the deck is the only place the
 * product explains itself and an owner who skipped it in a hurry should be able
 * to get it back without clearing site data.
 */
export function clearWelcomeSeen(): void {
  removePersisted(STORAGE)
}

/** Clamped so a stray key press can never index off the end of the deck. */
export function stepSlide(index: number, delta: number, total = welcomeSlideCount()): number {
  if (total <= 0) return 0
  return Math.min(total - 1, Math.max(0, index + delta))
}

export function isLastSlide(index: number, total = welcomeSlideCount()): boolean {
  return index >= total - 1
}
