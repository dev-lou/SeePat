import { describe, expect, it } from 'vitest'
import { parseReceiptText, receiptToTransaction } from './receipt.ts'
import type { Ledger } from './types.ts'

function ledger(): Ledger {
  return {
    skus: [
      { id: 'lucky_me', name: 'Lucky Me Pancit', unit: 'pc', baseUnit: 'pc', aliases: ['lucky me', 'lucky me pancit', 'pancit'] },
      { id: 'coke_mismo', name: 'Coke Mismo', unit: 'pc', baseUnit: 'pc', aliases: ['coke', 'coke mismo'] },
      { id: 'asukal', name: 'Asukal', unit: 'kg', baseUnit: 'g', aliases: ['asukal', 'sugar'] },
    ],
    customers: [],
    transactions: [],
    voids: [],
  }
}

describe('parseReceiptText', () => {
  it('parses Puregold-style lines with qty × price', () => {
    const draft = parseReceiptText(
      ['PUREGOLD DINGLE', 'LUCKY ME PANCIT 2 x 12.00 24.00', 'COKE MISMO 3 @ 15.00 45.00', 'TOTAL 69.00'].join('\n'),
      ledger(),
    )
    expect(draft.lines).toHaveLength(2)
    expect(draft.lines[0].skuId).toBe('lucky_me')
    expect(draft.lines[0].qty).toBe(2)
    expect(draft.lines[0].unitPriceCentavos).toBe(1200)
    expect(draft.lines[1].qty).toBe(3)
    expect(draft.supplierGuess).toMatch(/puregold/i)
    expect(draft.receiptTotalCentavos).toBe(6900)
    expect(draft.totalsMismatch).toBe(false)
  })

  it('implies qty 1 when only a price is printed', () => {
    const draft = parseReceiptText('COKE MISMO 15.00', ledger())
    expect(draft.lines).toHaveLength(1)
    expect(draft.lines[0].qty).toBe(1)
    expect(draft.lines[0].skuId).toBe('coke_mismo')
  })

  it('flags unknown items as new-SKU proposals, never silently', () => {
    const draft = parseReceiptText('MAGIC SARAP 5 x 8.00 40.00', ledger())
    expect(draft.lines).toHaveLength(1)
    expect(draft.lines[0].skuId).toBeNull()
    expect(draft.lines[0].needsReview).toBe(true)
    expect(draft.lines[0].reason).toBe('new-item')
  })

  it('detects totals mismatch instead of hiding it', () => {
    const draft = parseReceiptText(
      ['LUCKY ME PANCIT 2 x 12.00 24.00', 'TOTAL 999.00'].join('\n'),
      ledger(),
    )
    expect(draft.totalsMismatch).toBe(true)
  })

  it('tolerates OCR typos without inventing items', () => {
    const draft = parseReceiptText('LCKY ME PANCIT 2 x 12.00 24.00', ledger())
    expect(draft.lines[0].skuId).toBe('lucky_me')
    expect(draft.lines[0].needsReview).toBe(true)
  })

  it('returns an empty honest draft for garbage input', () => {
    const draft = parseReceiptText('--- *** ---', ledger())
    expect(draft.lines).toHaveLength(0)
    expect(draft.needsConfirmation).toBe(true)
  })

  it('never drafts an item off a 2-letter fragment inside a longer name', () => {
    // Regression: a face photo OCR'd as "po", and "po" sits inside
    // "shampoo" — the old substring match drafted a Shampoo Sachet line.
    const draft = parseReceiptText('po', ledger())
    expect(draft.lines).toHaveLength(0)
  })

  it('drops price-less fragments when nothing in the photo has a price', () => {
    // A non-receipt photo reads as stray words; with no money token anywhere
    // there is nothing grounding a draft, so nothing is drafted.
    const draft = parseReceiptText(['po', 'face here'].join('\n'), ledger())
    expect(draft.lines).toHaveLength(0)
  })

  it('drafts nothing from a face photo full of stray digits', () => {
    // Regression: Tesseract read a selfie as 15 garbage fragments, two with
    // lone bare digits ("pad Pps ve 3 SL") that parsed as ₱3.00 each.
    // Thermal printers write centavos — bare digits are not prices.
    const face = [
      'S17 Sedat LMR ie eT',
      'ARISES Ee',
      'ORE',
      'Be =D pc',
      'x = SA',
      '3 gira IY es [re',
      'E Foy; Tee E',
      ': i ES',
      '= Fr ps',
      'ag » ibd iad',
      'pad Pps ve 3 SL',
    ].join('\n')
    const draft = parseReceiptText(face, ledger())
    expect(draft.lines).toHaveLength(0)
  })

  it('drops price-less lines even when a priced line is present', () => {
    // Price-only gate: "BIGAS" has no decimal price, so it is junk until the
    // owner adds it by hand — the priced line still drafts normally.
    const draft = parseReceiptText(['BIGAS', 'COKE MISMO 15.00'].join('\n'), ledger())
    expect(draft.lines).toHaveLength(1)
    expect(draft.lines[0].unitPriceCentavos).toBe(1500)
  })
})

describe('receiptToTransaction', () => {
  it('requires confirmed lines and stamps camera provenance', () => {
    const txn = receiptToTransaction(
      [{ skuId: 'coke_mismo', qty: 3, unitPriceCentavos: 1500 }],
      { id: 'pur-x', at: new Date().toISOString(), photoId: 'rc-1', supplier: 'PUREGOLD', createSku: () => 'never' },
    )
    expect(txn.kind).toBe('purchase')
    expect(txn.source).toBe('camera')
    expect(txn.paidCentavos).toBe(4500)
    expect(txn.note).toContain('rc-1')
  })

  it('creates SKUs only for checked new-item rows', () => {
    const created: string[] = []
    const txn = receiptToTransaction(
      [
        { skuId: '', newSkuName: 'Magic Sarap', qty: 5, unitPriceCentavos: 800 },
        { skuId: '', newSkuName: '   ', qty: 1, unitPriceCentavos: 100 },
      ],
      { id: 'pur-y', at: new Date().toISOString(), photoId: 'rc-2', createSku: (n) => { created.push(n); return 'magic_sarap' } },
    )
    expect(created).toEqual(['Magic Sarap'])
    expect(txn.lines).toHaveLength(1)
    expect(txn.lines[0].skuId).toBe('magic_sarap')
  })
})
