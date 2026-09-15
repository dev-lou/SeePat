import { formatPHP, formatPercent, safeDiv } from './money.ts'
import { addDays } from './period.ts'
import { openingInventoryValueCentavos, periodMetrics } from './metrics.ts'
import { capitalComposition, capitalProvenance } from './capital.ts'
import { computeScore, bandLabel } from './score.ts'
import { deriveTwin } from './twin.ts'
import type { BusinessTwin, CustomerId, Ledger, SkuId } from './types.ts'
import { pick as pickCopy } from '../i18n/index.ts'
import type { Lang } from '../i18n/index.ts'

/**
 * "Ask My Negosyo" without an LLM.
 *
 * Every answer here is computed from the Business Twin by fixed templates, which
 * means it works offline, costs nothing per question, and can never hallucinate a
 * number. An LLM layer may later re-phrase these results — but it never produces
 * them. This is the trust architecture of section 5 made executable.
 */

export type IntentId =
  | 'profit_period'
  | 'capital_where'
  | 'capital_provenance'
  | 'cash_why_low'
  | 'top_product'
  | 'slow_movers'
  | 'biggest_utang'
  | 'profit_change'
  | 'restock'
  | 'score'
  | 'sales_forecast'
  | 'unknown'

export interface EvidenceItem {
  label: string
  value: string
}

export interface Answer {
  intent: IntentId
  question: string
  headline: string
  detail: string[]
  evidence: EvidenceItem[]
  actions: string[]
}

export interface AskContext {
  ledger: Ledger
  twin: BusinessTwin
  now: Date
}

const DEFAULT_WINDOW = 7

interface Pattern {
  intent: IntentId
  patterns: RegExp[]
}

const PATTERNS: Pattern[] = [
  {
    intent: 'capital_where',
    patterns: [/nasaan\s+ang\s+puhunan/i, /saan\s+ang\s+puhunan/i, /where.*capital/i, /puhunan\s+ko/i],
  },
  {
    intent: 'capital_provenance',
    patterns: [/saan\s+napunta/i, /napunta\s+ang\s+pera/i, /where.*money.*go/i, /saan\s+ang\s+pera/i],
  },
  {
    intent: 'cash_why_low',
    patterns: [/bakit.*(kulang|wala|mababa).*(cash|pera)/i, /kulang.*cash/i, /wala.*cash/i, /malakas.*benta.*pero/i, /why.*no cash/i, /why.*\bcash\b/i],
  },
  {
    intent: 'profit_change',
    patterns: [/bakit.*(bumaba|baba|humina).*(kita|tubo|benta)/i, /bumaba.*kita/i, /why.*(profit|income).*(drop|down|fall)/i],
  },
  {
    intent: 'profit_period',
    patterns: [
      // Word boundaries matter: "kikitain" is prospective and must not be read
      // as a question about profit already earned.
      /magkano.*\b(kinita|kita|tubo)\b/i,
      /\b(kinita|kita|tubo)\s+ko\b/i,
      /how much.*(profit|earn)/i,
      /\bkumita\b/i,
    ],
  },
  {
    intent: 'top_product',
    // English phrasing is matched as carefully as the Filipino: these are the
    // exact questions the Ask screen offers as tiles, and a suggestion that
    // lands in `unknown` is worse than no suggestion at all.
    patterns: [
      /pinakamalakas/i,
      /best.?sell/i,
      /mabili/i,
      /top\s+(product|item)/i,
      /strongest/i,
      /best\s+item/i,
      /ano.*(mabili|malakas).*paninda/i,
    ],
  },
  {
    intent: 'slow_movers',
    patterns: [
      /hindi\s+gumagalaw/i,
      /mabagal/i,
      /slow.?mov/i,
      /not\s+moving/i,
      /stuck/i,
      /ayaw\s+maubos/i,
      /hindi\s+maubos/i,
    ],
  },
  {
    intent: 'biggest_utang',
    patterns: [
      /pinakamalaking\s+utang/i,
      /sino.*(utang|umutang)/i,
      /sino.*may.*utang/i,
      /biggest.*(utang|debt|receivable)/i,
      // Added so the English example questions below actually resolve rather than
      // landing in `unknown` — a suggestion that does not work is worse than none.
      /who\s+owes/i,
    ],
  },
  {
    intent: 'restock',
    patterns: [/restock/i, /dapat.*bilhin/i, /ano.*order/i, /ano.*bilihin/i, /reorder/i, /what.*(buy|stock)/i],
  },
  {
    intent: 'sales_forecast',
    patterns: [/next\s+week/i, /kikitain/i, /forecast/i, /hula/i, /magkano.*bukas/i, /susunod\s+na\s+linggo/i],
  },
  {
    intent: 'score',
    patterns: [/kumusta\s+ang\s+negosyo/i, /score/i, /kalagayan/i, /how.*(business|negosyo)/i, /health/i],
  },
]

