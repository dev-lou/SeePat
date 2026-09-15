import { describe, expect, it } from 'vitest'
import { scoreHistory } from './history.ts'
import { seedLedger } from './demo.ts'
import { computeTwin } from './twin.ts'
import { openingInventoryValueCentavos, periodMetrics } from './metrics.ts'
import { computeScore } from './score.ts'
import type { Ledger } from './types.ts'
import type { Lang } from '../i18n/index.ts'

const NOW = new Date(2026, 8, 20, 18, 0, 0)
const ledger: Ledger = seedLedger(NOW)

function currentScore(l: Ledger, now: Date, lang: Lang): number {
  return computeScore(
    {
      twin: computeTwin(l),
      metrics: periodMetrics(l, 7, now),
      openingInventoryValueCentavos: openingInventoryValueCentavos(l, 7, now),
    },
    lang,
  ).value
}

describe('Sipat Score history', () => {
  it('returns the requested number of weeks, oldest first', () => {
    const trend = scoreHistory(ledger, 4, NOW, 'fil')
    expect(trend.weeks).toHaveLength(4)

    const times = trend.weeks.map((w) => new Date(w.endsAt).getTime())
    expect([...times].sort((a, b) => a - b)).toEqual(times)
  })

  it('ends on the current week, and agrees with the score on the Score screen', () => {
    // If these two ever disagree, one of them is lying to the owner.
    const trend = scoreHistory(ledger, 4, NOW, 'fil')
    const latest = trend.weeks[trend.weeks.length - 1]
    expect(latest.value).toBe(currentScore(ledger, NOW, 'fil'))
  })

  it('is reproducible — the same ledger always yields the same line', () => {
    expect(scoreHistory(ledger, 4, NOW, 'fil')).toEqual(scoreHistory(ledger, 4, NOW, 'fil'))
  })

  it('tiles weeks without overlapping', () => {
    const trend = scoreHistory(ledger, 3, NOW, 'fil')
    const ends = trend.weeks.map((w) => new Date(w.endsAt))
    for (let i = 1; i < ends.length; i += 1) {
      const gapDays = Math.round(
        (ends[i].getTime() - ends[i - 1].getTime()) / (24 * 60 * 60 * 1000),
      )
      expect(gapDays).toBe(7)
    }
  })

  it('marks a week with no sales as a gap rather than a zero score', () => {
    // Shifting "now" far past the seeded history must not invent sales.
    const trend = scoreHistory(ledger, 2, new Date(2027, 0, 20, 18, 0, 0), 'fil')
    for (const week of trend.weeks) {
      expect(week.hasData).toBe(false)
      expect(week.revenueCentavos).toBe(0)
    }
  })

  it('reports direction from the latest two weeks', () => {
    const trend = scoreHistory(ledger, 4, NOW, 'fil')
    if (trend.delta === null) throw new Error('expected a delta with four weeks')
    if (trend.delta > 0) expect(trend.direction).toBe('up')
    else if (trend.delta < 0) expect(trend.direction).toBe('down')
    else expect(trend.direction).toBe('flat')

    const latest = trend.weeks[trend.weeks.length - 1]
    const previous = trend.weeks[trend.weeks.length - 2]
    expect(trend.delta).toBe(latest.value - previous.value)
  })

  it('has no delta to report from a single week', () => {
    const trend = scoreHistory(ledger, 1, NOW, 'fil')
    expect(trend.weeks).toHaveLength(1)
    expect(trend.delta).toBeNull()
    expect(trend.direction).toBe('flat')
  })

  it('keeps every week inside the 0–100 range the score promises', () => {
    for (const week of scoreHistory(ledger, 8, NOW, 'fil').weeks) {
      expect(week.value).toBeGreaterThanOrEqual(0)
      expect(week.value).toBeLessThanOrEqual(100)
    }
  })
})
