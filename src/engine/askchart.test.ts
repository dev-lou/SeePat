import { describe, expect, it } from 'vitest'
import { chartIsWorthDrawing, formatChartValue, weekdayLabels } from './askchart.ts'
import type { AnswerChart } from './askchart.ts'
import { answerIntent } from './narrator.ts'
import type { AskContext, IntentId } from './narrator.ts'
import { capitalComposition } from './capital.ts'
import { formatPHP, pesos } from './money.ts'
import { periodMetrics } from './metrics.ts'
import { addDays } from './period.ts'
import { computeTwin } from './twin.ts'
import { DEMO_SKUS, seedLedger } from './demo.ts'
import type { Ledger } from './types.ts'

/**
 * A chart is a claim about the same numbers as the sentence above it.
 *
 * So the test that matters is not "does it have seven points" — it is that the
 * bars and the words can never disagree. Each intent builds its chart out of the
 * arrays it just used for its own copy, and these tests hold the two side by side
 * and compare them, which is what would catch a refactor that recomputed one and
 * not the other.
 */

const NOW = new Date(2026, 8, 20, 18, 0, 0)
const ledger = seedLedger(NOW)
const context: AskContext = { ledger, twin: computeTwin(ledger), now: NOW }

/**
 * The intents whose answer carries a picture. `slow_movers` is charted too, but
 * the demo store is a well-run one — nothing on its shelf sits unsold for two
 * weeks — so it needs a ledger of its own and is tested further down.
 */
const CHARTED: IntentId[] = [
  'profit_period',
  'capital_where',
  'cash_why_low',
  'top_product',
  'biggest_utang',
  'profit_change',
  'restock',
  'sales_forecast',
  'score',
]

describe('how a chart value reads', () => {
  it('writes money the way money is written everywhere else', () => {
    expect(formatChartValue(123400, 'money', 'en')).toBe('₱1,234.00')
    expect(formatChartValue(123400, 'money', 'fil')).toBe('₱1,234.00')
  })

  it('keeps one decimal on days, because 0.4 days and 0 days are different advice', () => {
    expect(formatChartValue(2.5, 'days', 'en')).toBe('2.5 days')
    expect(formatChartValue(2.5, 'days', 'fil')).toBe('2.5 araw')
  })

  it('writes a score out of a hundred', () => {
    expect(formatChartValue(76.4, 'score', 'en')).toBe('76/100')
  })

  it('writes a plain count with no decimals', () => {
    expect(formatChartValue(7, 'count', 'en')).toBe('7')
  })
})

describe('deciding whether to draw anything at all', () => {
  const chart = (partial: Partial<AnswerChart>): AnswerChart => ({
    shape: 'bars',
    title: 't',
    values: [0],
    labels: ['a'],
    unit: 'money',
    tone: 'brand',
    ...partial,
  })

  it('refuses a chart of nothing', () => {
    expect(chartIsWorthDrawing(chart({ values: [0, 0, 0], labels: ['a', 'b', 'c'] }))).toBe(false)
    expect(
      chartIsWorthDrawing(chart({ shape: 'area', values: [0, 0], labels: ['a', 'b'] })),
    ).toBe(false)
    expect(chartIsWorthDrawing(chart({ shape: 'split', values: [0], labels: ['a'] }))).toBe(false)
  })

  it('draws a week that contains one closed day', () => {
    // A zero inside a real week is a day the store was shut, not missing data.
    expect(
      chartIsWorthDrawing(chart({ shape: 'area', values: [0, 0, 1200], labels: ['a', 'b', 'c'] })),
    ).toBe(true)
  })

  it('draws a bar chart with anything in it, and a line only with two points', () => {
    expect(chartIsWorthDrawing(chart({ values: [500] }))).toBe(true)
    expect(chartIsWorthDrawing(chart({ shape: 'area', values: [500], labels: ['a'] }))).toBe(false)
  })
})

