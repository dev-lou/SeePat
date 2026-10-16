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

/**
 * The home-screen starter checklist: three steps, resumable, dismissible.
 *
 * A new owner should not have to read a report before her first sale, so the
 * dashboard opens with at most one job per step. State is a small JSON object
 * under its own key — pure helpers, so the rules are testable without storage.
 */

export const CHECKLIST_STEPS = ['sale', 'voice', 'score'] as const
export type ChecklistStep = (typeof CHECKLIST_STEPS)[number]

export interface ChecklistState {
  done: ChecklistStep[]
  dismissed: boolean
}

const CHECKLIST_STORAGE = { key: 'seepat.checklist.v1' }

export function emptyChecklist(): ChecklistState {
  return { done: [], dismissed: false }
}

export function parseChecklist(raw: string | null): ChecklistState {
  if (!raw) return emptyChecklist()
  try {
    const parsed = JSON.parse(raw) as Partial<ChecklistState>
    const done = Array.isArray(parsed.done)
      ? parsed.done.filter((s): s is ChecklistStep => (CHECKLIST_STEPS as readonly string[]).includes(s as string))
      : []
    return { done, dismissed: parsed.dismissed === true }
  } catch {
    return emptyChecklist()
  }
}

export function getChecklist(): ChecklistState {
  return parseChecklist(readPersisted(CHECKLIST_STORAGE))
}

function saveChecklist(state: ChecklistState): void {
  writePersisted(CHECKLIST_STORAGE, JSON.stringify(state))
}

export function markChecklistStep(state: ChecklistState, step: ChecklistStep): ChecklistState {
  if (state.done.includes(step)) return state
  const next = { ...state, done: [...state.done, step] }
  saveChecklist(next)
  return next
}

export function dismissChecklist(state: ChecklistState): ChecklistState {
  const next = { ...state, dismissed: true }
  saveChecklist(next)
  return next
}

export function checklistVisible(state: ChecklistState): boolean {
  return !state.dismissed && state.done.length < CHECKLIST_STEPS.length
}

/** Clamped so a stray key press can never index off the end of the deck. */
export function stepSlide(index: number, delta: number, total = welcomeSlideCount()): number {
  if (total <= 0) return 0
  return Math.min(total - 1, Math.max(0, index + delta))
}

export function isLastSlide(index: number, total = welcomeSlideCount()): boolean {
  return index >= total - 1
}
