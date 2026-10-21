import { describe, expect, it } from 'vitest'
import { filterTxns, txnDirection } from './Record.tsx'
import type { Transaction } from '../engine/index.ts'
import {
  checklistVisible,
  dismissChecklist,
  emptyChecklist,
  markChecklistStep,
  parseChecklist,
} from '../onboarding.ts'
import { UI } from '../i18n/index.ts'
import type { Lang } from '../i18n/index.ts'

/**
 * The declutter contract: one panel at a time on the dashboard, and a ledger
 * history that narrows by day, direction and word instead of showing all of
 * everything. The composed UI is in Record.tsx/Dashboard.tsx; what is asserted
 * here are the pure rules underneath — the filter semantics and the checklist
 * state machine — plus the bilingual copy they render.
 */

const at = (day: number, hour: number) =>
  new Date(2026, 9, day, hour, 0, 0).toISOString()

const txns: Transaction[] = [
  {
    id: 'sal-old',
    at: at(1, 9),
    kind: 'cash_sale',
    lines: [{ skuId: 'coke', qty: 2, unitPriceCentavos: 2500 }],
  },
  {
    id: 'exp-week',
    at: at(12, 10),
    kind: 'expense',
    amountCentavos: 30000,
    paid: 'cash',
  },
  {
    id: 'sal-today',
    at: at(15, 9),
    kind: 'cash_sale',
    lines: [{ skuId: 'coke', qty: 4, unitPriceCentavos: 2500 }],
  },
  {
    id: 'utg-today',
    at: at(15, 11),
    kind: 'credit_sale',
    lines: [{ skuId: 'noodles', qty: 1, unitPriceCentavos: 2000 }],
    customerId: 'nena',
  },
]

const now = new Date(2026, 9, 15, 18, 0, 0)
const labelTxn = (txn: Transaction) => `${txn.kind} ${txn.id}`

describe('txnDirection', () => {
  it('claims in/out only where cash unambiguously moved', () => {
    const kinds = Object.fromEntries(txns.map((t) => [t.id, txnDirection(t)]))
    expect(kinds).toMatchObject({
      'sal-old': 'in',
      'exp-week': 'out',
      'sal-today': 'in',
      // Utang moves no cash, so it stays neutral rather than carrying a sign
      // the ledger would not support.
      'utg-today': 'neutral',
    })
  })
})

describe('filterTxns', () => {
  it('reads newest-first, like a ledger page', () => {
    const out = filterTxns(txns, { range: 'all', direction: 'all', query: '', now, describe: labelTxn })
    expect(out.map((t) => t.id)).toEqual(['utg-today', 'sal-today', 'exp-week', 'sal-old'])
  })

  it('defaults to today: only the current shift shows', () => {
    const out = filterTxns(txns, { range: 'today', direction: 'all', query: '', now, describe: labelTxn })
    expect(out.map((t) => t.id)).toEqual(['utg-today', 'sal-today'])
  })

  it('week covers the last seven days, not everything', () => {
    const out = filterTxns(txns, { range: 'week', direction: 'all', query: '', now, describe: labelTxn })
    expect(out.map((t) => t.id)).toEqual(['utg-today', 'sal-today', 'exp-week'])
  })

  it('money-in excludes expenses and utang alike', () => {
    const out = filterTxns(txns, { range: 'all', direction: 'in', query: '', now, describe: labelTxn })
    expect(out.map((t) => t.id)).toEqual(['sal-today', 'sal-old'])
  })

  it('search matches the row text and ignores case and padding', () => {
    const out = filterTxns(txns, {
      range: 'all',
      direction: 'all',
      query: '  UTG ',
      now,
      describe: labelTxn,
    })
    expect(out.map((t) => t.id)).toEqual(['utg-today'])
  })

  it('range, direction and query compose', () => {
    const out = filterTxns(txns, {
      range: 'today',
      direction: 'in',
      query: 'sal-today',
      now,
      describe: labelTxn,
    })
    expect(out.map((t) => t.id)).toEqual(['sal-today'])
  })
})

describe('starter checklist', () => {
  it('starts empty and visible', () => {
    const state = emptyChecklist()
    expect(state.done).toEqual([])
    expect(checklistVisible(state)).toBe(true)
  })

  it('marks each step once and hides when all three are done', () => {
    let state = emptyChecklist()
    state = markChecklistStep(state, 'sale')
    state = markChecklistStep(state, 'sale')
    expect(state.done).toEqual(['sale'])
    state = markChecklistStep(state, 'voice')
    state = markChecklistStep(state, 'score')
    expect(checklistVisible(state)).toBe(false)
  })

  it('dismissing hides it even with steps left', () => {
    const state = dismissChecklist(emptyChecklist())
    expect(checklistVisible(state)).toBe(false)
  })

  it('survives corrupt storage instead of crashing the dashboard', () => {
    expect(parseChecklist(null)).toEqual(emptyChecklist())
    expect(parseChecklist('not-json')).toEqual(emptyChecklist())
    const parsed = parseChecklist(JSON.stringify({ done: ['sale', 'bogus'], dismissed: false }))
    expect(parsed.done).toEqual(['sale'])
  })
})

describe('declutter copy', () => {
  it('has every new key in both languages, none blank', () => {
    const keys = [
      'dash.view.today',
      'dash.view.week',
      'dash.view.capital',
      'dash.view.label',
      'dash.banner.dismiss',
      'dash.banner.more',
      'dash.checklist.title',
      'dash.checklist.sale',
      'dash.checklist.voice',
      'dash.checklist.score',
      'dash.checklist.dismiss',
      'dash.seeWeek',
      'dash.seeCapital',
      'record.moreModes',
      'record.hideModes',
      'record.filter.label',
      'record.filter.today',
      'record.filter.week',
      'record.filter.all',
      'record.filter.in',
      'record.filter.out',
      'record.filter.search',
      'record.filter.clear',
      'record.loadMore',
      'record.showing',
      'record.emptyFilteredTitle',
      'record.emptyFilteredBody',
      'score.whyThis',
      'score.moreBelow',
      'voice.samples',
      'plan.annualNote',
      'plan.perYear',
      'plan.billingPeriod',
      'plan.monthly',
      'plan.annual',
      'plan.cohortTitle',
      'plan.cohortBody',
      'ask.speakFailed',
      'receipt.tipFill',
      'receipt.tipLight',
      'receipt.tipFlat',
      'backup.title',
      'backup.hint',
      'backup.body',
      'backup.export',
      'backup.import',
      'backup.restored',
      'backup.invalid',
      'backup.tooNew',
      'restock.title',
      'restock.empty',
      'restock.days',
      'restock.out',
      'report.print',
      'record.deleteTitle',
      'record.deleteBody',
      'record.deleteConfirm',
      'record.deleteCancel',
      'record.deleted',
      'record.deleteUndone',
      'record.detail.title',
      'record.detail.status',
      'record.detail.posted',
      'record.detail.voided',
      'record.detail.ref',
    ] as const
    const langs: Lang[] = ['en', 'fil']
    for (const key of keys) {
      const entry = (UI as Record<string, { en: string; fil: string }>)[key]
      expect(entry, `${key} is missing from the copy table`).toBeTruthy()
      for (const lang of langs) {
        expect(entry[lang].trim().length, `${key} is blank in ${lang}`).toBeGreaterThan(0)
      }
    }
  })
})
