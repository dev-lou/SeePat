import type { Centavos } from './money.ts'
import { safeDiv } from './money.ts'
import { deriveTwin } from './twin.ts'
import type { BusinessTwin } from './types.ts'
import { pick as pickCopy } from '../i18n/index.ts'
import type { Bilingual, Lang } from '../i18n/index.ts'

/**
 * Capital Intelligence — the flagship differentiator.
 *
 * The concept document previously used the word "puhunan" for two different
 * questions, and both example breakdowns summed to the right total, which is
 * exactly why the ambiguity survived review. They are separated here:
 *
 *   COMPOSITION  "Nasaan ang Puhunan Ko?"   — where capital sits RIGHT NOW.
 *                Assets only. Expenses and withdrawals are not locations.
 *
 *   PROVENANCE   "Saan Napunta ang Pera Ko?" — how capital was built and
 *                consumed SINCE INCEPTION. Sources and uses must reconcile.
 *
 * Both are guaranteed consistent because both reduce to the same identity:
 *   Assets − Liabilities == Capital − Withdrawals + Cumulative Net Profit
 */

export interface CapitalComponent {
  key: string
  /** Carried in both languages: the UI picks, because a label is not a sentence. */
  label: Bilingual
  amountCentavos: Centavos
  /** Share of net assets. Negative for offsets such as supplier payables. */
  share: number
  kind: 'asset' | 'offset'
  note?: Bilingual
}

export interface CapitalComposition {
  netAssetsCentavos: Centavos
  components: CapitalComponent[]
  narrative: string[]
  /** True when the components sum exactly to net assets. */
  balanced: boolean
}

export function capitalComposition(twin: BusinessTwin, lang: Lang): CapitalComposition {
  const d = deriveTwin(twin)
  const netAssets = d.totalAssetsCentavos - d.totalLiabilitiesCentavos
  const total = Math.abs(netAssets)

  const components: CapitalComponent[] = [
    {
      key: 'cash',
      label: { en: 'Cash on hand', fil: 'Cash sa Kahon' },
      amountCentavos: twin.cashCentavos,
      share: safeDiv(twin.cashCentavos, total),
      kind: 'asset',
    },
    {
      key: 'inventory',
      label: { en: 'Inventory at cost', fil: 'Paninda' },
      amountCentavos: d.inventoryValueCentavos,
      share: safeDiv(d.inventoryValueCentavos, total),
      // Negative inventory means sales have been recorded without the matching
      // purchases, so the position is a claim against the business, not an asset.
      kind: d.inventoryValueCentavos < 0 ? 'offset' : 'asset',
      note: {
        en: 'Valued at what you paid, not what you sell it for.',
        fil: 'Nasa presyo ng puhunan, hindi presyo ng benta.',
      },
    },
    {
      key: 'receivables',
      label: { en: 'Owed to you', fil: 'Utang sa Iyo' },
      amountCentavos: d.receivablesCentavos,
      share: safeDiv(d.receivablesCentavos, total),
      kind: 'asset',
    },
    {
      key: 'fixed_assets',
      label: { en: 'Equipment and fixtures', fil: 'Kagamitan' },
      amountCentavos: twin.fixedAssetsCentavos,
      share: safeDiv(twin.fixedAssetsCentavos, total),
      kind: 'asset',
    },
    {
      key: 'payables',
      label: { en: 'Owed to suppliers', fil: 'Utang sa Supplier' },
      amountCentavos: -twin.payablesCentavos,
      share: safeDiv(-twin.payablesCentavos, total),
      kind: 'offset',
      note: {
        en: 'Subtracted: money in the business that still belongs to the supplier.',
        fil: 'Ibawas: pera na nasa negosyo pero pag-aari pa ng supplier.',
      },
    },
  ]

  const summed = components.reduce((sum, c) => sum + c.amountCentavos, 0)

  return {
    netAssetsCentavos: netAssets,
    components,
    balanced: summed === netAssets,
    narrative: buildCompositionNarrative(components, total, netAssets, lang),
  }
}

