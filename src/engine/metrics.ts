import { safeDiv } from './money.ts'
import type { Centavos } from './money.ts'
import { computeTwin } from './twin.ts'
import { dayKeys, toDateKey, windowStart } from './period.ts'
import type { Ledger, SkuId, SkuPeriodStats, Transaction } from './types.ts'

/**
 * Period metrics are produced by folding the engine twice — once for everything
 * before the window, once for everything up to now — and subtracting.
 *
 * That is what makes *windowed COGS* correct: a sale inside the window must be
 * costed against the inventory state as it stood at the start of the window, not
 * against today's moving average.
 */

export interface DailySales {
  date: string
  amountCentavos: Centavos
}

export interface PeriodMetrics {
  days: number
  revenueCentavos: Centavos
  cogsCentavos: Centavos
  grossProfitCentavos: Centavos
  expensesCentavos: Centavos
  shrinkageCentavos: Centavos
  netProfitCentavos: Centavos
  grossMargin: number
  netMargin: number
  salesBySku: Record<SkuId, SkuPeriodStats>
  dailySales: DailySales[]
  cashInCentavos: Centavos
  cashOutCentavos: Centavos
  uncollectedCentavos: Centavos
}

function saleTotal(txn: Transaction): number {
  if (txn.kind !== 'cash_sale' && txn.kind !== 'credit_sale') return 0
  return txn.lines.reduce((sum, l) => sum + l.qty * l.unitPriceCentavos, 0)
}

/** Inventory value as it stood at the start of the window. */
export function openingInventoryValueCentavos(ledger: Ledger, days: number, now: Date): number {
  const startMs = windowStart(days, now).getTime()
  const before: Ledger = {
    ...ledger,
    transactions: ledger.transactions.filter((t) => new Date(t.at).getTime() < startMs),
  }
  return Object.values(computeTwin(before).inventory).reduce((s, x) => s + x.valueCentavos, 0)
}

export function periodMetrics(ledger: Ledger, days: number, now: Date): PeriodMetrics {
  const startMs = windowStart(days, now).getTime()
  const nowMs = now.getTime()

  const before: Ledger = {
    ...ledger,
    transactions: ledger.transactions.filter((t) => new Date(t.at).getTime() < startMs),
  }
  const upto: Ledger = {
    ...ledger,
    transactions: ledger.transactions.filter((t) => new Date(t.at).getTime() <= nowMs),
  }

  const opening = computeTwin(before)
  const closing = computeTwin(upto)

  const revenueCentavos = closing.revenueCentavos - opening.revenueCentavos
  const cogsCentavos = closing.cogsCentavos - opening.cogsCentavos
  const expensesCentavos = closing.expensesCentavos - opening.expensesCentavos
  const shrinkageCentavos = closing.shrinkageCentavos - opening.shrinkageCentavos

  const grossProfitCentavos = revenueCentavos - cogsCentavos
  const netProfitCentavos = grossProfitCentavos - expensesCentavos - shrinkageCentavos

  // Per-SKU deltas between the two folds.
  const salesBySku: Record<SkuId, SkuPeriodStats> = {}
  for (const skuId of Object.keys(closing.salesBySku)) {
    const c = closing.salesBySku[skuId]
    const o = opening.salesBySku[skuId]
    salesBySku[skuId] = {
      qtySold: c.qtySold - (o?.qtySold ?? 0),
      revenueCentavos: c.revenueCentavos - (o?.revenueCentavos ?? 0),
      cogsCentavos: c.cogsCentavos - (o?.cogsCentavos ?? 0),
      marginCentavos: c.marginCentavos - (o?.marginCentavos ?? 0),
    }
  }

  const windowTxns = ledger.transactions.filter(
    (t) => new Date(t.at).getTime() >= startMs && new Date(t.at).getTime() <= nowMs,
  )

  const dailySales: DailySales[] = dayKeys(days, now).map((date) => ({
    date,
    amountCentavos: 0,
  }))
  const byDate = new Map(dailySales.map((d) => [d.date, d]))

  let cashInCentavos = 0
  let cashOutCentavos = 0
  let salesInWindow = 0
  let utangInWindow = 0

  for (const txn of windowTxns) {
    const total = saleTotal(txn)
    if (txn.kind === 'cash_sale' || txn.kind === 'credit_sale') {
      const bucket = byDate.get(toDateKey(txn.at))
      if (bucket) bucket.amountCentavos += total
      salesInWindow += total
      if (txn.kind === 'credit_sale') utangInWindow += total
    }

    switch (txn.kind) {
      case 'cash_sale':
      case 'payment_received':
        cashInCentavos += txn.kind === 'cash_sale' ? total : txn.amountCentavos
        break
      case 'capital_injection':
        cashInCentavos += txn.amountCentavos
        break
      case 'expense':
        if (txn.paid === 'cash') cashOutCentavos += txn.amountCentavos
        break
      case 'purchase':
        cashOutCentavos += Math.min(txn.paidCentavos, txn.lines.reduce((s, l) => s + l.qty * l.unitCostCentavos, 0))
        break
      case 'payable_payment':
      case 'owner_withdrawal':
      case 'fixed_asset_purchase':
        cashOutCentavos += txn.amountCentavos
        break
      default:
        break
    }
  }

  return {
    days,
    revenueCentavos,
    cogsCentavos,
    grossProfitCentavos,
    expensesCentavos,
    shrinkageCentavos,
    netProfitCentavos,
    grossMargin: safeDiv(grossProfitCentavos, revenueCentavos),
    netMargin: safeDiv(netProfitCentavos, revenueCentavos),
    salesBySku,
    dailySales,
    cashInCentavos,
    cashOutCentavos,
    uncollectedCentavos: utangInWindow,
  }
}
