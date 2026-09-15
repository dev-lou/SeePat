import type { Centavos } from './money.ts'
import { safeDiv } from './money.ts'
import { consumeStock, emptyStock, receiveStock } from './inventory.ts'
import type {
  BusinessTwin,
  DerivedTwin,
  Ledger,
  SkuId,
  SkuPeriodStats,
  SkuStock,
  Transaction,
  Warning,
} from './types.ts'

/**
 * The Business Twin is a pure fold over the transaction log.
 *
 * Nothing in it is hand-maintained: voiding a transaction simply recomputes the
 * whole twin from the log, which makes corrections reproducible and auditable
 * rather than a mutation someone has to trust.
 */

function emptyTwin(): BusinessTwin {
  return {
    cashCentavos: 0,
    payablesCentavos: 0,
    fixedAssetsCentavos: 0,
    capitalInjectedCentavos: 0,
    withdrawalsCentavos: 0,
    revenueCentavos: 0,
    cogsCentavos: 0,
    expensesCentavos: 0,
    shrinkageCentavos: 0,
    inventory: {},
    receivables: {},
    salesBySku: {},
    warnings: [],
  }
}

function stockOf(twin: BusinessTwin, skuId: SkuId): SkuStock {
  return twin.inventory[skuId] ?? emptyStock()
}

function emptyStats(): SkuPeriodStats {
  return { qtySold: 0, revenueCentavos: 0, cogsCentavos: 0, marginCentavos: 0 }
}

export function computeTwin(ledger: Ledger): BusinessTwin {
  const voided = new Set(ledger.voids.map((v) => v.txnId))
  const skuIds = new Set(ledger.skus.map((s) => s.id))
  const customerIds = new Set(ledger.customers.map((c) => c.id))

  const twin = emptyTwin()
  const warnings: Warning[] = []

  for (const record of ledger.voids) {
    if (!ledger.transactions.some((t) => t.id === record.txnId)) {
      warnings.push({
        code: 'voided_txn_not_found',
        message: `Void recorded for unknown transaction ${record.txnId}.`,
        messageFil: `May naitalang void para sa hindi kilalang transaksyon ${record.txnId}.`,
        txnId: record.txnId,
      })
    }
  }

  // JS Array.prototype.sort is stable, so same-timestamp entries keep input order.
  const ordered = [...ledger.transactions].sort((a, b) => a.at.localeCompare(b.at))

  for (const txn of ordered) {
    if (voided.has(txn.id)) continue
    applyTransaction(twin, warnings, txn, skuIds, customerIds)
  }

  twin.warnings = warnings
  return twin
}

function recordSale(
  twin: BusinessTwin,
  lines: { skuId: SkuId; qty: number; unitPriceCentavos: Centavos }[],
  warnings: Warning[],
  txnId: string,
  skuIds: Set<string>,
): void {
  for (const line of lines) {
    const revenue = line.qty * line.unitPriceCentavos

    if (!skuIds.has(line.skuId)) {
      warnings.push({
        code: 'unknown_sku',
        message: `Sale references unregistered SKU "${line.skuId}"; revenue recorded without inventory movement.`,
        messageFil: `May bentang tumutukoy sa hindi rehistradong paninda "${line.skuId}"; naitala ang benta pero walang bawas sa stock.`,
        txnId,
      })
      twin.revenueCentavos += revenue
      continue
    }

    const { cogsCentavos, stock, oversold } = consumeStock(stockOf(twin, line.skuId), line.qty)
    twin.inventory[line.skuId] = stock

    if (oversold) {
      warnings.push({
        code: 'oversold_stock',
        message: `"${line.skuId}" was sold below zero stock. Record the purchase to correct the cost basis.`,
        messageFil: `Nabili ang "${line.skuId}" kahit ubos na ang stock. I-record ang bili para tumama ang puhunan.`,
        txnId,
      })
    }

    twin.revenueCentavos += revenue
    twin.cogsCentavos += cogsCentavos

    const stats = twin.salesBySku[line.skuId] ?? emptyStats()
    twin.salesBySku[line.skuId] = {
      qtySold: stats.qtySold + line.qty,
      revenueCentavos: stats.revenueCentavos + revenue,
      cogsCentavos: stats.cogsCentavos + cogsCentavos,
      marginCentavos: stats.marginCentavos + (revenue - cogsCentavos),
    }
  }
}

