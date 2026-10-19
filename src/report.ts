import { addDays, computeTwin, endOfLocalDay, endOfMonth, endOfYear, startOfLocalDay, startOfMonth, startOfYear } from './engine/index.ts'
import { formatPHP } from './engine/index.ts'
import type { Ledger } from './engine/index.ts'

/**
 * The printable weekly report: one page a coop manager can file.
 *
 * Pure text assembly from already-computed figures — no layout engine, no
 * server. The UI renders it inside a print-only surface (see print CSS) and
 * calls `window.print()`. Reports are table stakes per the market research;
 * *printable-for-the-accountant* is the job that justifies money.
 */

export interface WeeklyReportInput {
  weekLabel: string
  revenueCentavos: number
  cogsCentavos: number
  expensesCentavos: number
  shrinkageCentavos: number
  netProfitCentavos: number
  cashCentavos: number
  /** The part of `cashCentavos` sitting in e-wallets rather than the drawer. */
  walletCentavos: number
  receivablesCentavos: number
  recordsCount: number
}

/**
 * Figures for any calendar range, computed the same way `periodMetrics` folds
 * the ledger twice (before-start vs up-to-end) so windowed COGS stays correct.
 * Cash and receivables are read as they stood at the end of the range — a past
 * month's sheet must show that month's drawer, not today's.
 */
export type ReportKind = 'day' | 'week' | 'month' | 'year'

export interface ReportRange {
  kind: ReportKind
  /** 0 = current, -1 = previous, … — the future is never selectable. */
  offset: number
  start: Date
  end: Date
}

export function reportRange(kind: ReportKind, offset: number, now: Date): ReportRange {
  const back = Math.min(0, Math.floor(offset))
  if (kind === 'day') {
    const day = addDays(now, back)
    return { kind, offset: back, start: startOfLocalDay(day), end: endOfLocalDay(day) }
  }
  if (kind === 'week') {
    const end = endOfLocalDay(addDays(now, 7 * back))
    return { kind, offset: back, start: startOfLocalDay(addDays(end, -6)), end }
  }
  if (kind === 'month') {
    const anchor = new Date(now.getFullYear(), now.getMonth() + back, 1)
    return { kind, offset: back, start: startOfMonth(anchor), end: endOfMonth(anchor) }
  }
  const anchor = new Date(now.getFullYear() + back, 0, 1)
  return { kind, offset: back, start: startOfYear(anchor), end: endOfYear(anchor) }
}

export interface PeriodReport {
  revenueCentavos: number
  cogsCentavos: number
  expensesCentavos: number
  shrinkageCentavos: number
  netProfitCentavos: number
  cashCentavos: number
  walletCentavos: number
  receivablesCentavos: number
  recordsCount: number
}

export function periodReport(ledger: Ledger, start: Date, end: Date): PeriodReport {
  const startMs = start.getTime()
  const endMs = end.getTime()
  const voided = new Set(ledger.voids.map((v) => v.txnId))

  const before: Ledger = {
    ...ledger,
    transactions: ledger.transactions.filter((t) => new Date(t.at).getTime() < startMs),
  }
  const upto: Ledger = {
    ...ledger,
    transactions: ledger.transactions.filter((t) => new Date(t.at).getTime() <= endMs),
  }
  const opening = computeTwin(before)
  const closing = computeTwin(upto)

  const revenueCentavos = closing.revenueCentavos - opening.revenueCentavos
  const cogsCentavos = closing.cogsCentavos - opening.cogsCentavos
  const expensesCentavos = closing.expensesCentavos - opening.expensesCentavos
  const shrinkageCentavos = closing.shrinkageCentavos - opening.shrinkageCentavos
  const receivablesCentavos = Object.values(closing.receivables).reduce((s, v) => s + v, 0)
  const recordsCount = ledger.transactions.filter(
    (t) => !voided.has(t.id) && new Date(t.at).getTime() >= startMs && new Date(t.at).getTime() <= endMs,
  ).length

  return {
    revenueCentavos,
    cogsCentavos,
    expensesCentavos,
    shrinkageCentavos,
    netProfitCentavos: revenueCentavos - cogsCentavos - expensesCentavos - shrinkageCentavos,
    cashCentavos: closing.cashCentavos,
    walletCentavos: closing.walletCentavos,
    receivablesCentavos,
    recordsCount,
  }
}

export function buildWeeklyReport(input: WeeklyReportInput, title = 'SeePat — weekly summary'): string {
  // Cost of goods is printed for the same reason it now shows under the
  // dashboard hero: without it, Sales minus Expenses does not equal the
  // profit on the same page, and the paper looks wrong to anyone who checks.
  const lines = [
    `${title} (${input.weekLabel})`,
    `Sales: ${formatPHP(input.revenueCentavos)}`,
    `Cost of goods: ${formatPHP(input.cogsCentavos)}`,
    `Expenses: ${formatPHP(input.expensesCentavos)}`,
  ]
  if (input.shrinkageCentavos > 0) {
    lines.push(`Spoilage & losses: ${formatPHP(input.shrinkageCentavos)}`)
  }
  // Cash is printed split, never as one lump: a single "cash on hand" line
  // once read ₱37k on paper while the dashboard card read ₱39k, because the
  // card counts the drawer and the report counted everything. The drawer line
  // below is the same number the dashboard shows, so the two can never
  // disagree again; the wallet line appears whenever e-money is nonzero —
  // including negative, which is the tell that a GCash payment was recorded
  // as cash. Drawer plus wallet always reconciles to total cash.
  lines.push(`Net profit: ${formatPHP(input.netProfitCentavos)}`)
  lines.push(`Cash in drawer: ${formatPHP(input.cashCentavos - input.walletCentavos)}`)
  if (input.walletCentavos !== 0) {
    lines.push(`In GCash/Maya: ${formatPHP(input.walletCentavos)}`)
  }
  lines.push(
    `Owed to you: ${formatPHP(input.receivablesCentavos)}`,
    `Records: ${input.recordsCount}`,
  )
  return lines.join('\n')
}
