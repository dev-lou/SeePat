import { describe, expect, it } from 'vitest'
import { pesos } from './money.ts'
import { computeTwin, checkInvariant, deriveTwin } from './twin.ts'
import { consumeStock, emptyStock, receiveStock, unitCostOf } from './inventory.ts'
import { seedLedger } from './demo.ts'
import type { Customer, Ledger, Sku, Transaction } from './types.ts'

const SKUS: Sku[] = [
  { id: 'coke', name: 'Coke Mismo', unit: 'pc', baseUnit: 'pc', aliases: ['coke'] },
  { id: 'bigas', name: 'Bigas', unit: 'kg', baseUnit: 'g', aliases: ['bigas'] },
]

const CUSTOMERS: Customer[] = [{ id: 'nena', name: 'Aling Nena', aliases: ['nena'] }]

let seq = 0
function txnAt(day: number, hour = 12): string {
  return new Date(2026, 8, day, hour, 0, 0).toISOString()
}

function ledgerOf(transactions: Transaction[], voids: Ledger['voids'] = []): Ledger {
  return { skus: SKUS, customers: CUSTOMERS, transactions, voids }
}

function id(): string {
  seq += 1
  return `t-${seq}`
}

describe('the accounting invariant', () => {
  it('holds for every kind of transaction', () => {
    const steps: Transaction[] = [
      { id: id(), at: txnAt(1, 7), kind: 'capital_injection', amountCentavos: pesos(20000) },
      { id: id(), at: txnAt(1, 8), kind: 'purchase', lines: [{ skuId: 'coke', qty: 100, unitCostCentavos: pesos(18) }], paidCentavos: pesos(1800) },
      { id: id(), at: txnAt(1, 9), kind: 'cash_sale', lines: [{ skuId: 'coke', qty: 12, unitPriceCentavos: pesos(25) }] },
      { id: id(), at: txnAt(1, 10), kind: 'credit_sale', lines: [{ skuId: 'coke', qty: 5, unitPriceCentavos: pesos(25) }], customerId: 'nena' },
      { id: id(), at: txnAt(1, 11), kind: 'payment_received', customerId: 'nena', amountCentavos: pesos(50) },
      { id: id(), at: txnAt(1, 12), kind: 'expense', amountCentavos: pesos(300), paid: 'cash' },
      { id: id(), at: txnAt(1, 13), kind: 'expense', amountCentavos: pesos(150), paid: 'credit' },
      { id: id(), at: txnAt(1, 14), kind: 'purchase', lines: [{ skuId: 'bigas', qty: 5000, unitCostCentavos: pesos(0.052) }], paidCentavos: 0 },
      { id: id(), at: txnAt(1, 15), kind: 'payable_payment', amountCentavos: pesos(100) },
      { id: id(), at: txnAt(1, 16), kind: 'fixed_asset_purchase', amountCentavos: pesos(2000) },
      { id: id(), at: txnAt(1, 17), kind: 'stock_adjustment', skuId: 'coke', qtyDelta: -3 },
      { id: id(), at: txnAt(1, 18), kind: 'owner_withdrawal', amountCentavos: pesos(500) },
    ]

    for (let i = 1; i <= steps.length; i += 1) {
      const twin = computeTwin(ledgerOf(steps.slice(0, i)))
      const result = checkInvariant(twin)
      expect(result.ok, `invariant broke after ${steps[i - 1].kind}: ${result.deltaCentavos}`).toBe(true)
    }
  })

  it('holds across a full 21-day seeded history', () => {
    const ledger = seedLedger(new Date(2026, 8, 20, 18, 0, 0))
    expect(ledger.transactions.length).toBeGreaterThan(50)
    const result = checkInvariant(computeTwin(ledger))
    expect(result.ok).toBe(true)
    expect(result.deltaCentavos).toBe(0)
  })

  it('holds when a transaction references an unknown SKU', () => {
    const twin = computeTwin(
      ledgerOf([
        { id: id(), at: txnAt(1, 8), kind: 'capital_injection', amountCentavos: pesos(1000) },
        { id: id(), at: txnAt(1, 9), kind: 'cash_sale', lines: [{ skuId: 'ghost', qty: 2, unitPriceCentavos: pesos(10) }] },
      ]),
    )
    expect(checkInvariant(twin).ok).toBe(true)
    expect(twin.warnings.some((w) => w.code === 'unknown_sku')).toBe(true)
  })
})

