import type { Centavos } from './money.ts'
import { formatPHP, safeDiv } from './money.ts'
import { consumeStock, emptyStock, receiveStock } from './inventory.ts'
import type {
  BusinessTwin,
  DerivedTwin,
  Ledger,
  PaymentChannel,
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
    walletCentavos: 0,
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

/**
 * Money arrives, and it arrives in one of two places.
 *
 * `cashCentavos` is money on hand either way — that is why it is incremented in
 * both branches, and why every existing identity in `deriveTwin` is untouched by
 * this. The e-wallet branch additionally fills `walletCentavos`, so the drawer
 * can be separated from the float without becoming a second account system.
 */
function receiveMoney(twin: BusinessTwin, amountCentavos: Centavos, channel: PaymentChannel | undefined): void {
  twin.cashCentavos += amountCentavos
  if (channel && channel !== 'cash') twin.walletCentavos += amountCentavos
}

function emptyStats(): SkuPeriodStats {
  return { qtySold: 0, revenueCentavos: 0, cogsCentavos: 0, marginCentavos: 0 }
}

export function computeTwin(ledger: Ledger): BusinessTwin {
  const voided = new Set(ledger.voids.map((v) => v.txnId))
  // Maps rather than Sets. These warnings are read by the owner, and one that
  // names "coke_mismo" instead of "Coke Mismo", or counts in centavos, is a
  // message about the program rather than about her shop. Membership is still
  // `.has()`, so nothing else changes shape.
  const skuNames = new Map<string, string>(ledger.skus.map((s) => [s.id, s.name]))
  const customerNames = new Map<string, string>(ledger.customers.map((c) => [c.id, c.name]))

  const twin = emptyTwin()
  const warnings: Warning[] = []

  for (const record of ledger.voids) {
    if (!ledger.transactions.some((t) => t.id === record.txnId)) {
      warnings.push({
        code: 'voided_txn_not_found',
        message: `A cancelled entry points to a record that is no longer in the list, so it could not be taken out. (Ref ${record.txnId})`,
        messageFil: `May kanseladong entry na tumutukoy sa rekord na wala na sa listahan, kaya hindi ito naialis. (Ref ${record.txnId})`,
        txnId: record.txnId,
      })
    }
  }

  // JS Array.prototype.sort is stable, so same-timestamp entries keep input order.
  const ordered = [...ledger.transactions].sort((a, b) => a.at.localeCompare(b.at))

  for (const txn of ordered) {
    if (voided.has(txn.id)) continue
    applyTransaction(twin, warnings, txn, skuNames, customerNames)
  }

  /*
   * The box cannot hold less than nothing.
   *
   * Every outflow is assumed to be paid from the drawer, so a store that pays a
   * supplier through GCash — or that records a GCash sale and then spends box
   * money it never had — ends up with a negative drawer while the total is still
   * right. That is the signature of missing channel information rather than of a
   * wrong amount, and the fix is to record which place the money moved in, so the
   * warning says exactly that instead of letting a nonsense figure sit on screen.
   */
  const drawer = twin.cashCentavos - twin.walletCentavos
  if (drawer < 0 && twin.walletCentavos > 0) {
    warnings.push({
      code: 'box_overdrawn',
      message: `The records say ${formatPHP(-drawer)} more went out of the box than is left in it. Part of your money is in GCash/Maya (${formatPHP(twin.walletCentavos)}), so a payment made from there was probably recorded as cash.`,
      messageFil: `Ayon sa tala, ${formatPHP(-drawer)} ang sobrang lumabas sa kahon kaysa laman nito. May pera kang nasa GCash/Maya (${formatPHP(twin.walletCentavos)}), kaya malamang may bayad na galing doon ang naitala bilang cash.`,
    })
  }

  twin.warnings = warnings
  return twin
}

/** What to call an id in a sentence the owner reads: the name, or the id if it is unknown. */
function nameOf(names: Map<string, string>, id: string): string {
  return names.get(id) ?? id
}

function recordSale(
  twin: BusinessTwin,
  lines: { skuId: SkuId; qty: number; unitPriceCentavos: Centavos }[],
  warnings: Warning[],
  txnId: string,
  skuNames: Map<string, string>,
): void {
  for (const line of lines) {
    const revenue = line.qty * line.unitPriceCentavos

    if (!skuNames.has(line.skuId)) {
      warnings.push({
        code: 'unknown_sku',
        message: `A sale of "${nameOf(skuNames, line.skuId)}" was recorded even though it is not in your item list, so no stock was taken out. Add the item so the count stays right.`,
        messageFil: `May bentang "${nameOf(skuNames, line.skuId)}" kahit wala ito sa listahan ng paninda mo, kaya walang nabawas na stock. Idagdag ang paninda para tumama ang bilang.`,
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
        message: `You sold more "${nameOf(skuNames, line.skuId)}" than the stock records show, so its cost was estimated. Record the purchase to make it exact.`,
        messageFil: `Mas marami ang naibentang "${nameOf(skuNames, line.skuId)}" kaysa nakatalang stock, kaya tinantiya lang ang puhunan nito. Itala ang bili para tumama.`,
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
  skuNames: Map<string, string>,
  customerNames: Map<string, string>,
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
        if (!skuNames.has(line.skuId)) {
          warnings.push({
            code: 'unknown_sku',
            message: `A purchase of "${nameOf(skuNames, line.skuId)}" was recorded for an item that is not in your item list, so it was not added to your stock.`,
            messageFil: `May biling "${nameOf(skuNames, line.skuId)}" para sa panindang wala sa listahan mo, kaya hindi ito naidagdag sa stock mo.`,
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
        message: `You paid a supplier more than the whole purchase cost, so only ${formatPHP(total)} was taken from the money in the box.`,
        messageFil: `Lumampas ang bayad mo sa supplier sa buong halaga ng bili, kaya ${formatPHP(total)} lang ang nabawas sa pera sa kahon.`,
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
      receiveMoney(twin, total, txn.channel)
      recordSale(twin, txn.lines, warnings, txn.id, skuNames)
      return
    }

    case 'credit_sale': {
      let total = 0
      for (const line of txn.lines) total += line.qty * line.unitPriceCentavos
      if (!customerNames.has(txn.customerId)) {
        warnings.push({
          code: 'unknown_customer',
          message: `Utang was recorded for "${nameOf(customerNames, txn.customerId)}", who is not in your customer list, so the balance is not being tracked. Add the customer to follow it.`,
          messageFil: `May utang na naitala para kay "${nameOf(customerNames, txn.customerId)}", na wala sa listahan ng customer mo, kaya hindi nasusubaybayan ang balanse. Idagdag ang customer para mabantayan ito.`,
          txnId: txn.id,
        })
      }
      twin.receivables[txn.customerId] = (twin.receivables[txn.customerId] ?? 0) + total
      recordSale(twin, txn.lines, warnings, txn.id, skuNames)
      return
    }

    case 'payment_received': {
      receiveMoney(twin, txn.amountCentavos, txn.channel)
      const owed = twin.receivables[txn.customerId] ?? 0
      if (txn.amountCentavos > owed) {
        warnings.push({
          code: 'payment_exceeds_receivable',
          message: `The payment of ${formatPHP(txn.amountCentavos)} is more than the ${formatPHP(owed)} that "${nameOf(customerNames, txn.customerId)}" still owed, so that balance went below zero. Check the amount, or their earlier payments.`,
          messageFil: `Ang bayad na ${formatPHP(txn.amountCentavos)} ay mas malaki kaysa ${formatPHP(owed)} na utang pa ni "${nameOf(customerNames, txn.customerId)}", kaya naging negatibo ang balanse. Suriin ang halaga, o ang mga naunang bayad niya.`,
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
          message: `You paid a supplier more than the ${formatPHP(twin.payablesCentavos)} you still owed them, so that balance went below zero. Check the amount.`,
          messageFil: `Mas malaki ang binayad mo sa supplier kaysa ${formatPHP(twin.payablesCentavos)} na utang mo pa, kaya naging negatibo ang balanse. Suriin ang halaga.`,
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
      if (!skuNames.has(txn.skuId)) {
        warnings.push({
          code: 'unknown_sku',
          message: `A stock correction was recorded for "${nameOf(skuNames, txn.skuId)}", which is not in your item list, so nothing changed. Add the item first.`,
          messageFil: `May pagwawasto ng paninda para sa "${nameOf(skuNames, txn.skuId)}", na wala sa listahan mo, kaya walang nabago. Idagdag muna ang paninda.`,
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
    // Money on hand, split by where it is. The box figure is what a real drawer
    // count is compared against; the wallet figure is money that is spendable
    // but not countable.
    cashInBoxCentavos: twin.cashCentavos - twin.walletCentavos,
    walletCentavos: twin.walletCentavos,
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
