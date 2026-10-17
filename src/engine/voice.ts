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

/**
 * Words that join two items in one sentence.
 *
 * A quantity after one of these belongs to the item that *follows* it: in "coke
 * at dalawang skyflakes" the two is Skyflakes', not Coke's, and reading it the
 * other way invents a Coke sale the owner never said.
 */
const CONJUNCTIONS = new Set(['at', 'saka', 'tapos', 'pati', 'then', 'and'])

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
  /**
   * How many transcript words the hit actually occupies. Exact hits occupy
   * every word of their alias; a fuzzy hit usually occupies fewer ("coke"
   * matching the catalogue alias "coke zero" sits on one word, not two).
   * The quantity windows are measured from this, so a fuzzy hit can never
   * reach past its own word and steal the next item's number.
   */
  spanWords?: number
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

/**
 * Units that carry no item identity on the transcript side of a fuzzy match.
 *
 * Most units already live in STOPWORDS; these are the stragglers ('g' from
 * "2g", metric shorthands) that would otherwise count as a "word" and dilute
 * the overlap score below.
 */
const FUZZY_IGNORED = new Set(['g', 'ml', 'l', 'liter', 'litro', 'gramo'])

/** Transcript words that can vote for an item: not filler, numbers, or units. */
function significantWords(words: string[]): { word: string; index: number }[] {
  const out: { word: string; index: number }[] = []
  words.forEach((raw, index) => {
    const word = raw.replace(/'t$/, '')
    if (word.length < 2) return
    if (STOPWORDS.has(word) || FUZZY_IGNORED.has(word)) return
    if (/^\d+(\.\d+)?$/.test(word)) return
    if (wordValue(word) !== null || wordValue(word.replace(/ng$/, '')) !== null) return
    out.push({ word, index })
  })
  return out
}

/**
 * Word-overlap matching for ledgers whose aliases are full names.
 *
 * The exact matcher needs the catalogue alias to appear verbatim, which holds
 * for the demo ledger (alias 'coke') but not for a real store whose only Coke
 * is listed as "Coke Zero": saying "coke" then matches nothing and the draft
 * reports no goods. This pass runs after the exact one and only over words the
 * exact pass did not consume: an alias wins when it shares at least one word
 * with what is left *and* covers at least half of its own words — "coke"
 * against {coke, zero} scores 1/2, while a stray shared filler cannot reach
 * the bar on a long name.
 *
 * Ambiguity refuses rather than guesses, word by word: when one leftover word
 * matches two different SKUs ("coke" with both Coke Mismo and Coke Zero on
 * the shelf), every candidate claiming that word is dropped and it surfaces as
 * unplaced, exactly as an unknown word would. Candidates claiming disjoint
 * words ("coke ... sardinas") are independent matches, not a conflict, and
 * all stand. Picking a conflicted word would invent a sale of the wrong item;
 * the confirmation sheet already shows the words, so the owner resolves it
 * by tap.
 */
function findFuzzyHits(
  words: string[],
  normalized: string,
  exactHits: AliasHit[],
  ledger: Ledger,
): AliasHit[] {
  const consumed = new Set<number>()
  for (const hit of exactHits) {
    const aliasWordIndex = normalized
      .slice(0, Math.max(0, hit.index - 1))
      .split(' ')
      .filter(Boolean).length
    const aliasWords = hit.spanWords ?? hit.alias.split(' ').filter(Boolean).length
    for (let i = Math.max(0, aliasWordIndex - 5); i < aliasWordIndex + aliasWords; i += 1) {
      consumed.add(i)
    }
  }

  const remaining = significantWords(words).filter((w) => !consumed.has(w.index))
  if (remaining.length === 0) return []
  const remainingSet = new Set(remaining.map((w) => w.word))

  // Char offsets of each word, so a hit can point at its first shared word.
  const starts: number[] = []
  let pos = 1 // the padded string starts with a space
  for (const word of words) {
    starts.push(pos)
    pos += word.length + 1
  }

  const hitSkus = new Set(exactHits.map((h) => h.skuId))
  const remainingByWord = new Map(remaining.map((w) => [w.word, w.index] as const))
  const candidates: { hit: AliasHit; claimed: number[] }[] = []
  for (const sku of ledger.skus) {
    if (hitSkus.has(sku.id)) continue
    const aliases = [sku.name, ...sku.aliases].map(normalize).sort((a, b) => b.length - a.length)
    let best: { alias: string; shared: string[] } | null = null
    for (const alias of aliases) {
      const aliasWords = alias.split(' ').filter(Boolean)
      if (aliasWords.length === 0) continue
      const shared = aliasWords.filter((w) => remainingSet.has(w))
      if (shared.length === 0 || shared.length / aliasWords.length < 0.5) continue
      if (!best || shared.length > best.shared.length) best = { alias, shared }
    }
    if (!best) continue
    const claimed = best.shared
      .map((word) => remainingByWord.get(word))
      .filter((index): index is number => index !== undefined)
    if (claimed.length === 0) continue
    const firstIndex = Math.min(...claimed)
    candidates.push({
      hit: {
        skuId: sku.id,
        skuName: sku.name,
        index: starts[firstIndex] ?? 1,
        length: words[firstIndex]?.length ?? best.alias.length,
        alias: best.alias,
        spanWords: 1,
      },
      claimed,
    })
  }

  // A word claimed by two SKUs is a conflict: drop every candidate touching
  // it. What survives claims only words nobody else wants.
  const claimsByWord = new Map<number, Set<SkuId>>()
  for (const candidate of candidates) {
    for (const wordIndex of candidate.claimed) {
      const set = claimsByWord.get(wordIndex) ?? new Set<SkuId>()
      set.add(candidate.hit.skuId)
      claimsByWord.set(wordIndex, set)
    }
  }
  return candidates
    .filter((candidate) =>
      candidate.claimed.every((wordIndex) => (claimsByWord.get(wordIndex)?.size ?? 0) <= 1),
    )
    .map((candidate) => candidate.hit)
    .sort((a, b) => a.index - b.index)
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
  const normalized = normalize(transcript)
  const words = normalized.split(' ').filter(Boolean)
  const exactHits = findAliasHits(transcript, ledger)
  // Exact first, fuzzy only for what exact left on the table — then one order.
  const hits = [...exactHits, ...findFuzzyHits(words, normalized, exactHits, ledger)].sort(
    (a, b) => a.index - b.index,
  )

  const lines: DraftLine[] = []
  const consumed = new Set<number>()

  for (const hit of hits) {
    // `findAliasHits` indexes into a copy padded with a leading space; undo that here.
    const aliasWordIndex = normalized.slice(0, Math.max(0, hit.index - 1)).split(' ').filter(Boolean).length
    const from = Math.max(0, aliasWordIndex - 5)
    const window = words.slice(from, aliasWordIndex)

    let qty: number | null = null
    let qtySource = pickCopy(lang, {
      en: 'used 1 — no number was heard',
      fil: '1 ang ginamit — walang narinig na numero',
    })
    for (let i = window.length - 1; i >= 0; i -= 1) {
      const candidate = parseSpokenNumber(window.slice(i).join(' '))
      if (candidate !== null && candidate > 0 && candidate < 1000) {
        qty = candidate
        qtySource = window.slice(i).join(' ')
        break
      }
    }

    /*
     * If nothing was said *before* the item, listen just after it.
     *
     * "bigas, kalahating kilo" is how a weighing sale is actually spoken — the
     * item first, then the weight — and this parser only ever looked backwards,
     * so the quantity was dropped and the draft silently defaulted to one kilo.
     * That is the worst kind of failure this screen can have: the item is right,
     * the screen looks right, and only the amount is wrong. The bench in
     * tools/bench-voice-parse.mjs is what caught it.
     *
     * The search stops at a conjunction (see CONJUNCTIONS) and at the next item's
     * own words, so a number spoken for the next item can never be borrowed.
     */
    // A fuzzy hit sits on fewer transcript words than its catalogue alias
    // names (see `spanWords`), and the windows below are measured in
    // transcript words — so they use the span, not the alias length.
    const aliasWords = hit.spanWords ?? hit.alias.split(' ').filter(Boolean).length
    let qtyEnd = aliasWordIndex
    if (qty === null) {
      const forwardStart = aliasWordIndex + aliasWords
      const nextHit = hits.find((h) => h.index > hit.index)
      const nextHitWordIndex = nextHit
        ? normalized.slice(0, Math.max(0, nextHit.index - 1)).split(' ').filter(Boolean).length
        : Number.POSITIVE_INFINITY
      const limit = Math.min(words.length, forwardStart + 5, nextHitWordIndex)
      if (forwardStart < words.length && !CONJUNCTIONS.has(words[forwardStart])) {
        for (let end = forwardStart + 1; end <= limit; end += 1) {
          const candidate = parseSpokenNumber(words.slice(forwardStart, end).join(' '))
          if (candidate !== null && candidate > 0 && candidate < 1000) {
            qty = candidate
            qtySource = words.slice(forwardStart, end).join(' ')
            qtyEnd = end
            break
          }
        }
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
    /*
     * The item's own words are consumed too, and that is a fix rather than a
     * detail: nothing was ever marking them, so "nakabenta ako ng bigas" came
     * back from this function with a correct Bigas line *and* `bigas` in
     * `unresolved` — the confirmation sheet telling the owner, in amber, that it
     * did not understand the one word it had understood perfectly.
     *
     * The same goes for the words a forward-spoken quantity used.
     */
    for (let i = aliasWordIndex; i < Math.max(aliasWordIndex + aliasWords, qtyEnd); i += 1) {
      consumed.add(i)
    }

    lines.push({
      skuId: hit.skuId,
      skuName: hit.skuName,
      qty: Math.round(baseQty),
      unitPriceCentavos:
        kind === 'purchase' ? suggestedCost(ledger, hit.skuId) : suggestedPrice(ledger, hit.skuId),
      qtySource,
    })
  }

  /*
   * A customer the parser matched is a word it understood, so it must not come
   * back as "not understood" either.
   *
   * This one reached the screen: "umutang ng dalawang bigas si nena" produced a
   * correct utang line against Aling Nena *and* flagged `nena` as unplaced,
   * because the screen's own filter only knew how to exclude item names. A
   * warning that fires on a correct parse teaches the owner to ignore the line
   * that exists to catch a real mishearing.
   */
  const customerId = kind === 'credit_sale' ? findCustomer(transcript, ledger) : undefined
  if (customerId) {
    const customer = ledger.customers.find((c) => c.id === customerId)
    const spoken = new Set(
      [customer?.name ?? '', ...(customer?.aliases ?? [])]
        .flatMap((label) => normalize(label).split(' '))
        .filter(Boolean),
    )
    words.forEach((word, i) => {
      if (spoken.has(word)) consumed.add(i)
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
          en: `${quantityList} — check the numbers before recording.`,
          fil: `${quantityList} — suriin ang numero bago itala.`,
        })

  return {
    kind,
    transcript,
    customerId,
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