function applyTransaction(
  twin: BusinessTwin,
  warnings: Warning[],
  txn: Transaction,
  skuIds: Set<string>,
  customerIds: Set<string>,
): void {
  switch (txn.kind) {
    case 'capital_injection': {
      twin.cashCentavos += txn.amountCentavos
      twin.capitalInjectedCentavos += txn.amountCentavos
      return
    }

    case 'owner_withdrawal': {
      twin.cashCentavos -= txn.amountCentavos
      twin.withdrawalsCentavos += txn.amountCentavos
      return
    }

    case 'purchase': {
      let total = 0
      for (const line of txn.lines) {
        total += line.qty * line.unitCostCentavos
        if (!skuIds.has(line.skuId)) {
          warnings.push({
            code: 'unknown_sku',
            message: `Purchase references unregistered SKU "${line.skuId}".`,
            messageFil: `May biling tumutukoy sa hindi rehistradong paninda "${line.skuId}".`,
            txnId: txn.id,
          })
          continue
        }
        twin.inventory[line.skuId] = receiveStock(
          stockOf(twin, line.skuId),
          line.qty,
          line.unitCostCentavos,
        )
      }

      const paid = Math.min(txn.paidCentavos, total)
      if (txn.paidCentavos > total) {
        warnings.push({
          code: 'overpaid_purchase',
          message: `Payment exceeded the purchase total; only ${total} centavos applied.`,
          messageFil: `Lumampas ang bayad sa kabuuang bili; ${total} sentimos lang ang naibawas.`,
          txnId: txn.id,
        })
      }
      twin.cashCentavos -= paid
      twin.payablesCentavos += total - paid
      return
    }

    case 'cash_sale': {
      let total = 0
      for (const line of txn.lines) total += line.qty * line.unitPriceCentavos
      twin.cashCentavos += total
      recordSale(twin, txn.lines, warnings, txn.id, skuIds)
      return
    }

    case 'credit_sale': {
      let total = 0
      for (const line of txn.lines) total += line.qty * line.unitPriceCentavos
      if (!customerIds.has(txn.customerId)) {
        warnings.push({
          code: 'unknown_customer',
          message: `Utang recorded against unregistered customer "${txn.customerId}".`,
          messageFil: `May utang na naitala sa hindi rehistradong customer na "${txn.customerId}".`,
          txnId: txn.id,
        })
      }
      twin.receivables[txn.customerId] = (twin.receivables[txn.customerId] ?? 0) + total
      recordSale(twin, txn.lines, warnings, txn.id, skuIds)
      return
    }

    case 'payment_received': {
      twin.cashCentavos += txn.amountCentavos
      const owed = twin.receivables[txn.customerId] ?? 0
      if (txn.amountCentavos > owed) {
        warnings.push({
          code: 'payment_exceeds_receivable',
          message: `Payment of ${txn.amountCentavos} exceeds the ${owed} outstanding for "${txn.customerId}".`,
          messageFil: `Ang bayad na ${txn.amountCentavos} ay lumampas sa ${owed} na utang ni "${txn.customerId}".`,
          txnId: txn.id,
        })
      }
      twin.receivables[txn.customerId] = owed - txn.amountCentavos
      return
    }

    case 'expense': {
      twin.expensesCentavos += txn.amountCentavos
      if (txn.paid === 'cash') twin.cashCentavos -= txn.amountCentavos
      else twin.payablesCentavos += txn.amountCentavos
      return
    }

    case 'payable_payment': {
      twin.cashCentavos -= txn.amountCentavos
      if (txn.amountCentavos > twin.payablesCentavos) {
        warnings.push({
          code: 'payment_exceeds_payable',
          message: `Supplier payment exceeds recorded payables (${twin.payablesCentavos}).`,
          messageFil: `Lumampas ang bayad sa supplier sa naitalang utang (${twin.payablesCentavos}).`,
          txnId: txn.id,
        })
      }
      twin.payablesCentavos -= txn.amountCentavos
      return
    }

    case 'fixed_asset_purchase': {
      twin.cashCentavos -= txn.amountCentavos
      twin.fixedAssetsCentavos += txn.amountCentavos
      return
    }

    case 'stock_adjustment': {
      if (!skuIds.has(txn.skuId)) {
        warnings.push({
          code: 'unknown_sku',
          message: `Stock adjustment references unregistered SKU "${txn.skuId}".`,
          messageFil: `Ang stock adjustment ay tumutukoy sa hindi rehistradong paninda na "${txn.skuId}".`,
          txnId: txn.id,
        })
        return
      }

      const stock = stockOf(twin, txn.skuId)

      if (txn.qtyDelta < 0) {
        const { cogsCentavos, stock: next } = consumeStock(stock, -txn.qtyDelta)
        twin.inventory[txn.skuId] = next
        twin.shrinkageCentavos += cogsCentavos
      } else if (txn.qtyDelta > 0) {
        // Stock found outside a purchase carries an explicit cost basis; the
        // offsetting entry reduces shrinkage rather than inventing a revenue line.
        const unitCost = txn.unitCostCentavos ?? stock.lastUnitCostCentavos
        twin.inventory[txn.skuId] = receiveStock(stock, txn.qtyDelta, unitCost)
        twin.shrinkageCentavos -= txn.qtyDelta * unitCost
      }
      return
    }
  }
}

