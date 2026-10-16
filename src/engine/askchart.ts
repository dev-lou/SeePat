/**
 * The shape of an answer, when words alone are not enough.
 *
 * "Magkano ang kita ko this week?" is a question with a *shape* — seven days,
 * one line, the last point lit — and the engine has always computed that series
 * (`periodMetrics.dailySales`) without ever drawing it. This module is the
 * contract between the two: a small, closed payload an answer can carry, and the
 * one place that decides how a number in it reads out loud on a chart.
 *
 * Why the chart rides ON the answer instead of being derived beside it: the two
 * must never disagree. If the Ask screen recomputed "top product" for the chart,
 * a change to the ranking rule would move the chart and leave the headline
 * behind, and the app would show two different answers to one question. So each
 * intent builds its chart out of the *same* arrays it just used for its own
 * sentences — see `narrator.ts` — and `askchart.test.ts` asserts they match.
 *
 * `unit` exists because a chart of money and a chart of days are both bar lists,
 * and the only thing that differs is how a value is written. Keeping the unit in
 * the data means the renderer never has to guess from context.
 */

import { formatPHP } from './money.ts'
import { dayKeys } from './period.ts'
import { pick, weekdayShort } from '../i18n/index.ts'
import type { Bilingual, Lang } from '../i18n/index.ts'

export type ChartShape = 'area' | 'bars' | 'split'
export type ChartUnit = 'money' | 'days' | 'score' | 'count'
export type ChartTone = 'brand' | 'gold' | 'sky'

export interface AnswerChart {
  shape: ChartShape
  /** Heading above the chart, in the reading language. */
  title: string
  /**
   * The one line that stops the chart lying. A sales line is not a profit line,
   * and a chart without that sentence would let an owner read revenue as income.
   */
  caption?: string
  values: number[]
  labels: string[]
  unit: ChartUnit
  tone: ChartTone
  /** Chip pinned to the most recent point of an area chart. */
  valueLabel?: string
}

/**
 * Whether a chart is worth drawing at all.
 *
 * A chart of nothing is worse than no chart: `emptyAnswer` intents (no sales
 * yet, nothing stuck on the shelf) still carry a chart payload, and an axis of
 * zeroes beside "no sales in this period yet" invents a flat, healthy-looking
 * week out of missing data. One zero-valued day inside a real week is a
 * different thing — that is a closed day, and it belongs on the chart.
 */
export function chartIsWorthDrawing(chart: AnswerChart): boolean {
  if (chart.shape === 'area' && chart.values.length < 2) return false
  return chart.values.some((value) => value !== 0)
}

export function formatChartValue(value: number, unit: ChartUnit, lang: Lang): string {
  switch (unit) {
    case 'money':
      return formatPHP(value)
    case 'days':
      // One decimal, because "0.4 days left" and "0 days left" are different
      // pieces of advice and rounding the first to the second is a lie.
      return `${value.toFixed(1)} ${pick(lang, DAYS)}`
    case 'score':
      return `${Math.round(value)}/100`
    case 'count':
    default:
      return String(Math.round(value))
  }
}

const DAYS: Bilingual = { en: 'days', fil: 'araw' }

/**
 * Weekday ticks for a daily series.
 *
 * Built from `dayKeys`, the same function `periodMetrics` buckets its days with,
 * so the labels and the values are guaranteed to be the same seven days in the
 * same order — the classic chart bug is a one-day offset between axis and data,
 * and it cannot happen if both come from one list.
 *
 * Midday is pinned before formatting so a date key cannot slide into the previous
 * day in a timezone behind UTC.
 */
export function weekdayLabels(days: number, now: Date, lang: Lang): string[] {
  return dayKeys(days, now).map((key) => weekdayShort(new Date(`${key}T12:00:00`), lang))
}
