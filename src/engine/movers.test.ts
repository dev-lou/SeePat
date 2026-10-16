import { describe, expect, it } from 'vitest'
import { topSellers } from './movers.ts'
import { answerIntent } from './narrator.ts'
import type { AskContext } from './narrator.ts'
import { periodMetrics } from './metrics.ts'
import { computeTwin } from './twin.ts'
import { seedLedger } from './demo.ts'
import { pesos } from './money.ts'
import type { Ledger } from './types.ts'

/**
 * The dashboard's best-seller list and the spoken answer to "ano ang
 * pinakamalakas kong paninda?" are the same claim from two places. If they can
 * drift, an owner gets told one thing out loud and shown another on the screen
 * directly above it — so the last test here holds the list and the sentence
 * against each other rather than trusting that they were written to match.
 */

const NOW = new Date(2026, 8, 20, 18, 0, 0)
const ledger = seedLedger(NOW)
const context: AskContext = { ledger, twin: computeTwin(ledger), now: NOW }

describe('topSellers', () => {
  it('ranks by what the item kept, not by how busy its shelf looked', () => {
    const sales = {
      // Busy and thin: ₱200 of sales that leaves ₱20.
      busy: { qtySold: 10, revenueCentavos: pesos(200), marginCentavos: pesos(20) },
      // Quieter and worth more: ₱90 of sales that leaves ₱54.
      rich: { qtySold: 3, revenueCentavos: pesos(90), marginCentavos: pesos(54) },
    }
    const ledgerWithBoth: Ledger = {
      ...ledger,
      skus: [
        ...ledger.skus,
        { id: 'busy', name: 'Busy', unit: 'pc', baseUnit: 'pc', aliases: [] },
        { id: 'rich', name: 'Rich', unit: 'pc', baseUnit: 'pc', aliases: [] },
      ],
    }
    expect(topSellers(ledgerWithBoth, sales).map((row) => row.skuId)).toEqual(['rich', 'busy'])
  })

  it('leaves out anything that did not move', () => {
    const rows = topSellers(ledger, {
      coke: { qtySold: 4, revenueCentavos: pesos(120), marginCentavos: pesos(40) },
      rice: { qtySold: 0, revenueCentavos: 0, marginCentavos: 0 },
    })
    expect(rows.map((row) => row.skuId)).toEqual(['coke'])
  })

  it('honours the limit, so a 200-item shop never renders a 200-row list', () => {
    const sales = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [
        `sk-${i}`,
        { qtySold: 1, revenueCentavos: pesos(10), marginCentavos: pesos(10 - i) },
      ]),
    )
    expect(topSellers(ledger, sales, 3)).toHaveLength(3)
    expect(topSellers(ledger, sales, 3).map((row) => row.skuId)).toEqual(['sk-0', 'sk-1', 'sk-2'])
  })

  it('still names an item that was deleted after it sold', () => {
    // Sales outlive the item list: removing a product must not blank out the
    // history of what it earned.
    const rows = topSellers(ledger, {
      gone: { qtySold: 2, revenueCentavos: pesos(40), marginCentavos: pesos(12) },
    })
    expect(rows[0].name).toBe('gone')
    expect(rows[0].unit).toBe('pc')
  })

  it('counts rice in kilos, not in the grams the engine stores', () => {
    // Quantities are held in the base unit, so rice accumulates in grams. An
    // un-converted list read "52406 sold" beside one kilo of rice, which is the
    // kind of number that makes an owner distrust the whole screen.
    const rice = ledger.skus.find((sku) => sku.baseUnit === 'g')
    expect(rice, 'the demo ledger needs a weighed item for this test').toBeTruthy()
    const rows = topSellers(ledger, {
      [rice!.id]: { qtySold: 52406, revenueCentavos: pesos(3800), marginCentavos: pesos(400) },
    })
    expect(rows[0].qtySold).toBe(52406)
    expect(rows[0].qtyDisplay).toBe(52.4)
    expect(rows[0].unit).toBe('kg')
  })
})

describe('the screen and the spoken answer agree', () => {
  it('names the same item as the narrator does', () => {
    const week = periodMetrics(ledger, 7, NOW)
    const best = topSellers(ledger, week.salesBySku)[0]
    const answer = answerIntent('top_product', context, 'en')

    const named = ledger.skus.find((sku) => sku.id === best.skuId)?.name
    expect(named).toBeTruthy()
    expect(answer.headline).toContain(named as string)
    // And the money in the sentence is the margin this list ranked on, to the
    // centavo — not a second, differently-rounded computation of it.
    expect(answer.headline).toContain(
      new Intl.NumberFormat('en-PH', {
        style: 'currency',
        currency: 'PHP',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(best.marginCentavos / 100),
    )
  })
})
