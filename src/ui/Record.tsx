import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, Card, Chip, ConfirmDialog, CustomSelect, EmptyState, Field, SectionTitle, inputClass } from './components.tsx'
import { useToast } from './Toast.tsx'
import {
  formatPHP,
  pesos,
  pricePerBaseUnit,
  pricePerDisplayUnit,
  qtyPerDisplayUnit,
  suggestedCost,
  suggestedPrice,
  unitPriceDrifts,
} from '../engine/index.ts'
import type { Ledger, PaymentChannel, Sku, Transaction } from '../engine/index.ts'
import { newTxnId } from '../store.ts'
import type { Negosyo } from '../store.ts'
import { UI, clockTime, dayMonth, tr, useLang, useT } from '../i18n/index.ts'
import type { Lang, Params, UIStr } from '../i18n/index.ts'

type Mode =
  | 'cash_sale'
  | 'credit_sale'
  | 'purchase'
  | 'expense'
  | 'payment_received'
  | 'capital_injection'
  | 'owner_withdrawal'

const MODES: { id: Mode; labelKey: UIStr }[] = [
  { id: 'cash_sale', labelKey: 'record.mode.cash_sale' },
  { id: 'credit_sale', labelKey: 'record.mode.credit_sale' },
  { id: 'expense', labelKey: 'record.mode.expense' },
  { id: 'purchase', labelKey: 'record.mode.purchase' },
  { id: 'payment_received', labelKey: 'record.mode.payment_received' },
  { id: 'capital_injection', labelKey: 'record.mode.capital_injection' },
  { id: 'owner_withdrawal', labelKey: 'record.mode.owner_withdrawal' },
]

// The three daily jobs stay visible; the rest live one tap away under "More".
// A new owner meets Benta / Gastos / Utang, not seven chips at once.
const PRIMARY_IDS: Mode[] = ['cash_sale', 'expense', 'credit_sale']
const MORE_IDS: Mode[] = ['purchase', 'payment_received', 'capital_injection', 'owner_withdrawal']
const PRIMARY_MODES = MODES.filter((m) => PRIMARY_IDS.includes(m.id))
const MORE_MODES = MODES.filter((m) => MORE_IDS.includes(m.id))

/**
 * Where a cash sale's money landed, in the order a store meets them.
 *
 * Cash first because it is the default and the most common; GCash before Maya
 * because of reach; bank last, because a bank transfer to a sari-sari is rare
 * enough to be the last option rather than hidden behind a menu.
 */
const PAYMENT_CHANNELS: { id: PaymentChannel; labelKey: UIStr }[] = [
  { id: 'cash', labelKey: 'record.channel.cash' },
  { id: 'gcash', labelKey: 'record.channel.gcash' },
  { id: 'maya', labelKey: 'record.channel.maya' },
  { id: 'bank', labelKey: 'record.channel.bank' },
]

export type HistoryRange = 'today' | 'week' | 'all'
export type DirectionFilter = 'all' | 'in' | 'out'

/** Page size for the history feed — the same 15-at-a-time GCash documents. */
export const HISTORY_PAGE = 15

/**
 * Direction is only claimed where it is unambiguous: a credit sale or a
 * purchase on terms moves no cash, so those stay neutral rather than carrying
 * a +/− the ledger would not support.
 */
export function txnDirection(txn: Transaction): 'in' | 'out' | 'neutral' {
  if (txn.kind === 'cash_sale' || txn.kind === 'payment_received' || txn.kind === 'capital_injection')
    return 'in'
  if (
    txn.kind === 'expense' ||
    txn.kind === 'owner_withdrawal' ||
    txn.kind === 'fixed_asset_purchase' ||
    txn.kind === 'payable_payment'
  )
    return 'out'
  return 'neutral'
}

function startOfDay(d: Date): number {
  const copy = new Date(d)
  copy.setHours(0, 0, 0, 0)
  return copy.getTime()
}

/**
 * Newest-first history under the active filters. Pure given its inputs, so the
 * range/direction/search rules are assertable without rendering.
 */
export function filterTxns(
  txns: Transaction[],
  opts: {
    range: HistoryRange
    direction: DirectionFilter
    query: string
    now: Date
    describe: (txn: Transaction) => string
  },
): Transaction[] {
  const { range, direction, query, now, describe } = opts
  const q = query.trim().toLowerCase()
  const todayStart = startOfDay(now)
  const weekStart = startOfDay(new Date(now.getTime() - 6 * 86400000))
  return [...txns].reverse().filter((txn) => {
    const at = new Date(txn.at).getTime()
    if (range === 'today' && at < todayStart) return false
    if (range === 'week' && at < weekStart) return false
    if (direction !== 'all' && txnDirection(txn) !== direction) return false
    if (q && !describe(txn).toLowerCase().includes(q)) return false
    return true
  })
}

interface LineDraft {
  key: string
  skuId: string
  qty: string
  price: string
}

/** Quantities are entered in the SKU's display unit and stored in its base unit. */
function toBaseQty(sku: Sku | undefined, displayQty: number): number {
  if (sku?.baseUnit === 'g') return Math.round(displayQty * 1000)
  return Math.round(displayQty)
}

export interface OversoldLine {
  skuId: string
  name: string
  unit: string
  /** Wanted and on-hand, in the unit the owner counts in — never base grams. */
  wanted: number
  onHand: number
}

/**
 * The honest-sale gate as a pure function, so tests can pin it.
 *
 * Every returned line is a sale the ledger cannot cover: committing it would
 * push the stock negative and force the next Weeks screen to estimate that
 * item's cost. An exact-quantity sale is NOT oversold — the shelf is empty
 * afterwards, but the books still balance.
 */
export function oversoldLines(
  ledger: Ledger,
  inventory: { readonly [skuId: string]: { readonly qty: number } | undefined },
  saleLines: { readonly skuId: string; readonly qty: number }[],
): OversoldLine[] {
  return saleLines.flatMap((l) => {
    const sku = ledger.skus.find((s) => s.id === l.skuId)
    const onHandBase = Math.max(0, inventory[l.skuId]?.qty ?? 0)
    if (l.qty <= onHandBase) return []
    const baseUnit = sku?.baseUnit ?? 'pc'
    // The same rounding the items list reads back with, so the gate never
    // disagrees with the shelf count the owner just saw there.
    const shown = (baseQty: number) =>
      baseUnit === 'g'
        ? Math.round(qtyPerDisplayUnit(baseUnit, baseQty) * 10) / 10
        : Math.round(qtyPerDisplayUnit(baseUnit, baseQty))
    return [
      {
        skuId: l.skuId,
        name: sku?.name ?? l.skuId,
        unit: sku?.unit ?? baseUnit,
        wanted: shown(l.qty),
        onHand: shown(onHandBase),
      },
    ]
  })
}

