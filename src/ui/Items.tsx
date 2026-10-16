import { useState } from 'react'
import {
  Button,
  Card,
  Chip,
  ConfirmDialog,
  EmptyState,
  Field,
  SectionTitle,
  Sheet,
  inputClass,
} from './components.tsx'
import { useToast } from './Toast.tsx'
import { formatPHP, pricePerDisplayUnit, suggestedPrice } from '../engine/index.ts'
import type { Sku } from '../engine/index.ts'
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

export function ItemsScreen({ negosyo }: { negosyo: Negosyo }) {
  const t = useT()
  const toast = useToast()
  const skus = negosyo.ledger.skus

  const [query, setQuery] = useState('')
  /** Which item the editor is open for; `null` is a closed sheet. */
  const [editing, setEditing] = useState<{ mode: 'add' | 'edit'; id?: string } | null>(null)
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('pc')
  const [pendingDelete, setPendingDelete] = useState<Sku | null>(null)

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

  function openAdd() {
    setEditing({ mode: 'add' })
    setName('')
    setUnit('pc')
  }

  function openEdit(sku: Sku) {
    setEditing({ mode: 'edit', id: sku.id })
    setName(sku.name)
    setUnit(sku.unit)
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

    if (current) {
      negosyo.updateSku(current.id, { name: clean, unit })
      toast.show({ title: t('items.updated'), tone: 'success' })
    } else {
      negosyo.addSku({ name: clean, unit })
      toast.show({ title: t('items.added', { name: clean }), tone: 'success' })
    }
    setEditing(null)
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
