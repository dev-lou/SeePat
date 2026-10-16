import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, Card, Chip, CustomSelect, EmptyState, Field, SectionTitle, inputClass } from './components.tsx'
import { useToast } from './Toast.tsx'
import { formatPHP, pesos, suggestedCost, suggestedPrice } from '../engine/index.ts'
import type { Sku, Transaction } from '../engine/index.ts'
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

export function RecordScreen({ negosyo }: { negosyo: Negosyo }) {
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
  const [flash, setFlash] = useState('')
  // History filters: a store owner reconciles the current shift first, so the
  // feed opens on today rather than on everything ever recorded.
  const [range, setRange] = useState<HistoryRange>('today')
  const [direction, setDirection] = useState<DirectionFilter>('all')
  const [query, setQuery] = useState('')
  const [visibleCount, setVisibleCount] = useState(HISTORY_PAGE)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showMoreModes, setShowMoreModes] = useState(false)
  // Deleting is always gated: the row key arms this, the dialog confirms it,
  // and the toast afterwards still offers undo. No silent deletes.
  const [pendingDelete, setPendingDelete] = useState<{ txn: Transaction; index: number } | null>(null)

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
  }

  function pickSku(key: string, skuId: string) {
    const sku = ledger.skus.find((s) => s.id === skuId)
    const defaultPrice =
      mode === 'purchase'
        ? suggestedCost(ledger, skuId)
        : suggestedPrice(ledger, skuId)
    setLines((current) =>
      current.map((line) =>
        line.key === key
          ? { ...line, skuId, price: defaultPrice > 0 ? String(defaultPrice / 100) : '' }
          : line,
      ),
    )
    void sku
  }

  function post() {
    const at = new Date().toISOString()

    if (isLineMode) {
      const usable = lines.filter((l) => l.skuId && Number(l.qty) > 0 && Number(l.price) > 0)
      if (usable.length === 0) {
        const msg = t('record.flash.needItems')
        setFlash(msg)
        toast.show({ title: msg, tone: 'warn' })
        return
      }

      if (mode === 'purchase') {
        const purchaseLines = usable.map((l) => {
          const sku = ledger.skus.find((s) => s.id === l.skuId)
          return {
            skuId: l.skuId,
            qty: toBaseQty(sku, Number(l.qty)),
            unitCostCentavos: pesos(Number(l.price)),
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
        setFlash(msg)
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
          unitPriceCentavos: pesos(Number(l.price)),
        }
      })
      const total = saleLines.reduce((s, l) => s + l.qty * l.unitPriceCentavos, 0)

      if (mode === 'credit_sale') {
        const txn: Transaction = {
          id: newTxnId('utang'),
          at,
          kind: 'credit_sale',
          lines: saleLines,
          customerId: customerId || 'walk_in',
        }
        add(txn)
        const msg = t('record.flash.credit', { amount: formatPHP(total) })
        setFlash(msg)
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
        const txn: Transaction = { id: newTxnId('sal'), at, kind: 'cash_sale', lines: saleLines }
        add(txn)
        const msg = t('record.flash.sale', { amount: formatPHP(total) })
        setFlash(msg)
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
      toast.show({ title: msg, tone: 'warn' })
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
        setFlash(msg)
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
          toast.show({ title: msg, tone: 'warn' })
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
        setFlash(msg)
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
        setFlash(msg)
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
        setFlash(msg)
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
      {/* The daily three up front, the rest under More: seven chips at once is
          what made this feel like a form to study rather than a till to use. */}
      <div className="px-3.5 pt-2">
        <div className="rounded-2xl bg-white/60 backdrop-blur-md border border-white/80 shadow-xs p-1.5 space-y-1.5">
          <div className="flex flex-wrap gap-1.5">
            {PRIMARY_MODES.map((m) => (
              <Chip key={m.id} active={mode === m.id} onClick={() => setMode(m.id)}>
                {t(m.labelKey)}
              </Chip>
            ))}
            <button
              type="button"
              aria-expanded={showMoreModes || MORE_IDS.includes(mode)}
              onClick={() => setShowMoreModes((v) => !v)}
              className="tag"
            >
              {showMoreModes || MORE_IDS.includes(mode)
                ? t('record.hideModes')
                : t('record.moreModes')}{' '}
              <span aria-hidden>{showMoreModes || MORE_IDS.includes(mode) ? '▴' : '▾'}</span>
            </button>
          </div>
          {showMoreModes || MORE_IDS.includes(mode) ? (
            <div className="flex flex-wrap gap-1.5 border-t border-line/60 pt-1.5">
              {MORE_MODES.map((m) => (
                <Chip key={m.id} active={mode === m.id} onClick={() => setMode(m.id)}>
                  {t(m.labelKey)}
                </Chip>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <Card>
        <SectionTitle>{t(MODES.find((m) => m.id === mode)?.labelKey ?? 'record.mode.cash_sale')}</SectionTitle>

        {isLineMode ? (
          <div className="space-y-3.5">
            {lines.map((line) => {
              const sku = ledger.skus.find((s) => s.id === line.skuId)
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
                        mode === 'purchase' ? t('record.field.unitCost') : t('record.field.unitPrice')
                      }
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

            {mode === 'credit_sale' || mode === 'purchase' ? (
              <Field
                label={t('record.field.customer')}
                hint={mode === 'purchase' ? t('record.field.notNeeded') : undefined}
              >
                <CustomSelect
                  value={customerId}
                  onChange={(val) => setCustomerId(val)}
                  placeholder={t('record.walkIn')}
                  options={ledger.customers.map((c) => ({ value: c.id, label: c.name }))}
                  disabled={mode === 'purchase'}
                />
              </Field>
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

        <Button className="mt-4 w-full" onClick={post}>
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
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('record.filter.label')}>
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
                      <div className="mt-1.5 flex items-baseline justify-between gap-2 border-t border-line/60 pt-1.5">
                        <span className="font-bold tracking-wide uppercase text-[0.6875rem] text-fg-faint">
                          {t('record.detail.ref')}
                        </span>
                        <span className="num min-w-0 truncate">{txn.id}</span>
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

      {pendingDelete ? (
        <DeleteConfirmDialog
          what={describe(pendingDelete.txn, ledger, lang)}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
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

function describe(txn: Transaction, ledger: Negosyo['ledger'], lang: Lang): string {
  // A local binding, because this runs outside React and cannot use the hook.
  const label = (key: UIStr, params?: Params) => tr(lang, UI, key, params)
  switch (txn.kind) {
    case 'cash_sale':
      return describeCount('record.row.sale', 'record.row.saleLoose', txn.lines, label)
    case 'credit_sale':
      return label('record.row.credit', {
        name: ledger.customers.find((c) => c.id === txn.customerId)?.name ?? txn.customerId,
      })
    case 'purchase':
      return describeCount('record.row.purchase', 'record.row.purchaseLoose', txn.lines, label)
    // Amounts live in their own right-aligned column, so these labels stay
    // labels. Repeating the figure twice on one row was pure noise.
    case 'expense':
      return label('record.kind.expense')
    case 'payment_received':
      return label('record.kind.payment')
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
