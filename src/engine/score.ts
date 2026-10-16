import { clamp, formatPHP, formatPercent, safeDiv, scaleScore } from './money.ts'
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
      term: { en: 'What is left from your sales', fil: 'Natira sa bawat benta' },
      weight: 0.25,
      score: profitability,
      contribution: 0,
      rawValue:
        lang === 'fil'
          ? `${formatPercent(netMargin)} ang natitira sa bawat ₱100 ng benta`
          : `${formatPercent(netMargin)} is left from every ₱100 of sales`,
      explanation: pickCopy(lang, {
        en: 'Out of every ₱100 you sell, this is what stays with you after you pay for the goods. ₱20 or more earns full marks.',
        fil: 'Sa bawat ₱100 ng benta, ito ang natitira sa iyo pagkatapos bayaran ang paninda. ₱20 pataas ang buong marka.',
      }),
    },
    {
      key: 'cash_flow',
      label: { en: 'Cash you can spend', fil: 'Cash na magagamit' },
      term: { en: 'Money in the box vs. spending', fil: 'Pera sa kahon kumpara sa gastos' },
      weight: 0.2,
      score: cashFlow,
      contribution: 0,
      rawValue:
        lang === 'fil'
          ? `Kayang takpan ang ${cashCoverRatio.toFixed(2)} linggong gastos (isang linggo ang pinakamababa)`
          : `Covers ${cashCoverRatio.toFixed(2)} weeks of spending (a week is the minimum)`,
      explanation: pickCopy(lang, {
        en: 'How many weeks the money in the box could keep the store going if nothing sold. Two weeks or more earns full marks.',
        fil: 'Ilang linggo kayang ipagpatuloy ng pera sa kahon ang tindahan kung walang benta. Dalawang linggo pataas ang buong marka.',
      }),
    },
    {
      key: 'inventory_efficiency',
      label: { en: 'How fast stock sells', fil: 'Bilis ng galaw ng paninda' },
      term: { en: 'Stock sold and replaced', fil: 'Panindang naibenta at napalitan' },
      weight: 0.15,
      score: inventoryEfficiency,
      contribution: 0,
      rawValue:
        lang === 'fil'
          ? `Naibenta at napalitan ng ${turnover.toFixed(2)} beses bawat ${metrics.days} araw`
          : `Sold and replaced ${turnover.toFixed(2)} times in ${metrics.days} days`,
      explanation: pickCopy(lang, {
        en: 'How many times your stock was sold and then replaced during this period. Twice or more earns full marks.',
        fil: 'Ilan beses naubos at napalitan ang paninda mo sa panahong ito. Dalawang beses pataas ang buong marka.',
      }),
    },
    {
      key: 'receivable_exposure',
      label: { en: 'Owed to you', fil: 'Utang sa iyo' },
      term: { en: 'Utang not yet collected', fil: 'Utang na hindi pa nakokolekta' },
      weight: 0.15,
      score: receivableExposure,
      contribution: 0,
      rawValue:
        lang === 'fil'
          ? `${formatPercent(exposure)} ng benta ang utang na hindi pa bayad`
          : `${formatPercent(exposure)} of your sales is utang not yet paid`,
      explanation: pickCopy(lang, {
        en: 'How much of your sales is still unpaid by customers. Half of your sales or more scores zero.',
        fil: 'Magkano sa benta mo ang hindi pa bayad ng customers. Kalahati ng benta o higit pa ay zero.',
      }),
    },
    {
      key: 'expense_control',
      label: { en: 'Expenses', fil: 'Gastos' },
      term: { en: 'What it costs to run the store', fil: 'Gastos sa pagpapatakbo' },
      weight: 0.15,
      score: expenseControl,
      contribution: 0,
      rawValue:
        lang === 'fil'
          ? `${formatPercent(expenseRatio)} ng benta ang napupunta sa gastos`
          : `${formatPercent(expenseRatio)} of your sales goes to costs`,
      explanation: pickCopy(lang, {
        en: 'What you spend to run the store, plus spoilage and lost stock, measured against sales. ₱20 or less for every ₱100 earns full marks.',
        fil: 'Ang gastos sa pagpapatakbo, kasama ang panis at nawawalang paninda, kumpara sa benta. ₱20 pababa sa bawat ₱100 ang buong marka.',
      }),
    },
    {
      key: 'sales_stability',
      label: { en: 'Steady sales', fil: 'Tibay ng benta' },
      term: { en: 'Steady or swinging?', fil: 'Pantay ba o pataas-pababa?' },
      weight: 0.1,
      score: salesStability,
      contribution: 0,
      rawValue:
        lang === 'fil'
          ? `Umaalog ang benta ng mga ${(cv * 100).toFixed(0)}% kada araw`
          : `Sales move about ${(cv * 100).toFixed(0)}% up or down a day`,
      explanation: pickCopy(lang, {
        en: 'Whether sales are steady day by day, or swinging up and down. Swinging by as much as double scores zero.',
        fil: 'Pantay ba ang benta araw-araw, o pataas-pababa. Kung dumodoble ang pagbabago, zero.',
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
  // formatPHP, not a hand-built "₱" + number: this figure sits in a sentence next
  // to properly formatted ones, and "₱4159" beside "₱38,998.95" reads as a
  // different kind of number rather than as the same amount of money.
  const owed = formatPHP(receivablesCentavos)
  switch (dim.key) {
    case 'receivable_exposure':
      return pickCopy(lang, {
        en: `Collect first — ${owed} of utang is still unpaid. Collect it before you order again.`,
        fil: `Unahin ang koleksyon — may ${owed} pang utang na hindi pa bayad. Kolektahin bago mag-order ulit.`,
      })
    case 'cash_flow':
      return pickCopy(lang, {
        en: 'Watch the cash: more money is going out than coming in. Move the expenses that can wait.',
        fil: 'Bantayan ang pera: mas malaki ang lumalabas kaysa pumapasok. Ipagpaliban muna ang gastos na kayang hintayin.',
      })
    case 'profitability':
      return pickCopy(lang, {
        en: 'Check the price and the cost of each item — the profit is small next to the sales.',
        fil: 'Tingnan ang presyo at ang gastos sa bawat paninda — maliit ang kita kumpara sa benta.',
      })
    case 'expense_control':
      return pickCopy(lang, {
        en: 'Spend less, or waste less — spoilage and missing stock are part of this number.',
        fil: 'Bawasan ang gastos o ang panis at nawawalang paninda — kasama sila sa bilang na ito.',
      })
    case 'inventory_efficiency':
      return pickCopy(lang, {
        en: 'Some stock is barely selling. Hold off ordering more of the slow ones.',
        fil: 'May panindang mabagal maubos. Iwasan munang mag-order ng mabagal ang galaw.',
      })
    default:
      return pickCopy(lang, {
        en: 'The score is low. The six parts below show which one is pulling it down.',
        fil: 'Mababa ang marka. Makikita sa anim na bahagi sa ibaba kung alin ang humihila nito pababa.',
      })
  }
}