export function RecordScreen({
  negosyo,
  onOpenItems,
  onOpenUtang,
}: {
  negosyo: Negosyo
  /** Opens "My items" — where the item being recorded would be added. */
  onOpenItems?: () => void
  /** Opens the utang book — where the name being asked for is kept. */
  onOpenUtang?: () => void
}) {
  const { ledger, add, removeTransaction, restoreTransaction } = negosyo
  const lang = useLang()
  const t = useT()
  const toast = useToast()
  const undoLabel = lang === 'fil' ? 'I-undo' : 'Undo'
  const [mode, setMode] = useState<Mode>('cash_sale')
  const [lines, setLines] = useState<LineDraft[]>([{ key: '1', skuId: '', qty: '1', price: '' }])
  const [amount, setAmount] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [onCredit, setOnCredit] = useState(false)
  /**
   * Where a cash sale's money landed. Defaults to the box, which is both the
   * commonest answer and the behaviour every record written before this field
   * existed is read with.
   */
  const [channel, setChannel] = useState<PaymentChannel>('cash')
  const [flash, setFlash] = useState('')
  /*
   * The feed opens on EVERYTHING, and the chips narrow it.
   *
   * It used to open on Today, on the reasoning that the shift is what an owner
   * reconciles first. In practice that hid the thing people went looking for:
   * "where is my history?" is answered by seeing 230 rows and a Load more
   * button, not by a filter you have to find. Today and This week are one tap
   * away, which is the cheaper mistake of the two.
   */
  const [range, setRange] = useState<HistoryRange>('all')
  const [direction, setDirection] = useState<DirectionFilter>('all')
  const [query, setQuery] = useState('')
  const [visibleCount, setVisibleCount] = useState(HISTORY_PAGE)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showMoreModes, setShowMoreModes] = useState(false)
  // One job per screen: writing a record OR reading history, never both at
  // once. Stacking the form and the feed is what made Tala feel like too
  // much to process — the feed is one tap away, with its count on the tab.
  const [section, setSection] = useState<'write' | 'history'>('write')
  // Deleting is always gated: the row key arms this, the dialog confirms it,
  // and the toast afterwards still offers undo. No silent deletes.
  const [pendingDelete, setPendingDelete] = useState<{ txn: Transaction; index: number } | null>(null)
  // A sale the gate caught: nothing is committed while this is set — the
  // dialog either reroutes to the missing purchase or re-posts with force.
  const [pendingOversell, setPendingOversell] = useState<OversoldLine | null>(null)

  function confirmDelete() {
    const target = pendingDelete
    if (!target) return
    setPendingDelete(null)
    setExpandedId((current) => (current === target.txn.id ? null : current))
    removeTransaction(target.txn.id)
    toast.show({
      title: t('record.deleted'),
      tone: 'info',
      undoLabel,
      onUndo: () => {
        restoreTransaction(target.txn, target.index)
        toast.show({ title: t('record.deleteUndone'), tone: 'success' })
      },
    })
  }

  /**
   * The oversell dialog's way out: the stock the sale needs was never
   * recorded, so the form becomes a purchase of exactly that item — quantity
   * prefilled with what the sale asked for, price prefilled with the last
   * known cost, so recording the delivery is two taps, not a new errand.
   */
  function recordMissingPurchase() {
    const caught = pendingOversell
    setPendingOversell(null)
    if (!caught) return
    const sku = ledger.skus.find((s) => s.id === caught.skuId)
    const stored = suggestedCost(ledger, caught.skuId)
    const display = pricePerDisplayUnit(sku?.baseUnit ?? 'pc', stored)
    changeMode('purchase')
    setLines([
      {
        key: String(Date.now()),
        skuId: caught.skuId,
        qty: String(caught.wanted),
        price: display > 0 ? String(display / 100) : '',
      },
    ])
  }

  /**
   * The oversell dialog's trapdoor: the owner has read the warning and owns
   * the consequences, so the exact same lines post with the gate lifted.
   * Nothing about them is edited on the way through.
   */
  function sellAnyway() {
    setPendingOversell(null)
    post(true)
  }

  /**
   * Changing what you are recording clears last time's complaint.
   *
   * The message under the button used to survive the switch: pick Utang, hit
   * Record it without a name, then move to Expense and the form still reads
   * "Pick a customer." above an empty amount box. A stale warning on a fresh
   * form is worse than no warning — it teaches the owner to ignore the line.
   */
  function changeMode(next: Mode) {
    setMode(next)
    setFlash('')
    setSection('write')
  }

  function changeRange(next: HistoryRange) {
    setRange(next)
    setVisibleCount(HISTORY_PAGE)
  }
  function changeDirection(next: DirectionFilter) {
    setDirection(next)
    setVisibleCount(HISTORY_PAGE)
  }
  function changeQuery(next: string) {
    setQuery(next)
    setVisibleCount(HISTORY_PAGE)
  }
  function clearFilters() {
    setRange('all')
    setDirection('all')
    setQuery('')
    setVisibleCount(HISTORY_PAGE)
  }

  const isLineMode = mode === 'cash_sale' || mode === 'credit_sale' || mode === 'purchase'

  function reset() {
    setLines([{ key: String(Date.now()), skuId: '', qty: '1', price: '' }])
    setAmount('')
    setCustomerId('')
    setOnCredit(false)
    setChannel('cash')
  }

  function pickSku(key: string, skuId: string) {
    const sku = ledger.skus.find((s) => s.id === skuId)
    const stored =
      mode === 'purchase' ? suggestedCost(ledger, skuId) : suggestedPrice(ledger, skuId)
    // Last time's price, put back into the unit the owner prices in. For rice
    // that is the kilo, not the gram: `suggestedPrice` returns what is stored.
    const display = sku ? pricePerDisplayUnit(sku.baseUnit, stored) : stored
    setLines((current) =>
      current.map((line) =>
        line.key === key
          ? { ...line, skuId, price: display > 0 ? String(display / 100) : '' }
          : line,
      ),
    )
    void sku
  }

  // `force` bypasses the honest-sale gate — only the oversell dialog's own
  // "Sell anyway" passes true, so every other caller keeps the protection.
  function post(force = false) {
    const at = new Date().toISOString()

    if (isLineMode) {
      const usable = lines.filter((l) => l.skuId && Number(l.qty) > 0 && Number(l.price) > 0)
      if (usable.length === 0) {
        const msg = t('record.flash.needItems')
        setFlash(msg)
        return
      }

      if (mode === 'purchase') {
        const purchaseLines = usable.map((l) => {
          const sku = ledger.skus.find((s) => s.id === l.skuId)
          return {
            skuId: l.skuId,
            qty: toBaseQty(sku, Number(l.qty)),
            // The form's price is per DISPLAY unit (kilo); the line stores the
            // price of one base unit (gram), because that is what the engine
            // multiplies the stored quantity by.
            unitCostCentavos: pricePerBaseUnit(sku?.baseUnit ?? 'pc', pesos(Number(l.price))),
          }
        })
        const total = purchaseLines.reduce((s, l) => s + l.qty * l.unitCostCentavos, 0)
        const txn: Transaction = {
          id: newTxnId('pur'),
          at,
          kind: 'purchase',
          lines: purchaseLines,
          paidCentavos: onCredit ? 0 : total,
        }
        add(txn)
        const msg = onCredit
          ? t('record.flash.purchaseCredit', { amount: formatPHP(total) })
          : t('record.flash.purchase', { amount: formatPHP(total) })
        toast.show({
          title: msg,
          tone: 'success',
          undoLabel,
          onUndo: () => {
            removeTransaction(txn.id)
            toast.show({
              title: lang === 'fil' ? 'Na-undo ang bili' : 'Purchase undone',
              tone: 'info',
            })
          },
        })
        reset()
        return
      }

      const saleLines = usable.map((l) => {
        const sku = ledger.skus.find((s) => s.id === l.skuId)
        return {
          skuId: l.skuId,
          qty: toBaseQty(sku, Number(l.qty)),
          unitPriceCentavos: pricePerBaseUnit(sku?.baseUnit ?? 'pc', pesos(Number(l.price))),
        }
      })
      const total = saleLines.reduce((s, l) => s + l.qty * l.unitPriceCentavos, 0)

      // The honest-sale gate: a sale bigger than the stock on hand is how the
      // ledger goes negative and starts estimating costs (the WATCH OUT that
      // fires after the damage is done). Both cash and utang sales pass
      // through here, so the check lives before the two commit branches, not
      // inside either. Purchases skip it — stock arriving can never oversell.
      // `force` is only ever true from the dialog's own "Sell anyway".
      if (!force) {
        const oversold = oversoldLines(ledger, negosyo.twin.inventory, saleLines)
        if (oversold.length > 0) {
          setPendingOversell(oversold[0])
          return
        }
      }

      if (mode === 'credit_sale') {
        /*
         * A nameless utang is uncollectable: it lands in "Owed to you" with
         * nobody to ask, and the app's own top advice ("Collect first") starts
         * pointing at a person who does not exist. Recording a PAYMENT already
         * refuses to proceed without a name; lending was the one that quietly
         * defaulted to `walk_in`, which is the wrong way round.
         */
        if (!customerId) {
          const msg = t('record.utangNeedName')
          setFlash(msg)
          return
        }
        const txn: Transaction = {
          id: newTxnId('utang'),
          at,
          kind: 'credit_sale',
          lines: saleLines,
          customerId,
        }
        add(txn)
        const msg = t('record.flash.credit', { amount: formatPHP(total) })
        toast.show({
          title: msg,
          tone: 'success',
          undoLabel,
          onUndo: () => {
            removeTransaction(txn.id)
            toast.show({
              title: lang === 'fil' ? 'Na-undo ang utang' : 'Credit sale undone',
              tone: 'info',
            })
          },
        })
      } else {
        const txn: Transaction = {
          id: newTxnId('sal'),
          at,
          kind: 'cash_sale',
          lines: saleLines,
          // Only written when it is not the default, so a plain cash sale stays
          // the same shape it has always been in the ledger.
          ...(channel === 'cash' ? {} : { channel }),
        }
        add(txn)
        const msg = t('record.flash.sale', { amount: formatPHP(total) })
        toast.show({
          title: msg,
          tone: 'success',
          undoLabel,
          onUndo: () => {
            removeTransaction(txn.id)
            toast.show({
              title: lang === 'fil' ? 'Na-undo ang benta' : 'Sale undone',
              tone: 'info',
            })
          },
        })
      }
      reset()
      return
    }

    const value = pesos(Number(amount))
    if (value <= 0) {
      const msg = t('record.flash.needAmount')
      setFlash(msg)
      return
    }

    switch (mode) {
      case 'expense': {
        const txn: Transaction = {
          id: newTxnId('exp'),
          at,
          kind: 'expense',
          amountCentavos: value,
          paid: onCredit ? 'credit' : 'cash',
        }
        add(txn)
        const msg = t('record.flash.expense', { amount: formatPHP(value) })
        toast.show({
          title: msg,
          tone: 'success',
          undoLabel,
          onUndo: () => {
            removeTransaction(txn.id)
            toast.show({
              title: lang === 'fil' ? 'Na-undo ang gastos' : 'Expense undone',
              tone: 'info',
            })
          },
        })
        break
      }
      case 'payment_received': {
        if (!customerId) {
          const msg = t('record.flash.needCustomer')
          setFlash(msg)
          return
        }
        const txn: Transaction = {
          id: newTxnId('pay'),
          at,
          kind: 'payment_received',
          customerId,
          amountCentavos: value,
        }
        add(txn)
        const msg = t('record.flash.payment', { amount: formatPHP(value) })
        toast.show({
          title: msg,
          tone: 'success',
          undoLabel,
          onUndo: () => {
            removeTransaction(txn.id)
            toast.show({
              title: lang === 'fil' ? 'Na-undo ang bayad' : 'Payment undone',
              tone: 'info',
            })
          },
        })
        break
      }
      case 'capital_injection': {
        const txn: Transaction = { id: newTxnId('cap'), at, kind: 'capital_injection', amountCentavos: value }
        add(txn)
        const msg = t('record.flash.capital', { amount: formatPHP(value) })
        toast.show({
          title: msg,
          tone: 'success',
          undoLabel,
          onUndo: () => {
            removeTransaction(txn.id)
            toast.show({
              title: lang === 'fil' ? 'Na-undo ang dagdag puhunan' : 'Capital injection undone',
              tone: 'info',
            })
          },
        })
        break
      }
      case 'owner_withdrawal': {
        const txn: Transaction = { id: newTxnId('wdr'), at, kind: 'owner_withdrawal', amountCentavos: value }
        add(txn)
        const msg = t('record.flash.withdrawal', { amount: formatPHP(value) })
        toast.show({
          title: msg,
          tone: 'success',
          undoLabel,
          onUndo: () => {
            removeTransaction(txn.id)
            toast.show({
              title: lang === 'fil' ? 'Na-undo ang bawas puhunan' : 'Withdrawal undone',
              tone: 'info',
            })
          },
        })
        break
      }
      default:
        break
    }
    reset()
  }

  /*
   * The filtered feed, read newest-first. The rows are grouped under the day they
   * belong to — the way a page of a ledger book is read — so the date is printed
   * once above the day's first row instead of repeated on every line.
   *
   * The day heading is drawn INSIDE the row that opens the day (at `w-full`, so
   * it takes a line of its own). That keeps one list of transactions rather than
   * a list of days each holding a list — a screen reader announces one list of
   * six entries either way, and the DOM stays flat.
   */
  // Cancelled (voided) records never appear: a ledger shows what stands, not
  // what was crossed out. Deleting is permanent removal with a confirm gate.
  const activeTxns = useMemo(
    () => ledger.transactions.filter((txn) => !ledger.voids.some((v) => v.txnId === txn.id)),
    [ledger.transactions, ledger.voids],
  )
  const filtered = useMemo(
    () =>
      filterTxns(activeTxns, {
        range,
        direction,
        query,
        now: negosyo.now,
        describe: (txn) => describe(txn, ledger, lang),
      }),
    [activeTxns, ledger, range, direction, query, lang, negosyo.now],
  )
  const visible = filtered.slice(0, visibleCount)
  const filtersNarrowed = range !== 'all' || direction !== 'all' || query.trim() !== ''
  const dayOf = (txn: Transaction) => dayMonth(new Date(txn.at), lang)

  return (
    <div className="space-y-5">
      {/* Write vs history: one segmented switch, so the screen asks a single
          question — "what are you doing?" — before showing anything else. */}
      <div className="px-3.5 pt-2">
        <div
          role="tablist"
          aria-label={t('tab.ledger')}
          className="grid grid-cols-2 gap-1 rounded-2xl border border-white/80 bg-white/60 p-1 shadow-xs backdrop-blur-md"
        >
          <button
            type="button"
            role="tab"
            aria-selected={section === 'write'}
            onClick={() => setSection('write')}
            className={`min-h-11 rounded-xl text-[0.9375rem] font-bold transition active:scale-[0.99] ${section === 'write' ? 'bg-brand-600 text-white shadow-xs' : 'text-fg-muted'}`}
          >
            {t('tab.ledger')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={section === 'history'}
            onClick={() => setSection('history')}
            className={`min-h-11 rounded-xl text-[0.9375rem] font-bold transition active:scale-[0.99] ${section === 'history' ? 'bg-brand-600 text-white shadow-xs' : 'text-fg-muted'}`}
          >
            {t('record.filter.label')}
            <span className="num ml-1.5 text-[0.8125rem] font-semibold opacity-80">
              {ledger.transactions.length}
            </span>
          </button>
        </div>
      </div>

      {section === 'write' ? (
      <div className="space-y-5">
      {/* The daily three as big thumb-sized targets — one tap, no reading.
          Everything else lives under one quiet More row. */}
      <div className="px-3.5">
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2" role="group" aria-label={t('tab.ledger')}>
            {PRIMARY_MODES.map((m) => {
              const active = mode === m.id
              return (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => changeMode(m.id)}
                  className={`min-h-16 rounded-2xl border px-2 py-2.5 text-center transition active:scale-[0.97] ${active ? 'border-brand-600 bg-brand-600 text-white shadow-md' : 'border-white/80 bg-white/60 text-fg backdrop-blur-md shadow-xs'}`}
                >
                  <span className="block text-[0.9375rem] leading-tight font-bold">{t(m.labelKey)}</span>
                  <span className={`mt-0.5 block text-[0.6875rem] leading-tight font-semibold ${active ? 'text-white/80' : 'text-fg-faint'}`}>
                    {m.id === 'cash_sale' ? (lang === 'fil' ? 'Cash / GCash' : 'Cash / GCash') : m.id === 'expense' ? (lang === 'fil' ? 'Lumalabas' : 'Money out') : (lang === 'fil' ? 'Sisingilin' : 'Collect later')}
                  </span>
                </button>
              )
            })}
          </div>
          <button
            type="button"
            aria-expanded={showMoreModes || MORE_IDS.includes(mode)}
            onClick={() => setShowMoreModes((v) => !v)}
            className="flex min-h-11 w-full items-center justify-center gap-1 rounded-xl border border-line/60 bg-white/40 text-[0.875rem] font-bold text-fg-muted transition active:scale-[0.99]"
          >
            {showMoreModes || MORE_IDS.includes(mode)
              ? t('record.hideModes')
              : t('record.moreModes')}{' '}
            <span aria-hidden>{showMoreModes || MORE_IDS.includes(mode) ? '▴' : '▾'}</span>
          </button>
          {showMoreModes || MORE_IDS.includes(mode) ? (
            <div className="flex flex-wrap gap-1.5">
              {MORE_MODES.map((m) => (
                <Chip key={m.id} active={mode === m.id} onClick={() => changeMode(m.id)}>
                  {t(m.labelKey)}
                </Chip>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <Card>
        <SectionTitle>{t(MODES.find((m) => m.id === mode)?.labelKey ?? 'record.mode.cash_sale')}</SectionTitle>

        {/*
         * Where the money landed, asked only of a cash sale.
         *
         * This is not a payment integration and must never look like one: the
         * owner tells the app where the money went, exactly as they would tell
         * their notebook. What it buys is that the drawer figure stays true — a
         * GCash sale is money received that is not in the box, and every app in
         * this market that treats the two as one number makes an owner's nightly
         * count come out short for no visible reason.
         */}
        {mode === 'cash_sale' ? (
          <div className="mb-3.5">
            <div className="eyebrow text-fg-subtle">{t('record.field.channel')}</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {PAYMENT_CHANNELS.map((option) => (
                <Chip
                  key={option.id}
                  active={channel === option.id}
                  onClick={() => setChannel(option.id)}
                >
                  {t(option.labelKey)}
                </Chip>
              ))}
            </div>
            {channel !== 'cash' ? (
              <p className="mt-2 text-[0.8125rem] leading-relaxed text-fg-subtle">
                {t('record.channelNote')}
              </p>
            ) : null}
          </div>
        ) : null}

        {/*
         * Money taken home, said out loud at the moment it is recorded.
         *
         * The whole positioning of this app is that business capital and
         * household cash are two different things, and this is the single tap
         * where an owner could accidentally merge them: a withdrawal entered as
         * "gastos" turns a profitable week into a losing one, and hides the fact
         * that she paid herself. The machinery already keeps them apart
         * (a withdrawal is a use of capital in `capitalProvenance`) — this line
         * is what tells her, where the choice is made, that she has not made a
         * mistake by tapping it.
         */}
        {mode === 'owner_withdrawal' ? (
          <p className="mb-3.5 text-[0.8125rem] leading-relaxed text-fg-subtle">
            {t('record.withdrawalNote')}
          </p>
        ) : null}

        {isLineMode ? (
          <div className="space-y-3.5">
            {lines.map((line) => {
              const sku = ledger.skus.find((s) => s.id === line.skuId)
              const perKilo = sku?.baseUnit === 'g'
              const typed = pesos(Number(line.price))
              return (
                <div key={line.key} className="rounded-2xl border border-line/80 bg-white/60 backdrop-blur-md p-4 shadow-xs space-y-3">
                  <Field label={t('record.field.item')}>
                    <CustomSelect
                      value={line.skuId}
                      onChange={(val) => pickSku(line.key, val)}
                      placeholder={t('record.select')}
                      options={ledger.skus.map((s) => ({ value: s.id, label: s.name }))}
                    />
                  </Field>
                  {/* `fit-grid-2`: quantity and price sit side by side from 384px
                      up, and stack below that so each field is a full-width target
                      instead of a 68px box. */}
                  <div className="fit-grid-2 mt-3 grid grid-cols-2 gap-3.5">
                    <Field
                      label={t('record.field.qty')}
                      hint={
                        sku ? (sku.baseUnit === 'g' ? t('voice.hintPerKilo') : sku.unit) : undefined
                      }
                    >
                      <input
                        className={inputClass}
                        type="number"
                        inputMode="decimal"
                        step="any"
                        value={line.qty}
                        onChange={(e) =>
                          setLines((current) =>
                            current.map((l) =>
                              l.key === line.key ? { ...l, qty: e.target.value } : l,
                            ),
                          )
                        }
                      />
                    </Field>
                    <Field
                      label={
                        perKilo
                          ? mode === 'purchase'
                            ? t('record.field.costPerKilo')
                            : t('record.field.pricePerKilo')
                          : mode === 'purchase'
                            ? t('record.field.unitCost')
                            : t('record.field.unitPrice')
                      }
                      hint={
                        perKilo && typed > 0 && sku && unitPriceDrifts(sku.baseUnit, typed)
                          ? t('record.priceRecording', {
                              amount: formatPHP(sku ? pricePerDisplayUnit(sku.baseUnit, pricePerBaseUnit(sku.baseUnit, typed)) : typed),
                            })
                          : undefined
                      }
                      /* Prices in the unit the item is sold in: rice is ₱72 a
                         kilo, and asking for the price of one GRAM is how a
                         2-kilo sale once became ₱144,000. */
                    >
                      <input
                        className={inputClass}
                        type="number"
                        inputMode="decimal"
                        step="any"
                        placeholder="0.00"
                        value={line.price}
                        onChange={(e) =>
                          setLines((current) =>
                            current.map((l) =>
                              l.key === line.key ? { ...l, price: e.target.value } : l,
                            ),
                          )
                        }
                      />
                    </Field>
                  </div>
                  {lines.length > 1 ? (
                    <button
                      type="button"
                      className="mt-3 inline-flex min-h-11 items-center text-[0.875rem] font-semibold text-red-700"
                      onClick={() =>
                        setLines((current) => current.filter((l) => l.key !== line.key))
                      }
                    >
                      {t('record.remove')}
                    </button>
                  ) : null}
                </div>
              )
            })}

            <Button
              variant="ghost"
              className="w-full"
              onClick={() =>
                setLines((current) => [
                  ...current,
                  { key: String(Date.now() + current.length), skuId: '', qty: '1', price: '' },
                ])
              }
            >
              {t('record.addItem')}
            </Button>

            {/* Where an item that is not on the list gets added. Without this
                the picker is a closed set of ten seeded products and there is
                no way out of it from the screen that needs one. */}
            {onOpenItems ? (
              <button
                type="button"
                onClick={onOpenItems}
                className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full text-[0.875rem] font-bold text-brand-700 transition active:scale-[0.99]"
              >
                {t('items.manage')}
                <span aria-hidden>→</span>
              </button>
            ) : null}

            {mode === 'credit_sale' || mode === 'purchase' ? (
              <Field
                label={t('record.field.customer')}
                hint={mode === 'purchase' ? t('record.field.notNeeded') : undefined}
              >
                <CustomSelect
                  value={customerId}
                  onChange={(val) => setCustomerId(val)}
                  /* "Choose…", not "Walk-in": utang now requires a name, and a
                     placeholder that reads like a default was what let a
                     nameless debt through in the first place. */
                  placeholder={
                    mode === 'purchase' ? t('record.walkIn') : t('record.select')
                  }
                  options={ledger.customers.map((c) => ({ value: c.id, label: c.name }))}
                  disabled={mode === 'purchase'}
                />
              </Field>
            ) : null}

            {/* Utang is the one mode whose value is not in the single record but
                in the running list of who owes what, so the list is one tap
                away from the form that creates a debt. */}
            {mode === 'credit_sale' && onOpenUtang ? (
              <button
                type="button"
                onClick={onOpenUtang}
                className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full text-[0.875rem] font-bold text-brand-700 transition active:scale-[0.99]"
              >
                {t('app.utangList')}
                <span aria-hidden>→</span>
              </button>
            ) : null}

            {mode === 'purchase' ? (
              <label className="flex min-h-11 items-center gap-3 text-[0.9375rem] leading-relaxed text-fg-muted">
                <input
                  type="checkbox"
                  checked={onCredit}
                  onChange={(e) => setOnCredit(e.target.checked)}
                  className="h-5 w-5 shrink-0 accent-brand-700"
                />
                {t('record.supplierCredit')}
              </label>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3.5">
            <Field label={t('record.field.amount')}>
              <input
                className={inputClass}
                type="number"
                inputMode="decimal"
                step="any"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            {mode === 'payment_received' ? (
              <Field label={t('record.field.customer')}>
                <CustomSelect
                  value={customerId}
                  onChange={(val) => setCustomerId(val)}
                  placeholder={t('record.select')}
                  options={ledger.customers.map((c) => ({
                    value: c.id,
                    label: `${c.name} — ${formatPHP(negosyo.twin.receivables[c.id] ?? 0)}`,
                  }))}
                />
              </Field>
            ) : null}
            {mode === 'expense' ? (
              <label className="flex min-h-11 items-center gap-3 text-[0.9375rem] leading-relaxed text-fg-muted">
                <input
                  type="checkbox"
                  checked={onCredit}
                  onChange={(e) => setOnCredit(e.target.checked)}
                  className="h-5 w-5 shrink-0 accent-brand-700"
                />
                {t('record.creditLater')}
              </label>
            ) : null}
          </div>
        )}

        {/* A wrapper, not a bare handler: React passes the click event as the first argument, and post reads that slot as the oversell-gate bypass. */}
        <Button className="mt-4 w-full" onClick={() => post()}>
          {t('record.submit')}
        </Button>

        {/*
         * The confirmation. It is the app answering the owner rather than counting
         * for her, so it is set in the second voice (`.aside`: same family, one
         * step down in weight) on a brand-tinted panel — a filled shape is how a
         * modern surface says "this is a message, not another field".
         */}
        {flash ? (
          <div className="mt-4 flex items-center gap-2.5 rounded-2xl border border-brand-500/30 bg-gradient-to-r from-brand-50/90 to-brand-100/50 px-4 py-3.5 text-[0.9375rem] font-bold text-brand-800 shadow-xs backdrop-blur-md">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white text-[0.75rem]">✓</span>
            <p className="aside leading-relaxed">{flash}</p>
          </div>
        ) : null}
      </Card>
      </div>
      ) : null}

      {section === 'history' ? (
      <Card>
        <SectionTitle hint={`${ledger.transactions.length}`}>{t('record.recentTitle')}</SectionTitle>
        {/* History controls: search does the finding, the chips do the narrowing.
            One control per job, the way GCash/Maya/Copilot all split it. */}
        <div className="mb-3 space-y-2.5">
          <input
            className={inputClass}
            type="search"
            value={query}
            placeholder={t('record.filter.search')}
            aria-label={t('record.filter.search')}
            onChange={(e) => changeQuery(e.target.value)}
          />
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1" role="group" aria-label={t('record.filter.label')}>
            <Chip active={range === 'today'} onClick={() => changeRange('today')}>
              {t('record.filter.today')}
            </Chip>
            <Chip active={range === 'week'} onClick={() => changeRange('week')}>
              {t('record.filter.week')}
            </Chip>
            <Chip active={range === 'all'} onClick={() => changeRange('all')}>
              {t('record.filter.all')}
            </Chip>
            <span aria-hidden className="mx-1 h-5 w-px self-center bg-line" />
            <Chip active={direction === 'in'} onClick={() => changeDirection(direction === 'in' ? 'all' : 'in')}>
              {t('record.filter.in')}
            </Chip>
            <Chip active={direction === 'out'} onClick={() => changeDirection(direction === 'out' ? 'all' : 'out')}>
              {t('record.filter.out')}
            </Chip>
            {filtersNarrowed ? (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex min-h-11 items-center px-2 text-[0.8125rem] font-bold text-brand-700"
              >
                × {t('record.filter.clear')}
              </button>
            ) : null}
          </div>
        </div>
        <ul className="space-y-1">
          {visible.map((txn, index) => {
              const showDay = index === 0 || dayOf(txn) !== dayOf(visible[index - 1])
              const direction = txnDirection(txn)
              const expanded = expandedId === txn.id
              // Only resolved for the row that is actually open: naming ten
              // thousand records on every render to show one of them is work the
              // phone does not need to do.
              const detailLines = expanded ? displayLines(txn, ledger) : null
              const centavos = txnTotalCentavos(txn)
              const amount =
                centavos !== 0
                  ? `${direction === 'in' ? '+' : direction === 'out' ? '−' : ''}${formatPHP(Math.abs(centavos))}`
                  : ''
              return (
                <li
                  key={txn.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line/50 py-3 last:border-b-0 transition-colors hover:bg-white/40 rounded-xl px-1.5"
                >
                  {showDay ? (
                    <div className="eyebrow w-full text-fg-faint mb-1">{dayOf(txn)}</div>
                  ) : null}
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border shadow-xs ${
                      direction === 'in'
                        ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700'
                        : direction === 'out'
                          ? 'border-red-500/25 bg-red-500/10 text-red-700'
                          : 'border-line bg-sunken text-fg-subtle'
                    }`}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-3.5 w-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path
                        d={
                          direction === 'in'
                            ? 'M12 5v14M6 13l6 6 6-6'
                            : direction === 'out'
                              ? 'M12 19V5M6 11l6-6 6 6'
                              : 'M4 12h16'
                        }
                      />
                    </svg>
                  </span>
                  {/* `min-w-[8rem]` is what decides the stack: the description asks for at
                      least 128px, so when it, the amount and the button cannot all fit,
                      the other two move to the next line. Nothing on this row is
                      truncated any more — "Sale — 4 pieces" and "Paid the supplier"
                      were both being cut to an ellipsis on a phone. */}
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : txn.id)}
                    aria-expanded={expanded}
                    className="min-w-[8rem] flex-1 text-left"
                  >
                    <div className="text-[0.9375rem] leading-snug font-semibold text-fg">
                      {describe(txn, ledger, lang)}
                      {/* A small mic glyph marks anything that came in by voice, in
                          either language — the note itself is the owner's own
                          words and is never translated. */}
                      {txn.source === 'voice' ? (
                        <span className="ml-1.5 text-[0.8125rem] font-bold text-brand-700 align-middle">
                          {t('record.voiceBadge')}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="num text-[0.8125rem] text-fg-faint">
                        {clockTime(new Date(txn.at))}
                      </span>
                      <span aria-hidden className="text-[0.75rem] text-fg-faint">
                        {expanded ? '▴' : '▾'}
                      </span>
                    </div>
                  </button>
                  {/* The money column. The amount and the void key travel together on
                      the right, so every row ends at the same edge — which is what
                      makes a column of figures line up without a table around it. */}
                  <div className="ml-auto flex shrink-0 items-center gap-1.5">
                    {amount ? (
                      /* `whitespace-nowrap` for the same reason `.figure-*` carries
                         it: a peso amount broken across two lines prints a number a
                         hundred times smaller than the real one. The row wraps
                         around the figure instead. */
                      <span
                        className={`num whitespace-nowrap text-right text-[clamp(0.9375rem,4.2vw,1.0625rem)] font-bold ${
                          direction === 'in'
                            ? 'text-emerald-700'
                            : direction === 'out'
                              ? 'text-fg'
                              : 'text-fg-subtle'
                        }`}
                      >
                        {amount}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      aria-label={t('record.voidAria', { what: describe(txn, ledger, lang) })}
                      onClick={() =>
                        setPendingDelete({ txn, index: ledger.transactions.findIndex((x) => x.id === txn.id) })
                      }
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-fg-faint transition active:bg-red-50 active:text-red-700"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className="h-[1.15rem] w-[1.15rem]"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                      >
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  </div>
                  {/* The receipt behind the row: reference, full date and status live
                      here instead of in the row itself, so the feed stays a feed. */}
                  {expanded ? (
                    <div className="w-full rounded-xl border border-line/70 bg-white/60 px-3.5 py-3 text-[0.8125rem] leading-relaxed text-fg-muted">
                      <div className="num">
                        {dayOf(txn)} · {clockTime(new Date(txn.at))}
                      </div>

                      {/* What was actually bought or sold. Tapping a row used to
                          reveal a reference number and nothing else — the one
                          thing an owner opening their own record wants to check
                          ("was that really five?") was the one thing missing. */}
                      {detailLines ? (
                        <ul className="mt-1.5 space-y-1 border-t border-line/60 pt-1.5">
                          {detailLines.map((line, i) => (
                            <li key={`${line.name}-${i}`} className="flex items-baseline justify-between gap-3">
                              <span className="min-w-0">
                                <span className="num font-semibold text-fg">
                                  {line.unit === 'pc' ? line.qty : `${line.qty} ${line.unit}`}
                                </span>{' '}
                                × {line.name}
                              </span>
                              <span className="num shrink-0 text-right text-fg-faint">
                                {t('record.detail.each', { amount: formatPHP(line.unitPriceCentavos) })}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : null}

                      {/* The reference stays, last and faint: it is provenance, not
                          information — there only for the day someone has to
                          reconcile a record over the phone. */}
                      <div className="mt-1.5 flex items-baseline justify-between gap-2 border-t border-line/60 pt-1.5">
                        <span className="font-bold tracking-wide uppercase text-[0.6875rem] text-fg-faint">
                          {t('record.detail.support')}
                        </span>
                        <span className="num min-w-0 truncate text-fg-faint">{txn.id}</span>
                      </div>
                    </div>
                  ) : null}
                </li>
              )
            })}
        </ul>
        {filtered.length > visible.length ? (
          <Button variant="ghost" className="mt-3 w-full" onClick={() => setVisibleCount((c) => c + HISTORY_PAGE)}>
            {t('record.loadMore')}
          </Button>
        ) : null}
        {filtered.length > 0 ? (
          <>
            <p className="num mt-3 text-center text-[0.8125rem] text-fg-faint">
              {t('record.showing', { n: visible.length, total: filtered.length })}
            </p>
            {/* A hairline closes the feed before the next card starts, so the last
                row is not left hanging off the end of the surface. */}
            <div className="rule-set mt-3.5" aria-hidden />
          </>
        ) : activeTxns.length === 0 ? (
          <p className="py-4 text-[0.9375rem] leading-relaxed text-fg-faint">
            {t('record.emptyLedger')}
          </p>
        ) : (
          <div className="mt-3">
            <EmptyState
              title={t('record.emptyFilteredTitle')}
              body={t('record.emptyFilteredBody')}
              action={
                <Button variant="ghost" onClick={clearFilters}>
                  {t('record.filter.clear')}
                </Button>
              }
            />
          </div>
        )}
      </Card>
      ) : null}

      {pendingDelete ? (
        <DeleteConfirmDialog
          what={describe(pendingDelete.txn, ledger, lang)}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        />
      ) : null}

      {pendingOversell ? (
        <ConfirmDialog
          title={t('record.oversellTitle')}
          body={`${t('record.oversellBody', {
            qty: pendingOversell.wanted,
            unit: pendingOversell.unit,
            name: pendingOversell.name,
            n: pendingOversell.onHand,
          })} ${t('record.oversellPurchaseHint')}`}
          confirmLabel={t('record.oversellPurchase')}
          cancelLabel={t('record.oversellAnyway')}
          tone="brand"
          onConfirm={recordMissingPurchase}
          onCancel={sellAnyway}
        />
      ) : null}
    </div>
  )
}

/**
 * The delete gate: a centered dialog over a scrim, portalled to <body> so the
 * screen's entrance transform cannot anchor it off-viewport. Two explicit
 * choices, Delete last and dangerous — no swipe, no silent tap.
 */
function DeleteConfirmDialog({
  what,
  onCancel,
  onConfirm,
}: {
  what: string
  onCancel: () => void
  onConfirm: () => void
}) {
  const t = useT()
  // Esc backs out of the delete gate the same as tapping outside it: the
  // record stays, and focus stays where the owner left it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-5 backdrop-blur-sm"
      onClick={onCancel}
      role="alertdialog"
      aria-modal="true"
      aria-label={t('record.deleteTitle')}
    >
      <div
        className="surface w-full max-w-xs rounded-2xl border border-white/80 p-5 shadow-e2"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="headline text-[1.0625rem] leading-snug text-fg">{t('record.deleteTitle')}</h2>
        <p className="mt-1.5 text-[0.875rem] leading-relaxed text-fg-muted">
          {what} · {t('record.deleteBody')}
        </p>
        <div className="mt-4 flex flex-col gap-2.5">
          <Button variant="danger" className="w-full" onClick={onConfirm}>
            {t('record.deleteConfirm')}
          </Button>
          <Button variant="ghost" className="w-full" onClick={onCancel}>
            {t('record.deleteCancel')}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/**
 * What a transaction is worth, across every shape it can take. Line-based
 * transactions carry no total of their own — the engine derives revenue as
 * `qty * unitPriceCentavos` (qty in base units), so this sums the lines the same
 * way rather than inventing a second convention.
 */
function txnTotalCentavos(txn: Transaction): number {
  switch (txn.kind) {
    case 'cash_sale':
    case 'credit_sale':
      return txn.lines.reduce((sum, l) => sum + l.qty * l.unitPriceCentavos, 0)
    case 'purchase':
      return txn.lines.reduce((sum, l) => sum + l.qty * l.unitCostCentavos, 0)
    default:
      return 'amountCentavos' in txn ? txn.amountCentavos : 0
  }
}

/**
 * How many things were sold or bought, in a sentence that is always right.
 *
 * The count used to be the number of *lines*: a sale of three Cokes and five
 * noodles is two lines but eight pieces, and a single-line sale of one Coke read
 * "1 items". It is now the total quantity, with a count word; and when the
 * quantities are fractional (rice by the kilo) there is no honest count word at
 * all, so the row simply says what it is.
 */
function describeCount(
  wholeKey: UIStr,
  looseKey: UIStr,
  lines: { qty: number }[],
  label: (key: UIStr, params?: Params) => string,
): string {
  const total = lines.reduce((sum, line) => sum + line.qty, 0)
  return Number.isInteger(total)
    ? label(wholeKey, { n: total })
    : label(looseKey, { n: total.toFixed(1) })
}

/**
 * One line of a transaction, put back into the numbers the owner typed.
 *
 * Quantities are stored in the SKU's base unit, so 1.5 kg of rice is 1500 in
 * the ledger. Showing that figure back to the owner would be worse than showing
 * nothing, so every read of a line goes through here first.
 */
interface DisplayLine {
  name: string
  qty: number
  unit: string
  unitPriceCentavos: number
}

function displayLines(txn: Transaction, ledger: Negosyo['ledger']): DisplayLine[] | null {
  const lines =
    txn.kind === 'cash_sale' || txn.kind === 'credit_sale'
      ? txn.lines.map((l) => ({ skuId: l.skuId, qty: l.qty, price: l.unitPriceCentavos }))
      : txn.kind === 'purchase'
        ? txn.lines.map((l) => ({ skuId: l.skuId, qty: l.qty, price: l.unitCostCentavos }))
        : null
  if (!lines || lines.length === 0) return null
  const out: DisplayLine[] = []
  for (const line of lines) {
    const sku = ledger.skus.find((s) => s.id === line.skuId)
    // An unknown SKU is not a reason to print an id: the caller falls back to
    // the count phrasing, which is true even when the goods cannot be named.
    if (!sku) return null
    const grams = sku.baseUnit === 'g'
    out.push({
      name: sku.name,
      qty: grams ? displayQty(line.qty / 1000) : line.qty,
      // The display unit ('kg'), never the base unit ('g').
      unit: sku.unit,
      unitPriceCentavos: line.price,
    })
  }
  return out
}

/**
 * Quantities for display, at the precision a hand can type.
 *
 * Storage is exact (grams), which is right; printing `7.532 kg` of rice is not —
 * nobody weighs to the gram, and three decimals makes a simple figure look like
 * a calculation leak. Two decimals is the most a person types (¼ kilo, 1.5, 2.25),
 * so two decimals is exactly as precise as this can be without inventing
 * precision the owner never entered.
 */
function displayQty(qty: number): number {
  return Math.round(qty * 100) / 100
}

/**
 * The row title for a line-based transaction: the goods, in the owner's unit.
 *
 * One line is named outright — "5 × Coke Mismo". Several lines lead with the
 * first and count the rest, because a row is one line tall and the full list is
 * one tap away in the detail underneath.
 */
function describeGoods(
  txn: Transaction,
  ledger: Negosyo['ledger'],
  label: (key: UIStr, params?: Params) => string,
  fallback: () => string,
): string {
  const lines = displayLines(txn, ledger)
  if (!lines) return fallback()
  if (lines.length > 1) return label('record.row.items', { item: lines[0].name, n: lines.length - 1 })
  const only = lines[0]
  return only.unit === 'pc'
    ? label('record.row.item', { n: only.qty, item: only.name })
    : label('record.row.itemWeighed', { item: only.name, qty: only.qty, unit: only.unit })
}

/**
 * Exported for its test: every row title in the ledger comes from here, and a
 * row that names the wrong goods is a worse bug than a row that names none.
 */
export function describe(txn: Transaction, ledger: Negosyo['ledger'], lang: Lang): string {
  // A local binding, because this runs outside React and cannot use the hook.
  const label = (key: UIStr, params?: Params) => tr(lang, UI, key, params)
  switch (txn.kind) {
    case 'cash_sale':
      // The goods, then the count: the fallback only appears for a record whose
      // item is no longer in the book.
      return describeGoods(txn, ledger, label, () =>
        describeCount('record.row.sale', 'record.row.saleLoose', txn.lines, label),
      )
    case 'credit_sale':
      /*
       * For utang the *person* is the headline, not the goods: the whole point
       * of the row is who owes you, and "2 × Bigas" does not answer that. The
       * sentence list lives in the detail below.
       *
       * `walk_in` has no customer record to look up, and printing the raw id
       * put the string "walk_in" in the middle of an owner's Tagalog ledger.
       */
      return label('record.row.credit', {
        name: ledger.customers.find((c) => c.id === txn.customerId)?.name ?? label('record.walkIn'),
      })
    case 'purchase':
      return describeGoods(txn, ledger, label, () =>
        describeCount('record.row.purchase', 'record.row.purchaseLoose', txn.lines, label),
      )
    // Amounts live in their own right-aligned column, so these labels stay
    // labels. Repeating the figure twice on one row was pure noise.
    case 'expense':
      return label('record.kind.expense')
    case 'payment_received': {
      // "Paid by Aling Nena", not a bare "Payment": in a column of rows that all
      // say Payment, the name is the only thing that distinguishes them.
      const customer = ledger.customers.find((c) => c.id === txn.customerId)
      return customer
        ? label('record.row.payment', { name: customer.name })
        : label('record.kind.payment')
    }
    case 'capital_injection':
      return label('record.kind.capital')
    case 'owner_withdrawal':
      return label('record.kind.withdrawal')
    case 'fixed_asset_purchase':
      return label('record.kind.fixedAsset')
    case 'payable_payment':
      return label('record.kind.supplierPayment')
    case 'stock_adjustment':
      return label('record.row.stockAdjustment', { qty: txn.qtyDelta })
    default:
      return label('record.kind.other')
  }
}
