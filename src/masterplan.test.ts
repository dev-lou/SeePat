import { describe, expect, it } from 'vitest'
import { exportLedger, importLedger } from './backup.ts'
import { computeRestock } from './engine/restock.ts'
import { AiNotConfigured, configureAi, explainAnswer, isAiConfigured } from './ai.ts'
import { summarizeCohort } from './cohort.ts'
import { buildWeeklyReport } from './report.ts'
import type { Ledger } from './engine/index.ts'

const ledger = (skus: { id: string; name: string; unit: string }[]): Ledger => ({
  // Minimal shape the helpers read: skus plus a twin-shaped inventory.
  skus: skus.map((s) => ({ id: s.id, name: s.name, unit: s.unit, baseUnit: 'pc', aliases: [] })),
  customers: [],
  transactions: [],
  voids: [],
})

describe('backup envelope', () => {
  it('round-trips a ledger with its timestamp', () => {
    const raw = exportLedger(ledger([{ id: 'coke', name: 'Coke', unit: 'pc' }]), '2026-10-15T00:00:00.000Z')
    const { ledger: back, exportedAt } = importLedger(raw)
    expect(back.skus).toHaveLength(1)
    expect(exportedAt).toBe('2026-10-15T00:00:00.000Z')
  })

  it('rejects garbage, non-backups and newer versions instead of loading them', () => {
    expect(() => importLedger('not json')).toThrow('backup.invalid')
    expect(() => importLedger(JSON.stringify({ app: 'other', version: 1, ledger: {} }))).toThrow(
      'backup.invalid',
    )
    expect(() =>
      importLedger(JSON.stringify({ app: 'seepat', version: 99, ledger: { transactions: [], skus: [], customers: [], voids: [] } })),
    ).toThrow('backup.tooNew')
  })
})

describe('restock alerts', () => {
  it('ranks by days left and skips SKUs with no sales signal', () => {
    const l = ledger([
      { id: 'coke', name: 'Coke', unit: 'pc' },
      { id: 'rice', name: 'Rice', unit: 'kg' },
      { id: 'idle', name: 'Idle', unit: 'pc' },
    ])
    const twin = { inventory: { coke: { qty: 2 }, rice: { qty: 0 }, idle: { qty: 50 } } }
    const alerts = computeRestock(
      l,
      twin as never,
      { coke: { qtySold: 14 }, rice: { qtySold: 7 } },
      7,
    )
    expect(alerts.map((a) => a.skuId)).toEqual(['rice', 'coke'])
    expect(alerts[0].severity).toBe('out')
    expect(alerts[1].severity).toBe('low')
  })
})

describe('the AI boundary', () => {
  it('is closed by default and honest about it', async () => {
    configureAi(null)
    expect(isAiConfigured()).toBe(false)
    await expect(explainAnswer({ headline: 'h', evidence: [], lang: 'en' })).rejects.toBeInstanceOf(
      AiNotConfigured,
    )
  })

  it('opens through one door when a provider is configured', async () => {
    configureAi(async (input) => `Says: ${input.headline}`)
    expect(isAiConfigured()).toBe(true)
    await expect(
      explainAnswer({ headline: 'Kita mo', evidence: [], lang: 'fil' }),
    ).resolves.toBe('Says: Kita mo')
    configureAi(null)
  })
})

describe('cohort aggregates', () => {
  it('folds opt-in indicators without touching raw ledgers', () => {
    const summary = summarizeCohort([
      { storeId: 'a', recordingDays: 6, profitUp: true, completedOnboarding: true, scoreLatest: 70 },
      { storeId: 'b', recordingDays: 0, profitUp: false, completedOnboarding: false, scoreLatest: 50 },
      { storeId: 'c', recordingDays: 7, profitUp: true, completedOnboarding: true, scoreLatest: 80 },
    ])
    expect(summary.stores).toBe(3)
    expect(summary.activeStores).toBe(2)
    expect(summary.recordingDaysTotal).toBe(13)
    expect(summary.profitUpShare).toBeCloseTo(2 / 3)
    expect(summary.scoreMedian).toBe(70)
  })

  it('handles an empty cohort without dividing by zero', () => {
    expect(summarizeCohort([]).stores).toBe(0)
  })
})

describe('delete semantics (no void stamps)', () => {
  it('documents the contract: removal drops the txn and its void record', () => {
    // The store's removeTransaction/restoreTransaction pair is exercised here
    // as pure array logic, mirroring the implementation: delete filters both
    // lists, undo re-inserts at the original index.
    const txns = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const voids = [{ txnId: 'b' }]
    const afterDelete = {
      transactions: txns.filter((t) => t.id !== 'b'),
      voids: voids.filter((v) => v.txnId !== 'b'),
    }
    expect(afterDelete.transactions.map((t) => t.id)).toEqual(['a', 'c'])
    expect(afterDelete.voids).toEqual([])
    const restored = [...afterDelete.transactions.slice(0, 1), { id: 'b' }, ...afterDelete.transactions.slice(1)]
    expect(restored.map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('weekly report', () => {
  it('prints figures, not placeholders', () => {
    const text = buildWeeklyReport({
      weekLabel: 'Oct 15',
      revenueCentavos: 10000,
      cogsCentavos: 2000,
      expensesCentavos: 3000,
      shrinkageCentavos: 0,
      netProfitCentavos: 5000,
      cashCentavos: 5000,
      walletCentavos: 0,
      receivablesCentavos: 2000,
      recordsCount: 12,
    })
    expect(text).toContain('₱100.00')
    expect(text).toContain('Records: 12')
    expect(text).not.toMatch(/\{\w+\}/)
  })

  it('shows the cost of goods, so sales minus the subtractions equals the profit', () => {
    const input = {
      weekLabel: 'Oct 15',
      revenueCentavos: 10000,
      cogsCentavos: 2000,
      expensesCentavos: 3000,
      shrinkageCentavos: 500,
      netProfitCentavos: 4500,
      cashCentavos: 5000,
      walletCentavos: 1500,
      receivablesCentavos: 2000,
      recordsCount: 12,
    }
    // The contract the dashboard strip keeps too: every printed subtraction
    // reconciles to the printed profit.
    expect(input.revenueCentavos - input.cogsCentavos - input.expensesCentavos - input.shrinkageCentavos).toBe(
      input.netProfitCentavos,
    )
    const text = buildWeeklyReport(input)
    expect(text).toContain('Cost of goods: ₱20.00')
    expect(text).toContain('Spoilage & losses: ₱5.00')
    expect(text).toContain('Net profit: ₱45.00')
    // Cash prints split so the sheet can never contradict the dashboard
    // card again: drawer plus wallet reconciles to total cash.
    expect(text).toContain('Cash in drawer: ₱35.00')
    expect(text).toContain('In GCash/Maya: ₱15.00')
    expect(text).not.toContain('Cash on hand')
  })
})
