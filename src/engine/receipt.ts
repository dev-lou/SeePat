import { pesos } from './money.ts'
import type { Centavos } from './money.ts'
import type { Ledger, SkuId } from './types.ts'
import type { Lang } from '../i18n/index.ts'

/**
 * Resibo-to-Draft — deterministic receipt text → purchase draft.
 *
 * OCR gives us text lines, never transactions. This module turns those lines
 * into a *draft* the owner must confirm. It never writes to the ledger itself;
 * `receiptToTransaction` requires explicitly confirmed lines, mirroring
 * `draftToTransaction` in voice.ts. That is what makes "camera never silently
 * modifies financial records" a property of the code.
 *
 * v1 scope (per plan): printed supplier receipts (Puregold / wholesaler /
 * grocery thermal), offline-first, Tagalog + English print via Latin script.
 * Handwriting is out — flagged as needsReview, never trusted.
 */

export interface ReceiptDraftLine {
  /** Verbatim OCR line this came from — kept so the owner can audit. */
  rawText: string
  /** Best-guess item name after stripping qty/price tokens. */
  nameCandidate: string
  /** Matched catalogue item, or null when this proposes a new SKU. */
  skuId: SkuId | null
  /** Display name for the review row (matched SKU name or candidate). */
  displayName: string
  /** Quantity in display units (pc, or kg for weighed goods). */
  qty: number
  /** Unit price in centavos, per *display* unit — same convention as Record. */
  unitPriceCentavos: Centavos
  lineTotalCentavos: Centavos
  /** 0..1 — low values force manual check before confirm is enabled. */
  confidence: number
  needsReview: boolean
  /** Why review is needed — shown on the row, not hidden in a log. */
  reason?: string
}

export interface ReceiptDraft {
  /** Raw OCR text, preserved for audit + re-parse. */
  ocrText: string
  supplierGuess: string
  receiptTotalCentavos: Centavos | null
  lines: ReceiptDraftLine[]
  /** True when Σ lines ≠ receipt total, or any line needs review. */
  totalsMismatch: boolean
  /** Always true: the owner must confirm before anything posts. */
  needsConfirmation: true
  summary: string
}

export interface ConfirmedReceiptLine {
  /** Empty skuId + name means "create this SKU on confirm". */
  skuId: SkuId | ''
  newSkuName?: string
  newSkuUnit?: string
  qty: number
  unitPriceCentavos: Centavos
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[“”"']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** ₱1,234.50 / P 45.00 / PHP 12 / 45.00 — all the ways thermal prints money. */
function parseMoneyToken(token: string): number | null {
  const cleaned = token
    .replace(/₱/g, '')
    .replace(/\b(p|php)\b\.?/gi, '')
    .replace(/[, ]/g, '')
    .trim()
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const value = Number(cleaned)
  if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) return null
  return Math.round(value * 100)
}

/** Small edit distance for typo-tolerant SKU matching ("LCKY ME" → "LUCKY ME"). */
function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i += 1) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const temp = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = temp
    }
  }
  return prev[b.length]
}

function matchSku(candidate: string, ledger: Ledger): { skuId: SkuId | null; score: number } {
  const norm = normalize(candidate)
  if (!norm) return { skuId: null, score: 0 }
  let best: SkuId | null = null
  let bestScore = 0
  for (const sku of ledger.skus) {
    const names = [sku.name, ...sku.aliases]
    for (const label of names) {
      const target = normalize(label)
      if (!target) continue
      // Substring matches need at least 3 letters: "po" is inside "shampoo",
      // and a 2-letter OCR fragment must never draft a phantom item off it.
      // (Exact equality below still applies at any length.)
      if (norm === target || (norm.length >= 3 && (norm.includes(target) || target.includes(norm)))) {
        const score = Math.min(1, (Math.min(norm.length, target.length) + 2) / (Math.max(norm.length, target.length) + 2))
        if (score > bestScore) {
          bestScore = score
          best = sku.id
        }
        continue
      }
      const dist = editDistance(norm, target)
      const allowed = target.length <= 5 ? 1 : 2
      if (dist <= allowed) {
        const score = 0.7 - dist * 0.1
        if (score > bestScore) {
          bestScore = score
          best = sku.id
        }
      }
    }
  }
  return { skuId: best, score: bestScore }
}

const SUPPLIER_HINTS = ['puregold', 'gaisano', 'savemore', 'sm ', '7-eleven', '7 eleven', 'palengke', 'wholesaler', 'grocery', 'trabzon', 'ultramega']

