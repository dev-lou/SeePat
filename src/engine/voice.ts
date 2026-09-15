import { pesos } from './money.ts'
import type { Centavos } from './money.ts'
import type { CustomerId, Ledger, SkuId, Transaction } from './types.ts'
import { pick as pickCopy } from '../i18n/index.ts'
import type { Lang } from '../i18n/index.ts'

/**
 * Constrained voice-to-business-record.
 *
 * Three deliberate constraints, each tied to a failure mode:
 *
 * 1. CONSTRAINED VOCABULARY. The recognizer is only asked to distinguish items
 *    this store actually sells, plus numbers. Free-form Taglish transcription
 *    runs at 19–25% word error on the best available engines; slot-filling
 *    against a known SKU list is an engineering problem, not a research one.
 *
 * 2. NUMBERS NEVER AUTO-POST. Item identity is safe to infer — a misheard "Coke"
 *    is obvious on screen. A misheard quantity or price silently corrupts the
 *    ledger and every downstream insight, so numbers must always be confirmed.
 *
 * 3. DRAFTS, NOT RECORDS. Parsing produces a draft that cannot be persisted
 *    until the owner accepts it. This is what makes "AI never silently modifies
 *    financial records" a property of the code rather than a promise.
 */

export type DraftKind = 'cash_sale' | 'credit_sale' | 'expense' | 'purchase'

export interface DraftLine {
  skuId: SkuId
  skuName: string
  qty: number
  unitPriceCentavos: Centavos
  /** How the quantity was understood, for the confirmation step. */
  qtySource: string
}

export interface DraftTransaction {
  kind: DraftKind
  transcript: string
  /** True when a customer was named and matched. */
  customerId?: CustomerId
  lines: DraftLine[]
  amountCentavos?: Centavos
  /** Spoken words that matched no SKU and no number — surfaced for correction. */
  unresolved: string[]
  /** Always true: the owner must confirm every amount and quantity. */
  needsConfirmation: true
  summary: string
}

// ---------------------------------------------------------------------------
// Filipino / Taglish numerals
// ---------------------------------------------------------------------------

const UNITS: Record<string, number> = {
  isa: 1, uno: 1, una: 1, one: 1,
  dalawa: 2, dos: 2, two: 2,
  tatlo: 3, tres: 3, three: 3,
  apat: 4, kwatro: 4, four: 4,
  lima: 5, singko: 5, five: 5,
  anim: 6, sais: 6, six: 6,
  pito: 7, syete: 7, seven: 7,
  walo: 8, otso: 8, eight: 8,
  siyam: 9, nuwebe: 9, nine: 9,
  sampu: 10, diyes: 10, ten: 10,
}

const TENS: Record<string, number> = {
  dalawampu: 20, bente: 20,
  trenta: 30, treynta: 30,
  kwarenta: 40, kuwarenta: 40,
  singkwenta: 50, sinkuwenta: 50,
  sisenta: 60, sesenta: 60,
  setenta: 70,
  otsenta: 80,
  nobenta: 90,
}

