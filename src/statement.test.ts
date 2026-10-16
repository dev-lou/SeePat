import { describe, expect, it } from 'vitest'
import { ageText, buildUtangStatement, readShopName, writeShopName } from './statement.ts'
import type { StatementRowInput } from './statement.ts'

/**
 * The statement is the artifact the audit ranked as the product's clear missing
 * piece: the app knew exactly who owed what and could not hand it to anyone. It
 * is also the one output that leaves the phone and lands in someone else's
 * hands, so what it says has to be right in both languages, and it must never
 * look like a document SeePat is not allowed to issue.
 */

const AS_OF = new Date(2026, 9, 16, 18, 0, 0)

const rows: StatementRowInput[] = [
  { name: 'Aling Nena', amountCentavos: 45000, daysOldest: 12, lastPaidAt: '2026-10-01T09:00:00.000Z' },
  { name: 'Mang Ben', amountCentavos: 12250, daysOldest: 0, lastPaidAt: '2026-10-16T08:00:00.000Z' },
  { name: 'Walk-in', amountCentavos: 30000, daysOldest: null, lastPaidAt: null },
]

const total = rows.reduce((sum, row) => sum + row.amountCentavos, 0)

function build(lang: 'en' | 'fil', shopName = 'Nena Store') {
  return buildUtangStatement({ rows, totalCentavos: total, asOf: AS_OF, lang, shopName })
}

describe('ageText', () => {
  it('says what a notebook says: how long the oldest unpaid debt has been sitting', () => {
    expect(ageText(rows[0], 'en')).toContain('12')
    expect(ageText(rows[1], 'en')).toBe('today')
    expect(ageText(rows[2], 'en')).toBe('never paid anything yet')
  })

  it('speaks Filipino when the app is in Filipino', () => {
    expect(ageText(rows[2], 'fil')).toBe('wala pang nababayaran')
    expect(ageText(rows[1], 'fil')).toBe('ngayon')
  })
})

describe('the statement itself', () => {
  it('numbers every line, in the order the screen shows them', () => {
    const statement = build('en')
    expect(statement.lines.map((line) => line.index)).toEqual([1, 2, 3])
    expect(statement.lines.map((line) => line.name)).toEqual(['Aling Nena', 'Mang Ben', 'Walk-in'])
  })

  it('carries the shop name, the date and the total', () => {
    const statement = build('en')
    expect(statement.title).toContain('Nena Store')
    expect(statement.shopName).toBe('Nena Store')
    expect(statement.asOfText).toBe('Oct 16, 2026')
    expect(statement.totalCentavos).toBe(total)
    expect(statement.totalText).toBe('₱872.50')
    expect(statement.countLabel).toContain('3')
  })

  it('falls back to a neutral name when the owner has not typed one', () => {
    expect(build('en', '   ').shopName).toBe('My store')
    expect(build('fil', '').shopName).toBe('Aking tindahan')
    // Whitespace is not a name, and a list headed with nothing reads as broken.
    expect(build('en', '   ').title).not.toContain('{shop}')
  })

  it('writes the shareable message as plain text a chat can carry', () => {
    const { text } = build('en')
    for (const line of ['1. Aling Nena', '2. Mang Ben', '3. Walk-in']) {
      expect(text).toContain(line)
    }
    expect(text).toContain('Still unpaid: ₱872.50')
    expect(text).toContain('Nena Store')
    expect(text).toContain('Oct 16, 2026')
    // No markup: this lands in Messenger or an SMS, not in a browser.
    expect(text).not.toMatch(/<[a-z]/i)
  })

  it('never presents itself as a BIR document', () => {
    for (const lang of ['en', 'fil'] as const) {
      const statement = build(lang)
      expect(statement.note.toLowerCase()).toContain('bir')
      expect(statement.note.toLowerCase()).toMatch(/not|hindi/)
      expect(statement.text).toContain(statement.note)
    }
  })

  it('is fully translated, with no English left inside the Filipino sheet', () => {
    const fil = build('fil')
    expect(fil.totalLabel).toBe('Hindi pa nababayaran')
    expect(fil.nameLabel).toBe('Customer')
    expect(fil.amountLabel).toBe('Halagang utang')
    expect(fil.text).toContain('Listahan ng Utang')
    expect(fil.lines[0].age).toContain('araw')
    expect(fil.text).not.toContain('Still unpaid')
  })

  it('shows money the way a collector reads it, with the sign and separators', () => {
    const statement = build('en')
    expect(statement.lines[0].amountText).toBe('₱450.00')
    expect(statement.lines[1].amountText).toBe('₱122.50')
  })
})

describe('the shop name is remembered', () => {
  it('round-trips through local storage and trims what it keeps', () => {
    // The suite runs without a DOM, so the storage the app actually writes to
    // is stubbed here rather than assumed: the point of the test is that a name
    // typed once is still there on the next statement, not that localStorage
    // exists in Node.
    const store = new Map<string, string>()
    const stub = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    }
    Object.defineProperty(globalThis, 'localStorage', { value: stub, configurable: true })

    try {
      writeShopName('  Nena Store  ')
      expect(readShopName()).toBe('Nena Store')
      writeShopName('')
      expect(readShopName()).toBe('')
    } finally {
      Reflect.deleteProperty(globalThis, 'localStorage')
    }
  })
})