function buildCompositionNarrative(
  components: CapitalComponent[],
  total: number,
  netAssets: Centavos,
  lang: Lang,
): string[] {
  const lines: string[] = []
  const biggest = components
    .filter((c) => c.kind === 'asset')
    .reduce<CapitalComponent | null>((max, c) => (!max || c.amountCentavos > max.amountCentavos ? c : max), null)

  if (!biggest || total === 0) {
    return [
      pickCopy(lang, {
        en: 'No capital recorded yet. Add capital or record a sale to see the breakdown.',
        fil: 'Wala pang naitalang puhunan. Magdagdag ng puhunan o benta para makita ang hatian.',
      }),
    ]
  }

  // One component can exceed the whole when another is negative, so cap the
  // printed share and explain the underlying cause separately below.
  const pct = (c: CapitalComponent) => `${Math.min(100, Math.round(Math.abs(c.share) * 100))}%`

  const inventoryLine = components.find((c) => c.key === 'inventory')
  if (inventoryLine && inventoryLine.amountCentavos < 0) {
    lines.push(
      pickCopy(lang, {
        en: 'Purchases are under-recorded — inventory has gone negative. Record the buys so the numbers agree.',
        fil: 'Kulang pa ang naitalang bili — negatibo ang halaga ng paninda. I-record ang mga bili para tumugma ang mga numero.',
      }),
    )
  }

  if (biggest.key === 'inventory') {
    lines.push(
      pickCopy(lang, {
        en: `Most of your capital is sitting in stock (${pct(biggest)}). It is not cash until it sells.`,
        fil: `Malaking bahagi ng puhunan mo ay nasa paninda (${pct(biggest)}). Hindi ito cash hanggang hindi ito maibenta.`,
      }),
    )
  } else if (biggest.key === 'receivables') {
    lines.push(
      pickCopy(lang, {
        en: `Most of your capital is out on customer credit (${pct(biggest)}). That money is not in the store.`,
        fil: `Malaking bahagi ng puhunan mo ay nasa utang ng customers (${pct(biggest)}). Nasa labas ang pera na ito.`,
      }),
    )
  } else if (biggest.key === 'cash') {
    lines.push(
      pickCopy(lang, {
        en: `Most of your capital is in cash (${pct(biggest)}).`,
        fil: `Nasa cash ang malaking bahagi ng puhunan mo (${pct(biggest)}).`,
      }),
    )
  } else {
    lines.push(
      pickCopy(lang, {
        en: `Most of your capital is tied up in equipment (${pct(biggest)}).`,
        fil: `Malaking bahagi ng puhunan mo ay nasa kagamitan (${pct(biggest)}).`,
      }),
    )
  }

  const receivables = components.find((c) => c.key === 'receivables')
  if (receivables && total > 0 && Math.abs(receivables.share) >= 0.15) {
    lines.push(
      pickCopy(lang, {
        en: `Watch this: ${pct(receivables)} of your capital has not been collected yet. Collect before adding an order.`,
        fil: `Bantayan: ${pct(receivables)} ng puhunan mo ay hindi pa nakokolekta. Bago magdagdag ng order, unahin ang koleksyon.`,
      }),
    )
  }

  const payables = components.find((c) => c.key === 'payables')
  if (payables && payables.amountCentavos !== 0 && netAssets > 0) {
    lines.push(
      pickCopy(lang, {
        en: `${Math.round(Math.abs(payables.share) * 100)}% of your total assets is still owed to suppliers.`,
        fil: `May ${Math.round(Math.abs(payables.share) * 100)}% ng kabuuang assets mo na utang pa sa supplier.`,
      }),
    )
  }

  return lines
}

// ---------------------------------------------------------------------------
// Provenance — "Saan Napunta ang Pera Ko?"
// ---------------------------------------------------------------------------

export interface ProvenanceLine {
  key: string
  label: Bilingual
  amountCentavos: Centavos
}

export interface CapitalProvenance {
  sources: ProvenanceLine[]
  uses: ProvenanceLine[]
  totalSourcesCentavos: Centavos
  totalUsesCentavos: Centavos
  /** Present only through the operational view, not as a location of capital. */
  withdrawnCentavos: Centavos
  spentOnExpensesCentavos: Centavos
  reconciled: boolean
}

/**
 * Sources: capital the owner put in, plus what the business has earned.
 * Uses: what the owner took out, plus where the remainder sits today
 *       (net of what is still owed to suppliers).
 *
 * `totalSourcesCentavos === totalUsesCentavos` is asserted, not hoped for.
 */
export function capitalProvenance(twin: BusinessTwin): CapitalProvenance {
  const d = deriveTwin(twin)

  const sources: ProvenanceLine[] = [
    {
      key: 'capital_in',
      label: { en: 'Capital you put in', fil: 'Puhunan na Inilagay' },
      amountCentavos: twin.capitalInjectedCentavos,
    },
    {
      key: 'retained_profit',
      label: { en: 'Profit kept in the business', fil: 'Naipon na Kita' },
      amountCentavos: d.netProfitCentavos,
    },
  ]

  const uses: ProvenanceLine[] = [
    {
      key: 'withdrawals',
      label: { en: 'Money you took out', fil: 'Kinuhang Pera' },
      amountCentavos: twin.withdrawalsCentavos,
    },
    {
      key: 'cash',
      label: { en: 'Held as cash now', fil: 'Nasa Cash Ngayon' },
      amountCentavos: twin.cashCentavos,
    },
    {
      key: 'inventory',
      label: { en: 'Held as stock now', fil: 'Nasa Paninda Ngayon' },
      amountCentavos: d.inventoryValueCentavos,
    },
    {
      key: 'receivables',
      label: { en: 'Held as customer credit', fil: 'Nasa Utang Ngayon' },
      amountCentavos: d.receivablesCentavos,
    },
    {
      key: 'fixed_assets',
      label: { en: 'Held as equipment', fil: 'Nasa Kagamitan Ngayon' },
      amountCentavos: twin.fixedAssetsCentavos,
    },
    {
      key: 'payables_offset',
      label: { en: 'Less: owed to suppliers', fil: 'Ibawas: Utang sa Supplier' },
      amountCentavos: -twin.payablesCentavos,
    },
  ]

  const totalSourcesCentavos = sources.reduce((s, l) => s + l.amountCentavos, 0)
  const totalUsesCentavos = uses.reduce((s, l) => s + l.amountCentavos, 0)

  return {
    sources,
    uses,
    totalSourcesCentavos,
    totalUsesCentavos,
    withdrawnCentavos: twin.withdrawalsCentavos,
    spentOnExpensesCentavos: twin.expensesCentavos + twin.shrinkageCentavos,
    reconciled: totalSourcesCentavos === totalUsesCentavos,
  }
}
