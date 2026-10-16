import { useState } from 'react'
import {
  Button,
  Card,
  EmptyState,
  Field,
  PrintSheet,
  SectionTitle,
  Sheet,
  inputClass,
} from './components.tsx'
import { formatPHP, pesos } from '../engine/index.ts'
import { newTxnId } from '../store.ts'
import type { Ledger } from '../engine/index.ts'
import type { Negosyo } from '../store.ts'
import { useToast } from './Toast.tsx'
import { useLang, useT } from '../i18n/index.ts'
import { ageText, buildUtangStatement, readShopName, writeShopName } from '../statement.ts'

/**
 * The utang book — who owes you, and how long they have owed it.
 *
 * Why this screen exists at all: this is the single most-wanted view in a
 * sari-sari. The notebook under the counter is a list of names with amounts, the
 * engine has always computed exactly that (`twin.receivables`), and until now
 * the only way to see it was to type a question into the Ask box. "Collect
 * first — ₱4,158.65 of utang is still unpaid" is the app's own headline advice,
 * and it was advice nobody could act on.
 *
 * The distinction this screen teaches (in `utang.semanticsBody`) is the one
 * every owner gets wrong: utang IS a sale, so it counts in Sales and in profit —
 * the goods left the shelf and the earnings are real. What it is not is cash.
 * Subtracting it from sales would understate the business; counting it as cash
 * would overstate the drawer. It is a third thing, and it gets its own list.
 */

export interface UtangRow {
  id: string
  name: string
  amountCentavos: number
  /** ISO date of the oldest credit sale still not settled, null when none is open. */
  oldestUnpaidAt: string | null
  /** Whole days between `oldestUnpaidAt` and today. */
  daysOldest: number | null
  /** ISO date of their most recent payment, null when they have never paid. */
  lastPaidAt: string | null
}

const DAY_MS = 86_400_000

function creditTotal(lines: { qty: number; unitPriceCentavos: number }[]): number {
  return lines.reduce((sum, line) => sum + line.qty * line.unitPriceCentavos, 0)
}

/**
 * Pure: the ledger and the engine's own receivable map in, rows out.
 *
 * Aging is a FIFO walk rather than a stored field, because a stored "oldest
 * unpaid date" would be a second source of truth for the same number — and the
 * ledger is a fold, so every derived figure is recomputed from it. A payment
 * settles the oldest credit first, which is what a notebook does when the owner
 * crosses out the top line.
 *
 * `voids` are skipped: a voided record is not money.
 */
export function utangRows(
  ledger: Ledger,
  receivables: Record<string, number>,
  walkInName = 'Walk-in',
): UtangRow[] {
  const voided = new Set(ledger.voids.map((record) => record.txnId))
  const names = new Map(ledger.customers.map((customer) => [customer.id, customer.name]))
  const byCustomer = new Map<string, { at: string; kind: 'credit_sale' | 'payment_received'; amount: number }[]>()

  for (const txn of ledger.transactions) {
    if (voided.has(txn.id)) continue
    if (txn.kind !== 'credit_sale' && txn.kind !== 'payment_received') continue
    const rows = byCustomer.get(txn.customerId) ?? []
    rows.push({
      at: txn.at,
      kind: txn.kind,
      amount: txn.kind === 'credit_sale' ? creditTotal(txn.lines) : txn.amountCentavos,
    })
    byCustomer.set(txn.customerId, rows)
  }

  const today = Date.now()
  const out: UtangRow[] = []

  for (const [id, owed] of Object.entries(receivables)) {
    // A negative balance means they paid more than they took. That is a refund
    // problem, not an utang, and a "Payment" button on it would be a lie.
    if (owed <= 0) continue

    const history = (byCustomer.get(id) ?? []).slice().sort((a, b) => a.at.localeCompare(b.at))
    const open: { at: string; remaining: number }[] = []
    let lastPaidAt: string | null = null

    for (const entry of history) {
      if (entry.kind === 'credit_sale') {
        open.push({ at: entry.at, remaining: entry.amount })
        continue
      }
      lastPaidAt = entry.at
      let paying = entry.amount
      while (paying > 0 && open.length > 0) {
        const head = open[0]
        const taken = Math.min(head.remaining, paying)
        head.remaining -= taken
        paying -= taken
        if (head.remaining <= 0) open.shift()
      }
    }

    const oldestUnpaidAt = open.length > 0 ? open[0].at : null
    out.push({
      id,
      name: names.get(id) ?? walkInName,
      amountCentavos: owed,
      oldestUnpaidAt,
      daysOldest:
        oldestUnpaidAt === null
          ? null
          : Math.max(0, Math.floor((today - new Date(oldestUnpaidAt).getTime()) / DAY_MS)),
      lastPaidAt,
    })
  }

  // Biggest debt first: the list is a collection order, not an address book.
  return out.sort((a, b) => b.amountCentavos - a.amountCentavos || a.name.localeCompare(b.name))
}

