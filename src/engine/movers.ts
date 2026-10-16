import { qtyPerDisplayUnit } from './money.ts'
import type { Centavos } from './money.ts'
import type { Ledger, SkuId } from './types.ts'

/**
 * What is actually selling, ranked the way the answer already ranks it.
 *
 * The engine has always known this — `top_product` answers "ano ang pinakamalakas
 * kong paninda?" from `salesBySku` — and the only way to see it was to ask. A
 * shop owner should not have to hold a conversation with their own ledger to
 * find out what to buy more of.
 *
 * Two notes on the ranking, because they are choices rather than accidents:
 *
 * - **Ranked by margin, not by revenue.** A ₱60 item that keeps ₱5 is not a
 *   better seller than a ₱30 item that keeps ₱12, and an owner buying stock for
 *   the busiest-looking shelf is the classic way to end up broke while busy.
 *   This is the same comparison `narrator.ts` uses for `top_product`, and a test
 *   asserts the two agree so the screen can never quietly disagree with the
 *   answer the owner was given out loud.
 * - **Quantity sold must be positive.** An item that never moved is a slow mover,
 *   which is a different list with a different decision attached to it.
 */

export interface TopSeller {
  skuId: SkuId
  name: string
  /** The unit the owner typed, e.g. `kg` — never `g`. */
  unit: string
  /** Stored quantity, in the base unit the engine multiplies by. */
  qtySold: number
  /** `qtySold` in the display unit, ready to print. */
  qtyDisplay: number
  revenueCentavos: Centavos
  marginCentavos: Centavos
}

/**
 * A quantity as the owner would say it: kilos to one decimal, pieces whole.
 *
 * One decimal rather than all of them, because "52.406 kg" is the machine
 * talking, and no shop measures rice to the gram.
 */
function displayQty(baseUnit: string, qty: number): number {
  const shown = qtyPerDisplayUnit(baseUnit, qty)
  return baseUnit === 'g' ? Math.round(shown * 10) / 10 : Math.round(shown)
}

export function topSellers(
  ledger: Ledger,
  salesBySku: Record<string, { qtySold: number; revenueCentavos: number; marginCentavos: number }>,
  limit = 5,
): TopSeller[] {
  const rows: TopSeller[] = []
  for (const [skuId, stats] of Object.entries(salesBySku)) {
    if (stats.qtySold <= 0) continue
    const sku = ledger.skus.find((s) => s.id === skuId)
    const baseUnit = sku?.baseUnit ?? 'pc'
    rows.push({
      skuId,
      // A deleted item still has sales behind it, and a blank row would be a
      // worse answer than the id it was recorded under.
      name: sku?.name ?? skuId,
      unit: sku?.unit ?? 'pc',
      qtySold: stats.qtySold,
      qtyDisplay: displayQty(baseUnit, stats.qtySold),
      revenueCentavos: stats.revenueCentavos,
      marginCentavos: stats.marginCentavos,
    })
  }
  return rows
    .sort((a, b) => b.marginCentavos - a.marginCentavos || b.qtySold - a.qtySold)
    .slice(0, limit)
}
