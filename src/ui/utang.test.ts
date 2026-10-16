import { describe, expect, it } from 'vitest'
import { utangRows } from './Utang.tsx'
import type { Customer, Ledger, Transaction } from '../engine/index.ts'

/**
 * The utang book's arithmetic.
 *
 * `twin.receivables` says how much each person owes; this is what turns that
 * into a collection list — whose name, how much, and **how long**. The aging is
 * the part worth pinning, because it is the only number here that changes on its
 * own, and it is a FIFO walk over the ledger rather than a stored field.
 */

const NOW = Date.now()
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString()

const CUSTOMERS: Customer[] = [
  { id: 'nena', name: 'Aling Nena', aliases: ['nena'] },
  { id: 'tonyo', name: 'Mang Tonyo', aliases: ['tonyo'] },
]

function credit(id: string, customerId: string, at: string, centavos: number): Transaction {
  return {
    id,
    at,
    kind: 'credit_sale',
    customerId,
    lines: [{ skuId: 'coke', qty: centavos / 2500, unitPriceCentavos: 2500 }],
  }
}

function payment(id: string, customerId: string, at: string, centavos: number): Transaction {
  return { id, at, kind: 'payment_received', customerId, amountCentavos: centavos }
}

function ledgerOf(transactions: Transaction[], voids: Ledger['voids'] = []): Ledger {
  return { skus: [], customers: CUSTOMERS, transactions, voids }
}

describe('what the utang list shows', () => {
  it('names the person and the amount the engine says they owe', () => {
    const rows = utangRows(ledgerOf([credit('c1', 'nena', daysAgo(2), 10000)]), { nena: 10000 })
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Aling Nena')
    expect(rows[0].amountCentavos).toBe(10000)
  })

  it('counts how long the oldest unpaid debt has been open', () => {
    const rows = utangRows(ledgerOf([credit('c1', 'nena', daysAgo(3), 10000)]), { nena: 10000 })
    expect(rows[0].oldestUnpaidAt).toBe(daysAgo(3))
    expect(rows[0].daysOldest).toBe(3)
  })

  it('settles the OLDEST debt first, the way a notebook gets crossed out', () => {
    // ₱100 taken 10 days ago, ₱200 taken 2 days ago, ₱100 paid back yesterday.
    // The payment must clear the 10-day-old one, leaving the 2-day-old debt as
    // the oldest thing still open. Getting this backwards would report a debt
    // that has actually been settled as the urgent one.
    const rows = utangRows(
      ledgerOf([
        credit('c1', 'nena', daysAgo(10), 10000),
        credit('c2', 'nena', daysAgo(2), 20000),
        payment('p1', 'nena', daysAgo(1), 10000),
      ]),
      { nena: 20000 },
    )
    expect(rows[0].oldestUnpaidAt).toBe(daysAgo(2))
    expect(rows[0].daysOldest).toBe(2)
  })

  it('leaves no open debt once everything is paid', () => {
    const rows = utangRows(
      ledgerOf([
        credit('c1', 'nena', daysAgo(10), 10000),
        payment('p1', 'nena', daysAgo(1), 10000),
      ]),
      { nena: 10000 },
    )
    expect(rows[0].oldestUnpaidAt).toBeNull()
    expect(rows[0].daysOldest).toBeNull()
  })

  it('remembers the last time they paid', () => {
    const rows = utangRows(
      ledgerOf([
        credit('c1', 'tonyo', daysAgo(9), 30000),
        payment('p1', 'tonyo', daysAgo(5), 10000),
        payment('p2', 'tonyo', daysAgo(1), 5000),
      ]),
      { tonyo: 15000 },
    )
    expect(rows[0].lastPaidAt).toBe(daysAgo(1))
    expect(rows[0].daysOldest).toBe(9)
  })

  it('says when they have never paid anything', () => {
    const rows = utangRows(ledgerOf([credit('c1', 'tonyo', daysAgo(4), 30000)]), { tonyo: 30000 })
    expect(rows[0].lastPaidAt).toBeNull()
  })
})

describe('the list is a collection order', () => {
  it('puts the biggest debt first', () => {
    const rows = utangRows(
      ledgerOf([credit('c1', 'nena', daysAgo(1), 10000), credit('c2', 'tonyo', daysAgo(1), 50000)]),
      { nena: 10000, tonyo: 50000 },
    )
    expect(rows.map((r) => r.name)).toEqual(['Mang Tonyo', 'Aling Nena'])
  })

  it('leaves out anyone who owes nothing', () => {
    const rows = utangRows(ledgerOf([]), { nena: 0, tonyo: 5000 })
    expect(rows.map((r) => r.id)).toEqual(['tonyo'])
  })

  it('does not present an overpayment as a debt', () => {
    // A negative balance means they paid more than they took. Rendering it as a
    // debt with a "Payment" button would be a lie, so it is not a row at all.
    const rows = utangRows(ledgerOf([]), { nena: -2000 })
    expect(rows).toHaveLength(0)
  })
})

describe('names and voids', () => {
  it('gives the walk-in sentinel a readable name instead of its id', () => {
    const rows = utangRows(ledgerOf([credit('c1', 'walk_in', daysAgo(1), 5000)]), { walk_in: 5000 }, 'Walk-in')
    expect(rows[0].name).toBe('Walk-in')
  })

  it('takes the walk-in label from the caller, so it can be translated', () => {
    const rows = utangRows(ledgerOf([]), { walk_in: 5000 }, 'Dumaan lang')
    expect(rows[0].name).toBe('Dumaan lang')
  })

  it('ignores a voided credit — a voided record is not money', () => {
    const rows = utangRows(
      ledgerOf([credit('c1', 'nena', daysAgo(6), 10000)], [{ txnId: 'c1', at: daysAgo(5), by: 'owner' }]),
      { nena: 10000 },
    )
    expect(rows[0].oldestUnpaidAt).toBeNull()
  })
})
