import { describe, expect, it } from 'vitest'
import { buildRestockTxn } from './Items.tsx'
import { DEMO_SKUS } from '../engine/demo.ts'

/**
 * The restock sheet's promise: what it writes is a real purchase, identical to
 * one written on the recording screen — base units stored, cost per base unit,
 * credit purchases owing the full total. These pin the conversion and the two
 * refusals (no item, no positive numbers), because a restock that writes a
 * wrong quantity corrupts the exact stock figure the owner came here to fix.
 */

const coke = DEMO_SKUS.find((s) => s.id === 'coke')!
const bigas = DEMO_SKUS.find((s) => s.id === 'bigas')!

describe('a restock is a purchase', () => {
  it('stores pieces and the full cost when paid', () => {
    const txn = buildRestockTxn(coke, 24, 21, false, 'pur-1', '2026-10-19T10:00:00.000Z')
    expect(txn).toMatchObject({
      kind: 'purchase',
      lines: [{ skuId: 'coke', qty: 24, unitCostCentavos: 2100 }],
      paidCentavos: 24 * 2100,
    })
  })

  it('owes the whole total when bought on supplier credit', () => {
    const txn = buildRestockTxn(coke, 24, 21, true, 'pur-2', '2026-10-19T10:00:00.000Z')
    expect(txn?.paidCentavos).toBe(0)
  })

  it('converts kilos to the grams the ledger stores', () => {
    // 2 kilos at ₱70 each: stored as 2000 g at 7 centavos a gram.
    const txn = buildRestockTxn(bigas, 2, 70, false, 'pur-3', '2026-10-19T10:00:00.000Z')
    expect(txn).toMatchObject({
      lines: [{ skuId: 'bigas', qty: 2000, unitCostCentavos: 7 }],
      paidCentavos: 2000 * 7,
    })
  })

  it('refuses to write without an item', () => {
    expect(buildRestockTxn(undefined, 24, 21, false, 'pur-4', '2026-10-19T10:00:00.000Z')).toBeNull()
  })

  it('refuses a zero quantity, a zero cost, and nonsense', () => {
    const at = '2026-10-19T10:00:00.000Z'
    expect(buildRestockTxn(coke, 0, 21, false, 'a', at)).toBeNull()
    expect(buildRestockTxn(coke, 24, 0, false, 'b', at)).toBeNull()
    expect(buildRestockTxn(coke, -3, 21, false, 'c', at)).toBeNull()
    expect(buildRestockTxn(coke, Number.NaN, 21, false, 'd', at)).toBeNull()
  })
})
