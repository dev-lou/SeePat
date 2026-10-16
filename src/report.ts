import { formatPHP } from './engine/index.ts'

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
  expensesCentavos: number
  netProfitCentavos: number
  cashCentavos: number
  receivablesCentavos: number
  recordsCount: number
}

export function buildWeeklyReport(input: WeeklyReportInput): string {
  const lines = [
    `SeePat — weekly summary (${input.weekLabel})`,
    `Sales: ${formatPHP(input.revenueCentavos)}`,
    `Expenses: ${formatPHP(input.expensesCentavos)}`,
    `Net profit: ${formatPHP(input.netProfitCentavos)}`,
    `Cash on hand: ${formatPHP(input.cashCentavos)}`,
    `Owed to you: ${formatPHP(input.receivablesCentavos)}`,
    `Records: ${input.recordsCount}`,
  ]
  return lines.join('\n')
}
