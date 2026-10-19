import { useState } from 'react'
import {
  Button,
  Card,
  Chip,
  ConfirmDialog,
  CustomSelect,
  EmptyState,
  Field,
  SectionTitle,
  Sheet,
  inputClass,
} from './components.tsx'
import { useToast } from './Toast.tsx'
import {
  formatPHP,
  pesos,
  pricePerBaseUnit,
  pricePerDisplayUnit,
  qtyPerDisplayUnit,
  suggestedCost,
  suggestedPrice,
} from '../engine/index.ts'
import type { PurchaseTxn, Sku } from '../engine/index.ts'
import { newTxnId } from '../store.ts'
import type { Negosyo } from '../store.ts'
import { useT } from '../i18n/index.ts'
import type { UIStr } from '../i18n/index.ts'

/**
 * My items — the owner's own price list.
 *
 * This screen is the difference between a demo and a shop's book. Every other
 * screen could only ever write against the ten seeded products, because
 * `ledger.skus` was read-only; a sari-sari carries 80–200 items, so "add your
 * own" is not a feature, it is the precondition for the rest of the app being
 * true. It is also the switching cost: the day an owner types her shelf into
 * this list, the app has something of hers in it that no other app has.
 *
 * Two deliberate smallnesses, both to keep it usable at 80 rows on a cheap
 * phone:
 *
 *  - The list keeps **ledger order**, the same order the item picker uses when
 *    recording, so the place an owner learns in one screen is the place she
 *    sees in the other. Discovery at that length is the search box's job, not
 *    the sort's.
 *  - Price is never typed twice. It is read back from the last sale of that
 *    item, which is what makes a second sale of the same Coke two taps.
 */

/** The units a sari-sari actually sells in, in the owner's words, not ours. */
const UNITS: { id: string; labelKey: UIStr }[] = [
  { id: 'pc', labelKey: 'items.unit.pc' },
  { id: 'pack', labelKey: 'items.unit.pack' },
  { id: 'bottle', labelKey: 'items.unit.bottle' },
  { id: 'sachet', labelKey: 'items.unit.sachet' },
  { id: 'kg', labelKey: 'items.unit.kg' },
  { id: 'tray', labelKey: 'items.unit.tray' },
]

/** Only worth the space once the list is longer than one screenful of thumbs. */
const SEARCH_FROM = 8

/**
 * A restock is a one-line purchase, built the same way the recording screen
 * builds one — display units in, base units stored — so a purchase written
 * here and one written there are indistinguishable in the log. Returns null
 * when there is nothing honest to write: no item, or a quantity or cost that
 * is not a positive number. Zero cost is refused, not defaulted: free stock
 * would book its sale at full margin and flatter every figure downstream.
 */
export function buildRestockTxn(
  sku: Sku | undefined,
  qtyDisplay: number,
  costDisplay: number,
  onCredit: boolean,
  id: string,
  at: string,
): PurchaseTxn | null {
  if (!sku) return null
  if (!Number.isFinite(qtyDisplay) || qtyDisplay <= 0) return null
  if (!Number.isFinite(costDisplay) || costDisplay <= 0) return null
  const qty = sku.baseUnit === 'g' ? Math.round(qtyDisplay * 1000) : Math.round(qtyDisplay)
  const unitCostCentavos = pricePerBaseUnit(sku.baseUnit, pesos(costDisplay))
  const total = qty * unitCostCentavos
  return {
    id,
    at,
    kind: 'purchase',
    lines: [{ skuId: sku.id, qty, unitCostCentavos }],
    paidCentavos: onCredit ? 0 : total,
  }
}

