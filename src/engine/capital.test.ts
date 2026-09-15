import { describe, expect, it } from 'vitest'
import { pesos } from './money.ts'
import { capitalComposition, capitalProvenance } from './capital.ts'
import { checkInvariant, computeTwin, deriveTwin } from './twin.ts'
import { seedLedger } from './demo.ts'
import type { BusinessTwin, Ledger } from './types.ts'

/**
 * Both examples from the concept document are used verbatim as fixtures.
 *
 * Section 9 — "Nasaan ang Puhunan Ko?":  Cash ₱8,500 + Paninda ₱13,700 +
 * Utang ₱4,300 + Kagamitan ₱2,000 + Withdrawals ₱1,500 = ₱30,000
 *
 * Section 4 — the Business Twin:        Cash ₱7,800 + Paninda ₱8,600 +
 * Utang ₱2,100 + Expenses ₱1,500 = ₱20,000
 *
 * Both totals are internally consistent, which is precisely why the ambiguity
 * survived review. Neither is a *composition* of capital: withdrawals and
 * expenses are money that has left the business, so they cannot be a place
 * where capital currently sits.
 */

function fixtureTwin(fields: Partial<BusinessTwin>): BusinessTwin {
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
    ...fields,
  }
}

/** Section 9: ₱30,000 injected, ₱1,500 withdrawn, everything else still held. */
const section9 = fixtureTwin({
  cashCentavos: pesos(8500),
  inventory: {
    stock: { qty: 100, valueCentavos: pesos(13700), lastUnitCostCentavos: pesos(137) },
  },
  receivables: { nena: pesos(4300) },
  fixedAssetsCentavos: pesos(2000),
  capitalInjectedCentavos: pesos(30000),
  withdrawalsCentavos: pesos(1500),
})

/** Section 4: ₱20,000 injected, ₱1,500 already spent on expenses. */
const section4 = fixtureTwin({
  cashCentavos: pesos(7800),
  inventory: {
    stock: { qty: 100, valueCentavos: pesos(8600), lastUnitCostCentavos: pesos(86) },
  },
  receivables: { nena: pesos(2100) },
  capitalInjectedCentavos: pesos(20000),
  expensesCentavos: pesos(1500),
})

describe('both document fixtures satisfy the accounting identity', () => {
  it('section 9 balances', () => {
    expect(checkInvariant(section9).ok).toBe(true)
  })

  it('section 4 balances', () => {
    expect(checkInvariant(section4).ok).toBe(true)
  })
})

describe('COMPOSITION — where capital sits right now', () => {
  it('sums to net assets for the section 9 fixture', () => {
    const comp = capitalComposition(section9, 'fil')
    expect(comp.balanced).toBe(true)
    // ₱28,500 held — NOT the ₱30,000 the document states.
    expect(comp.netAssetsCentavos).toBe(pesos(28500))
  })

  it('differs from the documented total by exactly the withdrawals', () => {
    const comp = capitalComposition(section9, 'fil')
    expect(pesos(30000) - comp.netAssetsCentavos).toBe(section9.withdrawalsCentavos)
  })

  it('sums to net assets for the section 4 fixture', () => {
    const comp = capitalComposition(section4, 'fil')
    expect(comp.balanced).toBe(true)
    // ₱18,500 held — NOT the ₱20,000 the document states.
    expect(comp.netAssetsCentavos).toBe(pesos(18500))
  })

  it('differs from the documented total by exactly the expenses already spent', () => {
    const comp = capitalComposition(section4, 'fil')
    expect(pesos(20000) - comp.netAssetsCentavos).toBe(section4.expensesCentavos)
  })

  it('never lists a flow as a location of capital', () => {
    const keys = capitalComposition(section9, 'fil').components.map((c) => c.key)
    expect(keys).not.toContain('withdrawals')
    expect(keys).not.toContain('expenses')
    expect(keys).toContain('cash')
    expect(keys).toContain('inventory')
  })

  it('presents supplier payables as an offset, not an asset', () => {
    const withDebt = fixtureTwin({
      cashCentavos: pesos(1000),
      inventory: { stock: { qty: 10, valueCentavos: pesos(5000), lastUnitCostCentavos: pesos(500) } },
      payablesCentavos: pesos(2000),
      capitalInjectedCentavos: pesos(4000),
    })
    const comp = capitalComposition(withDebt, 'fil')
    const payables = comp.components.find((c) => c.key === 'payables')
    expect(payables?.kind).toBe('offset')
    expect(payables?.amountCentavos).toBe(pesos(-2000))
    expect(comp.netAssetsCentavos).toBe(pesos(4000))
    expect(comp.balanced).toBe(true)
  })

  it('exposes each component as a share of net assets', () => {
    const comp = capitalComposition(section9, 'fil')
    const inventory = comp.components.find((c) => c.key === 'inventory')
    // 13,700 / 28,500
    expect(inventory?.share).toBeCloseTo(13700 / 28500, 6)
  })
})

describe('PROVENANCE — where the money went', () => {
  it('reconciles sources and uses for section 9', () => {
    const prov = capitalProvenance(section9)
    expect(prov.reconciled).toBe(true)
    expect(prov.totalSourcesCentavos).toBe(prov.totalUsesCentavos)
    expect(prov.withdrawnCentavos).toBe(pesos(1500))
  })

  it('reconciles sources and uses for section 4', () => {
    const prov = capitalProvenance(section4)
    expect(prov.reconciled).toBe(true)
    // Capital in ₱20,000, less a ₱1,500 loss, leaves ₱18,500 of sources.
    expect(prov.totalSourcesCentavos).toBe(pesos(18500))
    expect(prov.spentOnExpensesCentavos).toBe(pesos(1500))
  })

  it('ties the two views together: uses less withdrawals equals composition', () => {
    for (const fixture of [section9, section4]) {
      const prov = capitalProvenance(fixture)
      const comp = capitalComposition(fixture, 'fil')
      expect(prov.totalUsesCentavos - fixture.withdrawalsCentavos).toBe(
        comp.netAssetsCentavos,
      )
    }
  })

  it('attributes the section 9 total to its actual sources', () => {
    const prov = capitalProvenance(section9)
    const capital = prov.sources.find((s) => s.key === 'capital_in')
    const profit = prov.sources.find((s) => s.key === 'retained_profit')
    expect(capital?.amountCentavos).toBe(pesos(30000))
    expect(profit?.amountCentavos).toBe(0)
  })
})

describe('capital views on a real ledger', () => {
  const ledger: Ledger = seedLedger(new Date(2026, 8, 20, 18, 0, 0))
  const twin = computeTwin(ledger)

  it('reports a balanced composition', () => {
    expect(capitalComposition(twin, 'fil').balanced).toBe(true)
  })

  it('reports a reconciled provenance', () => {
    expect(capitalProvenance(twin).reconciled).toBe(true)
  })

  it('composes to exactly the equity on the twin', () => {
    const d = deriveTwin(twin)
    expect(capitalComposition(twin, 'fil').netAssetsCentavos).toBe(d.equityCentavos)
  })
})
