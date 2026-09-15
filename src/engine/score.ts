import { clamp, formatPercent, safeDiv, scaleScore } from './money.ts'
import { deriveTwin } from './twin.ts'
import type { PeriodMetrics } from './metrics.ts'
import type { BusinessTwin } from './types.ts'
import { pick as pickCopy } from '../i18n/index.ts'
import type { Bilingual, Lang } from '../i18n/index.ts'

/**
 * Sipat Score v1.
 *
 * The concept document promised a score that is "not an arbitrary AI-generated
 * score" and that "every score must be decomposable into its contributing
 * metrics" — but it never published weights, normalisation, or a baseline, which
 * left it underdetermined and therefore not reproducible. The weights and every
 * scoring formula are fixed and versioned here so the same ledger always yields
 * the same score.
 */

export const SCORE_VERSION = 'Sipat-Score v1'

/**
 * Bands are KEYS, not words.
 *
 * They used to *be* the Filipino labels ('Malakas', 'Maayos', …), which meant a
 * band could not be stored, compared, or translated without every consumer
 * knowing the display language. A band is a fact about the business — how strong
 * the reading is — so it is named as one, and dressed by `bandLabel` at the point
 * of display.
 */
export type ScoreBand = 'strong' | 'good' | 'watch' | 'critical'

export const BAND_COPY: Record<ScoreBand, Bilingual> = {
  strong: { en: 'Strong', fil: 'Malakas' },
  good: { en: 'Good', fil: 'Maayos' },
  watch: { en: 'Watch', fil: 'Bantayan' },
  critical: { en: 'At risk', fil: 'Problema' },
}

export function bandLabel(band: ScoreBand, lang: Lang): string {
  return pickCopy(lang, BAND_COPY[band])
}

export interface ScoreDimension {
  key: string
  /** Short tag, as it appears beside the bar. */
  label: Bilingual
  /** The formal name of the measure, shown as the subtitle. */
  term: Bilingual
  weight: number
  /** 0–100 sub-score. */
  score: number
  /** weight × score, the amount this dimension contributes to the total. */
  contribution: number
  /** Formatted in the language the score was computed in. */
  rawValue: string
  explanation: string
}

export interface BusinessScore {
  version: string
  value: number
  band: ScoreBand
  dimensions: ScoreDimension[]
  strengths: string[]
  watch: string[]
  priorities: string[]
  /** False while there is too little history for the ratios to mean anything. */
  sufficientData: boolean
}

export function bandFor(value: number): ScoreBand {
  if (value >= 85) return 'strong'
  if (value >= 70) return 'good'
  if (value >= 50) return 'watch'
  return 'critical'
}

function coefficientOfVariation(values: number[]): number {
  const usable = values.filter((v) => Number.isFinite(v))
  if (usable.length < 2) return 0
  const mean = usable.reduce((s, v) => s + v, 0) / usable.length
  if (mean <= 0) return 0
  const variance =
    usable.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (usable.length - 1)
  return Math.sqrt(variance) / mean
}

export interface ScoreContext {
  twin: BusinessTwin
  metrics: PeriodMetrics
  /** Inventory value at the start of the window, for turnover. */
  openingInventoryValueCentavos: number
}