/** "kalahati" — half, common when selling rice by the kilo. */
const FRACTIONS: Record<string, number> = {
  kalahati: 0.5,
  hati: 0.5,
  'kalahating': 0.5,
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Numeric value of a single spoken word, including the assimilated teens
 * (labing-isa, labindalawa, labimpito…) where the prefix's `n` becomes `m`
 * before a labial consonant.
 */
function wordValue(word: string): number | null {
  if (word in UNITS) return UNITS[word]
  if (word in TENS) return TENS[word]
  if (word in FRACTIONS) return FRACTIONS[word]
  if (word === 'isandaan' || word === 'sandaang' || word === 'siyento') return 100
  for (const prefix of ['labing', 'labin', 'labim']) {
    if (word.startsWith(prefix)) {
      // "labing-isa" keeps the hyphen the speaker's intonation implies.
      const rest = word.slice(prefix.length).replace(/^-/, '')
      if (rest in UNITS) return 10 + UNITS[rest]
    }
  }
  return null
}

/** Parse a spoken quantity phrase such as "dalawampu't lima" or "12". */
export function parseSpokenNumber(phrase: string): number | null {
  const words = normalize(phrase).split(' ').filter(Boolean)
  if (words.length === 0) return null

  // Plain digits win outright.
  const digits = words.filter((w) => /^\d+(\.\d+)?$/.test(w))
  if (digits.length > 0) return Number(digits[digits.length - 1])

  let current = 0
  let matched = false

  for (const raw of words) {
    const word = raw.replace(/'t$/, '')
    if (word === 'at' || word === 'ug' || word === 'and') continue

    // Spoken Filipino attaches the ligature: sampung, limang, dalawang, pitong.
    let value = wordValue(word)
    if (value === null && word.endsWith('ng')) value = wordValue(word.slice(0, -2))

    if (value !== null) {
      current += value
      matched = true
    }
  }

  return matched ? current : null
}

// ---------------------------------------------------------------------------
// Intent verbs
// ---------------------------------------------------------------------------

/** Words that carry no slot value: verbs, particles, and the wake word itself. */
const STOPWORDS = new Set([
  // The wake word, in both the Filipino spelling users say and the brand
  // spelling they type. It carries no slot value, so it never becomes a line.
  'sipat', 'seepat', 'at', 'ng', 'ang', 'ako', 'si', 'kay', 'na', 'mismo', 'pcs', 'pc',
  'kilo', 'kg', 'gram', 'grams', 'benta', 'nakabenta', 'nagbenta', 'bumili',
  'bili', 'umutang', 'utang', 'gastos', 'gumastos', 'bayad', 'nagbayad', 'order',
  'restock', 'sold', 'lang', 'din', 'rin', 'ko', 'mo', 'ni', 'sa', 'may',
  'mayroon', 'ngayon', 'kahapon', 'piraso', 'pirasong', 'pack', 'packs',
  'sachet', 'sachets', 'nag', 'yung', 'iyong',
])

const KIND_PATTERNS: { kind: DraftKind; patterns: RegExp[] }[] = [
  { kind: 'credit_sale', patterns: [/\bumutang\b/, /\butang\b/, /\bnakautang\b/] },
  { kind: 'purchase', patterns: [/\bbumili\b/, /\bbili\b/, /\bnagrestock\b/, /\border\b/] },
  { kind: 'expense', patterns: [/\bgastos\b/, /\bgumastos\b/, /\bbayad\b.*\bkuryente/, /\bexpense\b/] },
  { kind: 'cash_sale', patterns: [/\bnakabenta\b/, /\bbenta\b/, /\bnagbenta\b/, /\bsold\b/] },
]

export function detectDraftKind(transcript: string): DraftKind {
  const t = normalize(transcript)
  for (const { kind, patterns } of KIND_PATTERNS) {
    if (patterns.some((p) => p.test(t))) return kind
  }
  return 'cash_sale'
}

// ---------------------------------------------------------------------------
// Constrained SKU matching
// ---------------------------------------------------------------------------

interface AliasHit {
  skuId: SkuId
  skuName: string
  index: number
  length: number
  alias: string
}

/** Longest aliases first so "pancit canton" is not shadowed by "lucky". */
function findAliasHits(transcript: string, ledger: Ledger): AliasHit[] {
  const text = ` ${normalize(transcript)} `
  const hits: AliasHit[] = []

  for (const sku of ledger.skus) {
    const aliases = [sku.name, ...sku.aliases].map(normalize).sort((a, b) => b.length - a.length)
    for (const alias of aliases) {
      if (!alias) continue
      const index = text.indexOf(` ${alias}`)
      if (index === -1) continue
      // Skip if a longer alias already claimed this span.
      const overlaps = hits.some(
        (h) => h.skuId === sku.id || (index < h.index + h.length && h.index < index + alias.length),
      )
      if (overlaps) continue
      hits.push({
        skuId: sku.id,
        skuName: sku.name,
        index,
        length: alias.length,
        alias,
      })
      break
    }
  }

  return hits.sort((a, b) => a.index - b.index)
}

/** Most recent unit price this store used for a SKU — offered, then confirmed. */
export function suggestedPrice(ledger: Ledger, skuId: SkuId): Centavos {
  for (let i = ledger.transactions.length - 1; i >= 0; i -= 1) {
    const txn = ledger.transactions[i]
    if (txn.kind === 'cash_sale' || txn.kind === 'credit_sale') {
      const line = txn.lines.filter((l) => l.skuId === skuId).pop()
      if (line) return line.unitPriceCentavos
    }
  }
  return 0
}

/** Most recent unit cost this store paid for a SKU. */
export function suggestedCost(ledger: Ledger, skuId: SkuId): Centavos {
  for (let i = ledger.transactions.length - 1; i >= 0; i -= 1) {
    const txn = ledger.transactions[i]
    if (txn.kind === 'purchase') {
      const line = txn.lines.filter((l) => l.skuId === skuId).pop()
      if (line) return line.unitCostCentavos
    }
  }
  return 0
}

function findCustomer(transcript: string, ledger: Ledger): CustomerId | undefined {
  const text = ` ${normalize(transcript)} `
  for (const customer of ledger.customers) {
    for (const alias of [customer.name, ...customer.aliases]) {
      if (text.includes(` ${normalize(alias)}`)) return customer.id
    }
  }
  return undefined
}

/**
 * Parse a spoken sentence into a DRAFT transaction. Cannot be persisted as-is:
 * the caller must pass the confirmed lines to `draftToTransaction`.
 */
export function parseSpoken(
  transcript: string,
  ledger: Ledger,
  /** Language for the confirmation copy. Parsing itself is language-agnostic. */
  lang: Lang,
): DraftTransaction {
  const kind = detectDraftKind(transcript)
  const hits = findAliasHits(transcript, ledger)
  const words = normalize(transcript).split(' ').filter(Boolean)

  const lines: DraftLine[] = []
  const consumed = new Set<number>()

  const normalized = normalize(transcript)

  for (const hit of hits) {
    // `findAliasHits` indexes into a copy padded with a leading space; undo that here.
    const aliasWordIndex = normalized.slice(0, Math.max(0, hit.index - 1)).split(' ').filter(Boolean).length
    const from = Math.max(0, aliasWordIndex - 5)
    const window = words.slice(from, aliasWordIndex)

    let qty: number | null = null
    let qtySource = pickCopy(lang, { en: 'assumed 1', fil: 'default 1' })
    for (let i = window.length - 1; i >= 0; i -= 1) {
      const candidate = parseSpokenNumber(window.slice(i).join(' '))
      if (candidate !== null && candidate > 0 && candidate < 1000) {
        qty = candidate
        qtySource = window.slice(i).join(' ')
        break
      }
    }

    const sku = ledger.skus.find((s) => s.id === hit.skuId)
    // Selling rice by the kilo means the base unit is grams.
    let baseQty = qty ?? 1
    if (sku?.baseUnit === 'g') {
      const mentionsKilo = /\bkilo|\bkg\b/.test(normalized)
      const mentionsGram = /\bgram|\bg\b/.test(normalized)
      if (mentionsKilo) baseQty *= 1000
      else if (!mentionsGram && baseQty < 100) baseQty *= 1000
    }

    for (let i = from; i < aliasWordIndex; i += 1) consumed.add(i)

    lines.push({
      skuId: hit.skuId,
      skuName: hit.skuName,
      qty: Math.round(baseQty),
      unitPriceCentavos:
        kind === 'purchase' ? suggestedCost(ledger, hit.skuId) : suggestedPrice(ledger, hit.skuId),
      qtySource,
    })
  }

  const unresolved = words.filter((w, i) => {
    if (consumed.has(i)) return false
    if (/^\d+(\.\d+)?$/.test(w)) return false
    if (wordValue(w.replace(/'t$/, '')) !== null) return false
    if (wordValue(w.replace(/ng$/, '')) !== null) return false
    return !STOPWORDS.has(w)
  })

  // The confirmation line is the one thing standing between speech and the
  // ledger, so it is written in whichever language the owner is reading.
  const quantityList = lines.map((l) => `${l.qty}× ${l.skuName}`).join(', ')
  const summary =
    lines.length === 0
      ? pickCopy(lang, {
          en: 'No known items in what was said.',
          fil: 'Walang nakilalang paninda sa sinabi.',
        })
      : pickCopy(lang, {
          en: `${quantityList} — needs confirmation.`,
          fil: `${quantityList} — kailangan ng kumpirmasyon.`,
        })

  return {
    kind,
    transcript,
    customerId: kind === 'credit_sale' ? findCustomer(transcript, ledger) : undefined,
    lines,
    unresolved,
    needsConfirmation: true,
    summary,
  }
}

export interface ConfirmedLine {
  skuId: SkuId
  qty: number
  unitPriceCentavos: Centavos
}

/**
 * Only path from a draft to a real transaction. Requires explicitly confirmed
 * lines — there is no overload that accepts a raw draft.
 */
export function draftToTransaction(
  draft: DraftTransaction,
  confirmed: ConfirmedLine[],
  id: string,
  at: string,
): Transaction {
  // The transcript is stored as-is and the capture method as a key: a record
  // written in Tagalog must not leave an English reader with a stray "Boses".
  const note = draft.transcript
  const source = 'voice' as const

  switch (draft.kind) {
    case 'credit_sale':
      return {
        id,
        at,
        kind: 'credit_sale',
        lines: confirmed,
        customerId: draft.customerId ?? 'walk_in',
        note,
        source,
      }
    case 'purchase': {
      const lines = confirmed.map((l) => ({
        skuId: l.skuId,
        qty: l.qty,
        unitCostCentavos: l.unitPriceCentavos,
      }))
      const total = lines.reduce((s, l) => s + l.qty * l.unitCostCentavos, 0)
      return { id, at, kind: 'purchase', lines, paidCentavos: total, note, source }
    }
    case 'expense':
      return {
        id,
        at,
        kind: 'expense',
        amountCentavos: draft.amountCentavos ?? pesos(0),
        paid: 'cash',
        note,
        source,
      }
    case 'cash_sale':
    default:
      return { id, at, kind: 'cash_sale', lines: confirmed, note, source }
  }
}