describe('the axis of a daily chart', () => {
  it('is seven weekdays ending today, in the reading language', () => {
    const english = weekdayLabels(7, NOW, 'en')
    const filipino = weekdayLabels(7, NOW, 'fil')
    expect(english).toHaveLength(7)
    // Sep 20 2026 is a Sunday, and the last tick is today.
    expect(english[english.length - 1]).toBe('Sun')
    expect(filipino[filipino.length - 1]).toBe('Lin')
    expect(filipino).not.toEqual(english)
  })
})

describe('every charted answer agrees with its own words', () => {
  it('has a chart on all of them, and none on the rest', () => {
    for (const intent of CHARTED) {
      const answer = answerIntent(intent, context, 'en', 'test')
      expect(answer.chart, `${intent} lost its chart`).toBeDefined()
      expect(answer.chart?.values.length).toBe(answer.chart?.labels.length)
      expect(answer.chart?.title.length).toBeGreaterThan(0)
    }
    // An answer that cannot be drawn — and the ones that answer a general
    // question in words — must not grow a chart of nothing.
    expect(answerIntent('unknown', context, 'en').chart).toBeUndefined()
    expect(answerIntent('capital_provenance', context, 'en').chart).toBeUndefined()
  })

  it('draws the week of sales that the profit answer is built from', () => {
    const metrics = periodMetrics(ledger, 7, NOW)
    const chart = answerIntent('profit_period', context, 'en').chart
    expect(chart?.shape).toBe('area')
    expect(chart?.values).toEqual(metrics.dailySales.map((day) => day.amountCentavos))
    // The chart is a picture OF the revenue the answer reports, so the two
    // readings of it must add up to the same peso.
    expect(chart?.values.reduce((sum, value) => sum + value, 0)).toBe(metrics.revenueCentavos)
    expect(chart?.valueLabel).toBeDefined()
  })

  it('names the same item as the best seller, with the same profit', () => {
    const answer = answerIntent('top_product', context, 'en')
    const chart = answer.chart
    const top = chart?.values[0] ?? 0
    expect(chart?.labels[0]).toBe(answer.evidence[0].label)
    expect(formatPHP(top)).toBe(answer.evidence[0].value)
    // And the headline names it too — one ranking, three renderings.
    expect(answer.headline.startsWith(`${chart?.labels[0]} is your best seller`)).toBe(true)
  })

  it('ranks the utang chart from the same ledger the headline names', () => {
    const answer = answerIntent('biggest_utang', context, 'en')
    const chart = answer.chart
    const headlineFigure = answer.headline.match(/₱[\d,.]+\.\d{2}/)?.[0]
    expect(headlineFigure).toBeDefined()
    expect(formatPHP(chart?.values[0] ?? 0)).toBe(headlineFigure)
    expect(chart?.values).toEqual([...chart!.values].sort((a, b) => b - a))
  })

  it('leaves an empty answer uncharted', () => {
    // "No sales in this period yet" has no shape, and a chart of zeroes beside it
    // would invent a flat, healthy-looking week out of missing data.
    const answer = answerIntent('slow_movers', context, 'en')
    expect(answer.detail).toHaveLength(0)
    expect(answer.chart).toBeUndefined()
  })

  it('draws restocking in days of cover, and name the same item as the headline', () => {
    const answer = answerIntent('restock', context, 'en')
    const chart = answer.chart
    expect(chart?.unit).toBe('days')
    expect(answer.headline).toContain(chart?.labels[0] ?? '')
    expect(answer.detail[0]).toContain(formatChartValue(chart?.values[0] ?? 0, 'days', 'en'))
  })

  it('compares the same two weeks the profit-change answer compares', () => {
    const chart = answerIntent('profit_change', context, 'en').chart
    expect(chart?.values).toHaveLength(2)
    expect(chart?.labels).toEqual(['Week before', 'This week'])
  })

  it('shows the whole of the capital it is a share of', () => {
    const composition = capitalComposition(context.twin, 'en')
    const positives = composition.components.filter((c) => c.amountCentavos > 0)
    const chart = answerIntent('capital_where', context, 'en').chart
    // Offsets are excluded on purpose: money owed to a supplier is not a place
    // capital sits, and stacking it would count part of the capital twice.
    expect(chart?.values).toEqual(positives.map((c) => c.amountCentavos))
    expect(chart?.labels).toEqual(positives.map((c) => c.label.en))
    expect(chart?.shape).toBe('split')
  })

  it('shows where the money is, using the figures the cash answer quotes', () => {
    const answer = answerIntent('cash_why_low', context, 'en')
    const chart = answer.chart
    const quoted = answer.evidence.map((item) => item.value)
    expect(chart?.shape).toBe('split')
    for (const value of chart?.values ?? []) {
      expect(quoted).toContain(formatPHP(value))
    }
  })

  it('breaks the score into the parts the answer lists', () => {
    const answer = answerIntent('score', context, 'en')
    const chart = answer.chart
    expect(chart?.unit).toBe('score')
    expect(chart?.values.length).toBe(answer.detail.length)
    expect(chart?.values.length).toBe(chart?.labels.length)
    for (const value of chart?.values ?? []) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(100)
    }
    // Each bar is the same number the line under it prints.
    expect(answer.detail[0]).toContain(formatChartValue(chart?.values[0] ?? 0, 'score', 'en'))
  })
})