export function computeScore(
  { twin, metrics, openingInventoryValueCentavos }: ScoreContext,
  /** The language the words come back in. The arithmetic never changes. */
  lang: Lang,
): BusinessScore {
  const d = deriveTwin(twin)
  const revenue = metrics.revenueCentavos
  const netMargin = metrics.netMargin

  // 1. Profitability — net margin, 0% → 0, 20%+ → 100.
  const profitability = scaleScore(netMargin, 0, 0.2)

  // 2. Cash-flow health — cash cover against a week of operating outflow.
  const dailyOutflow = safeDiv(metrics.cogsCentavos + metrics.expensesCentavos, metrics.days)
  const weeklyOutflow = dailyOutflow * 7
  const cashCoverRatio = safeDiv(twin.cashCentavos, weeklyOutflow)
  const cashFlow = scaleScore(cashCoverRatio, 0, 2)

  // 3. Inventory efficiency — COGS against the inventory carrying it.
  const turningInventory = objectTotal(twin.inventory)
  const avgInventory = (turningInventory + openingInventoryValueCentavos) / 2
  const turnover = safeDiv(metrics.cogsCentavos, Math.max(1, avgInventory))
  const inventoryEfficiency = scaleScore(turnover, 0, 2)

  // 4. Receivable exposure — outstanding utang against period sales. Lower is better.
  const exposure = safeDiv(d.receivablesCentavos, revenue)
  const receivableExposure = 100 - scaleScore(exposure, 0, 0.5)

  // 5. Expense control — operating costs as a share of sales. Lower is better.
  const expenseRatio = safeDiv(metrics.expensesCentavos + metrics.shrinkageCentavos, revenue)
  const expenseControl = scaleScore(expenseRatio, 0.7, 0.2)

  // 6. Sales stability — day-to-day consistency. Lower variation is better.
  const cv = coefficientOfVariation(metrics.dailySales.map((x) => x.amountCentavos))
  const salesStability = 100 - scaleScore(cv, 0, 1)

  const dimensions: ScoreDimension[] = [
    {
      key: 'profitability',
      label: { en: 'Profit', fil: 'Kita' },
      term: { en: 'Profitability', fil: 'Kita sa bawat benta' },
      weight: 0.25,
      score: profitability,
      contribution: 0,
      rawValue: formatPercent(netMargin),
      explanation: pickCopy(lang, {
        en: 'Net margin over the period. 20% or better scores full marks.',
        fil: 'Net margin sa buong panahon. Bente porsyento o higit pa ang buong marka.',
      }),
    },
    {
      key: 'cash_flow',
      label: { en: 'Cash', fil: 'Cash' },
      term: { en: 'Cash-flow health', fil: 'Kalagayan ng cash' },
      weight: 0.2,
      score: cashFlow,
      contribution: 0,
      rawValue:
        lang === 'fil'
          ? `${cashCoverRatio.toFixed(2)}x linggong gastos`
          : `${cashCoverRatio.toFixed(2)}x a week of outflow`,
      explanation: pickCopy(lang, {
        en: 'How many weeks of operating outflow your cash on hand could cover. 2x scores full marks.',
        fil: 'Ilang linggo ng gastos ang kayang takpan ng cash mo ngayon. Dalawang beses ang buong marka.',
      }),
    },
    {
      key: 'inventory_efficiency',
      label: { en: 'Stock turnover', fil: 'Galaw ng Paninda' },
      term: { en: 'Inventory efficiency', fil: 'Bilis ng galaw ng paninda' },
      weight: 0.15,
      score: inventoryEfficiency,
      contribution: 0,
      rawValue:
        lang === 'fil'
          ? `${turnover.toFixed(2)}x bawat ${metrics.days} araw`
          : `${turnover.toFixed(2)}x in ${metrics.days} days`,
      explanation: pickCopy(lang, {
        en: 'How many times your average inventory turned over in the period.',
        fil: 'Ilan beses naikot ang karaniwang paninda mo sa buong panahon.',
      }),
    },
    {
      key: 'receivable_exposure',
      label: { en: 'Owed to you', fil: 'Utang sa Iyo' },
      term: { en: 'Receivable exposure', fil: 'Laki ng utang sa iyo' },
      weight: 0.15,
      score: receivableExposure,
      contribution: 0,
      rawValue: formatPercent(exposure),
      explanation: pickCopy(lang, {
        en: 'Outstanding utang as a share of period sales. At 50% or above this scores zero.',
        fil: 'Utang na hindi pa bayad kumpara sa benta ng panahon. Singkwenta porsyento pataas ay zero.',
      }),
    },
    {
      key: 'expense_control',
      label: { en: 'Expenses', fil: 'Gastos' },
      term: { en: 'Expense control', fil: 'Kontrol sa gastos' },
      weight: 0.15,
      score: expenseControl,
      contribution: 0,
      rawValue: formatPercent(expenseRatio),
      explanation: pickCopy(lang, {
        en: 'Operating costs plus shrinkage as a share of sales. 20% or below scores full marks.',
        fil: 'Gastos at panis/nawala kumpara sa benta. Bente porsyento pababa ang buong marka.',
      }),
    },
    {
      key: 'sales_stability',
      label: { en: 'Sales stability', fil: 'Tibay ng Benta' },
      term: { en: 'Sales stability', fil: 'Tibay ng benta' },
      weight: 0.1,
      score: salesStability,
      contribution: 0,
      rawValue: cv.toFixed(2),
      explanation: pickCopy(lang, {
        en: 'Day-to-day variation in sales. A variation of 100% or more scores zero.',
        fil: 'Pagbabago ng benta araw-araw. Isandaang porsyento pataas na pagbabago ay zero.',
      }),
    },
  ]

  for (const dim of dimensions) {
    dim.score = clamp(dim.score)
    dim.contribution = dim.score * dim.weight
  }

  const value = Math.round(dimensions.reduce((sum, dim) => sum + dim.contribution, 0))
  const byScore = [...dimensions].sort((a, b) => b.score - a.score)

  const strengths = byScore
    .filter((dim) => dim.score >= 70)
    .slice(0, 2)
    .map((dim) => `${pickCopy(lang, dim.label)} — ${dim.rawValue}`)

  const watch = byScore
    .filter((dim) => dim.score < 70 && dim.score >= 45)
    .slice(0, 2)
    .map((dim) => `${pickCopy(lang, dim.label)} — ${dim.rawValue}`)

  const worst = byScore[byScore.length - 1]
  const priorities: string[] = []
  if (worst && worst.score < 60) {
    priorities.push(priorityFor(worst, d.receivablesCentavos, lang))
  }

  return {
    version: SCORE_VERSION,
    value,
    band: bandFor(value),
    dimensions,
    strengths,
    watch,
    priorities,
    sufficientData: revenue > 0 && metrics.days >= 3,
  }
}

