import { describe, expect, it } from 'vitest'
import { seedLedger } from './engine/demo.ts'
import type { Ledger } from './engine/index.ts'
import { periodReport, reportRange } from './report.ts'

/**
 * Reports cover any range — today, this week, this month, this year, and the
 * past ones — and every figure comes from the same double-fold the engine's
 * own `periodMetrics` uses, so a sheet can never contradict the ledger.
 */

const NOW = new Date(2026, 9, 19, 12, 0, 0)

function figures(kind: 'day' | 'week' | 'month' | 'year', offset = 0) {
  const ledger = seedLedger(NOW)
  const range = reportRange(kind, offset, NOW)
  return { range, report: periodReport(ledger, range.start, range.end) }
}

describe('reportRange', () => {
  it('tiles day, week, month and year around now', () => {
    const day = reportRange('day', 0, NOW)
    expect(day.start.getDate()).toBe(19)
    expect(day.end.getDate()).toBe(19)

    const week = reportRange('week', 0, NOW)
    expect(week.end.getDate()).toBe(19)
    expect(week.start.getDate()).toBe(13)

    const month = reportRange('month', 0, NOW)
    expect(month.start.getDate()).toBe(1)
    expect(month.start.getMonth()).toBe(9)
    expect(month.end.getMonth()).toBe(9)

    const year = reportRange('year', 0, NOW)
    expect(year.start.getMonth()).toBe(0)
    expect(year.end.getMonth()).toBe(11)
    expect(year.end.getDate()).toBe(31)
  })

  it('steps cleanly into the past without overlapping', () => {
    const thisMonth = reportRange('month', 0, NOW)
    const lastMonth = reportRange('month', -1, NOW)
    expect(lastMonth.end.getTime()).toBeLessThan(thisMonth.start.getTime())
    expect(lastMonth.start.getMonth()).toBe(8)

    const lastYear = reportRange('year', -1, NOW)
    expect(lastYear.start.getFullYear()).toBe(2025)
    expect(lastYear.end.getFullYear()).toBe(2025)
  })

  it('never reaches into the future', () => {
    expect(reportRange('month', 3, NOW).offset).toBe(0)
    expect(reportRange('day', 1, NOW).start.getDate()).toBe(19)
  })
})

describe('periodReport', () => {
  it('nests: a day sits inside its week inside its month', () => {
    const day = figures('day')
    const week = figures('week')
    const month = figures('month')
    expect(day.report.revenueCentavos).toBeLessThanOrEqual(week.report.revenueCentavos)
    expect(week.report.revenueCentavos).toBeLessThanOrEqual(month.report.revenueCentavos)
    expect(day.report.recordsCount).toBeLessThanOrEqual(week.report.recordsCount)
    expect(week.report.recordsCount).toBeLessThanOrEqual(month.report.recordsCount)
  })

  it('reads cash and debts as they stood then, not today', () => {
    const { report } = figures('month', -12)
    // A year before the seed starts there is nothing: no sales, no drawer.
    expect(report.revenueCentavos).toBe(0)
    expect(report.cashCentavos).toBe(0)
    expect(report.receivablesCentavos).toBe(0)
    expect(report.recordsCount).toBe(0)
  })

  it('splits cash into drawer and e-wallets, so the sheet matches the dashboard card', () => {
    // A GCash sale is money, but it is not in the drawer: the report carries
    // both, and drawer plus wallet reconciles to total cash.
    const at = new Date(NOW.getTime() - 3600_000).toISOString()
    const ledger: Ledger = {
      skus: [{ id: 'coke', name: 'Coke Mismo', unit: 'pc', baseUnit: 'pc', aliases: [] }],
      customers: [],
      transactions: [
        {
          id: 'sal-1',
          at,
          kind: 'cash_sale',
          lines: [{ skuId: 'coke', qty: 1, unitPriceCentavos: 2500 }],
          channel: 'gcash',
        },
      ],
      voids: [],
    }
    const range = reportRange('day', 0, NOW)
    const report = periodReport(ledger, range.start, range.end)
    expect(report.cashCentavos).toBe(2500)
    expect(report.walletCentavos).toBe(2500)
    expect(report.cashCentavos - report.walletCentavos).toBe(0)
  })

  it('counts real money on a lived-in month', () => {
    const { report } = figures('month')
    expect(report.revenueCentavos).toBeGreaterThan(0)
    expect(report.recordsCount).toBeGreaterThan(0)
    expect(report.netProfitCentavos).toBeLessThanOrEqual(report.revenueCentavos)
  })
})
