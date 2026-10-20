import { useCallback, useEffect, useMemo, useState } from 'react'
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
  Customer,
  CustomerId,
  DerivedTwin,
  Ledger,
  PeriodMetrics,
  Sku,
  SkuId,
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

/**
 * An id an owner never sees: derived from what they typed, made unique.
 *
 * Derived rather than random because these ids appear in the LEDGER forever —
 * a restore from backup, a merge, a debugging session — and `bigas` says what
 * `sk-7f3a91` does not. Uniqueness is then forced by suffixing, which is safe
 * because nothing joins on the shape of the id.
 */
export function slugId(name: string, taken: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 24) || 'item'
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}_${n}`)) n += 1
  return `${base}_${n}`
}

/**
 * What an owner types is a name and a unit. Everything else is derived.
 *
 * `baseUnit` is the one piece of real machinery in here: quantities are stored
 * as integers in the base unit, so rice is entered in kilos and kept in grams
 * (`kg` → `g`). Getting this wrong on a new item would corrupt every quantity
 * recorded against it, so it is decided here rather than asked as a question.
 *
 * Pure and exported on purpose. The id has to be known at the CALL site — a
 * screen that adds an item and then wants to select it cannot read a value
 * produced inside a `setState` updater, which React may run later, and twice.
 */
export function deriveSku(
  name: string,
  unit: string,
  taken: Set<string>,
  prices?: { buyPriceCentavos?: number; sellPriceCentavos?: number },
): Sku {
  const cleanUnit = unit.trim() || 'pc'
  const words = name.toLowerCase().split(/\s+/).filter(Boolean)
  return {
    id: slugId(name, taken),
    name: name.trim(),
    unit: cleanUnit,
    baseUnit: cleanUnit === 'kg' || cleanUnit === 'g' ? 'g' : 'pc',
    // The whole name, then its words: the voice matcher looks for aliases, and
    // a new item that voice can never match would be a silent second-class one.
    aliases: [...new Set([name.toLowerCase().trim(), ...words])],
    ...(prices?.buyPriceCentavos ? { buyPriceCentavos: prices.buyPriceCentavos } : null),
    ...(prices?.sellPriceCentavos ? { sellPriceCentavos: prices.sellPriceCentavos } : null),
  }
}

/**
 * The same contract for the people who owe the owner money.
 *
 * A customer id is not decoration either: `twin.receivables` is keyed by it, so
 * this is what makes a typed name collectable instead of an anonymous balance
 * that the utang book can only report as "walk in".
 */
export function deriveCustomer(name: string, taken: Set<string>): Customer {
  const clean = name.trim()
  return {
    id: slugId(clean, taken),
    name: clean,
    // Voice matches on aliases, so a customer added by typing is as speakable
    // as one that shipped with the app.
    aliases: [...new Set([clean.toLowerCase(), ...clean.toLowerCase().split(/\s+/).filter(Boolean)])],
  }
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
  /** Permanently remove a transaction (and its void record, if any). */
  removeTransaction(id: TxnId): void
  /** Put a removed transaction back at its position — the delete-undo path. */
  restoreTransaction(txn: Transaction, index?: number): void
  resetToDemo(): void
  clearAll(): void
  /** Replace the whole ledger — used only by backup restore. */
  restore(ledger: Ledger): void
  /*
   * The owner's own book.
   *
   * Until these existed, `ledger.skus` and `ledger.customers` were read-only and
   * every record could only be written against the ten demo goods — which made
   * the app unusable for a real store no matter how good the rest of it was. A
   * sari-sari carries 80–200 items and 10–40 utang customers, so creating both
   * is the difference between a demo and a product.
   *
   * Removal never touches history: transactions keep their `skuId`, the row
   * falls back to naming a count, and a deleted customer still shows up in the
   * utang book while they owe money.
   */
  addSku(input: { name: string; unit?: string; buyPriceCentavos?: number; sellPriceCentavos?: number }): SkuId
  updateSku(id: SkuId, patch: { name?: string; unit?: string; buyPriceCentavos?: number; sellPriceCentavos?: number }): void
  removeSku(id: SkuId): void
  addCustomer(input: { name: string }): CustomerId
  updateCustomer(id: CustomerId, patch: { name?: string }): void
  removeCustomer(id: CustomerId): void
}

export function useNegosyo(): Negosyo {
  const [now, setNow] = useState(() => new Date())
  const [ledger, setLedger] = useState<Ledger>(() => load() ?? seedLedger(now))
  const refreshNow = useCallback(() => {
    // `now` bounds every windowed figure (today, this week, the report range).
    // It used to be captured once at mount, so a record written minutes later
    // carried a timestamp NEWER than the bound — and vanished from every
    // period figure (but not from the totals, which are unbounded). The owner
    // watched a sale land in the cash box while today's sales stayed ₱0.00
    // until the next reload. Time moves when the book does, and once a minute
    // besides, so midnight rollover cannot strand yesterday's date on screen.
    setNow(new Date())
  }, [])
  useEffect(() => {
    const tick = window.setInterval(refreshNow, 60_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshNow()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      window.clearInterval(tick)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [refreshNow])
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

  const update = useCallback(
    (next: Ledger) => {
      persist(next)
      setLedger(next)
      refreshNow()
    },
    [refreshNow],
  )

  const add = useCallback(
    (txn: Transaction) => {
      setLedger((current) => {
        const next: Ledger = { ...current, transactions: [...current.transactions, txn] }
        persist(next)
        return next
      })
      refreshNow()
    },
    [refreshNow],
  )

  const voidTransaction = useCallback(
    (id: TxnId) => {
      setLedger((current) => {
        const next: Ledger = {
          ...current,
          voids: [...current.voids, { txnId: id, at: new Date().toISOString(), by: 'owner' }],
        }
        persist(next)
        return next
      })
      refreshNow()
    },
    [refreshNow],
  )

  const removeTransaction = useCallback(
    (id: TxnId) => {
      setLedger((current) => {
        const next: Ledger = {
          ...current,
          transactions: current.transactions.filter((t) => t.id !== id),
          voids: current.voids.filter((v) => v.txnId !== id),
        }
        persist(next)
        return next
      })
      refreshNow()
    },
    [refreshNow],
  )

  const restoreTransaction = useCallback(
    (txn: Transaction, index?: number) => {
      setLedger((current) => {
        if (current.transactions.some((t) => t.id === txn.id)) return current
        const transactions =
          typeof index === 'number'
            ? [...current.transactions.slice(0, index), txn, ...current.transactions.slice(index)]
            : [...current.transactions, txn]
        const next: Ledger = { ...current, transactions }
        persist(next)
        return next
      })
      refreshNow()
    },
    [refreshNow],
  )

  const resetToDemo = useCallback(() => {
    update(seedLedger(new Date()))
  }, [update])

  const clearAll = useCallback(() => {
    // Erase means erase: the sample catalog goes too, so the book afterwards
    // contains only what the owner adds. (It used to keep the demo SKUs and
    // customers, which made "erase everything" a lie — sample names kept
    // showing up in a supposedly empty store.)
    setLedger(() => {
      const next: Ledger = { skus: [], customers: [], transactions: [], voids: [] }
      persist(next)
      return next
    })
  }, [])

  const restore = useCallback(
    (ledger: Ledger) => {
      update(ledger)
    },
    [update],
  )

  const addSku = useCallback(
    (input: { name: string; unit?: string; buyPriceCentavos?: number; sellPriceCentavos?: number }) => {
      // Derived from the ledger as it stands, not inside the updater, so the id
      // is real at the call site: see `deriveSku`.
      const sku = deriveSku(input.name, input.unit ?? 'pc', new Set(ledger.skus.map((s) => s.id)), {
        buyPriceCentavos: input.buyPriceCentavos,
        sellPriceCentavos: input.sellPriceCentavos,
      })
      update({ ...ledger, skus: [...ledger.skus, sku] })
      return sku.id
    },
    [ledger, update],
  )

  const updateSku = useCallback(
    (id: SkuId, patch: { name?: string; unit?: string; buyPriceCentavos?: number; sellPriceCentavos?: number }) => {
      setLedger((current) => {
        const next: Ledger = {
          ...current,
          skus: current.skus.map((sku) => {
            if (sku.id !== id) return sku
            const unit = patch.unit ?? sku.unit
            const name = patch.name === undefined ? sku.name : patch.name.trim() || sku.name
            return {
              ...sku,
              name,
              unit,
              // Owner-typed bought-for/sell-for: the sheet always prefills
              // the effective value, so saving writes it back wholesale — an
              // emptied field clears the default (undefined keys drop out of
              // the persisted JSON on their own).
              buyPriceCentavos: patch.buyPriceCentavos,
              sellPriceCentavos: patch.sellPriceCentavos,
              // Renaming an item re-teaches the voice matcher: an owner who
              // renames "Coke" to "Coke Mismo" would otherwise be stuck with an
              // alias that only matches the old word.
              baseUnit: unit === 'kg' || unit === 'g' ? 'g' : sku.baseUnit === 'g' ? 'pc' : sku.baseUnit,
              aliases: patch.name === undefined ? sku.aliases : [...new Set([name.toLowerCase(), ...name.toLowerCase().split(/\s+/).filter(Boolean)])],
            }
          }),
        }
        persist(next)
        return next
      })
    },
    [],
  )

  const removeSku = useCallback((id: SkuId) => {
    setLedger((current) => {
      const next: Ledger = { ...current, skus: current.skus.filter((s) => s.id !== id) }
      persist(next)
      return next
    })
  }, [])

  const addCustomer = useCallback(
    (input: { name: string }) => {
      const customer = deriveCustomer(input.name, new Set(ledger.customers.map((c) => c.id)))
      update({ ...ledger, customers: [...ledger.customers, customer] })
      return customer.id
    },
    [ledger, update],
  )

  const updateCustomer = useCallback((id: CustomerId, patch: { name?: string }) => {
    setLedger((current) => {
      const next: Ledger = {
        ...current,
        customers: current.customers.map((customer) => {
          if (customer.id !== id || patch.name === undefined) return customer
          const name = patch.name.trim() || customer.name
          return {
            ...customer,
            name,
            aliases: [...new Set([name.toLowerCase(), ...name.toLowerCase().split(/\s+/).filter(Boolean)])],
          }
        }),
      }
      persist(next)
      return next
    })
  }, [])

  const removeCustomer = useCallback((id: CustomerId) => {
    setLedger((current) => {
      const next: Ledger = { ...current, customers: current.customers.filter((c) => c.id !== id) }
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
    removeTransaction,
    restoreTransaction,
    resetToDemo,
    clearAll,
    restore,
    addSku,
    updateSku,
    removeSku,
    addCustomer,
    updateCustomer,
    removeCustomer,
  }
}