function objectTotal(record: Record<string, { valueCentavos: number }>): number {
  return Object.values(record).reduce((sum, s) => sum + s.valueCentavos, 0)
}

function priorityFor(
  dim: ScoreDimension,
  receivablesCentavos: number,
  lang: Lang,
): string {
  const owed = (receivablesCentavos / 100).toFixed(0)
  switch (dim.key) {
    case 'receivable_exposure':
      return pickCopy(lang, {
        en: `Collect first — ₱${owed} is still tied up in utang before you add another order.`,
        fil: `Unahin ang koleksyon — may ${owed} piso pang nakabinbin sa utang bago magdagdag ng order.`,
      })
    case 'cash_flow':
      return pickCopy(lang, {
        en: 'Watch the cash: more is going out than coming in. Delay expenses that can wait.',
        fil: 'Bantayan ang cash: mas maigting ang paglabas kaysa pagpasok. Ipagpaliban ang hindi kailangang gastos.',
      })
    case 'profitability':
      return pickCopy(lang, {
        en: 'Review the price and the cost of each item — profit is thin next to the sales.',
        fil: 'Repasuhin ang presyo at ang gastos sa bawat paninda — mahina ang kita kumpara sa benta.',
      })
    case 'expense_control':
      return pickCopy(lang, {
        en: 'Cut expenses, or cut the spoilage and missing stock.',
        fil: 'Bawasan ang gastos o ang panis/nawawalang paninda.',
      })
    case 'inventory_efficiency':
      return pickCopy(lang, {
        en: 'Some stock is barely moving. Hold off ordering the slow ones.',
        fil: 'May panindang mabagal gumalaw. Iwasan munang mag-order ng mabagal ang galaw.',
      })
    default:
      return pickCopy(lang, {
        en: 'The business is scoring low. Look at each part below.',
        fil: 'Mababa ang marka ng negosyo. Tingnan ang bawat bahagi sa ibaba.',
      })
  }
}