/** Pesos as plain digits, for a message body — no ₱, no thousands separator. */
function plainAmount(centavos: number): string {
  return (centavos / 100).toFixed(2)
}

/**
 * The statement as it appears on paper, behind `PrintSheet`.
 *
 * Same rows, same wording and same total as the message that gets sent — one
 * builder fills both, so the paper and the chat cannot disagree. What changes is
 * the layout: numbered lines a collector can tick off, the total on its own rule
 * at the foot, and the "not a BIR official receipt" line printed on the sheet
 * itself rather than only spoken about in a document.
 */
function StatementSheet({ statement }: { statement: ReturnType<typeof buildUtangStatement> }) {
  return (
    <PrintSheet>
      <section className="print-sheet print-sheet-body" aria-hidden>
        <h1 className="print-shop">{statement.title}</h1>
        <p className="print-meta">
          {statement.asOfLabel}: {statement.asOfText}
        </p>
        <table className="print-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">{statement.nameLabel}</th>
              <th scope="col" className="print-num">
                {statement.amountLabel}
              </th>
            </tr>
          </thead>
          <tbody>
            {statement.lines.map((line) => (
              <tr key={line.index}>
                <td className="print-num">{line.index}</td>
                <td>
                  <span className="print-name">{line.name}</span>
                  <span className="print-age">{line.age}</span>
                </td>
                <td className="print-num print-amount">{line.amountText}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td />
              <td>{statement.countLabel}</td>
              <td className="print-num print-amount">{statement.totalText}</td>
            </tr>
          </tfoot>
        </table>
        {/* On the paper itself, in both languages: this is the shop's own
            record, and the one thing it must never be mistaken for is a BIR
            receipt. */}
        <p className="print-note">{statement.note}</p>
      </section>
    </PrintSheet>
  )
}

export function UtangScreen({
  negosyo,
  onOpenLedger,
}: {
  negosyo: Negosyo
  onOpenLedger: () => void
}) {
  const t = useT()
  const lang = useLang()
  const toast = useToast()
  const rows = utangRows(negosyo.ledger, negosyo.twin.receivables, t('utang.walkInName'))
  const total = rows.reduce((sum, row) => sum + row.amountCentavos, 0)

  const [paying, setPaying] = useState<UtangRow | null>(null)
  const [payValue, setPayValue] = useState('')
  const [reminding, setReminding] = useState<UtangRow | null>(null)
  const [customersOpen, setCustomersOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [statementOpen, setStatementOpen] = useState(false)
  const [shopName, setShopName] = useState(() => readShopName())

  const statement = buildUtangStatement({
    rows,
    totalCentavos: total,
    asOf: negosyo.now,
    lang,
    shopName,
  })

  function openPay(row: UtangRow) {
    setPaying(row)
    // Prefilled with what is owed: the common case is "they paid it all", and a
    // prefilled field is one tap where an empty one is a keyboard.
    setPayValue(plainAmount(row.amountCentavos))
  }

  function recordPayment() {
    if (!paying) return
    const value = pesos(Number(payValue))
    if (!(value > 0)) {
      toast.show({ title: t('utang.payNeedAmount'), tone: 'warn' })
      return
    }
    const txn = {
      id: newTxnId('pay'),
      at: new Date().toISOString(),
      kind: 'payment_received' as const,
      customerId: paying.id,
      amountCentavos: value,
    }
    negosyo.add(txn)
    const name = paying.name
    setPaying(null)
    toast.show({
      title: t('utang.paid', { amount: formatPHP(value), name }),
      tone: 'success',
      undoLabel: t('backup.undo'),
      onUndo: () => {
        negosyo.removeTransaction(txn.id)
        toast.show({ title: t('record.deleteUndone'), tone: 'info' })
      },
    })
  }

  function saveCustomer() {
    const name = newName.trim()
    if (!name) {
      toast.show({ title: t('utang.customerNeedName'), tone: 'warn' })
      return
    }
    const taken = negosyo.ledger.customers.some(
      (customer) => customer.name.trim().toLowerCase() === name.toLowerCase(),
    )
    if (taken) {
      toast.show({ title: t('utang.customerTaken'), tone: 'warn' })
      return
    }
    negosyo.addCustomer({ name })
    setNewName('')
    toast.show({ title: t('utang.customerAdded', { name }), tone: 'success' })
  }

  function saveRename() {
    if (!editing) return
    const name = editing.name.trim()
    if (!name) {
      toast.show({ title: t('utang.customerNeedName'), tone: 'warn' })
      return
    }
    negosyo.updateCustomer(editing.id, { name })
    setEditing(null)
    toast.show({ title: t('utang.customerSaved'), tone: 'success' })
  }

  // One source of truth for the age wording: the screen, the shared message and
  // the printed sheet all read the same function in `statement.ts`.
  function ageLine(row: UtangRow): string {
    return ageText(row, lang)
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.show({ title: t('utang.remindCopied'), tone: 'success' })
    } catch {
      // A browser that refuses the clipboard still has the message on screen,
      // and the toast tells the owner what to do with it.
      toast.show({ title: t('utang.remindCopied'), tone: 'warn' })
    }
  }

  async function sendText(text: string) {
    // Typed locally rather than through lib.dom's optional member: `share` is
    // genuinely absent on desktop browsers, and a cancelled share sheet is not
    // an error — it is the owner changing their mind.
    const nav = navigator as Navigator & { share?: (data: { text: string }) => Promise<void> }
    if (nav.share) {
      try {
        await nav.share({ text })
        return
      } catch {
        return
      }
    }
    await copyText(text)
  }

  const reminderText = reminding
    ? t('utang.remindBody', { name: reminding.name, amount: plainAmount(reminding.amountCentavos) })
    : ''

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle hint={t('utang.hint')}>{t('utang.title')}</SectionTitle>

        {rows.length === 0 ? (
          <EmptyState title={t('utang.none')} body={t('utang.noneBody')} />
        ) : (
          <>
            <div className="money-cell flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="eyebrow text-fg-subtle">{t('utang.total')}</span>
              <span className="figure-lg num leading-none text-red-700">{formatPHP(total)}</span>
            </div>
            <p className="mt-1 text-[0.8125rem] text-fg-faint">{t('utang.people', { n: rows.length })}</p>

            <ul className="mt-3.5 divide-y divide-line border-t border-line">
              {rows.map((row) => (
                <li key={row.id} className="py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => setEditing({ id: row.id, name: row.name })}
                        className="text-left text-[0.9375rem] leading-snug font-semibold text-fg"
                      >
                        {row.name}
                      </button>
                      <div className="num mt-0.5 text-[0.8125rem] leading-snug text-fg-faint">
                        {ageLine(row)}
                      </div>
                    </div>
                    <span className="num shrink-0 text-right text-[1.0625rem] font-bold whitespace-nowrap text-red-700">
                      {formatPHP(row.amountCentavos)}
                    </span>
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <Button variant="brand" className="min-h-11 flex-1" onClick={() => openPay(row)}>
                      {t('utang.pay')}
                    </Button>
                    <Button variant="ghost" className="min-h-11 flex-1" onClick={() => setReminding(row)}>
                      {t('utang.remind')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        <Button variant="ghost" className="mt-3.5 w-full" onClick={() => setCustomersOpen(true)}>
          {t('utang.newCustomer')}
        </Button>
        <Button variant="ghost" className="mt-2.5 w-full" onClick={onOpenLedger}>
          {t('utang.openLedger')}
        </Button>
      </Card>

      {/*
       * The list, out of the phone.
       *
       * Every other feature on this screen works on one customer at a time, and
       * the biggest unpaid balance — the number the dashboard already nags about
       * — could not be acted on at all: no sheet to hand to whoever walks the
       * barangay, nothing to send to a cooperative. This is the same data, in the
       * two forms a collection actually happens in: a message, and paper.
       */}
      {rows.length > 0 ? (
        <Card material="inset">
          <SectionTitle>{t('utang.statement')}</SectionTitle>
          <p className="text-[0.875rem] leading-relaxed text-fg-subtle">
            {t('utang.statementHint')}
          </p>
          <Button className="mt-3 min-h-12 w-full" onClick={() => setStatementOpen(true)}>
            {t('utang.statementShare')}
          </Button>
        </Card>
      ) : null}

      <StatementSheet statement={statement} />

      {/* The one accounting sentence this app has to get across, on the screen
          where the owner is most likely to believe the opposite. */}
      <Card material="inset">
        <SectionTitle>{t('utang.semanticsTitle')}</SectionTitle>
        <p className="text-[0.875rem] leading-relaxed text-fg-subtle">{t('utang.semanticsBody')}</p>
      </Card>

      {statementOpen ? (
        <Sheet
          title={t('utang.statement')}
          hint={t('utang.statementHint')}
          closeLabel={t('voice.cancel')}
          onClose={() => setStatementOpen(false)}
        >
          <Field label={t('utang.statementShopField')}>
            <input
              className={inputClass}
              type="text"
              autoComplete="off"
              placeholder={t('utang.statementShopPlaceholder')}
              value={shopName}
              onChange={(event) => {
                setShopName(event.target.value)
                // Saved as it is typed: the name belongs to the shop, not to this
                // sheet, and losing it because the owner closed the sheet would
                // mean retyping it for every statement.
                writeShopName(event.target.value)
              }}
            />
          </Field>

          {/* The message exactly as it will be sent — a statement nobody can read
              before sending it is a statement nobody sends twice. */}
          <pre className="mt-3 max-h-56 overflow-auto rounded-2xl border border-line bg-white/70 px-3.5 py-3 font-sans text-[0.8125rem] leading-relaxed whitespace-pre-wrap text-fg">
            {statement.text}
          </pre>

          <Button className="mt-3 min-h-12 w-full" onClick={() => void sendText(statement.text)}>
            {t('utang.statementShare')}
          </Button>
          <Button variant="ghost" className="mt-2.5 min-h-12 w-full" onClick={() => window.print()}>
            {t('utang.statementPrint')}
          </Button>
          <p className="mt-2 text-[0.8125rem] text-fg-faint">{t('utang.statementPrintHint')}</p>
        </Sheet>
      ) : null}

      {paying ? (
        <Sheet
          title={t('utang.payTitle', { name: paying.name })}
          closeLabel={t('voice.cancel')}
          onClose={() => setPaying(null)}
        >
          <Field label={t('utang.payField')}>
            <input
              className={inputClass}
              type="number"
              inputMode="decimal"
              step="any"
              value={payValue}
              onChange={(event) => setPayValue(event.target.value)}
            />
          </Field>
          <Button
            variant="ghost"
            className="mt-3 w-full"
            onClick={() => setPayValue(plainAmount(paying.amountCentavos))}
          >
            {t('utang.payFull', { amount: formatPHP(paying.amountCentavos) })}
          </Button>
          <Button className="mt-2.5 min-h-12 w-full" onClick={recordPayment}>
            {t('utang.payConfirm')}
          </Button>
        </Sheet>
      ) : null}

      {reminding ? (
        <Sheet
          title={t('utang.remindTitle')}
          hint={t('utang.remindHint')}
          closeLabel={t('voice.cancel')}
          onClose={() => setReminding(null)}
        >
          <p className="rounded-2xl border border-line bg-white/70 px-3.5 py-3 text-[0.9375rem] leading-relaxed text-fg">
            {reminderText}
          </p>
          <Button className="mt-3 min-h-12 w-full" onClick={() => void sendText(reminderText)}>
            {t('utang.remindShare')}
          </Button>
          <Button
            variant="ghost"
            className="mt-2.5 min-h-12 w-full"
            onClick={() => void copyText(reminderText)}
          >
            {t('utang.remindCopy')}
          </Button>
        </Sheet>
      ) : null}

      {customersOpen ? (
        <Sheet
          title={t('utang.newCustomer')}
          closeLabel={t('app.close')}
          onClose={() => setCustomersOpen(false)}
        >
          <Field label={t('utang.customerField')}>
            <input
              className={inputClass}
              type="text"
              autoComplete="off"
              placeholder={t('utang.customerPlaceholder')}
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
          </Field>
          <Button className="mt-3 min-h-12 w-full" onClick={saveCustomer}>
            {t('utang.customerSave')}
          </Button>

          {/* The name list, including people who owe nothing: a misspelt name has
              to be fixable somewhere, and it cannot be fixed from the ranked list
              above, which only shows debtors. */}
          {negosyo.ledger.customers.length > 0 ? (
            <ul className="mt-4 divide-y divide-line border-t border-line">
              {negosyo.ledger.customers.map((customer) => {
                const owed = negosyo.twin.receivables[customer.id] ?? 0
                return (
                  <li key={customer.id} className="flex flex-wrap items-center gap-2 py-3">
                    <span className="min-w-0 flex-1 text-[0.9375rem] leading-snug font-semibold text-fg">
                      {customer.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => setEditing({ id: customer.id, name: customer.name })}
                      className="min-h-11 shrink-0 rounded-full border border-line-strong px-3.5 text-[0.8125rem] font-bold text-fg-subtle transition active:translate-y-px"
                    >
                      {t('items.edit')}
                    </button>
                    {owed > 0 ? (
                      // A debt is not deletable. The sentence replaces the button
                      // rather than sitting beside it, so there is nothing to
                      // press that loses money.
                      <p className="num w-full text-[0.8125rem] leading-snug text-red-700">
                        {t('utang.customerOwing', { amount: formatPHP(owed) })}
                      </p>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          negosyo.removeCustomer(customer.id)
                          toast.show({ title: t('items.removed'), tone: 'info' })
                        }}
                        className="min-h-11 shrink-0 rounded-full border border-red-200 px-3.5 text-[0.8125rem] font-bold text-red-700 transition active:translate-y-px"
                      >
                        {t('utang.customerDelete')}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : null}
        </Sheet>
      ) : null}

      {editing ? (
        <Sheet
          title={t('utang.customerField')}
          closeLabel={t('app.close')}
          onClose={() => setEditing(null)}
        >
          <Field label={t('utang.customerField')}>
            <input
              className={inputClass}
              type="text"
              autoComplete="off"
              placeholder={t('utang.customerPlaceholder')}
              value={editing.name}
              onChange={(event) => setEditing({ id: editing.id, name: event.target.value })}
            />
          </Field>
          <Button className="mt-3 min-h-12 w-full" onClick={saveRename}>
            {t('utang.customerSave')}
          </Button>
        </Sheet>
      ) : null}
    </div>
  )
}