describe('a shelf with something stuck on it', () => {
  /*
   * A second, hand-made store: one item bought 20 days ago and never sold. That
   * is the case the chart exists for, and it is the one the demo data cannot
   * reach — so it is built here rather than left untested.
   */
  const stuck: Ledger = {
    ...ledger,
    skus: [
      ...DEMO_SKUS,
      { id: 'kalamansi', name: 'Kalamansi (luma)', unit: 'pc', baseUnit: 'pc', aliases: ['kalamansi'] },
    ],
    transactions: [
      ...ledger.transactions,
      {
        id: 'pur-stuck-0001',
        at: addDays(NOW, -20).toISOString(),
        kind: 'purchase' as const,
        lines: [{ skuId: 'kalamansi', qty: 40, unitCostCentavos: pesos(3) }],
        paidCentavos: pesos(120),
        note: 'Bili ng kalamansi',
      },
    ],
  }
  const slowContext: AskContext = { ledger: stuck, twin: computeTwin(stuck), now: NOW }

  it('draws the stuck stock the answer priced, item for item', () => {
    const answer = answerIntent('slow_movers', slowContext, 'en')
    const chart = answer.chart
    expect(chart?.shape).toBe('bars')
    expect(chart?.unit).toBe('money')
    expect(chart?.labels[0]).toBe('Kalamansi (luma)')
    // The bar and the line under it are one number: what the stock is worth.
    expect(answer.detail[0]).toContain(chart?.labels[0] ?? '')
    expect(answer.detail[0]).toContain(formatPHP(chart?.values[0] ?? 0))
  })

  it('still writes the chart in the asked language', () => {
    const english = answerIntent('slow_movers', slowContext, 'en').chart
    const filipino = answerIntent('slow_movers', slowContext, 'fil').chart
    expect(filipino?.title).not.toBe(english?.title)
    expect(filipino?.values).toEqual(english?.values)
  })
})

describe('a chart is written in the language it is read in', () => {
  it('translates the words and leaves the numbers alone', () => {
    for (const intent of CHARTED) {
      const english = answerIntent(intent, context, 'en').chart
      const filipino = answerIntent(intent, context, 'fil').chart
      expect(english?.title).toBeTruthy()
      expect(filipino?.title).toBeTruthy()
      expect(filipino?.title).not.toBe(english?.title)
      expect(filipino?.caption).not.toBe(english?.caption)
      // The money is the money: only the words around it may differ.
      expect(filipino?.values).toEqual(english?.values)
    }
  })

  it('names the same accounts in both languages', () => {
    const english = answerIntent('biggest_utang', context, 'en').chart
    const filipino = answerIntent('biggest_utang', context, 'fil').chart
    // Customer names are the owner's own words, so they are never translated.
    expect(filipino?.labels).toEqual(english?.labels)
  })
})