function guessSupplier(lines: string[]): string {
  const head = lines.slice(0, 6).map(normalize).join(' | ')
  for (const hint of SUPPLIER_HINTS) {
    if (head.includes(hint.trim())) {
      const raw = lines.slice(0, 6).find((l) => normalize(l).includes(hint.trim()))
      if (raw) return raw.trim().slice(0, 48)
    }
  }
  return ''
}

/** TOTAL / AMOUNT DUE / CASH / CHANGE — last money on those rows wins. */
function guessTotal(lines: string[]): Centavos | null {
  const totalRow = [...lines].reverse().find((l) => /total|amount due|balance|net\b/i.test(l))
  const candidates = totalRow ? [totalRow, ...lines.slice(-4)] : lines.slice(-4)
  for (const line of candidates) {
    const tokens = line.replace(/[|]/g, ' ').split(/\s+/).filter(Boolean)
    for (let i = tokens.length - 1; i >= 0; i -= 1) {
      const money = parseMoneyToken(tokens[i].replace(/[.,;:]+$/, ''))
      if (money !== null) return money
    }
  }
  return null
}

interface ParsedLine {
  qty: number
  nameCandidate: string
  unitPriceCentavos: Centavos | null
  lineTotalCentavos: Centavos | null
}

/**
 * One OCR line → qty + name + prices.
 *
 * Handles the shapes thermal printers actually emit:
 * - `2 x LUCKY ME PANCIT 12.00`
 * - `LUCKY ME 2 @ 12.00`
 * - `1.5 KG ASUKAL 84.00`
 * - `COKE MISMO 15.00` (qty 1 implied)
 */
function parseLine(raw: string): ParsedLine | null {
  const text = raw.replace(/[|]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!text || text.length < 2) return null
  if (/^(total|amount|change|cash|thank|vat|tin|or no|address|tel|date)/i.test(text)) return null

  // Strip leading index ("1. COKE ...") that DOT-matrix counters print.
  const deindexed = text.replace(/^\d{1,3}[.)]\s+/, '')
  const tokens = deindexed.split(' ').filter(Boolean)
  if (tokens.length === 0) return null

  // Trailing money tokens: [..., unitPrice?, lineTotal]. One money token =
  // both (qty 1 implied or qty given). Two+ = last is total, prev is unit.
  const moneyIdx: number[] = []
  tokens.forEach((tok, i) => {
    if (parseMoneyToken(tok.replace(/[.,;:]+$/, '')) !== null) moneyIdx.push(i)
  })
  // Bare integers ("3") are not prices until proven otherwise: Tesseract
  // garbage is full of stray digits, and treating each as ₱3.00 invents money.
  // A money token only counts as a price with centavos ("12.00"); without one
  // the line falls through to the price-less candidate below, where the
  // document gate decides its fate. Real thermal printers write centavos, so
  // genuine lines are unaffected — a bare-int real line just asks for its
  // price by hand instead of getting a wrong one for free.
  const pricedIdx = moneyIdx.filter((i) => /\d+\.\d{1,2}/.test(tokens[i]))
  if (pricedIdx.length === 0) {
    // No price at all — keep as review-only candidate if it looks like goods.
    if (tokens.length >= 1 && /[a-zA-Z]{2,}/.test(text)) {
      return { qty: 1, nameCandidate: deindexed, unitPriceCentavos: null, lineTotalCentavos: null }
    }
    return null
  }
  const moneyIdx2 = pricedIdx

  const lastMoney = moneyIdx2[moneyIdx2.length - 1]
  const prevMoney = moneyIdx2.length > 1 ? moneyIdx2[moneyIdx2.length - 2] : null
  const lineTotal = parseMoneyToken(tokens[lastMoney].replace(/[.,;:]+$/, ''))!
  const unitPrice = prevMoney !== null ? parseMoneyToken(tokens[prevMoney].replace(/[.,;:]+$/, ''))! : lineTotal

  const head = tokens.slice(0, prevMoney ?? lastMoney)
  let qty = 1
  const nameParts: string[] = []
  const qtyRe = /^(\d+(?:\.\d+)?)\s*(?:x|×|@|\*)?$/i
  const kiloRe = /^(\d+(?:\.\d+)?)\s*(kg|kilo|kilos|g|gramo|grams?)$/i
  let qtyUnit: string | null = null
  for (const tok of head) {
    const kilo = tok.match(kiloRe) ?? null
    // "1.5KG" arrives as one token; "1.5 KG" as two — handle both below.
    const compact = tok.match(/^(\d+(?:\.\d+)?)(kg|g|x)$/i)
    if (/^(x|×|@|\*)$/i.test(tok)) continue
    if (kilo) {
      qty = Number(kilo[1])
      qtyUnit = kilo[2].toLowerCase()
      continue
    }
    if (compact && nameParts.length === 0 && qty === 1) {
      qty = Number(compact[1])
      if (/^kg|g$/i.test(compact[2])) qtyUnit = compact[2].toLowerCase()
      continue
    }
    const q = tok.match(qtyRe)
    if (q && nameParts.length === 0) {
      qty = Number(q[1])
      continue
    }
    if (/^(kg|kilo|kilos|g|gramo|grams?|pc|pcs|pcks?)$/i.test(tok) && nameParts.length <= 2) {
      qtyUnit = tok.toLowerCase()
      continue
    }
    nameParts.push(tok)
  }
  // "2 x" split across tokens leaves qty set and name clean; "LUCKY ME 2 @"
  // (qty after name) is the wholesaler habit — recover it.
  if (nameParts.length >= 2) {
    const tailQty = nameParts[nameParts.length - 1].match(/^(\d+(?:\.\d+)?)$/)
    const tailAt = nameParts.length >= 2 && /^(@|x|×)$/i.test(nameParts[nameParts.length - 2])
    if (tailQty && (tailAt || qty === 1)) {
      qty = Number(tailQty[1])
      nameParts.splice(nameParts.length - (tailAt ? 2 : 1), tailAt ? 2 : 1)
    }
  }
  if (!Number.isFinite(qty) || qty <= 0 || qty > 9999) qty = 1
  void qtyUnit
  const nameCandidate = nameParts.join(' ').replace(/\s*[x×@*]\s*$/i, '').trim() || deindexed
  return { qty, nameCandidate, unitPriceCentavos: unitPrice, lineTotalCentavos: lineTotal }
}

