import { describe, expect, it } from 'vitest'
import { describe as rowTitle } from './Record.tsx'
import { DEMO_CUSTOMERS, DEMO_SKUS } from '../engine/demo.ts'
import type { Ledger, SaleLine, Transaction } from '../engine/index.ts'

/**
 * What a ledger row says.
 *
 * This is the surface an owner reads most and the one that was quietly empty:
 * every sale read "Sale — 4 pieces", so a week of Cokes and a week of rice
 * looked identical, and searching the feed for "coke" found nothing. These
 * tests pin the two things that make a row useful — the goods, and the person —
 * and the two things that must never appear in it: a raw customer id, and a
 * quantity in a base unit the owner never typed.
 */

const ledger: Ledger = {
  skus: DEMO_SKUS,
  customers: DEMO_CUSTOMERS,
  transactions: [],
  voids: [],
}

const coke = DEMO_SKUS.find((s) => s.id === 'coke')!
const lucky = DEMO_SKUS.find((s) => s.id === 'lucky')!
const bigas = DEMO_SKUS.find((s) => s.id === 'bigas')!

function sale(lines: SaleLine[]): Transaction {
  return { id: 'sal-1', at: '2026-09-20T10:00:00.000Z', kind: 'cash_sale', lines }
}

describe('a ledger row names the goods', () => {
  it('names a single sale line with its quantity first', () => {
    const txn = sale([{ skuId: coke.id, qty: 5, unitPriceCentavos: 2500 }])
    expect(rowTitle(txn, ledger, 'en')).toBe('5 × Coke Mismo')
    expect(rowTitle(txn, ledger, 'fil')).toBe('5 × Coke Mismo')
  })

  it('leads with the first line and counts the rest', () => {
    const txn = sale([
      { skuId: coke.id, qty: 5, unitPriceCentavos: 2500 },
      { skuId: lucky.id, qty: 2, unitPriceCentavos: 1700 },
      { skuId: bigas.id, qty: 1000, unitPriceCentavos: 5200 },
    ])
    expect(rowTitle(txn, ledger, 'en')).toBe('Coke Mismo +2 more')
    expect(rowTitle(txn, ledger, 'fil')).toBe('Coke Mismo +2 pa')
  })

  it('reads grams back as the kilos the owner typed', () => {
    // 1.5 kg of rice is stored as 1500 g. A row saying "1500" would be a bug
    // the arithmetic never catches.
    const txn = sale([{ skuId: bigas.id, qty: 1500, unitPriceCentavos: 5200 }])
    expect(rowTitle(txn, ledger, 'en')).toBe('Bigas — 1.5 kg')
  })

  it('prints a weight at the precision a hand can type', () => {
    // Storage is exact and stays exact; the READBACK rounds. No sari-sari
    // weighs rice to the gram, and "7.532 kg" makes a simple figure read like a
    // calculation leak. Two decimals is the most anyone types.
    const txn = sale([{ skuId: bigas.id, qty: 7532, unitPriceCentavos: 5200 }])
    expect(rowTitle(txn, ledger, 'en')).toBe('Bigas — 7.53 kg')
  })

  it('falls back to the honest count when the item is not in the book', () => {
    // A record whose SKU was deleted still has to be readable, and an id is not
    // a name. The count phrasing is true even when the goods cannot be named.
    const txn = sale([{ skuId: 'gone', qty: 4, unitPriceCentavos: 1000 }])
    expect(rowTitle(txn, ledger, 'en')).toBe('Sale — 4 pieces')
  })
})

describe('utang rows name the person, never an id', () => {
  it('names a known customer', () => {
    const txn: Transaction = {
      id: 'utang-1',
      at: '2026-09-20T10:00:00.000Z',
      kind: 'credit_sale',
      customerId: 'aling_nena',
      lines: [{ skuId: bigas.id, qty: 2000, unitPriceCentavos: 5200 }],
    }
    expect(rowTitle(txn, ledger, 'en')).toBe('Utang — Aling Nena')
  })

  it('shows the walk-in sentinel as Walk-in, not as `walk_in`', () => {
    // The sentinel is a storage detail. It was reaching the screen verbatim,
    // putting the string "walk_in" in the middle of a Tagalog ledger.
    const txn: Transaction = {
      id: 'utang-2',
      at: '2026-09-20T10:00:00.000Z',
      kind: 'credit_sale',
      customerId: 'walk_in',
      lines: [{ skuId: coke.id, qty: 2, unitPriceCentavos: 2500 }],
    }
    expect(rowTitle(txn, ledger, 'en')).toBe('Utang — Walk-in')
    expect(rowTitle(txn, ledger, 'fil')).toBe('Utang — Walk-in')
    expect(rowTitle(txn, ledger, 'en')).not.toContain('walk_in')
  })
})

describe('the other shapes', () => {
  it('names who paid, because a column of "Payment" rows says nothing', () => {
    const txn: Transaction = {
      id: 'pay-1',
      at: '2026-09-20T10:00:00.000Z',
      kind: 'payment_received',
      customerId: 'mang_tonyo',
      amountCentavos: 10000,
    }
    expect(rowTitle(txn, ledger, 'en')).toBe('Paid by Mang Tonyo')
    expect(rowTitle(txn, ledger, 'fil')).toBe('Bayad ni Mang Tonyo')
  })

  it('names the goods on a purchase too', () => {
    const txn: Transaction = {
      id: 'pur-1',
      at: '2026-09-20T10:00:00.000Z',
      kind: 'purchase',
      lines: [{ skuId: coke.id, qty: 24, unitCostCentavos: 1800 }],
      paidCentavos: 0,
    }
    expect(rowTitle(txn, ledger, 'en')).toBe('24 × Coke Mismo')
  })

  it('keeps amount-only rows as plain labels', () => {
    const txn: Transaction = {
      id: 'exp-1',
      at: '2026-09-20T10:00:00.000Z',
      kind: 'expense',
      amountCentavos: 5000,
      paid: 'cash',
    }
    expect(rowTitle(txn, ledger, 'en')).toBe('Expense')
    expect(rowTitle(txn, ledger, 'fil')).toBe('Gastos')
  })
})

describe('the row is a search key as well as a title', () => {
  it('lets the owner find a row by the item they sold', () => {
    // `filterTxns` matches the query against this same string, so naming the
    // goods is what makes "coke" work in the search box.
    const txn = sale([{ skuId: coke.id, qty: 5, unitPriceCentavos: 2500 }])
    expect(rowTitle(txn, ledger, 'en').toLowerCase()).toContain('coke')
  })
})

describe('amounts and units stay exact', () => {
  it('does not round a weighed quantity into a lie', () => {
    // A quarter kilo is a real sale. Rounding it to "0.3 kg" would misreport
    // what left the shelf, which is the one thing this row exists to say.
    const txn = sale([{ skuId: bigas.id, qty: 250, unitPriceCentavos: 5200 }])
    expect(rowTitle(txn, ledger, 'en')).toBe('Bigas — 0.25 kg')
  })

  it('keeps piece counts whole', () => {
    const txn = sale([{ skuId: coke.id, qty: 7, unitPriceCentavos: 2500 }])
    expect(rowTitle(txn, ledger, 'en')).toBe('7 × Coke Mismo')
  })
})