export function ItemsScreen({ negosyo }: { negosyo: Negosyo }) {
  const t = useT()
  const toast = useToast()
  const skus = negosyo.ledger.skus

  const [query, setQuery] = useState('')
  /** Which item the editor is open for; `null` is a closed sheet. */
  const [editing, setEditing] = useState<{ mode: 'add' | 'edit'; id?: string } | null>(null)
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('pc')
  /** The shelf count, typed in the unit the owner counts in — see `save`. */
  const [stock, setStock] = useState('')
  const [pendingDelete, setPendingDelete] = useState<Sku | null>(null)
  // The restock sheet: pick the item first, then say how many arrived.
  const [restocking, setRestocking] = useState(false)
  const [restockSku, setRestockSku] = useState('')
  const [restockQty, setRestockQty] = useState('')
  const [restockCost, setRestockCost] = useState('')
  const [restockCredit, setRestockCredit] = useState(false)

  const trimmedQuery = query.trim().toLowerCase()
  const filtered = trimmedQuery
    ? skus.filter((sku) => sku.name.toLowerCase().includes(trimmedQuery))
    : skus

  const current = editing?.mode === 'edit' ? skus.find((sku) => sku.id === editing.id) : undefined
  /*
   * A unit the presets do not carry — an item imported from a backup, or one
   * weighed in grams — keeps its own chip instead of silently becoming "Piece"
   * the moment the sheet opens. An edit that changes a quantity's unit without
   * being asked would rewrite the meaning of every record already made with it.
   */
  const unitOptions: { id: string; labelKey: UIStr | null }[] =
    current && !UNITS.some((option) => option.id === current.unit)
      ? [...UNITS, { id: current.unit, labelKey: null }]
      : UNITS

  /**
   * What is actually on the shelf, read back the way the list reads it:
   * kilos to one decimal, pieces whole — so the editor never disagrees with
   * the row it was opened from.
   */
  function displayOnHand(sku: Sku): string {
    const base = negosyo.twin.inventory[sku.id]?.qty ?? 0
    const shown =
      sku.baseUnit === 'g'
        ? Math.round(qtyPerDisplayUnit(sku.baseUnit, base) * 10) / 10
        : Math.round(qtyPerDisplayUnit(sku.baseUnit, base))
    return String(shown)
  }

  /**
   * Writes the shelf count as an auditable correction, not a silent overwrite.
   * A stock number is a claim about the world, and claims belong in the log
   * next to the sales and purchases — that is what keeps the history
   * reproducible, and what the history feed reads back as "Stock correction".
   * Returns whether a correction was written, so the toast can say the true
   * thing: an untouched count is not an update.
   */
  function writeStockCorrection(skuId: string, baseUnit: string, counted: number): boolean {
    const base = baseUnit === 'g' ? Math.round(counted * 1000) : Math.round(counted)
    const delta = base - (negosyo.twin.inventory[skuId]?.qty ?? 0)
    if (delta === 0) return false
    negosyo.add({
      id: newTxnId('adj'),
      at: new Date().toISOString(),
      kind: 'stock_adjustment',
      skuId,
      qtyDelta: delta,
    })
    return true
  }

  function openAdd() {
    setEditing({ mode: 'add' })
    setName('')
    setUnit('pc')
    setStock('')
  }

  function openEdit(sku: Sku) {
    setEditing({ mode: 'edit', id: sku.id })
    setName(sku.name)
    setUnit(sku.unit)
    setStock(displayOnHand(sku))
  }

  function save() {
    const clean = name.trim()
    if (!clean) {
      toast.show({ title: t('items.needName'), tone: 'warn' })
      return
    }
    // Two items with the same name would be indistinguishable in the picker,
    // and the picker is a list of names only — so the duplicate is caught here,
    // where it can still be explained, rather than there where it would just
    // look like the app losing a row.
    const taken = skus.some(
      (sku) => sku.name.trim().toLowerCase() === clean.toLowerCase() && sku.id !== current?.id,
    )
    if (taken) {
      toast.show({ title: t('items.taken'), tone: 'warn' })
      return
    }

    // The shelf count is validated BEFORE anything is written: a half-saved
    // item — renamed but with its stock rejected — would leave the shelf and
    // the books disagreeing with no record of why. Empty means untouched, and
    // an untouched count writes nothing, not even a zero correction.
    const counted = stock.trim() === '' ? null : Number(stock.trim())
    if (counted !== null && (!Number.isFinite(counted) || counted < 0)) {
      toast.show({ title: t('items.stockNeedNumber'), tone: 'warn' })
      return
    }
    // The count is typed in the unit selected ABOVE, which may just have been
    // changed: a kilo count saved as pieces would write a thousand-fold
    // correction, so the conversion follows the new selection, not the stored
    // base unit.
    const baseUnit = unit === 'kg' || unit === 'g' ? 'g' : 'pc'

    if (current) {
      negosyo.updateSku(current.id, { name: clean, unit })
      const corrected = counted !== null && writeStockCorrection(current.id, baseUnit, counted)
      toast.show({ title: corrected ? t('items.stockSaved') : t('items.updated'), tone: 'success' })
    } else {
      const id = negosyo.addSku({ name: clean, unit })
      const corrected = counted !== null && writeStockCorrection(id, baseUnit, counted)
      toast.show({
        title: corrected ? t('items.stockSaved') : t('items.added', { name: clean }),
        tone: 'success',
      })
    }
    setEditing(null)
  }

  function openRestock() {
    setRestocking(true)
    setRestockSku('')
    setRestockQty('')
    setRestockCost('')
    setRestockCredit(false)
  }

  /**
   * Choosing the item fills in its last known cost, so the common restock —
   * same item, same supplier price — is quantity plus one tap. A changed
   * price is typed over, which is also how a price increase gets noticed.
   */
  function pickRestockSku(skuId: string) {
    setRestockSku(skuId)
    const sku = skus.find((s) => s.id === skuId)
    const display = sku ? pricePerDisplayUnit(sku.baseUnit, suggestedCost(negosyo.ledger, skuId)) : 0
    setRestockCost(display > 0 ? String(display / 100) : '')
  }

  function saveRestock() {
    const sku = skus.find((s) => s.id === restockSku)
    if (!sku) {
      toast.show({ title: t('items.restockNeedItem'), tone: 'warn' })
      return
    }
    const txn = buildRestockTxn(
      sku,
      Number(restockQty),
      Number(restockCost),
      restockCredit,
      newTxnId('pur'),
      new Date().toISOString(),
    )
    if (!txn) {
      toast.show({ title: t('items.restockNeedNumbers'), tone: 'warn' })
      return
    }
    negosyo.add(txn)
    setRestocking(false)
    toast.show({
      title: t('items.restocked', { name: sku.name, qty: Number(restockQty), unit: sku.unit }),
      tone: 'success',
    })
  }

  function confirmDelete() {
    if (!pendingDelete) return
    negosyo.removeSku(pendingDelete.id)
    setPendingDelete(null)
    toast.show({ title: t('items.removed'), tone: 'success' })
  }

  const editor = (
    <Sheet
      title={editing?.mode === 'edit' ? t('items.editTitle') : t('items.addTitle')}
      closeLabel={t('app.close')}
      onClose={() => setEditing(null)}
    >
      <Field label={t('items.fieldName')}>
        <input
          className={inputClass}
          type="text"
          autoFocus
          /* Product names are Filipino, brand names and abbreviations. The
             browser's dictionary underlines all three in red, so it is off:
             a squiggle on "Pandesal" teaches the owner to distrust the field. */
          spellCheck={false}
          value={name}
          placeholder={t('items.namePlaceholder')}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
          }}
        />
      </Field>

      <div className="mt-4" role="group" aria-label={t('items.fieldUnit')}>
        <span className="text-[0.8125rem] font-bold tracking-wide text-fg-subtle uppercase">
          {t('items.fieldUnit')}
        </span>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {unitOptions.map((option) => (
            <Chip key={option.id} active={unit === option.id} onClick={() => setUnit(option.id)}>
              {/* A non-preset unit is shown as the owner's own word for it. */}
              {option.labelKey ? t(option.labelKey) : option.id}
            </Chip>
          ))}
        </div>
      </div>

      {/*
       * The missing shelf count: until this existed the only way stock entered
       * the books was a purchase, so a wrong count — or opening stock never
       * bought through the app — could never be fixed, and every later sale
       * dug the hole deeper. Counted in the unit selected above, saved as a
       * stock correction in the log.
       */}
      <div className="mt-4">
        <Field label={t('items.stockField')}>
          <input
            className={inputClass}
            type="number"
            inputMode="decimal"
            min="0"
            spellCheck={false}
            value={stock}
            placeholder="0"
            onChange={(e) => setStock(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save()
            }}
          />
        </Field>
      </div>

      <Button className="mt-5 w-full" onClick={save}>
        {t('items.save')}
      </Button>
    </Sheet>
  )

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle hint={t('items.hint')}>{t('items.title')}</SectionTitle>
        <p className="text-[0.875rem] leading-relaxed text-fg-subtle">{t('items.intro')}</p>
        <Button className="mt-3.5 w-full" onClick={openAdd}>
          {t('items.add')}
        </Button>
        {/* Second tap, quieter button: adding stock to what is already here
            is the week's commonest errand, and it should not require a trip
            to the recording screen to do it. */}
        <Button variant="ghost" className="mt-2 w-full" onClick={openRestock}>
          {t('items.restock')}
        </Button>
        {/* The count sits under the action rather than in the heading, because
            its job is to answer "did that save?", which is a question asked
            right after tapping the button above it. */}
        {skus.length > 0 ? (
          <p className="num mt-2.5 text-center text-[0.8125rem] text-fg-faint">
            {t('items.count', { n: skus.length })}
          </p>
        ) : null}
      </Card>

      {/* `px-4.5` on everything that is not a `Card`: a card is a full-bleed
          band with its own inner padding, so loose content needs the same inset
          or it runs to the edge of the phone and looks like a different app. */}
      {skus.length > SEARCH_FROM ? (
        <div className="px-4.5">
          <input
            className={inputClass}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('items.search')}
            aria-label={t('items.search')}
          />
        </div>
      ) : null}

      {skus.length === 0 ? (
        <div className="px-4.5">
          <EmptyState
            title={t('items.emptyTitle')}
            body={t('items.emptyBody')}
            action={<Button onClick={openAdd}>{t('items.add')}</Button>}
          />
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-4.5">
          <EmptyState title={t('items.notFound')} body={t('items.emptyBody')} />
        </div>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {filtered.map((sku) => {
              // Back into the unit this item is sold in. A line stores the price
              // of one base unit, so rice would otherwise read "last sold at
              // ₱0.07" — true, and useless to the person reading it.
              const last = pricePerDisplayUnit(
                sku.baseUnit,
                suggestedPrice(negosyo.ledger, sku.id),
              )
              // What is actually on the shelf, in the unit the owner counts in:
              // kilos to one decimal, pieces whole — the same rounding the
              // best-sellers list uses, so the two screens never disagree.
              const onHandBase = negosyo.twin.inventory[sku.id]?.qty ?? 0
              const onHand =
                sku.baseUnit === 'g'
                  ? Math.round(qtyPerDisplayUnit(sku.baseUnit, onHandBase) * 10) / 10
                  : Math.round(qtyPerDisplayUnit(sku.baseUnit, onHandBase))
              return (
                <li
                  key={sku.id}
                  /* `flex-wrap`: the two controls keep their size and drop to
                     their own line on a narrow phone in the largest reading
                     size, instead of squeezing the product name into an
                     ellipsis. The name is the one thing here that must never be
                     cut — a truncated product name is a different product. */
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3"
                >
                  <div className="min-w-[9rem] flex-1">
                    <div className="text-[0.9375rem] leading-snug font-semibold text-fg">
                      {sku.name}
                    </div>
                    <div className="num mt-0.5 text-[0.8125rem] text-fg-faint">
                      {last > 0 ? t('items.lastPrice', { amount: formatPHP(last) }) : t('items.noPrice')}
                    </div>
                    <div
                      className={`num mt-0.5 text-[0.8125rem] font-semibold ${onHand > 0 ? 'text-fg-faint' : 'text-red-700'}`}
                    >
                      {t('items.stock', { n: onHand, unit: sku.unit })}
                    </div>
                  </div>
                  <div className="ml-auto flex shrink-0 items-center gap-1.5">
                    <Button variant="ghost" onClick={() => openEdit(sku)}>
                      {t('items.edit')}
                    </Button>
                    {/* A plain button rather than `Button`, for the one thing
                        `Button` cannot do: carry an aria-label. Sixty rows each
                        announced as "Delete" tell a screen-reader user nothing;
                        "Delete Coke Mismo" tells them which row they are on. The
                        classes are the same pair `Button variant="ghost"` uses,
                        so it is the same control to the eye. */}
                    <button
                      type="button"
                      aria-label={t('record.voidAria', { what: sku.name })}
                      onClick={() => setPendingDelete(sku)}
                      className="btn btn-quiet"
                    >
                      {t('items.deleteConfirm')}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      {editing ? editor : null}

      {restocking ? (
        <Sheet
          title={t('items.restockTitle')}
          closeLabel={t('app.close')}
          onClose={() => setRestocking(false)}
        >
          <Field label={t('items.restockItem')}>
            <CustomSelect
              value={restockSku}
              onChange={pickRestockSku}
              placeholder={t('record.select')}
              options={skus.map((s) => ({
                value: s.id,
                label: s.name,
                hint: t('items.stock', {
                  n:
                    s.baseUnit === 'g'
                      ? Math.round(qtyPerDisplayUnit(s.baseUnit, negosyo.twin.inventory[s.id]?.qty ?? 0) * 10) / 10
                      : Math.round(qtyPerDisplayUnit(s.baseUnit, negosyo.twin.inventory[s.id]?.qty ?? 0)),
                  unit: s.unit,
                }),
              }))}
            />
          </Field>

          <div className="mt-4">
            <Field label={t('items.restockQty')}>
              <input
                className={inputClass}
                type="number"
                inputMode="decimal"
                min="0"
                spellCheck={false}
                value={restockQty}
                placeholder="0"
                onChange={(e) => setRestockQty(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveRestock()
                }}
              />
            </Field>
          </div>

          <div className="mt-4">
            <Field label={t('items.restockCost')}>
              <input
                className={inputClass}
                type="number"
                inputMode="decimal"
                min="0"
                spellCheck={false}
                value={restockCost}
                placeholder="0"
                onChange={(e) => setRestockCost(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveRestock()
                }}
              />
            </Field>
          </div>

          <label className="mt-4 flex min-h-11 items-center gap-3 text-[0.9375rem] leading-relaxed text-fg-muted">
            <input
              type="checkbox"
              checked={restockCredit}
              onChange={(e) => setRestockCredit(e.target.checked)}
              className="h-5 w-5 shrink-0 accent-brand-700"
            />
            {t('record.supplierCredit')}
          </label>

          <Button className="mt-5 w-full" onClick={() => saveRestock()}>
            {t('items.restockSave')}
          </Button>
        </Sheet>
      ) : null}

      {pendingDelete ? (
        <ConfirmDialog
          title={t('items.deleteTitle')}
          body={t('items.deleteBody')}
          confirmLabel={t('items.deleteConfirm')}
          cancelLabel={t('items.deleteCancel')}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        />
      ) : null}
    </div>
  )
}
