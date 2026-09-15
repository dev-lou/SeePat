import { useState } from 'react'
import { Button, Card, Chip, Field, SectionTitle, inputClass } from './components.tsx'
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
  const { ledger, add } = negosyo
  const lang = useLang()
  const t = useT()
  const [mode, setMode] = useState<Mode>('cash_sale')
  const [lines, setLines] = useState<LineDraft[]>([{ key: '1', skuId: '', qty: '1', price: '' }])
  const [amount, setAmount] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [onCredit, setOnCredit] = useState(false)
  const [flash, setFlash] = useState('')

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
        setFlash(t('record.flash.needItems'))
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
        setFlash(
          onCredit
            ? t('record.flash.purchaseCredit', { amount: formatPHP(total) })
            : t('record.flash.purchase', { amount: formatPHP(total) }),
        )
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
        add({
          id: newTxnId('utang'),
          at,
          kind: 'credit_sale',
          lines: saleLines,
          customerId: customerId || 'walk_in',
        })
        setFlash(t('record.flash.credit', { amount: formatPHP(total) }))
      } else {
        add({ id: newTxnId('sal'), at, kind: 'cash_sale', lines: saleLines })
        setFlash(t('record.flash.sale', { amount: formatPHP(total) }))
      }
      reset()
      return
    }

    const value = pesos(Number(amount))
    if (value <= 0) {
      setFlash(t('record.flash.needAmount'))
      return
    }

    switch (mode) {
      case 'expense': {
        add({
          id: newTxnId('exp'),
          at,
          kind: 'expense',
          amountCentavos: value,
          paid: onCredit ? 'credit' : 'cash',
        })
        setFlash(t('record.flash.expense', { amount: formatPHP(value) }))
        break
      }
      case 'payment_received': {
        if (!customerId) {
          setFlash(t('record.flash.needCustomer'))
          return
        }
        add({
          id: newTxnId('pay'),
          at,
          kind: 'payment_received',
          customerId,
          amountCentavos: value,
        })
        setFlash(t('record.flash.payment', { amount: formatPHP(value) }))
        break
      }
      case 'capital_injection': {
        add({ id: newTxnId('cap'), at, kind: 'capital_injection', amountCentavos: value })
        setFlash(t('record.flash.capital', { amount: formatPHP(value) }))
        break
      }
      case 'owner_withdrawal': {
        add({ id: newTxnId('wdr'), at, kind: 'owner_withdrawal', amountCentavos: value })
        setFlash(t('record.flash.withdrawal', { amount: formatPHP(value) }))
        break
      }
      default:
        break
    }
    reset()
  }

  return (
    <div className="space-y-4">
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
        {MODES.map((m) => (
          <Chip key={m.id} active={mode === m.id} onClick={() => setMode(m.id)}>
            {t(m.labelKey)}
          </Chip>
        ))}
      </div>

      <Card>
        <SectionTitle>{t(MODES.find((m) => m.id === mode)?.labelKey ?? 'record.mode.cash_sale')}</SectionTitle>

        {isLineMode ? (
          <div className="space-y-3">
            {lines.map((line) => {
              const sku = ledger.skus.find((s) => s.id === line.skuId)
              return (
                <div key={line.key} className="rounded-2xl border border-line bg-sunken p-3">
                  <Field label={t('record.field.item')}>
                    <select
                      className={inputClass}
                      value={line.skuId}
                      onChange={(e) => pickSku(line.key, e.target.value)}
                    >
                      <option value="">{t('record.select')}</option>
                      {ledger.skus.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="mt-2 grid grid-cols-2 gap-3">
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
                      className="mt-2 text-[0.7rem] text-red-700"
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
                <select
                  className={inputClass}
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  disabled={mode === 'purchase'}
                >
                  <option value="">{t('record.walkIn')}</option>
                  {ledger.customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}

            {mode === 'purchase' ? (
              <label className="flex items-center gap-2 text-xs text-fg-muted">
                <input
                  type="checkbox"
                  checked={onCredit}
                  onChange={(e) => setOnCredit(e.target.checked)}
                  className="h-4 w-4 accent-brand-700"
                />
                {t('record.supplierCredit')}
              </label>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
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
                <select
                  className={inputClass}
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                >
                  <option value="">{t('record.select')}</option>
                  {ledger.customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — {formatPHP(negosyo.twin.receivables[c.id] ?? 0)}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            {mode === 'expense' ? (
              <label className="flex items-center gap-2 text-xs text-fg-muted">
                <input
                  type="checkbox"
                  checked={onCredit}
                  onChange={(e) => setOnCredit(e.target.checked)}
                  className="h-4 w-4 accent-brand-700"
                />
                {t('record.creditLater')}
              </label>
            ) : null}
          </div>
        )}

        <Button className="mt-4 w-full" onClick={post}>
          {t('record.submit')}
        </Button>

        {flash ? <p className="mt-3 text-xs text-brand-700">{flash}</p> : null}
      </Card>

      <Card>
        <SectionTitle hint={`${ledger.transactions.length}`}>{t('record.recentTitle')}</SectionTitle>
        <ul>
          {[...ledger.transactions]
            .reverse()
            .slice(0, 6)
            .map((txn) => {
              const isVoid = ledger.voids.some((v) => v.txnId === txn.id)
              // Direction is only claimed where it is unambiguous. A credit sale
              // or a purchase on terms moves no cash, so those rows show no sign
              // rather than a +/− the ledger would not support.
              const direction =
                txn.kind === 'cash_sale' ||
                txn.kind === 'payment_received' ||
                txn.kind === 'capital_injection'
                  ? 'in'
                  : txn.kind === 'expense' ||
                      txn.kind === 'owner_withdrawal' ||
                      txn.kind === 'fixed_asset_purchase' ||
                      txn.kind === 'payable_payment'
                    ? 'out'
                    : 'neutral'
              const centavos = txnTotalCentavos(txn)
              const amount =
                centavos !== 0
                  ? `${direction === 'in' ? '+' : direction === 'out' ? '−' : ''}${formatPHP(Math.abs(centavos))}`
                  : ''
              return (
                <li
                  key={txn.id}
                  className={`flex items-center gap-3 border-b border-line py-2.5 last:border-b-0 ${
                    isVoid ? 'opacity-50' : ''
                  }`}
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                      direction === 'in'
                        ? 'bg-emerald-50 text-emerald-700'
                        : direction === 'out'
                          ? 'bg-red-50 text-red-700'
                          : 'bg-sunken text-fg-subtle'
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
                  <div className="min-w-0 flex-1">
                    <div
                      className={`truncate text-[0.78rem] font-semibold ${
                        isVoid ? 'text-fg-faint line-through' : 'text-fg'
                      }`}
                    >
                      {describe(txn, ledger, lang)}
                      {/* A small mic glyph marks anything that came in by voice, in
                          either language — the note itself is the owner's own
                          words and is never translated. */}
                      {txn.source === 'voice' ? (
                        <span className="ml-1.5 text-[0.6rem] font-bold text-brand-700 align-middle">
                          {t('record.voiceBadge')}
                        </span>
                      ) : null}
                    </div>
                    <div className="num mt-0.5 text-[0.64rem] text-fg-faint">
                      {dayMonth(new Date(txn.at), lang)} {clockTime(new Date(txn.at))}
                      {isVoid ? ' · VOID' : ''}
                    </div>
                  </div>
                  {amount ? (
                    <span
                      className={`num shrink-0 text-[0.78rem] font-bold ${
                        isVoid
                          ? 'text-fg-faint line-through'
                          : direction === 'in'
                            ? 'text-emerald-700'
                            : direction === 'out'
                              ? 'text-fg'
                              : 'text-fg-subtle'
                      }`}
                    >
                      {amount}
                    </span>
                  ) : null}
                  {isVoid ? null : (
                    <button
                      type="button"
                      aria-label={t('record.voidAria', { what: describe(txn, ledger, lang) })}
                      onClick={() => negosyo.voidTransaction(txn.id)}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-fg-faint transition active:bg-red-50 active:text-red-700"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className="h-3.5 w-3.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                      >
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  )}
                </li>
              )
            })}
        </ul>
        {ledger.transactions.length === 0 ? (
          <p className="py-3 text-xs text-fg-faint">{t('record.emptyLedger')}</p>
        ) : null}
      </Card>
    </div>
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

function describe(txn: Transaction, ledger: Negosyo['ledger'], lang: Lang): string {
  // A local binding, because this runs outside React and cannot use the hook.
  const label = (key: UIStr, params?: Params) => tr(lang, UI, key, params)
  switch (txn.kind) {
    case 'cash_sale':
      return label('record.row.sale', { n: txn.lines.length })
    case 'credit_sale':
      return label('record.row.credit', {
        name: ledger.customers.find((c) => c.id === txn.customerId)?.name ?? txn.customerId,
      })
    case 'purchase':
      return label('record.row.purchase', { n: txn.lines.length })
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
