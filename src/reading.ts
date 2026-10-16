import { useCallback, useSyncExternalStore } from 'react'
import { readPersisted, writePersisted } from './storage.ts'

/**
 * Reading size — the app's one accessibility setting, and it is here for a
 * specific reader rather than for a checklist.
 *
 * The owner this product is built for is often in her fifties or sixties,
 * reading a small prepaid phone in daylight, sometimes without the glasses she
 * needs. Every size in the interface is written in `rem`, so one root font-size
 * is enough to enlarge the whole app — words, spacing, buttons, the lot —
 * without rewriting a hundred className strings and without a second layout to
 * keep in sync.
 *
 * Three steps, not a slider. A slider invites an owner to settle on a setting
 * that half-works, and it cannot be described in words to someone reading the
 * screen for the first time. `bigger` is 125%, the documented "large print"
 * step that the resize-text criterion is written against; past that the ledger
 * rows start to wrap and the numbers stop lining up.
 *
 * Same store shape as the language setting (see src/i18n/index.ts): a tiny
 * external store with `useSyncExternalStore`, so the value survives a reload,
 * nothing re-renders that does not display it, and non-React code can read it.
 */

export type ReadingSize = 'normal' | 'big' | 'bigger'

/** The scale each step applies to the root font size, and therefore to everything. */
export const READING_SIZES: { id: ReadingSize; scale: number }[] = [
  { id: 'normal', scale: 1 },
  { id: 'big', scale: 1.125 },
  { id: 'bigger', scale: 1.25 },
]

export const DEFAULT_READING: ReadingSize = 'normal'

const READING_STORAGE = { key: 'seepat.reading.v1' }

export function isReadingSize(value: unknown): value is ReadingSize {
  return value === 'normal' || value === 'big' || value === 'bigger'
}

/** The multiplier for a step — 1, 1.125 or 1.25. */
export function readingScale(size: ReadingSize): number {
  return READING_SIZES.find((option) => option.id === size)?.scale ?? 1
}

// --- The store -------------------------------------------------------------

let current: ReadingSize = readStored()

function readStored(): ReadingSize {
  const raw = readPersisted(READING_STORAGE)
  return isReadingSize(raw) ? raw : DEFAULT_READING
}

const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): ReadingSize {
  return current
}

export function getReadingSize(): ReadingSize {
  return current
}

export function setReadingSize(size: ReadingSize): void {
  if (size === current) return
  current = size
  writePersisted(READING_STORAGE, size)
  applyReadingSize()
  for (const listener of listeners) listener()
}

/**
 * The scale itself is a CSS rule keyed off `data-read` on <html> rather than an
 * inline font-size: one declaration in index.css instead of a style write on
 * every change, and it keeps the numbers the design was tuned against in one
 * readable place.
 */
export function applyReadingSize(): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.read = current
}

/** Called once at startup, after the stored preference has been read. */
export function syncReadingSize(): void {
  applyReadingSize()
}

export function useReadingSize(): ReadingSize {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useSetReadingSize(): (size: ReadingSize) => void {
  return useCallback((size: ReadingSize) => setReadingSize(size), [])
}
