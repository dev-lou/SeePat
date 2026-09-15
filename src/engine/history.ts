import { openingInventoryValueCentavos, periodMetrics } from './metrics.ts'
import { addDays, startOfLocalDay } from './period.ts'
import { computeScore } from './score.ts'
import { computeTwin } from './twin.ts'
import type { Centavos } from './money.ts'
import type { ScoreBand } from './score.ts'
import type { Ledger } from './types.ts'
import { dayMonth } from '../i18n/index.ts'
import type { Lang } from '../i18n/index.ts'

/**
 * Sipat Score over time.
 *
 * The concept document promises a score that is reproducible and decomposable,
 * which makes a *history* of it almost free: each past week's score is just the
 * same deterministic function applied to the ledger as it stood at the end of
 * that week. Nothing is stored, nothing is back-filled, and no baseline is
 * invented — re-running it on the same ledger always produces the same line.
 *
 * This is why the history sits in a paid tier while the current score does not.
 * The arithmetic is free, but showing an owner how their business has moved over
 * months is the beginning of benchmarking, and benchmarking needs a server to
 * compare against anyone else. Selling that keeps the free tier genuinely free.
 */

export interface ScoreWeek {
  /** Last day covered by the window, ISO. */
  endsAt: string
  /** Human label for the window, e.g. "Set 8–14". */
  label: string
  value: number
  band: ScoreBand
  revenueCentavos: Centavos
  /** False when the week has no recorded sales — a gap, not a zero. */
  hasData: boolean
}

export interface ScoreTrend {
  /** Oldest week first, so it reads left to right on a chart. */
  weeks: ScoreWeek[]
  /** Latest minus previous, or null when there is nothing to compare. */
  delta: number | null
  direction: 'up' | 'down' | 'flat'
}

/** The ledger as it stood at the end of a given day, inclusive. */
function ledgerAsOf(ledger: Ledger, end: Date): Ledger {
  const cutoff = startOfLocalDay(addDays(end, 1)).getTime() - 1
  return {
    ...ledger,
    transactions: ledger.transactions.filter((t) => new Date(t.at).getTime() <= cutoff),
    voids: ledger.voids.filter((v) => new Date(v.at).getTime() <= cutoff),
  }
}

/** "Set 8–14" / "Sep 8–14": a range, so both ends are formatted from the same table. */
function label(from: Date, to: Date, lang: Lang): string {
  return `${dayMonth(from, lang)}–${dayMonth(to, lang)}`
}

/**
 * The last `weeks` weeks ending today, oldest first. Weeks tile without
 * overlapping, and the final entry is the current week — which therefore equals
 * the score shown on the Score screen, by construction rather than by luck.
 */
export function scoreHistory(ledger: Ledger, weeks: number, now: Date, lang: Lang): ScoreTrend {
  const total = Math.max(1, Math.floor(weeks))
  const result: ScoreWeek[] = []

  for (let i = total - 1; i >= 0; i -= 1) {
    const end = addDays(now, -7 * i)
    const snapshot = ledgerAsOf(ledger, end)
    const metrics = periodMetrics(snapshot, 7, end)
    const score = computeScore(
      {
        twin: computeTwin(snapshot),
        metrics,
        openingInventoryValueCentavos: openingInventoryValueCentavos(snapshot, 7, end),
      },
      lang,
    )

    result.push({
      endsAt: end.toISOString(),
      label: label(startOfLocalDay(addDays(end, -6)), startOfLocalDay(end), lang),
      value: score.value,
      band: score.band,
      revenueCentavos: metrics.revenueCentavos,
      hasData: metrics.revenueCentavos > 0,
    })
  }

  const latest = result[result.length - 1]
  const previous = result[result.length - 2]
  const delta = latest && previous ? latest.value - previous.value : null

  return {
    weeks: result,
    delta,
    direction: delta === null || delta === 0 ? 'flat' : delta > 0 ? 'up' : 'down',
  }
}
