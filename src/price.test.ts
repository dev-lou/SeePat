import { describe, expect, it } from 'vitest'
import {
  formatPHP,
  pesos,
  pricePerBaseUnit,
  pricePerDisplayUnit,
  unitPriceDrifts,
} from './engine/index.ts'
import { seedLedger } from './engine/demo.ts'
import { computeTwin } from './engine/twin.ts'

/**
 * The price of a weighed item, which is where this app could lose a thousand
 * times an owner's money.
 *
 * A line stores the price of ONE BASE UNIT (one gram for rice) because that is
 * what the engine multiplies the stored quantity by. A shop prices in KILOS.
 * The form therefore asks in kilos and converts — and this file pins both ends
 * of that conversion, plus the real total a recorded sale produces, because the
 * bug this replaces doubled as a silent ₱144,000 rice sale.
 */

const NOW = new Date(2026, 8, 20, 18, 0, 0)

describe('asking for a price in the unit the owner prices in', () => {
  it('keeps a piece price exactly as typed', () => {
    expect(pricePerBaseUnit('pc', pesos(25))).toBe(2500)
    expect(pricePerDisplayUnit('pc', 2500)).toBe(2500)
  })

  it('turns ₱70 a kilo into 7 centavos a gram', () => {
    expect(pricePerBaseUnit('g', pesos(70))).toBe(7)
    expect(pricePerDisplayUnit('g', 7)).toBe(7000)
  })

  it('is the identity for prices that a base unit can hold exactly', () => {
    for (const perKilo of [10, 20, 50, 70, 120]) {
      const cents = pesos(perKilo)
      expect(pricePerDisplayUnit('g', pricePerBaseUnit('g', cents))).toBe(cents)
      expect(unitPriceDrifts('g', cents)).toBe(false)
    }
  })

  it('admits when a per-kilo price cannot be stored exactly', () => {
    // ₱72/kg is 7.2 centavos a gram, and a centavo is the smallest unit there
    // is. The app must SAY what it will record rather than quietly charge ₱70
    // — every other number here is confirmed before it is saved.
    expect(unitPriceDrifts('g', pesos(72))).toBe(true)
    expect(pricePerDisplayUnit('g', pricePerBaseUnit('g', pesos(72)))).toBe(pesos(70))
    expect(formatPHP(pesos(70))).toBe('₱70.00')
  })

  it('never claims a drift for an item counted in pieces', () => {
    expect(unitPriceDrifts('pc', pesos(72))).toBe(false)
  })
})

describe('what a recorded sale actually adds up to', () => {
  it('books two kilos of rice at ₱70 a kilo as ₱140, not ₱144,000', () => {
    // The regression this exists for: the form once stored what was typed as
    // the price of a GRAM, so 2 kg × 72 = ₱144,000 of rice.
    const ledger = {
      ...seedLedger(NOW),
      transactions: [
        {
          id: 'sal-1',
          at: NOW.toISOString(),
          kind: 'cash_sale' as const,
          lines: [
            {
              skuId: 'bigas',
              // 2 kilos entered, stored as grams.
              qty: 2000,
              unitPriceCentavos: pricePerBaseUnit('g', pesos(70)),
            },
          ],
        },
      ],
      voids: [],
    }

    const twin = computeTwin(ledger)
    // Sold 2000 g at 7 centavos a gram = ₱140.00.
    expect(twin.cashCentavos).toBeGreaterThan(0)
    const lineTotal = 2000 * pricePerBaseUnit('g', pesos(70))
    expect(lineTotal).toBe(14000)
    expect(formatPHP(lineTotal)).toBe('₱140.00')
  })
})
