import type { Centavos } from './money.ts'
import type { Qty, SkuStock } from './types.ts'

/**
 * Perpetual inventory at moving weighted average cost.
 *
 * This is the correction to the periodic `Opening + Purchases - Closing` formula:
 * periodic COGS requires a physical stock count, which makes a *daily* profit
 * figure impossible. Perpetual costing derives COGS at the moment of each sale,
 * so "magkano ang kinita ko ngayong araw?" is answerable without counting shelves.
 *
 * Inventory value is held as an exact integer in centavos. Unit cost is a
 * derived, display-only value — never the basis for accumulation — so rounding
 * can never leak into the books.
 */

export const emptyStock = (): SkuStock => ({
  qty: 0,
  valueCentavos: 0,
  lastUnitCostCentavos: 0,
})

/** Add stock at a known unit cost, updating the moving average. */
export function receiveStock(stock: SkuStock, qty: Qty, unitCostCentavos: Centavos): SkuStock {
  if (qty <= 0) return stock
  return {
    qty: stock.qty + qty,
    valueCentavos: stock.valueCentavos + qty * unitCostCentavos,
    lastUnitCostCentavos: unitCostCentavos,
  }
}

export interface ConsumeResult {
  /** Cost of goods removed, derived from the moving average at this moment. */
  cogsCentavos: Centavos
  stock: SkuStock
  /** True when the sale took stock below zero — a signal the ledger is behind reality. */
  oversold: boolean
}

/**
 * Remove stock and return the cost basis consumed.
 *
 * When the whole remaining quantity is consumed, the entire remaining value is
 * absorbed so that no rounding residue is ever stranded in inventory.
 *
 * SELLING BELOW ZERO IS PERMITTED, and the position is allowed to go negative.
 * A sari-sari store routinely sells goods before the purchase is recorded. The
 * alternative — clamping the position at zero — silently books cost of sales
 * against an asset that was never created, which breaks the accounting identity.
 * Carrying the negative position instead means the figures stay balanced and
 * self-correct when the purchase finally lands.
 */
export function consumeStock(stock: SkuStock, qty: Qty): ConsumeResult {
  if (qty <= 0) return { cogsCentavos: 0, stock, oversold: false }

  const oversold = qty > stock.qty
  let cogsCentavos: number

  if (stock.qty <= 0) {
    // Nothing on hand: fall back to the last known cost basis.
    cogsCentavos = qty * stock.lastUnitCostCentavos
  } else if (qty >= stock.qty) {
    cogsCentavos = stock.valueCentavos + (qty - stock.qty) * stock.lastUnitCostCentavos
  } else {
    cogsCentavos = Math.round((qty * stock.valueCentavos) / stock.qty)
  }

  return {
    cogsCentavos,
    stock: {
      qty: stock.qty - qty,
      valueCentavos: stock.valueCentavos - cogsCentavos,
      lastUnitCostCentavos: stock.lastUnitCostCentavos,
    },
    oversold,
  }
}

/** Display-only unit cost, derived from the exact inventory value. */
export function unitCostOf(stock: SkuStock): Centavos {
  if (stock.qty <= 0) return stock.lastUnitCostCentavos
  return Math.round(stock.valueCentavos / stock.qty)
}
