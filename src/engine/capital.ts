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
      label: { en: 'Cash in the box', fil: 'Cash sa kahon' },
      amountCentavos: twin.cashCentavos,
      share: safeDiv(twin.cashCentavos, total),
      kind: 'asset',
    },
    {
      key: 'inventory',
      label: { en: 'Stock (what you paid)', fil: 'Paninda' },
      amountCentavos: d.inventoryValueCentavos,
      share: safeDiv(d.inventoryValueCentavos, total),
      // Negative inventory means sales have been recorded without the matching
      // purchases, so the position is a claim against the business, not an asset.
      kind: d.inventoryValueCentavos < 0 ? 'offset' : 'asset',
      note: {
        en: 'Counted at what you paid for it, not at what you sell it for.',
        fil: 'Bilang sa presyo ng puhunan mo, hindi sa presyo ng benta.',
      },
    },
    {
      key: 'receivables',
      label: { en: 'Owed to you', fil: 'Utang sa iyo' },
      amountCentavos: d.receivablesCentavos,
      share: safeDiv(d.receivablesCentavos, total),
      kind: 'asset',
    },
    {
      key: 'fixed_assets',
      label: { en: 'Equipment and tools', fil: 'Kagamitan' },
      amountCentavos: twin.fixedAssetsCentavos,
      share: safeDiv(twin.fixedAssetsCentavos, total),
      kind: 'asset',
    },
    {
      key: 'payables',
      label: { en: 'Owed to suppliers', fil: 'Utang sa supplier' },
      amountCentavos: -twin.payablesCentavos,
      share: safeDiv(-twin.payablesCentavos, total),
      kind: 'offset',
      note: {
        en: 'Minus this: the money is in the business, but it still belongs to the supplier.',
        fil: 'Ibawas ito: nasa negosyo ang pera pero pag-aari pa ng supplier.',
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
        en: 'Nothing recorded yet. Add the money you started with, or record a sale, to see this breakdown.',
        fil: 'Wala pang naitala. Idagdag ang panimulang puhunan o mag-record ng benta para makita ang hatian.',
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
        en: 'Some purchases are missing from the records, so your stock shows less than nothing. Record the buys so the numbers agree.',
        fil: 'May mga bili na hindi pa naitala, kaya mas mababa pa sa wala ang bilang ng paninda. I-record ang mga bili para tumugma ang mga numero.',
      }),
    )
  }

  if (biggest.key === 'inventory') {
    lines.push(
      pickCopy(lang, {
        en: `Most of your money is in stock — ${pct(biggest)} of every ₱100 of it. It is not cash until it sells.`,
        fil: `Nasa paninda ang malaking bahagi ng puhunan mo — ${pct(biggest)} sa bawat ₱100 nito. Hindi ito cash hangga't hindi naibenta.`,
      }),
    )
  } else if (biggest.key === 'receivables') {
    lines.push(
      pickCopy(lang, {
        en: `Most of your money is out on utang to customers — ${pct(biggest)} of every ₱100 of it. That money is not in the store.`,
        fil: `Nasa utang ng customers ang malaking bahagi ng puhunan mo — ${pct(biggest)} sa bawat ₱100 nito. Nasa labas ang pera na ito.`,
      }),
    )
  } else if (biggest.key === 'cash') {
    lines.push(
      pickCopy(lang, {
        en: `Most of your money is in cash — ${pct(biggest)} of every ₱100 of it.`,
        fil: `Nasa cash ang malaking bahagi ng puhunan mo — ${pct(biggest)} sa bawat ₱100 nito.`,
      }),
    )
  } else {
    lines.push(
      pickCopy(lang, {
        en: `Most of your money is in equipment and tools — ${pct(biggest)} of every ₱100 of it.`,
        fil: `Nasa kagamitan ang malaking bahagi ng puhunan mo — ${pct(biggest)} sa bawat ₱100 nito.`,
      }),
    )
  }

  const receivables = components.find((c) => c.key === 'receivables')
  if (receivables && total > 0 && Math.abs(receivables.share) >= 0.15) {
    lines.push(
      pickCopy(lang, {
        en: `Watch this: ${pct(receivables)} of every ₱100 of your money has not been collected yet. Collect before you order again.`,
        fil: `Bantayan: ${pct(receivables)} sa bawat ₱100 ng puhunan mo ay hindi pa nakokolekta. Kolektahin bago mag-order ulit.`,
      }),
    )
  }

  const payables = components.find((c) => c.key === 'payables')
  if (payables && payables.amountCentavos !== 0 && netAssets > 0) {
    lines.push(
      pickCopy(lang, {
        en: `Out of everything the business owns, ${Math.round(Math.abs(payables.share) * 100)}% is still owed to suppliers.`,
        fil: `Sa lahat ng pag-aari ng negosyo, ${Math.round(Math.abs(payables.share) * 100)}% nito ay utang pa sa supplier.`,
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
      label: { en: 'Money you put in', fil: 'Puhunan na inilagay' },
      amountCentavos: twin.capitalInjectedCentavos,
    },
    {
      key: 'retained_profit',
      label: { en: 'Profit left in the business', fil: 'Kita na naipon' },
      amountCentavos: d.netProfitCentavos,
    },
  ]

  const uses: ProvenanceLine[] = [
    {
      key: 'withdrawals',
      label: { en: 'Money you took out', fil: 'Kinuhang pera' },
      amountCentavos: twin.withdrawalsCentavos,
    },
    {
      key: 'cash',
      label: { en: 'In cash right now', fil: 'Nasa cash ngayon' },
      amountCentavos: twin.cashCentavos,
    },
    {
      key: 'inventory',
      label: { en: 'In stock right now', fil: 'Nasa paninda ngayon' },
      amountCentavos: d.inventoryValueCentavos,
    },
    {
      key: 'receivables',
      label: { en: 'Owed to you right now', fil: 'Nasa utang ngayon' },
      amountCentavos: d.receivablesCentavos,
    },
    {
      key: 'fixed_assets',
      label: { en: 'In equipment right now', fil: 'Nasa kagamitan ngayon' },
      amountCentavos: twin.fixedAssetsCentavos,
    },
    {
      key: 'payables_offset',
      label: { en: 'Minus: still owed to suppliers', fil: 'Ibawas: utang sa supplier' },
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