/** All figures derived from the twin. Nothing here is stored. */
export function deriveTwin(twin: BusinessTwin): DerivedTwin {
  const inventoryValueCentavos = Object.values(twin.inventory).reduce(
    (sum, s) => sum + s.valueCentavos,
    0,
  )
  const receivablesCentavos = Object.values(twin.receivables).reduce((sum, v) => sum + v, 0)

  const grossProfitCentavos = twin.revenueCentavos - twin.cogsCentavos
  const netProfitCentavos = grossProfitCentavos - twin.expensesCentavos - twin.shrinkageCentavos

  const totalAssetsCentavos =
    twin.cashCentavos + inventoryValueCentavos + receivablesCentavos + twin.fixedAssetsCentavos

  return {
    grossProfitCentavos,
    netProfitCentavos,
    grossMargin: safeDiv(grossProfitCentavos, twin.revenueCentavos),
    netMargin: safeDiv(netProfitCentavos, twin.revenueCentavos),
    inventoryValueCentavos,
    receivablesCentavos,
    totalAssetsCentavos,
    totalLiabilitiesCentavos: twin.payablesCentavos,
    equityCentavos:
      twin.capitalInjectedCentavos - twin.withdrawalsCentavos + netProfitCentavos,
    workingCapitalCentavos:
      twin.cashCentavos + inventoryValueCentavos + receivablesCentavos - twin.payablesCentavos,
  }
}

export interface InvariantResult {
  ok: boolean
  /** Cash + Inventory + Receivables + Fixed Assets − Payables */
  netAssetsCentavos: Centavos
  /** Capital Injections − Withdrawals + Cumulative Net Profit */
  equityCentavos: Centavos
  deltaCentavos: Centavos
}

/**
 * THE invariant every transaction must preserve:
 *
 *   Assets − Liabilities  ==  Capital − Withdrawals + Cumulative Net Profit
 *
 * If this ever fails, the books are wrong and no downstream insight can be trusted.
 */
export function checkInvariant(twin: BusinessTwin): InvariantResult {
  const d = deriveTwin(twin)
  return {
    ok: d.totalAssetsCentavos - d.totalLiabilitiesCentavos === d.equityCentavos,
    netAssetsCentavos: d.totalAssetsCentavos - d.totalLiabilitiesCentavos,
    equityCentavos: d.equityCentavos,
    deltaCentavos: d.totalAssetsCentavos - d.totalLiabilitiesCentavos - d.equityCentavos,
  }
}
