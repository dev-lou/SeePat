import { useCallback, useMemo, useState } from 'react'
import {
  capitalComposition,
  capitalProvenance,
  computeScore,
  computeTwin,
  deriveTwin,
  openingInventoryValueCentavos,
  periodMetrics,
  seedLedger,
} from './engine/index.ts'
import type {
  BusinessScore,
  BusinessTwin,
  CapitalComposition,
  CapitalProvenance,
  DerivedTwin,
  Ledger,
  PeriodMetrics,
  Transaction,
  TxnId,
} from './engine/index.ts'
import { readPersisted, writePersisted } from './storage.ts'
import { useLang } from './i18n/index.ts'
import type { Lang } from './i18n/index.ts'

/**
 * Persistence is the one deliberately swap-in-able boundary in the app.
 *
 * The concept document specifies SQLite over OPFS. The engine is a pure fold
 * over a transaction log, so the durable store only ever has to do one thing —
 * keep the log — and swapping localStorage for SQLite touches this file alone.
 * The prototype takes the lower-risk option so the demo cannot fail on a WASM
 * filesystem.
 */

/** `legacyKey` carries the slot from before the TimbangAI → SeePat rename. */
const STORAGE = { key: 'seepat.ledger.v1', legacyKey: 'timbangai.ledger.v1' }
export const WEEK_DAYS = 7

let counter = 0

export function newTxnId(prefix: string): string {
  counter += 1
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `${prefix}-${random}-${counter}`
}

function isLedger(value: unknown): value is Ledger {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<Ledger>
  return (
    Array.isArray(candidate.transactions) &&
    Array.isArray(candidate.skus) &&
    Array.isArray(candidate.customers) &&
    Array.isArray(candidate.voids)
  )
}

function load(): Ledger | null {
  const raw = readPersisted(STORAGE)
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return isLedger(parsed) ? parsed : null
  } catch {
    return null
  }
}

function persist(ledger: Ledger): void {
  writePersisted(STORAGE, JSON.stringify(ledger))
}

export interface Negosyo {
  ledger: Ledger
  now: Date
  /** The language the derived copy below is already written in. */
  lang: Lang
  twin: BusinessTwin
  derived: DerivedTwin
  today: PeriodMetrics
  week: PeriodMetrics
  score: BusinessScore
  composition: CapitalComposition
  provenance: CapitalProvenance
  add(txn: Transaction): void
  voidTransaction(id: TxnId): void
  resetToDemo(): void
  clearAll(): void
}

export function useNegosyo(): Negosyo {
  const [now] = useState(() => new Date())
  const [ledger, setLedger] = useState<Ledger>(() => load() ?? seedLedger(now))
  // The language is a dependency of every derived value that carries words, which
  // is what makes switching languages re-derive the Score and the capital
  // narrative rather than leaving stale Tagalog on screen. The arithmetic is
  // identical either way — only the sentences change.
  const lang = useLang()

  const twin = useMemo(() => computeTwin(ledger), [ledger])
  const derived = useMemo(() => deriveTwin(twin), [twin])
  const today = useMemo(() => periodMetrics(ledger, 1, now), [ledger, now])
  const week = useMemo(() => periodMetrics(ledger, WEEK_DAYS, now), [ledger, now])
  const composition = useMemo(() => capitalComposition(twin, lang), [twin, lang])
  const provenance = useMemo(() => capitalProvenance(twin), [twin])
  const score = useMemo(
    () =>
      computeScore(
        {
          twin,
          metrics: week,
          openingInventoryValueCentavos: openingInventoryValueCentavos(ledger, WEEK_DAYS, now),
        },
        lang,
      ),
    [twin, week, ledger, now, lang],
  )

  const update = useCallback((next: Ledger) => {
    persist(next)
    setLedger(next)
  }, [])

  const add = useCallback(
    (txn: Transaction) => {
      setLedger((current) => {
        const next: Ledger = { ...current, transactions: [...current.transactions, txn] }
        persist(next)
        return next
      })
    },
    [],
  )

  const voidTransaction = useCallback((id: TxnId) => {
    setLedger((current) => {
      const next: Ledger = {
        ...current,
        voids: [...current.voids, { txnId: id, at: new Date().toISOString(), by: 'owner' }],
      }
      persist(next)
      return next
    })
  }, [])

  const resetToDemo = useCallback(() => {
    update(seedLedger(new Date()))
  }, [update])

  const clearAll = useCallback(() => {
    setLedger((current) => {
      const next: Ledger = { ...current, transactions: [], voids: [] }
      persist(next)
      return next
    })
  }, [])

  return {
    ledger,
    now,
    lang,
    twin,
    derived,
    today,
    week,
    score,
    composition,
    provenance,
    add,
    voidTransaction,
    resetToDemo,
    clearAll,
  }
}