export function matchIntent(text: string): IntentId {
  const normalized = text.toLowerCase().trim()
  for (const { intent, patterns } of PATTERNS) {
    if (patterns.some((p) => p.test(normalized))) return intent
  }
  return 'unknown'
}

function skuName(ledger: Ledger, skuId: SkuId): string {
  return ledger.skus.find((s) => s.id === skuId)?.name ?? skuId
}

function customerName(ledger: Ledger, customerId: CustomerId): string {
  return ledger.customers.find((c) => c.id === customerId)?.name ?? customerId
}

/**
 * Two languages, one engine.
 *
 * Copy is a parameter, never a global: every entry point takes the language and
 * returns text already resolved, so the arithmetic is identical in both modes and
 * nothing downstream has to know which language it is holding.
 */
export function ask(question: string, ctx: AskContext, lang: Lang): Answer {
  return answerIntent(matchIntent(question), ctx, lang, question)
}

export function answerIntent(
  intent: IntentId,
  ctx: AskContext,
  lang: Lang,
  question = '',
): Answer {
  const { ledger, twin, now } = ctx
  const metrics = periodMetrics(ledger, DEFAULT_WINDOW, now)
  const derived = deriveTwin(twin)
  const days = DEFAULT_WINDOW

  switch (intent) {
    case 'profit_period': {
      return {
        intent,
        question,
        headline: pickCopy(lang, {
          en: `${formatPHP(metrics.netProfitCentavos)} is your real profit over the last ${days} days.`,
          fil: `${formatPHP(metrics.netProfitCentavos)} ang tunay na kita mo sa huling ${days} araw.`,
        }),
        detail: [
          pickCopy(lang, {
            en: `Sales: ${formatPHP(metrics.revenueCentavos)} — this is not profit.`,
            fil: `Benta: ${formatPHP(metrics.revenueCentavos)} — hindi ito kita.`,
          }),
          pickCopy(lang, {
            en: `Cost of what you sold (COGS): ${formatPHP(metrics.cogsCentavos)}`,
            fil: `Puhunan ng nabenta (COGS): ${formatPHP(metrics.cogsCentavos)}`,
          }),
          pickCopy(lang, {
            en: `Expenses: ${formatPHP(metrics.expensesCentavos)}${metrics.shrinkageCentavos !== 0 ? ` · Spoiled or missing: ${formatPHP(metrics.shrinkageCentavos)}` : ''}`,
            fil: `Gastos: ${formatPHP(metrics.expensesCentavos)}${metrics.shrinkageCentavos !== 0 ? ` · Panis/nawala: ${formatPHP(metrics.shrinkageCentavos)}` : ''}`,
          }),
          pickCopy(lang, {
            en: `Profit before expenses: ${formatPHP(metrics.grossProfitCentavos)} (${formatPercent(metrics.grossMargin)})`,
            fil: `Kita bago gastos: ${formatPHP(metrics.grossProfitCentavos)} (${formatPercent(metrics.grossMargin)})`,
          }),
        ],
        evidence: [
          { label: pickCopy(lang, { en: 'Sales', fil: 'Benta' }), value: formatPHP(metrics.revenueCentavos) },
          { label: 'COGS', value: formatPHP(metrics.cogsCentavos) },
          { label: pickCopy(lang, { en: 'Expenses', fil: 'Gastos' }), value: formatPHP(metrics.expensesCentavos) },
          {
            label: pickCopy(lang, { en: 'Real profit', fil: 'Tunay na kita' }),
            value: formatPHP(metrics.netProfitCentavos),
          },
        ],
        actions:
          metrics.netProfitCentavos <= 0
            ? [
                pickCopy(lang, {
                  en: 'Check which items have the thinnest margin.',
                  fil: 'Tingnan kung aling paninda ang mababa ang margin.',
                }),
                pickCopy(lang, {
                  en: 'Look for expenses that can wait.',
                  fil: 'Suriin ang gastos na maaaring ipagpaliban.',
                }),
              ]
            : [],
      }
    }

    case 'capital_where': {
      const comp = capitalComposition(twin, lang)
      return {
        intent,
        question,
        headline: pickCopy(lang, {
          en: `${formatPHP(comp.netAssetsCentavos)} is your total capital right now.`,
          fil: `${formatPHP(comp.netAssetsCentavos)} ang kabuuang puhunan mo ngayon.`,
        }),
        detail: comp.components
          .filter((c) => c.amountCentavos !== 0)
          .map(
            (c) =>
              `${pickCopy(lang, c.label)}: ${formatPHP(c.amountCentavos)} (${Math.round(Math.abs(c.share) * 100)}%)`,
          ),
        evidence: comp.narrative.map((n) => ({
          label: pickCopy(lang, { en: 'Noticed', fil: 'Napansin' }),
          value: n,
        })),
        actions: [
          pickCopy(lang, {
            en: 'Before adding an order, know where the capital is parked.',
            fil: 'Bago magdagdag ng order, tiyakin kung saan naka-park ang puhunan.',
          }),
        ],
      }
    }

    case 'capital_provenance': {
      const prov = capitalProvenance(twin)
      const fromLabel = pickCopy(lang, { en: 'From', fil: 'Pinagmulan' })
      const toLabel = pickCopy(lang, { en: 'Went to', fil: 'Napunta' })
      return {
        intent,
        question,
        headline: pickCopy(lang, {
          en: `${formatPHP(prov.totalSourcesCentavos)} came into the business; the same amount went out or is still held.`,
          fil: `${formatPHP(prov.totalSourcesCentavos)} ang pinagmulan ng puhunan; ganoon din ang napuntahan.`,
        }),
        detail: [
          ...prov.sources.map(
            (s) => `${fromLabel} — ${pickCopy(lang, s.label)}: ${formatPHP(s.amountCentavos)}`,
          ),
          ...prov.uses.map(
            (u) => `${toLabel} — ${pickCopy(lang, u.label)}: ${formatPHP(u.amountCentavos)}`,
          ),
        ],
        evidence: [
          {
            label: pickCopy(lang, { en: 'Total in', fil: 'Kabuuang pinagmulan' }),
            value: formatPHP(prov.totalSourcesCentavos),
          },
          {
            label: pickCopy(lang, { en: 'Total accounted for', fil: 'Kabuuang napuntahan' }),
            value: formatPHP(prov.totalUsesCentavos),
          },
        ],
        actions: prov.reconciled
          ? []
          : [
              pickCopy(lang, {
                en: 'Something does not tally in the records — report it.',
                fil: 'May hindi tugma sa records — i-report ito.',
              }),
            ],
      }
    }

    case 'cash_why_low': {
      const uncollectedShare = safeDiv(metrics.uncollectedCentavos, metrics.revenueCentavos)
      const inventoryShare = safeDiv(
        derived.inventoryValueCentavos,
        derived.totalAssetsCentavos - derived.totalLiabilitiesCentavos,
      )
      const lines = [
        pickCopy(lang, {
          en: `${formatPHP(metrics.revenueCentavos)} in sales was recorded over the last ${days} days.`,
          fil: `${formatPHP(metrics.revenueCentavos)} ang naitalang benta sa huling ${days} araw.`,
        }),
        pickCopy(lang, {
          en: `${formatPHP(metrics.uncollectedCentavos)} of that is utang — not cash yet (${formatPercent(uncollectedShare)} of sales).`,
          fil: `${formatPHP(metrics.uncollectedCentavos)} dito ay utang — hindi pa cash (${formatPercent(uncollectedShare)} ng benta).`,
        }),
        pickCopy(lang, {
          en: `Your cash right now: ${formatPHP(twin.cashCentavos)}.`,
          fil: `Cash mo ngayon: ${formatPHP(twin.cashCentavos)}.`,
        }),
        pickCopy(lang, {
          en: `${formatPHP(derived.inventoryValueCentavos)} of your capital is sitting in stock (${formatPercent(inventoryShare)}).`,
          fil: `${formatPHP(derived.inventoryValueCentavos)} ng puhunan mo ay nasa paninda (${formatPercent(inventoryShare)}).`,
        }),
      ]
      const actions: string[] = []
      if (uncollectedShare >= 0.2) {
        actions.push(
          pickCopy(lang, {
            en: 'Collect the utang first, before adding a big stock order.',
            fil: 'Unahin ang koleksyon ng utang bago magdagdag ng malaking order ng paninda.',
          }),
        )
      }
      if (twin.payablesCentavos > 0) {
        actions.push(
          pickCopy(lang, {
            en: `You still owe suppliers ${formatPHP(twin.payablesCentavos)}.`,
            fil: `May ${formatPHP(twin.payablesCentavos)} pang babayaran sa supplier.`,
          }),
        )
      }
      return {
        intent,
        question,
        headline: pickCopy(lang, {
          en: 'Cash is short even though sales are strong, because not every sale turned into cash.',
          fil: 'Kulang ang cash kahit malakas ang benta dahil hindi lahat ng benta ay naging cash.',
        }),
        detail: lines,
        evidence: [
          { label: pickCopy(lang, { en: 'Sales', fil: 'Benta' }), value: formatPHP(metrics.revenueCentavos) },
          {
            label: pickCopy(lang, { en: 'Not collected yet', fil: 'Hindi pa nakolekta' }),
            value: formatPHP(metrics.uncollectedCentavos),
          },
          { label: pickCopy(lang, { en: 'Cash now', fil: 'Cash ngayon' }), value: formatPHP(twin.cashCentavos) },
          {
            label: pickCopy(lang, { en: 'In stock', fil: 'Nasa paninda' }),
            value: formatPHP(derived.inventoryValueCentavos),
          },
        ],
        actions,
      }
    }

    case 'top_product': {
      const ranked = Object.entries(metrics.salesBySku)
        .filter(([, s]) => s.qtySold > 0)
        .sort((a, b) => b[1].marginCentavos - a[1].marginCentavos)
      if (ranked.length === 0) {
        return emptyAnswer(
          intent,
          question,
          pickCopy(lang, {
            en: 'No sales in this period yet.',
            fil: 'Wala pang benta sa panahong ito.',
          }),
        )
      }
      const top = ranked[0]
      return {
        intent,
        question,
        headline: pickCopy(lang, {
          en: `${skuName(ledger, top[0])} is your strongest item — it earned ${formatPHP(top[1].marginCentavos)} over the last ${days} days.`,
          fil: `${skuName(ledger, top[0])} ang pinakamalakas mo — ${formatPHP(top[1].marginCentavos)} ang kita nito sa huling ${days} araw.`,
        }),
        detail: ranked.slice(0, 5).map(([id, s]) =>
          pickCopy(lang, {
            en: `${skuName(ledger, id)}: ${s.qtySold} pcs · sales ${formatPHP(s.revenueCentavos)} · profit ${formatPHP(s.marginCentavos)}`,
            fil: `${skuName(ledger, id)}: ${s.qtySold} pcs · benta ${formatPHP(s.revenueCentavos)} · kita ${formatPHP(s.marginCentavos)}`,
          }),
        ),
        evidence: ranked.slice(0, 5).map(([id, s]) => ({
          label: skuName(ledger, id),
          value: formatPHP(s.marginCentavos),
        })),
        actions: [
          pickCopy(lang, {
            en: 'Make sure it does not run out — it is carrying the profit.',
            fil: 'Tiyaking hindi ito mauubos — ito ang nagdadala ng kita.',
          }),
        ],
      }
    }

    case 'slow_movers': {
      const long = periodMetrics(ledger, 14, now)
      const slow = Object.entries(twin.inventory)
        .filter(([id, stock]) => stock.qty > 0 && (long.salesBySku[id]?.qtySold ?? 0) === 0)
        .sort((a, b) => b[1].valueCentavos - a[1].valueCentavos)
      if (slow.length === 0) {
        return emptyAnswer(
          intent,
          question,
          pickCopy(lang, {
            en: 'Nothing is stuck on the shelf — everything is moving.',
            fil: 'Walang nakatenggang paninda — gumagalaw lahat.',
          }),
        )
      }
      const trapped = slow.reduce((sum, [, s]) => sum + s.valueCentavos, 0)
      return {
        intent,
        question,
        headline: pickCopy(lang, {
          en: `${formatPHP(trapped)} of your capital is sitting in stock that is not moving.`,
          fil: `${formatPHP(trapped)} ng puhunan mo ang nakatengga sa hindi gumagalaw na paninda.`,
        }),
        detail: slow.slice(0, 5).map(([id, s]) =>
          pickCopy(lang, {
            en: `${skuName(ledger, id)}: ${s.qty} left · ${formatPHP(s.valueCentavos)} parked · no sales in 14 days`,
            fil: `${skuName(ledger, id)}: ${s.qty} natitira · ${formatPHP(s.valueCentavos)} naka-park · walang benta sa 14 araw`,
          }),
        ),
        evidence: slow.slice(0, 5).map(([id, s]) => ({
          label: skuName(ledger, id),
          value: formatPHP(s.valueCentavos),
        })),
        actions: [
          pickCopy(lang, { en: 'Hold off ordering more of it.', fil: 'Iwasan munang mag-order nito.' }),
          pickCopy(lang, {
            en: 'If you can, bundle or discount it to turn it back into cash.',
            fil: 'Kung kaya, i-bundle o i-discount para maging cash.',
          }),
        ],
      }
    }

    case 'biggest_utang': {
      const ranked = Object.entries(twin.receivables)
        .filter(([, amt]) => amt > 0)
        .sort((a, b) => b[1] - a[1])
      if (ranked.length === 0) {
        return emptyAnswer(
          intent,
          question,
          pickCopy(lang, {
            en: 'Nobody owes you anything. Well done!',
            fil: 'Walang outstanding na utang sa iyo. Magaling!',
          }),
        )
      }
      const [topId, topAmt] = ranked[0]
      const total = ranked.reduce((sum, [, amt]) => sum + amt, 0)
      return {
        intent,
        question,
        headline: pickCopy(lang, {
          en: `${customerName(ledger, topId)} owes you the most: ${formatPHP(topAmt)}.`,
          fil: `${customerName(ledger, topId)} ang may pinakamalaking utang: ${formatPHP(topAmt)}.`,
        }),
        detail: [
          pickCopy(lang, {
            en: `Total owed to you: ${formatPHP(total)} across ${ranked.length} customers.`,
            fil: `Kabuuang utang sa iyo: ${formatPHP(total)} mula sa ${ranked.length} customers.`,
          }),
          ...ranked.slice(0, 5).map(([id, amt]) => `${customerName(ledger, id)}: ${formatPHP(amt)}`),
        ],
        evidence: [
          { label: pickCopy(lang, { en: 'Total owed', fil: 'Kabuuang utang' }), value: formatPHP(total) },
          {
            label: pickCopy(lang, { en: 'Number of customers', fil: 'Bilang ng customers' }),
            value: String(ranked.length),
          },
        ],
        actions: [
          pickCopy(lang, {
            en: `Collect from ${customerName(ledger, topId)} first.`,
            fil: `Unahin ang koleksyon kay ${customerName(ledger, topId)}.`,
          }),
        ],
      }
    }

    case 'profit_change': {
      const previous = periodMetrics(ledger, DEFAULT_WINDOW, addDays(now, -DEFAULT_WINDOW))
      const delta = metrics.netProfitCentavos - previous.netProfitCentavos
      if (previous.revenueCentavos === 0 && metrics.revenueCentavos === 0) {
        return emptyAnswer(
          intent,
          question,
          pickCopy(lang, {
            en: 'Not enough data yet to compare.',
            fil: 'Wala pang sapat na datos para ihambing.',
          }),
        )
      }
      const detail: string[] = [
        pickCopy(lang, {
          en: `Previous ${days} days: profit ${formatPHP(previous.netProfitCentavos)} · sales ${formatPHP(previous.revenueCentavos)}`,
          fil: `Nakaraang ${days} araw: kita ${formatPHP(previous.netProfitCentavos)} · benta ${formatPHP(previous.revenueCentavos)}`,
        }),
        pickCopy(lang, {
          en: `This ${days} days: profit ${formatPHP(metrics.netProfitCentavos)} · sales ${formatPHP(metrics.revenueCentavos)}`,
          fil: `Ngayong ${days} araw: kita ${formatPHP(metrics.netProfitCentavos)} · benta ${formatPHP(metrics.revenueCentavos)}`,
        }),
      ]
      const revenueDelta = metrics.revenueCentavos - previous.revenueCentavos
      const cogsDelta = metrics.cogsCentavos - previous.cogsCentavos
      const expenseDelta = metrics.expensesCentavos - previous.expensesCentavos
      const drivers = [
        { name: pickCopy(lang, { en: 'sales', fil: 'benta' }), value: revenueDelta },
        {
          name: pickCopy(lang, { en: 'cost of goods', fil: 'puhunan ng paninda' }),
          value: -cogsDelta,
        },
        { name: pickCopy(lang, { en: 'expenses', fil: 'gastos' }), value: -expenseDelta },
      ].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      const main = drivers[0]
      detail.push(
        pickCopy(lang, {
          en: `Biggest driver: ${main.name} (${main.value >= 0 ? '+' : ''}${formatPHP(main.value)}).`,
          fil: `Pinakamalaking dahilan: ${main.name} (${main.value >= 0 ? '+' : ''}${formatPHP(main.value)}).`,
        }),
      )
      return {
        intent,
        question,
        headline: pickCopy(lang, {
          en: `Your profit is ${delta >= 0 ? 'up' : 'down'} by ${formatPHP(Math.abs(delta))} compared with the previous week.`,
          fil: `${delta >= 0 ? 'Tumaas' : 'Bumaba'} ng ${formatPHP(Math.abs(delta))} ang kita mo kumpara sa nakaraang linggo.`,
        }),
        detail,
        evidence: [
          { label: pickCopy(lang, { en: 'Sales now', fil: 'Benta ngayon' }), value: formatPHP(metrics.revenueCentavos) },
          {
            label: pickCopy(lang, { en: 'Sales before', fil: 'Benta dati' }),
            value: formatPHP(previous.revenueCentavos),
          },
          {
            label: pickCopy(lang, { en: 'Profit now', fil: 'Kita ngayon' }),
            value: formatPHP(metrics.netProfitCentavos),
          },
          {
            label: pickCopy(lang, { en: 'Profit before', fil: 'Kita dati' }),
            value: formatPHP(previous.netProfitCentavos),
          },
        ],
        actions:
          main.value < 0
            ? [pickCopy(lang, { en: `Check the ${main.name}.`, fil: `Suriin ang ${main.name}.` })]
            : [],
      }
    }

    case 'restock': {
      const need: { name: string; cover: number; qty: number }[] = []
      for (const [id, stats] of Object.entries(metrics.salesBySku)) {
        if (stats.qtySold <= 0) continue
        const stock = twin.inventory[id]
        if (!stock) continue
        const perDay = stats.qtySold / DEFAULT_WINDOW
        const cover = safeDiv(stock.qty, perDay)
        if (cover < 3) need.push({ name: skuName(ledger, id), cover, qty: stock.qty })
      }
      need.sort((a, b) => a.cover - b.cover)
      if (need.length === 0) {
        return emptyAnswer(
          intent,
          question,
          pickCopy(lang, {
            en: 'Nothing needs restocking in the next 3 days.',
            fil: 'Walang kailangang i-restock agad sa susunod na 3 araw.',
          }),
        )
      }
      return {
        intent,
        question,
        headline: pickCopy(lang, {
          en: `${need.length} will run out soon. Start with ${need[0].name}.`,
          fil: `${need.length} ang malapit nang maubos. Unahin ang ${need[0].name}.`,
        }),
        detail: need.slice(0, 5).map((n) =>
          pickCopy(lang, {
            en: `${n.name}: ${n.qty} left · about ${n.cover.toFixed(1)} days at the current pace`,
            fil: `${n.name}: ${n.qty} natitira · sapat pa sa ${n.cover.toFixed(1)} araw sa kasalukuyang bilis`,
          }),
        ),
        evidence: need.slice(0, 5).map((n) => ({
          label: n.name,
          value: pickCopy(lang, { en: `${n.cover.toFixed(1)} days`, fil: `${n.cover.toFixed(1)} araw` }),
        })),
        actions: [
          pickCopy(lang, {
            en: 'Hold off ordering slow movers while something is running out.',
            fil: 'Iwasan munang mag-order ng mabagal gumalaw habang may nauubos.',
          }),
        ],
      }
    }

    case 'sales_forecast': {
      const sales = metrics.dailySales.map((d) => d.amountCentavos)
      if (sales.every((s) => s === 0)) {
        return emptyAnswer(
          intent,
          question,
          pickCopy(lang, {
            en: 'Not enough sales yet to give a forecast.',
            fil: 'Wala pang sapat na benta para magbigay ng hula.',
          }),
        )
      }
      const mean = sales.reduce((s, v) => s + v, 0) / sales.length
      const variance = sales.reduce((s, v) => s + (v - mean) * (v - mean), 0) / Math.max(1, sales.length - 1)
      const sd = Math.sqrt(variance)
      const low = Math.max(0, Math.round((mean - sd) * 7))
      const high = Math.round((mean + sd) * 7)
      return {
        intent,
        question,
        headline: pickCopy(lang, {
          en: `Around ${formatPHP(Math.round(mean * 7))} in sales is expected over the next 7 days.`,
          fil: `Mga ${formatPHP(Math.round(mean * 7))} ang inaasahang benta sa susunod na 7 araw.`,
        }),
        detail: [
          pickCopy(lang, {
            en: `Based on ${days} days of data, and not a guarantee.`,
            fil: `Batay sa ${days} araw na datos, hindi ito garantiya.`,
          }),
          pickCopy(lang, {
            en: `Range: ${formatPHP(low)} – ${formatPHP(high)}.`,
            fil: `Saklaw: ${formatPHP(low)} – ${formatPHP(high)}.`,
          }),
        ],
        evidence: [
          {
            label: pickCopy(lang, { en: 'Average per day', fil: 'Average bawat araw' }),
            value: formatPHP(Math.round(mean)),
          },
          { label: pickCopy(lang, { en: 'Low', fil: 'Mababa' }), value: formatPHP(low) },
          { label: pickCopy(lang, { en: 'High', fil: 'Mataas' }), value: formatPHP(high) },
        ],
        actions: [
          pickCopy(lang, {
            en: 'Stock for the expected sales, not for your best week.',
            fil: 'Ihanda ang paninda ayon sa inaasahang benta, hindi sa pinakamataas na linggo.',
          }),
        ],
      }
    }

    case 'score': {
      const score = computeScore(
        {
          twin,
          metrics,
          openingInventoryValueCentavos: openingInventoryValueCentavos(
            ledger,
            DEFAULT_WINDOW,
            now,
          ),
        },
        lang,
      )
      return {
        intent,
        question,
        headline: `${score.value}/100 — ${bandLabel(score.band, lang).toUpperCase()} (${score.version})`,
        detail: score.dimensions.map(
          (d) => `${pickCopy(lang, d.label)}: ${Math.round(d.score)}/100 · ${d.rawValue}`,
        ),
        evidence: [
          ...score.strengths.map((s) => ({ label: bandLabel('strong', lang), value: s })),
          ...score.watch.map((s) => ({ label: bandLabel('watch', lang), value: s })),
        ],
        actions: score.priorities,
      }
    }

    case 'unknown':
    default: {
      // The examples are shown as things the owner can *type*, so they are given
      // in the language they are reading — and the parser understands both, so a
      // suggestion tapped in English is answered in English.
      const examples =
        lang === 'fil'
          ? [
              '"Magkano kinita ko ngayong linggo?"',
              '"Nasaan ang puhunan ko?"',
              '"Ano ang hindi ko muna dapat i-restock?"',
              '"Sino ang may pinakamalaking utang?"',
              '"Bakit wala akong cash kahit malakas ang benta?"',
            ]
          : [
              '"How much did I earn this week?"',
              '"Where is my capital?"',
              '"What should I restock first?"',
              '"Who owes me the most?"',
              '"Why is my cash short when sales are strong?"',
            ]
      return {
        intent: 'unknown',
        question,
        headline: pickCopy(lang, {
          en: 'I am not sure about that question.',
          fil: 'Hindi ko sigurado ang tanong na iyon.',
        }),
        detail: [
          pickCopy(lang, { en: 'Try these:', fil: 'Subukan ang mga ito:' }),
          ...examples.map((e) => `· ${e}`),
        ],
        evidence: [],
        actions: [],
      }
    }
  }
}

function emptyAnswer(intent: IntentId, question: string, message: string): Answer {
  return { intent, question, headline: message, detail: [], evidence: [], actions: [] }
}