describe('perpetual moving-average costing', () => {
  it('costs each sale against the moving average, not a periodic count', () => {
    const txns: Transaction[] = [
      { id: id(), at: txnAt(1, 8), kind: 'capital_injection', amountCentavos: pesos(10000) },
      { id: id(), at: txnAt(1, 9), kind: 'purchase', lines: [{ skuId: 'coke', qty: 10, unitCostCentavos: pesos(20) }], paidCentavos: pesos(200) },
      { id: id(), at: txnAt(1, 10), kind: 'cash_sale', lines: [{ skuId: 'coke', qty: 5, unitPriceCentavos: pesos(30) }] },
      { id: id(), at: txnAt(1, 11), kind: 'purchase', lines: [{ skuId: 'coke', qty: 10, unitCostCentavos: pesos(30) }], paidCentavos: pesos(300) },
      { id: id(), at: txnAt(1, 12), kind: 'cash_sale', lines: [{ skuId: 'coke', qty: 5, unitPriceCentavos: pesos(40) }] },
    ]
    const twin = computeTwin(ledgerOf(txns))
    const stock = twin.inventory.coke

    // 10 @ ₱20 = ₱200; sell 5 → COGS ₱100; buy 10 @ ₱30 → 15 units worth ₱400.
    // Sell 5 → COGS = round(5 × 40000 / 15) = 13333 centavos.
    expect(twin.cogsCentavos).toBe(pesos(100) + 13333)
    expect(stock.qty).toBe(10)
    expect(stock.valueCentavos).toBe(pesos(400) - 13333)
  })

  it('can report daily profit with no physical stock count', () => {
    const twin = computeTwin(
      ledgerOf([
        { id: id(), at: txnAt(1, 8), kind: 'capital_injection', amountCentavos: pesos(10000) },
        { id: id(), at: txnAt(1, 9), kind: 'purchase', lines: [{ skuId: 'coke', qty: 20, unitCostCentavos: pesos(18) }], paidCentavos: pesos(360) },
        { id: id(), at: txnAt(1, 10), kind: 'cash_sale', lines: [{ skuId: 'coke', qty: 10, unitPriceCentavos: pesos(25) }] },
      ]),
    )
    const d = deriveTwin(twin)
    // Revenue ₱250, COGS ₱180 → gross ₱70, with no counting of shelves.
    expect(twin.revenueCentavos).toBe(pesos(250))
    expect(twin.cogsCentavos).toBe(pesos(180))
    expect(d.grossProfitCentavos).toBe(pesos(70))
  })

  it('absorbs the whole remaining value when stock is fully consumed', () => {
    // 3 @ ₱10 then 1 @ ₱11 makes a non-terminating average; consuming all must not strand residue.
    let stock = emptyStock()
    stock = receiveStock(stock, 3, pesos(10))
    stock = receiveStock(stock, 1, pesos(11))
    const first = consumeStock(stock, 1)
    const second = consumeStock(first.stock, 3)
    expect(first.stock.valueCentavos - second.cogsCentavos).toBe(0)
    expect(second.stock.qty).toBe(0)
    expect(second.stock.valueCentavos).toBe(0)
  })

  it('derives unit cost for display only', () => {
    const stock = receiveStock(emptyStock(), 3, pesos(10))
    expect(unitCostOf(stock)).toBe(pesos(10))
    expect(unitCostOf(emptyStock())).toBe(0)
  })
})

