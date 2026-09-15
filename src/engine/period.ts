import type { Ledger, Transaction } from './types.ts'

/**
 * All dates are handled in the device's local time zone (Asia/Manila for the
 * target market). A sari-sari store closes late and records next morning, so the
 * "day" boundary is a real product concern, not an implementation detail.
 */

export function toDateKey(iso: string): string {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

/** Window start for "the last N days", inclusive of today. */
export function windowStart(days: number, now: Date): Date {
  return startOfLocalDay(addDays(now, -(days - 1)))
}

export function inWindow(iso: string, days: number, now: Date): boolean {
  return new Date(iso).getTime() >= windowStart(days, now).getTime()
}

/** The N date keys ending today, oldest first. */
export function dayKeys(days: number, now: Date): string[] {
  const keys: string[] = []
  for (let i = days - 1; i >= 0; i -= 1) {
    keys.push(toDateKey(addDays(now, -i).toISOString()))
  }
  return keys
}

/** Non-voided transactions inside a window, in chronological order. */
export function transactionsInWindow(
  ledger: Ledger,
  days: number,
  now: Date,
): Transaction[] {
  const voided = new Set(ledger.voids.map((v) => v.txnId))
  const start = windowStart(days, now).getTime()
  return ledger.transactions
    .filter((t) => !voided.has(t.id) && new Date(t.at).getTime() >= start)
    .sort((a, b) => a.at.localeCompare(b.at))
}
