import { UI, dayMonthYear, tr } from './i18n/index.ts'
import type { Lang } from './i18n/index.ts'
import { formatPHP } from './engine/money.ts'
import { readPersisted, writePersisted } from './storage.ts'

/**
 * The collectable utang statement: the list an owner sends or prints.
 *
 * Why this file exists. SeePat tracked exactly who owed what, showed it on one
 * screen, and then did nothing with it. Pat's own headline advice on the
 * dashboard is "collect first — ₱4,158.65 of utang is still unpaid", and there
 * was no way to act on that sentence: no list to hand to whoever does the
 * collecting, no sheet to carry around the barangay, nothing a cooperative or an
 * LGU could ever ask for. The audit ranked this the single clearest gap in the
 * product, ahead of every feature that was already built.
 *
 * Two decisions worth stating, because both are about honesty rather than layout:
 *
 * 1. **It is not a BIR document.** The sheet says so on its face, in both
 *    languages. RA 11976 makes an *invoice* the primary document for sales, and
 *    SeePat issues none; a bookkeeping output presented as an official receipt
 *    would be the one genuinely dangerous thing this screen could do.
 * 2. **It is plain text first.** The shareable form is a plain string, because
 *    the destination is a Messenger chat or an SMS on a prepaid SIM — not a PDF
 *    attachment. The printable form is the same content, laid out for paper.
 *
 * The builder is pure and localized through the app's own copy table, so the
 * statement is identical on the screen, in the shared message and on the printed
 * page — and it can be tested without a browser.
 */

/** What the statement needs from a row; `UtangRow` satisfies it. */
export interface StatementRowInput {
  name: string
  amountCentavos: number
  daysOldest: number | null
  lastPaidAt: string | null
}

export interface StatementLine {
  /** 1-based, so the printed sheet can be ticked off against a notebook. */
  index: number
  name: string
  amountCentavos: number
  amountText: string
  age: string
}

export interface UtangStatement {
  shopName: string
  title: string
  asOfLabel: string
  asOfText: string
  lines: StatementLine[]
  totalLabel: string
  totalCentavos: number
  totalText: string
  countLabel: string
  /** Column heads for the printed sheet. */
  nameLabel: string
  amountLabel: string
  note: string
  /** The message body: plain text, ready for Messenger or SMS. */
  text: string
}

/**
 * How old the oldest unpaid debt is, in the app's two languages.
 *
 * This lives here rather than in the screen because it is part of the artifact:
 * the shared message and the printed sheet carry the same words, and a statement
 * whose screen says "12 days" while its message says something else would be the
 * kind of inconsistency nobody notices until a panel does.
 */
export function ageText(row: StatementRowInput, lang: Lang): string {
  if (row.lastPaidAt === null) return tr(lang, UI, 'utang.neverPaid')
  if (row.daysOldest === null || row.daysOldest === 0) return tr(lang, UI, 'utang.today')
  return tr(lang, UI, 'utang.oldest', { n: row.daysOldest })
}

/**
 * Money on a statement is money: ₱4,158.65, with the sign and the separators.
 * A collector reads this off a phone, and a bare "4158.65" is one transcription
 * error away from a wrong collection.
 */
function money(centavos: number): string {
  return formatPHP(centavos)
}

/**
 * The shop's own name, typed once and kept on the device.
 *
 * The app has no account and no profile, so this is the one piece of identity a
 * statement needs and the one thing it cannot derive: a list handed to a
 * collector with no shop on it is not much of a record. It never leaves the
 * phone except inside a statement the owner chooses to send.
 */
const SHOP_STORAGE = { key: 'seepat.shop.v1' }

export function readShopName(): string {
  return (readPersisted(SHOP_STORAGE) ?? '').trim()
}

export function writeShopName(name: string): void {
  writePersisted(SHOP_STORAGE, name.trim())
}

export function buildUtangStatement(input: {
  rows: StatementRowInput[]
  totalCentavos: number
  asOf: Date
  lang: Lang
  shopName: string
}): UtangStatement {
  const { rows, totalCentavos, asOf, lang } = input
  const shopName = input.shopName.trim() || tr(lang, UI, 'utang.statementNoShop')

  const lines: StatementLine[] = rows.map((row, i) => ({
    index: i + 1,
    name: row.name,
    amountCentavos: row.amountCentavos,
    amountText: money(row.amountCentavos),
    age: ageText(row, lang),
  }))

  const title = tr(lang, UI, 'utang.statementTitle', { shop: shopName })
  const asOfLabel = tr(lang, UI, 'utang.statementAsOf')
  const asOfText = dayMonthYear(asOf, lang)
  const totalLabel = tr(lang, UI, 'utang.statementTotal')
  const totalText = money(totalCentavos)
  const countLabel = tr(lang, UI, 'utang.statementCount', { n: lines.length })
  const nameLabel = tr(lang, UI, 'utang.statementColName')
  const amountLabel = tr(lang, UI, 'utang.statementColAmount')
  const note = tr(lang, UI, 'utang.statementNote')
  const signed = tr(lang, UI, 'utang.statementSigned', { shop: shopName })

  // Plain text, numbered, and with the total on its own line: this ends up in a
  // chat, where the owner reads it off a phone at a doorway.
  const text = [
    title,
    `${asOfLabel}: ${asOfText}`,
    '',
    ...lines.map((line) => `${line.index}. ${line.name} — ${line.amountText} (${line.age})`),
    '',
    `${totalLabel}: ${totalText}`,
    countLabel,
    '',
    note,
    signed,
  ].join('\n')

  return {
    shopName,
    title,
    asOfLabel,
    asOfText,
    lines,
    totalLabel,
    totalCentavos,
    totalText,
    countLabel,
    nameLabel,
    amountLabel,
    note,
    text,
  }
}