describe('void semantics', () => {
  const base: Transaction[] = [
    { id: 'cap-1', at: txnAt(1, 8), kind: 'capital_injection', amountCentavos: pesos(10000) },
    { id: 'pur-1', at: txnAt(1, 9), kind: 'purchase', lines: [{ skuId: 'coke', qty: 10, unitCostCentavos: pesos(20) }], paidCentavos: pesos(200) },
  ]
  const sale: Transaction = {
    id: 'sal-1',
    at: txnAt(1, 10),
    kind: 'cash_sale',
    lines: [{ skuId: 'coke', qty: 4, unitPriceCentavos: pesos(30) }],
  }

  it('restores the twin exactly when a transaction is voided', () => {
    const withSale = computeTwin(ledgerOf([...base, sale]))
    const voided = computeTwin(
      ledgerOf([...base, sale], [{ txnId: 'sal-1', at: txnAt(2, 9), reason: 'Mali ang entry' }]),
    )
    const neverPosted = computeTwin(ledgerOf(base))

    expect(voided.revenueCentavos).toBe(neverPosted.revenueCentavos)
    expect(voided.inventory.coke.qty).toBe(neverPosted.inventory.coke.qty)
    expect(voided.inventory.coke.valueCentavos).toBe(neverPosted.inventory.coke.valueCentavos)
    expect(voided.cashCentavos).toBe(neverPosted.cashCentavos)
    expect(withSale.revenueCentavos).toBe(pesos(120))
    expect(checkInvariant(voided).ok).toBe(true)
  })

  it('is NOT equivalent to posting a negative sale, even though both balance', () => {
    const voided = computeTwin(
      ledgerOf([...base, sale], [{ txnId: 'sal-1', at: txnAt(2, 9) }]),
    )
    const negative = computeTwin(
      ledgerOf([
        ...base,
        sale,
        {
          id: 'sal-2',
          at: txnAt(2, 9),
          kind: 'cash_sale',
          lines: [{ skuId: 'coke', qty: -4, unitPriceCentavos: pesos(30) }],
        },
      ]),
    )

    const neverPosted = computeTwin(ledgerOf(base))

    // Both keep the books balanced...
    expect(checkInvariant(voided).ok).toBe(true)
    expect(checkInvariant(negative).ok).toBe(true)
    // ...and both land on the same revenue...
    expect(negative.revenueCentavos).toBe(neverPosted.revenueCentavos)
    // ...but only the void puts the stock back. The negative sale leaves the
    // inventory overstated, which is the silent corruption the concept document
    // left unspecified.
    expect(voided.inventory.coke.qty).toBe(neverPosted.inventory.coke.qty)
    expect(negative.inventory.coke.qty).toBe(voided.inventory.coke.qty - 4)
  })

  it('warns about a void that references no known transaction', () => {
    const twin = computeTwin(ledgerOf(base, [{ txnId: 'nope', at: txnAt(2, 9) }]))
    expect(twin.warnings.some((w) => w.code === 'voided_txn_not_found')).toBe(true)
  })
})

describe('resilience warnings', () => {
  it('flags selling below zero stock rather than silently mis-costing', () => {
    const twin = computeTwin(
      ledgerOf([
        { id: id(), at: txnAt(1, 8), kind: 'capital_injection', amountCentavos: pesos(1000) },
        { id: id(), at: txnAt(1, 9), kind: 'cash_sale', lines: [{ skuId: 'coke', qty: 5, unitPriceCentavos: pesos(25) }] },
      ]),
    )
    expect(twin.warnings.some((w) => w.code === 'oversold_stock')).toBe(true)
    expect(checkInvariant(twin).ok).toBe(true)
  })

  it('flags a payment larger than the outstanding utang', () => {
    const twin = computeTwin(
      ledgerOf([
        { id: id(), at: txnAt(1, 8), kind: 'capital_injection', amountCentavos: pesos(1000) },
        { id: id(), at: txnAt(1, 9), kind: 'purchase', lines: [{ skuId: 'coke', qty: 10, unitCostCentavos: pesos(20) }], paidCentavos: pesos(200) },
        { id: id(), at: txnAt(1, 10), kind: 'credit_sale', lines: [{ skuId: 'coke', qty: 2, unitPriceCentavos: pesos(30) }], customerId: 'nena' },
        { id: id(), at: txnAt(1, 11), kind: 'payment_received', customerId: 'nena', amountCentavos: pesos(100) },
      ]),
    )
    expect(twin.warnings.some((w) => w.code === 'payment_exceeds_receivable')).toBe(true)
    expect(checkInvariant(twin).ok).toBe(true)
  })
})
