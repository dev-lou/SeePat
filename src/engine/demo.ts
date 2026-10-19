import { pesos } from './money.ts'
import { addDays, startOfLocalDay } from './period.ts'
import seedData from './seed-data.json'
import type {
  Customer,
  Ledger,
  Sku,
  Transaction,
} from './types.ts'

/**
 * A deterministic 21-day sari-sari store history.
 *
 * This also addresses the cold-start problem the concept document never covered:
 * a brand-new owner has an empty Business Twin, so none of the differentiators
 * exist on day one. Seeding (and a guided first stock take) is what makes the
 * product useful before there is history.
 */

/**
 * The sample catalog lives in `seed-data.json`, not in code: it is rows for
 * the local store, the same shape as rows the owner adds themselves. The
 * engine never touches it — only this sample-history builder reads it.
 *
 * Re-exported (not re-declared) so existing importers keep working.
 */
export const DEMO_SKUS: Sku[] = seedData.skus as Sku[]
export const DEMO_CUSTOMERS: Customer[] = seedData.customers as Customer[]

/** Unit costs and prices in pesos, as a sari-sari store would actually price them. */
const GOODS: Record<string, { cost: number; price: number; daily: number }> = seedData.goods

const DAYS = 21

function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

export function seedLedger(now: Date): Ledger {
  const rand = lcg(20260920)
  const transactions: Transaction[] = []
  let n = 0
  const id = (prefix: string) => `${prefix}-${(n += 1).toString().padStart(4, '0')}`

  const base = startOfLocalDay(addDays(now, -(DAYS - 1)))
  const at = (dayOffset: number, hour: number, minute = 0): string =>
    new Date(
      base.getFullYear(),
      base.getMonth(),
      base.getDate() + dayOffset,
      hour,
      minute,
    ).toISOString()

  // Opening capital.
  transactions.push({
    id: id('cap'),
    at: at(0, 7),
    kind: 'capital_injection',
    amountCentavos: pesos(30000),
    note: 'Panimulang puhunan',
  })

  // Equipment: a chest freezer for frozen goods.
  transactions.push({
    id: id('fa'),
    at: at(1, 9),
    kind: 'fixed_asset_purchase',
    amountCentavos: pesos(2000),
    note: 'Second-hand freezer',
  })

  for (let day = 0; day < DAYS; day += 1) {
    // Restock every 3 days, partly on credit.
    //
    // Quantities deliberately exceed the expected 3 days of sales. Selling more
    // than is recorded buying drives stock negative, which is legitimate but
    // makes for a misleading demo — and it is the signature of a store that has
    // stopped recording its purchases.
    if (day % 3 === 0) {
      const lines = Object.entries(GOODS).map(([skuId, g]) => {
        const restockQty = Math.max(1, Math.round(g.daily * 3 * (1.2 + rand() * 0.25)))
        return { skuId, qty: restockQty, unitCostCentavos: pesos(g.cost) }
      })
      const total = lines.reduce((s, l) => s + l.qty * l.unitCostCentavos, 0)
      const onCredit = day > 0 && rand() > 0.5
      transactions.push({
        id: id('pur'),
        at: at(day, 7, 30),
        kind: 'purchase',
        lines,
        paidCentavos: onCredit ? Math.round(total * (rand() > 0.5 ? 0 : 0.4)) : total,
        note: onCredit ? 'Utang sa supplier' : 'Cash na bili',
      })
    }

    // Daily sales, spread through the day.
    const volume = 0.75 + rand() * 0.5
    const hour = 8
    for (const [skuId, g] of Object.entries(GOODS)) {
      const qty = Math.round(g.daily * volume * (0.6 + rand() * 0.8))
      if (qty <= 0) continue

      const line = { skuId, qty, unitPriceCentavos: pesos(g.price) }
      const isUtang = rand() > 0.82
      const customer = DEMO_CUSTOMERS[Math.floor(rand() * DEMO_CUSTOMERS.length)]
      const saleAt = at(day, Math.min(21, hour + Math.floor(rand() * 11)), Math.floor(rand() * 60))

      if (isUtang) {
        transactions.push({
          id: id('sal'),
          at: saleAt,
          kind: 'credit_sale',
          lines: [line],
          customerId: customer.id,
        })
      } else {
        transactions.push({ id: id('sal'), at: saleAt, kind: 'cash_sale', lines: [line] })
      }
    }

    // Some utang gets collected.
    //
    // The amount is capped at what that customer actually owes at this point in
    // the history. It used to collect a flat ₱60-300 from a random customer,
    // which regularly overpaid somebody and left the seeded ledger carrying a
    // warning the app itself raised — a demo whose first screen showed a mistake
    // it had invented. The two `rand()` calls happen either way, so the rest of
    // the generated history is unchanged.
    if (day % 4 === 2) {
      const customer = DEMO_CUSTOMERS[Math.floor(rand() * DEMO_CUSTOMERS.length)]
      const wanted = pesos(Math.round(60 + rand() * 240))
      const owed = transactions.reduce((sum, t) => {
        if (t.kind === 'credit_sale' && t.customerId === customer.id) {
          return sum + t.lines.reduce((s, l) => s + l.qty * l.unitPriceCentavos, 0)
        }
        if (t.kind === 'payment_received' && t.customerId === customer.id) {
          return sum - t.amountCentavos
        }
        return sum
      }, 0)
      if (owed > 0) {
        transactions.push({
          id: id('pay'),
          at: at(day, 18),
          kind: 'payment_received',
          customerId: customer.id,
          amountCentavos: Math.min(wanted, owed),
        })
      }
    }

    // Operating expenses.
    if (day % 7 === 5) {
      transactions.push({
        id: id('exp'),
        at: at(day, 19),
        kind: 'expense',
        amountCentavos: pesos(350),
        paid: 'cash',
        note: 'Kuryente at tubig',
      })
    }
    if (day % 7 === 3) {
      transactions.push({
        id: id('exp'),
        at: at(day, 19, 30),
        kind: 'expense',
        amountCentavos: pesos(200),
        paid: day % 14 === 3 ? 'credit' : 'cash',
        note: 'Iba pang gastos',
      })
    }
  }

  // Spoilage: two packs went bad.
  transactions.push({
    id: id('adj'),
    at: at(DAYS - 4, 20),
    kind: 'stock_adjustment',
    skuId: 'tinapay',
    qtyDelta: -2,
    note: 'Napanis',
  })

  // Household withdrawal.
  transactions.push({
    id: id('wdr'),
    at: at(DAYS - 3, 12),
    kind: 'owner_withdrawal',
    amountCentavos: pesos(1500),
    note: 'Panggastos sa bahay',
  })

  // Pay down some supplier credit.
  transactions.push({
    id: id('ppay'),
    at: at(DAYS - 2, 11),
    kind: 'payable_payment',
    amountCentavos: pesos(1200),
    note: 'Bayad sa supplier',
  })

  return {
    skus: DEMO_SKUS,
    customers: DEMO_CUSTOMERS,
    transactions,
    voids: [],
  }
}