/**
 * OCR text → purchase draft. Pure: assertable without a camera or a model.
 * Numbers are never trusted blindly — anything fuzzy is flagged `needsReview`.
 */
export function parseReceiptText(ocrText: string, ledger: Ledger, lang: Lang = 'fil'): ReceiptDraft {
  const rawLines = ocrText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const supplierGuess = guessSupplier(rawLines)
  const receiptTotalCentavos = guessTotal(rawLines)

  // Document gate: a photo of a face has no real prices, while a genuine
  // receipt always prints at least one decimal price ("12.00"). Price-less
  // guess lines are only kept when some line in the same photo carries one —
  // otherwise every OCR fragment ("po") becomes a phantom item.
  //
  // Decimals are required deliberately: Tesseract garbage is full of stray
  // bare digits ("pad Pps ve 3 SL"), and a lone "3" parses as ₱3.00. Thermal
  // printers write prices with centavos, so grounding on decimal money kills
  // face-photo drafts without touching real receipts.
  const hasPricedLine = rawLines.some((raw) =>
    raw
      .replace(/[|]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .some(
        (tok) =>
          /\d+\.\d{1,2}/.test(tok) && parseMoneyToken(tok.replace(/[.,;:]+$/, '')) !== null,
      ),
  )

  const lines: ReceiptDraftLine[] = []
  for (const raw of rawLines) {
    // Store headers carry no prices and are never goods: "PUREGOLD DINGLE"
    // would otherwise become a phantom ₱0 line the owner must delete.
    if (!/\d/.test(raw) && SUPPLIER_HINTS.some((h) => normalize(raw).includes(h.trim()))) continue
    const parsed = parseLine(raw)
    if (!parsed) continue
    if (parsed.unitPriceCentavos === null && !hasPricedLine) continue
    const { skuId, score } = matchSku(parsed.nameCandidate, ledger)
    const sku = ledger.skus.find((s) => s.id === skuId)
    const needsPrice = parsed.unitPriceCentavos === null
    // Unit price implied from total/qty when the printer only shows the total.
    let unitPrice = parsed.unitPriceCentavos ?? 0
    if (parsed.unitPriceCentavos !== null && parsed.lineTotalCentavos !== null && parsed.qty > 1) {
      const implied = Math.round(parsed.lineTotalCentavos / parsed.qty)
      if (Math.abs(implied - parsed.unitPriceCentavos) <= Math.max(2, parsed.unitPriceCentavos * 0.02)) {
        unitPrice = parsed.unitPriceCentavos
      } else if (parsed.lineTotalCentavos === parsed.unitPriceCentavos) {
        unitPrice = implied
      }
    }
    const lineTotal = parsed.lineTotalCentavos ?? Math.round(unitPrice * parsed.qty)
    const confidence = needsPrice ? 0.3 : skuId ? Math.min(0.95, 0.55 + score * 0.4) : 0.45
    const reasons: string[] = []
    if (!skuId) reasons.push('new-item')
    if (needsPrice) reasons.push('no-price')
    if (score > 0 && score < 0.85 && skuId) reasons.push('fuzzy-match')
    lines.push({
      rawText: raw,
      nameCandidate: parsed.nameCandidate,
      skuId,
      displayName: sku?.name ?? parsed.nameCandidate,
      qty: parsed.qty,
      unitPriceCentavos: unitPrice,
      lineTotalCentavos: lineTotal,
      confidence,
      needsReview: reasons.length > 0,
      reason: reasons[0],
    })
  }

  const linesSum = lines.reduce((s, l) => s + l.lineTotalCentavos, 0)
  const totalsMismatch =
    receiptTotalCentavos !== null &&
    lines.length > 0 &&
    Math.abs(linesSum - receiptTotalCentavos) > Math.max(100, receiptTotalCentavos * 0.01)

  const reviewCount = lines.filter((l) => l.needsReview).length
  // Summary follows the app language — an English screen must never show a
  // Tagalog sentence. `lang` defaults to 'fil' so existing callers/tests
  // without a language keep their old snapshots.
  const summary =
    lines.length === 0
      ? lang === 'en'
        ? 'No lines recognised on the receipt — try retaking it more clearly.'
        : 'Walang nakilalang linya sa resibo — subukang kuhanan muli nang mas malinaw.'
      : lang === 'en'
        ? `${lines.length} lines from the receipt${reviewCount > 0 ? `, ${reviewCount} need${reviewCount === 1 ? 's' : ''} a check` : ''} — review before recording.`
        : `${lines.length} linya mula sa resibo${reviewCount > 0 ? `, ${reviewCount} kailangan ng check` : ''} — suriin bago itala.`

  return {
    ocrText,
    supplierGuess,
    receiptTotalCentavos,
    lines,
    totalsMismatch,
    needsConfirmation: true,
    summary,
  }
}

/**
 * Only path from a receipt draft to a real purchase. Requires explicitly
 * confirmed lines — there is no overload that accepts a raw draft, and the
 * photo id is kept in the note so the record stays auditable.
 */
export function receiptToTransaction(
  confirmed: ConfirmedReceiptLine[],
  opts: { id: string; at: string; photoId: string; supplier?: string; createSku: (name: string, unit?: string) => SkuId; lang?: Lang },
): { kind: 'purchase'; id: string; at: string; lines: { skuId: SkuId; qty: number; unitCostCentavos: Centavos }[]; paidCentavos: Centavos; note?: string; source: 'camera' } {
  const lines = confirmed
    .filter((l) => (l.skuId || l.newSkuName?.trim()) && l.qty > 0 && l.unitPriceCentavos > 0)
    .map((l) => {
      const skuId = l.skuId || opts.createSku(l.newSkuName!.trim(), l.newSkuUnit ?? 'pc')
      return {
        skuId,
        // Receipt qty is in display units (pc); weighed-goods kg handling
        // lives in the review row, which converts before confirming.
        qty: Math.round(l.qty),
        unitCostCentavos: l.unitPriceCentavos,
      }
    })
  const total = lines.reduce((s, l) => s + l.qty * l.unitCostCentavos, 0)
  const supplierBit = opts.supplier ? ` — ${opts.supplier}` : ''
  return {
    kind: 'purchase',
    id: opts.id,
    at: opts.at,
    lines,
    paidCentavos: total,
    note: `${opts.lang === 'en' ? 'Receipt' : 'Resibo'} ${opts.photoId}${supplierBit}`,
    source: 'camera',
  }
}

/** Demo OCR text used when the owner taps "Subukan ang sample" — no camera needed. */
export const SAMPLE_RECEIPT_TEXT = [
  'PUREGOLD DINGLE',
  'LUCKY ME PANCIT 2 x 12.00 24.00',
  'COKE MISMO 3 @ 15.00 45.00',
  '1.5 KG ASUKAL 84.00',
  'TOTAL 153.00',
].join('\n')

export function emptyDraft(ocrText: string): ReceiptDraft {
  return {
    ocrText,
    supplierGuess: '',
    receiptTotalCentavos: null,
    lines: [],
    totalsMismatch: false,
    needsConfirmation: true,
    summary: 'Walang nakilalang linya sa resibo — subukang kuhanan muli nang mas malinaw.',
  }
}

export { pesos }
