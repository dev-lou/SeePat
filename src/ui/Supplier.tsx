import { useState } from 'react'
import { Button, Card, EmptyState, Field, SectionTitle, Sheet, inputClass } from './components.tsx'
import { formatPHP, pesos } from '../engine/index.ts'
import { newTxnId } from '../store.ts'
import type { Ledger } from '../engine/index.ts'
import type { Negosyo } from '../store.ts'
import { useToast } from './Toast.tsx'
import { dayMonth, useLang, useT } from '../i18n/index.ts'

/**
 * The supplier side of utang — what the owner still owes, and where that
 * number comes from.
 *
 * Why entries, not suppliers: the ledger never records WHO the supplier is. A
 * purchase records lines, a total and what was paid; a credit expense records
 * an amount; a supplier payment reduces the one pooled balance. So this screen
 * shows the movements that built the dashboard's "Owed to suppliers" total,
 * newest first — every peso of it traceable to a record — instead of inventing
 * per-supplier balances the books cannot support.
 *
 * It also closes a real gap: until now there was no screen in the app that
 * could record a `payable_payment` at all. The dashboard showed the debt; Tala
 * had no mode that settles it.
 */

export type SupplierMovementKind = 'credit_purchase' | 'credit_expense' | 'payment'

export interface SupplierMovement {
  id: string
  at: string
  /**
   * Signed: what was added to the debt (+) or paid back (−). Summing every
   * movement reproduces the engine's own payables balance exactly.
   */
  amountCentavos: number
  kind: SupplierMovementKind
  /** The owner's own words when the record has them, shown verbatim. */
  note?: string
}

/**
 * Pure: the ledger in, the supplier-debt movements out, newest first.
 *
 * A fully-paid purchase adds nothing and is left out; a voided record is not
 * money. The signed sum of what comes out always equals `payablesCentavos`,
 * because these are the same three operations the engine folds.
 */
export function supplierMovements(ledger: Ledger): SupplierMovement[] {
  const voided = new Set(ledger.voids.map((record) => record.txnId))
  const out: SupplierMovement[] = []

  for (const txn of ledger.transactions) {
    if (voided.has(txn.id)) continue
    if (txn.kind === 'purchase') {
      const total = txn.lines.reduce((sum, line) => sum + line.qty * line.unitCostCentavos, 0)
      const unpaid = total - txn.paidCentavos
      if (unpaid > 0) {
        out.push({ id: txn.id, at: txn.at, amountCentavos: unpaid, kind: 'credit_purchase', note: txn.note })
      }
    } else if (txn.kind === 'expense' && txn.paid === 'credit') {
      out.push({ id: txn.id, at: txn.at, amountCentavos: txn.amountCentavos, kind: 'credit_expense', note: txn.note })
    } else if (txn.kind === 'payable_payment') {
      out.push({ id: txn.id, at: txn.at, amountCentavos: -txn.amountCentavos, kind: 'payment', note: txn.note })
    }
  }

  return out.sort((a, b) => b.at.localeCompare(a.at))
}

/** Pesos as plain digits, for the amount field — no ₱, no thousands separator. */
function plainAmount(centavos: number): string {
  return (centavos / 100).toFixed(2)
}

export function SupplierScreen({
  negosyo,
  onOpenLedger,
}: {
  negosyo: Negosyo
  onOpenLedger: () => void
}) {
  const t = useT()
  const lang = useLang()
  const toast = useToast()
  const total = negosyo.derived.totalLiabilitiesCentavos
  const movements = supplierMovements(negosyo.ledger)

  const [payOpen, setPayOpen] = useState(false)
  const [payValue, setPayValue] = useState('')

  function openPay() {
    setPayOpen(true)
    // Prefilled with the whole balance: the common case is "I paid it all",
    // and a prefilled field is one tap where an empty one is a keyboard.
    setPayValue(total > 0 ? plainAmount(total) : '')
  }

  function recordPayment() {
    const value = pesos(Number(payValue))
    if (!(value > 0)) {
      toast.show({ title: t('supplier.payNeedAmount'), tone: 'warn' })
      return
    }
    const txn = {
      id: newTxnId('ppay'),
      at: new Date().toISOString(),
      kind: 'payable_payment' as const,
      amountCentavos: value,
    }
    negosyo.add(txn)
    setPayOpen(false)
    toast.show({
      title: t('supplier.paid', { amount: formatPHP(value) }),
      tone: 'success',
      undoLabel: t('backup.undo'),
      onUndo: () => {
        negosyo.removeTransaction(txn.id)
        toast.show({ title: t('record.deleteUndone'), tone: 'info' })
      },
    })
  }

  function movementLabel(movement: SupplierMovement): string {
    const note = movement.note?.trim()
    if (note) return note
    if (movement.kind === 'payment') return t('supplier.paymentMade')
    if (movement.kind === 'credit_purchase') return t('supplier.creditPurchase')
    return t('supplier.creditExpense')
  }

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle hint={t('supplier.hint')}>{t('supplier.title')}</SectionTitle>

        {movements.length === 0 ? (
          <EmptyState title={t('supplier.none')} body={t('supplier.noneBody')} />
        ) : (
          <>
            <div className="money-cell flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="eyebrow text-fg-subtle">{t('supplier.total')}</span>
              <span className="figure-lg num leading-none text-red-700">{formatPHP(total)}</span>
            </div>

            <ul className="mt-3.5 divide-y divide-line border-t border-line">
              {movements.map((movement) => {
                const isPayment = movement.kind === 'payment'
                return (
                  <li key={movement.id} className="flex items-start justify-between gap-3 py-3.5">
                    <div className="min-w-0 flex-1">
                      <div className="text-[0.9375rem] leading-snug font-semibold text-fg">
                        {movementLabel(movement)}
                      </div>
                      <div className="num mt-0.5 text-[0.8125rem] leading-snug text-fg-faint">
                        {dayMonth(new Date(movement.at), lang)}
                      </div>
                    </div>
                    <span
                      className={`num shrink-0 text-right text-[1.0625rem] font-bold whitespace-nowrap ${
                        isPayment ? 'text-emerald-700' : 'text-red-700'
                      }`}
                    >
                      {isPayment ? '−' : '+'}
                      {formatPHP(Math.abs(movement.amountCentavos))}
                    </span>
                  </li>
                )
              })}
            </ul>
          </>
        )}

        <Button
          variant="brand"
          className="mt-3.5 min-h-12 w-full"
          onClick={openPay}
          disabled={total <= 0}
        >
          {t('supplier.pay')}
        </Button>
        <Button variant="ghost" className="mt-2.5 w-full" onClick={onOpenLedger}>
          {t('supplier.openLedger')}
        </Button>
      </Card>

      {payOpen ? (
        <Sheet
          title={t('supplier.payTitle')}
          closeLabel={t('voice.cancel')}
          onClose={() => setPayOpen(false)}
        >
          <Field label={t('supplier.payField')}>
            <input
              className={inputClass}
              type="number"
              inputMode="decimal"
              step="any"
              value={payValue}
              onChange={(event) => setPayValue(event.target.value)}
            />
          </Field>
          {total > 0 ? (
            <Button variant="ghost" className="mt-3 w-full" onClick={() => setPayValue(plainAmount(total))}>
              {t('supplier.payFull', { amount: formatPHP(total) })}
            </Button>
          ) : null}
          <Button className="mt-2.5 min-h-12 w-full" onClick={recordPayment}>
            {t('supplier.payConfirm')}
          </Button>
        </Sheet>
      ) : null}
    </div>
  )
}
