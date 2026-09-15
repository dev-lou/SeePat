import { pesos } from './money.ts'
import { addDays, startOfLocalDay } from './period.ts'
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

export const DEMO_SKUS: Sku[] = [
  { id: 'coke', name: 'Coke Mismo', unit: 'pc', baseUnit: 'pc', aliases: ['coke', 'coca cola', 'kola'] },
  { id: 'lucky', name: 'Lucky Me Pancit Canton', unit: 'pc', baseUnit: 'pc', aliases: ['lucky me', 'pancit canton', 'lucky'] },
  { id: 'sardinas', name: 'Sardinas 555', unit: 'pc', baseUnit: 'pc', aliases: ['sardinas', '555'] },
  { id: 'bigas', name: 'Bigas', unit: 'kg', baseUnit: 'g', aliases: ['bigas', 'rice'] },
  { id: 'itlog', name: 'Itlog', unit: 'pc', baseUnit: 'pc', aliases: ['itlog', 'egg'] },
  { id: 'mantika', name: 'Mantika', unit: 'pc', baseUnit: 'pc', aliases: ['mantika', 'oil'] },
  { id: 'tinapay', name: 'Tinapay', unit: 'pc', baseUnit: 'pc', aliases: ['tinapay', 'bread'] },
  { id: 'shampoo', name: 'Shampoo Sachet', unit: 'pc', baseUnit: 'pc', aliases: ['shampoo', 'sachet'] },
  { id: 'skyflakes', name: 'Skyflakes', unit: 'pc', baseUnit: 'pc', aliases: ['skyflakes', 'sky flakes'] },
  { id: 'kopiko', name: 'Kopiko', unit: 'pc', baseUnit: 'pc', aliases: ['kopiko', 'kape', 'coffee'] },
]

export const DEMO_CUSTOMERS: Customer[] = [
  { id: 'aling_nena', name: 'Aling Nena', aliases: ['nena', 'aling nena'] },
  { id: 'mang_tonyo', name: 'Mang Tonyo', aliases: ['tonyo', 'mang tonyo'] },
  { id: 'kuya_ben', name: 'Kuya Ben', aliases: ['ben', 'kuya ben'] },
  { id: 'ate_rosa', name: 'Ate Rosa', aliases: ['rosa', 'ate rosa'] },
]

/** Unit costs and prices in pesos, as a sari-sari store would actually price them. */
const GOODS: Record<string, { cost: number; price: number; daily: number }> = {
  coke: { cost: 18, price: 25, daily: 9 },
  lucky: { cost: 11, price: 17, daily: 6 },
  sardinas: { cost: 21, price: 30, daily: 3 },
  bigas: { cost: 0.052, price: 0.072, daily: 8000 },
  itlog: { cost: 7.5, price: 10, daily: 12 },
  mantika: { cost: 32, price: 45, daily: 2 },
  tinapay: { cost: 34, price: 48, daily: 4 },
  shampoo: { cost: 5.5, price: 9, daily: 5 },
  skyflakes: { cost: 7, price: 11, daily: 3 },
  kopiko: { cost: 6, price: 10, daily: 4 },
}

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
    if (day % 4 === 2) {
      const customer = DEMO_CUSTOMERS[Math.floor(rand() * DEMO_CUSTOMERS.length)]
      transactions.push({
        id: id('pay'),
        at: at(day, 18),
        kind: 'payment_received',
        customerId: customer.id,
        amountCentavos: pesos(Math.round(60 + rand() * 240)),
      })
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

export function emptyLedger(): Ledger {
  return { skus: DEMO_SKUS, customers: DEMO_CUSTOMERS, transactions: [], voids: [] }
}
