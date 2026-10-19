import { describe, expect, it } from 'vitest'
import { supplierMovements } from './Supplier.tsx'
import { computeTwin } from '../engine/twin.ts'
import type { Ledger, Transaction } from '../engine/index.ts'

/**
 * The supplier book's contract: the movement list behind the dashboard's
 * "Owed to suppliers" total. Whatever the screen shows must add up to the
 * engine's own payables balance — otherwise the list explains nothing.
 */

const at = (day: number, hour: number) => new Date(2026, 9, day, hour, 0, 0).toISOString()

const skus: Ledger['skus'] = [
  { id: 'coke', name: 'Coke', baseUnit: 'pc', unit: 'pc', aliases: [] },
  { id: 'noodles', name: 'Noodles', baseUnit: 'pc', unit: 'pc', aliases: [] },
]

function ledgerWith(txns: Transaction[]): Ledger {
  return { skus, customers: [], transactions: txns, voids: [] }
}

describe('supplierMovements', () => {
  it('lists credit purchases by their unpaid portion, newest first', () => {
    const ledger = ledgerWith([
      {
        id: 'pur-old',
        at: at(3, 8),
        kind: 'purchase',
        lines: [{ skuId: 'coke', qty: 10, unitCostCentavos: 2000 }],
        paidCentavos: 0,
        note: 'Utang sa supplier',
      },
      {
        id: 'pur-new',
        at: at(10, 8),
        kind: 'purchase',
        lines: [{ skuId: 'noodles', qty: 5, unitCostCentavos: 1500 }],
        paidCentavos: 2500,
      },
    ])
    const out = supplierMovements(ledger)
    expect(out.map((m) => m.id)).toEqual(['pur-new', 'pur-old'])
    expect(out.map((m) => m.amountCentavos)).toEqual([5000, 20000])
    expect(out.map((m) => m.kind)).toEqual(['credit_purchase', 'credit_purchase'])
  })

  it('leaves fully-paid purchases and cash expenses out', () => {
    const ledger = ledgerWith([
      {
        id: 'pur-cash',
        at: at(5, 8),
        kind: 'purchase',
        lines: [{ skuId: 'coke', qty: 2, unitCostCentavos: 2000 }],
        paidCentavos: 4000,
      },
      { id: 'exp-cash', at: at(6, 9), kind: 'expense', amountCentavos: 35000, paid: 'cash' },
      { id: 'exp-credit', at: at(7, 9), kind: 'expense', amountCentavos: 20000, paid: 'credit' },
    ])
    const out = supplierMovements(ledger)
    expect(out.map((m) => m.id)).toEqual(['exp-credit'])
    expect(out[0].kind).toBe('credit_expense')
  })

  it('shows supplier payments as negative, and the signed sum equals payables', () => {
    const ledger = ledgerWith([
      {
        id: 'pur-1',
        at: at(3, 8),
        kind: 'purchase',
        lines: [{ skuId: 'coke', qty: 10, unitCostCentavos: 2000 }],
        paidCentavos: 0,
        note: 'Utang sa supplier',
      },
      { id: 'exp-1', at: at(5, 9), kind: 'expense', amountCentavos: 5000, paid: 'credit' },
      { id: 'ppay-1', at: at(8, 11), kind: 'payable_payment', amountCentavos: 7000 },
    ])
    const out = supplierMovements(ledger)
    expect(out.map((m) => m.id)).toEqual(['ppay-1', 'exp-1', 'pur-1'])
    const payment = out.find((m) => m.kind === 'payment')
    expect(payment?.amountCentavos).toBe(-7000)
    // 20000 + 5000 − 7000 = 18000, the engine's own number for this ledger.
    const twin = computeTwin(ledger)
    expect(out.reduce((sum, m) => sum + m.amountCentavos, 0)).toBe(twin.payablesCentavos)
    expect(twin.payablesCentavos).toBe(18000)
  })

  it('skips voided records the way the engine does', () => {
    const ledger = ledgerWith([
      {
        id: 'pur-void',
        at: at(3, 8),
        kind: 'purchase',
        lines: [{ skuId: 'coke', qty: 10, unitCostCentavos: 2000 }],
        paidCentavos: 0,
      },
    ])
    ledger.voids = [{ txnId: 'pur-void', at: at(4, 8), reason: 'mistake' }]
    expect(supplierMovements(ledger)).toEqual([])
    const twin = computeTwin(ledger)
    expect(twin.payablesCentavos).toBe(0)
  })
})
