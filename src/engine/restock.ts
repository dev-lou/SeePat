import type { BusinessTwin, Ledger } from './types.ts'

/**
 * Restock advice from data already computed: days of stock left per SKU.
 *
 * `avgDailyQty` comes from the week's per-SKU sales; on-hand comes from the
 * twin. No server, no model — this costs ₱0 to serve, which is why it can sit
 * in PRO as pure premium "advice" while running fully on-device.
 */

export interface RestockAlert {
  skuId: string
  name: string
  unit: string
  onHand: number
  avgDailyQty: number
  daysLeft: number
  severity: 'out' | 'low' | 'watch'
}

export function computeRestock(
  ledger: Ledger,
  twin: BusinessTwin,
  salesBySku: Record<string, { qtySold: number }>,
  daysWindow = 7,
): RestockAlert[] {
  const alerts: RestockAlert[] = []
  for (const sku of ledger.skus) {
    const stock = twin.inventory[sku.id]
    const onHand = stock?.qty ?? 0
    const sold = salesBySku[sku.id]?.qtySold ?? 0
    if (sold <= 0) continue
    const avgDailyQty = sold / Math.max(1, daysWindow)
    if (avgDailyQty <= 0) continue
    const daysLeft = onHand / avgDailyQty
    const severity = onHand <= 0 || daysLeft <= 0 ? 'out' : daysLeft <= 3 ? 'low' : daysLeft <= 7 ? 'watch' : null
    if (!severity) continue
    alerts.push({ skuId: sku.id, name: sku.name, unit: sku.unit, onHand, avgDailyQty, daysLeft, severity })
  }
  return alerts.sort((a, b) => a.daysLeft - b.daysLeft)
}
