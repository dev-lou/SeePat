import { describe, expect, it } from 'vitest'
import { deriveCustomer, deriveSku, slugId } from './store.ts'

/**
 * The owner's own book: items and customers they typed themselves.
 *
 * Two things here are load-bearing and invisible, which is why they are tested
 * rather than trusted:
 *
 * 1. **The base unit.** Quantities are stored as integers in the SKU's base
 *    unit, so a kilo item MUST come back with `baseUnit: 'g'`. Get it wrong and
 *    every quantity ever recorded against that item is off by a factor of 1000 —
 *    and it looks right on screen.
 * 2. **The id.** These ids are written into the ledger and into
 *    `twin.receivables`, so they have to be stable, unique, and derived from
 *    what the owner typed rather than random.
 */

describe('an id derived from what the owner typed', () => {
  it('turns a name into a stable slug', () => {
    expect(slugId('Coke Mismo', new Set())).toBe('coke_mismo')
    expect(slugId('Aling Nena!', new Set())).toBe('aling_nena')
    expect(slugId('Kape ₱5', new Set())).toBe('kape_5')
  })

  it('is never empty, even for a name that is only punctuation', () => {
    // The UI refuses an empty name, but an id of '' would key a receivable to
    // nothing, so the fallback is deliberate.
    expect(slugId('', new Set())).toBe('item')
    expect(slugId('...', new Set())).toBe('item')
  })

  it('suffixes rather than colliding', () => {
    const taken = new Set(['coke_mismo'])
    expect(slugId('Coke Mismo', taken)).toBe('coke_mismo_2')
    expect(slugId('Coke Mismo', new Set(['coke_mismo', 'coke_mismo_2']))).toBe('coke_mismo_3')
  })
})

describe('a new item', () => {
  it('keeps a piece item in pieces', () => {
    const sku = deriveSku('Coke Mismo', 'pc', new Set())
    expect(sku.baseUnit).toBe('pc')
    expect(sku.unit).toBe('pc')
    expect(sku.id).toBe('coke_mismo')
  })

  it('stores a kilo item in grams, which is the whole reason baseUnit exists', () => {
    const sku = deriveSku('Bigas', 'kg', new Set())
    expect(sku.unit).toBe('kg')
    expect(sku.baseUnit).toBe('g')
  })

  it('trims the name, because it is printed on every row from now on', () => {
    expect(deriveSku('  Kape  ', 'sachet', new Set()).name).toBe('Kape')
  })

  it('defaults a missing unit to a piece', () => {
    expect(deriveSku('Kandila', '', new Set()).unit).toBe('pc')
    expect(deriveSku('Kandila', '   ', new Set()).baseUnit).toBe('pc')
  })

  it('is speakable, so a typed item is not a second-class one', () => {
    // The voice matcher looks for aliases. An item added by typing has to be as
    // matchable as one that shipped with the app, or voice quietly only works
    // for the demo catalogue.
    const sku = deriveSku('Lucky Me Pancit Canton', 'pc', new Set())
    expect(sku.aliases).toContain('lucky me pancit canton')
    expect(sku.aliases).toContain('lucky')
    expect(sku.aliases).toContain('pancit')
    for (const alias of sku.aliases) expect(alias).toBe(alias.toLowerCase())
  })

  it('does not repeat an alias', () => {
    const sku = deriveSku('Kape Kape', 'pc', new Set())
    const seen = new Set<string>()
    for (const alias of sku.aliases) {
      expect(seen.has(alias)).toBe(false)
      seen.add(alias)
    }
  })
})

describe('a new customer', () => {
  it('derives an id and stays speakable', () => {
    const customer = deriveCustomer('Aling Nena', new Set())
    expect(customer.id).toBe('aling_nena')
    expect(customer.name).toBe('Aling Nena')
    expect(customer.aliases).toContain('nena')
  })

  it('never reuses an id — a shared key would merge two people’s debts', () => {
    const first = deriveCustomer('Mang Tonyo', new Set())
    const second = deriveCustomer('Mang Tonyo', new Set([first.id]))
    expect(second.id).not.toBe(first.id)
    // The two keys are what `twin.receivables` is indexed by, so a collision
    // would silently pool two customers into one balance.
    expect(Object.keys({ [first.id]: 1, [second.id]: 2 })).toHaveLength(2)
  })
})
