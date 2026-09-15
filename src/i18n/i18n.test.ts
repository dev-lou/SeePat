import { describe, expect, it } from 'vitest'
import { DEFAULT_LANG, UI, getLang, interpolate, monthShort, pick, setLang, weekdayLong } from './index.ts'
import type { Entry, Lang } from './index.ts'
import { answerIntent, ask, matchIntent } from '../engine/narrator.ts'
import type { IntentId } from '../engine/narrator.ts'
import {
  BAND_COPY,
  bandFor,
  bandLabel,
  capitalComposition,
  capitalProvenance,
  computeScore,
  computeTwin,
  periodMetrics,
  scoreHistory,
  seedLedger,
} from '../engine/index.ts'
import { FEATURES, INSTITUTIONAL, TIERS } from '../billing.ts'
import { OFFLINE_MODELS } from '../asr-offline.ts'

/**
 * The language switch is a feature that fails *silently* — a string nobody
 * translated simply appears in the wrong language, and no type can catch it.
 * These tests are the guard: they assert both languages are present everywhere
 * copy is carried, and that the engine answers in the language it was asked.
 */

const NOW = new Date(2026, 8, 20, 18, 0, 0)
const ledger = seedLedger(NOW)
const twin = computeTwin(ledger)
const LANGS: Lang[] = ['en', 'fil']

function bothLanguages(entry: Entry, label: string): void {
  for (const lang of LANGS) {
    expect(entry[lang], `${label} is empty in ${lang}`).toBeTruthy()
    expect(entry[lang].trim().length, `${label} is blank in ${lang}`).toBeGreaterThan(0)
  }
}

describe('language selection', () => {
  it('defaults to English, because that is the language the product is pitched in', () => {
    expect(DEFAULT_LANG).toBe('en')
  })

  it('switches and switches back', () => {
    const original = getLang()
    setLang('fil')
    expect(getLang()).toBe('fil')
    setLang(original)
    expect(getLang()).toBe(original)
  })

  it('leaves an unknown placeholder visible rather than half-substituted', () => {
    expect(interpolate('{a} of {b}', { a: 'x' })).toBe('x of {b}')
    expect(interpolate('no placeholders')).toBe('no placeholders')
  })
})

describe('screen copy is complete in both languages', () => {
  const entries = Object.entries(UI) as [string, Entry][]

  it('ships a substantial dictionary', () => {
    // A guard against a refactor accidentally emptying the table.
    expect(entries.length).toBeGreaterThan(150)
  })

  it('has every string in both languages', () => {
    for (const [key, entry] of entries) bothLanguages(entry, key)
  })

  it('never leaves a placeholder unresolved in either language', () => {
    for (const [key, entry] of entries) {
      const params = { n: 1, date: 'x', mb: 1, runtime: 1, amount: '₱1', tier: 'PRO', what: 'x', done: 'a', total: 'b', pct: '1', sign: '+', name: 'x', qty: 1, label: 'x' }
      for (const lang of LANGS) {
        const rendered = interpolate(entry[lang], params)
        expect(rendered, `${key} in ${lang} kept a raw {placeholder}`).not.toMatch(/\{\w+\}/)
      }
    }
  })

  it('keeps brand and product names stable across languages', () => {
    // Intentional exceptions, listed so a future reader knows they are choices
    // rather than gaps: the product's own words do not change language.
    expect(pick('fil', UI['tab.twin'])).toBe(pick('en', UI['tab.twin']))
    expect(pick('fil', UI['record.walkIn'])).toBe(pick('en', UI['record.walkIn']))
  })
})

describe('the engine answers in the language it was asked', () => {
  const cases: [string, IntentId][] = [
    ['How much did I earn this week?', 'profit_period'],
    ['Where is my capital?', 'capital_where'],
    ['Where did my money go?', 'capital_provenance'],
    ['What is my strongest item?', 'top_product'],
    ['What is not moving?', 'slow_movers'],
    ['Who owes me the most?', 'biggest_utang'],
    ['Why did my profit drop?', 'profit_change'],
    ['Why is my cash short when sales are strong?', 'cash_why_low'],
    ['What should I restock first?', 'restock'],
    ['How is my business doing?', 'score'],
  ]

  const context = { ledger, twin, now: NOW }

  it('understands the English versions of its own suggestions', () => {
    // A suggested question that lands in `unknown` is worse than no suggestion.
    for (const [question, intent] of cases) {
      expect(matchIntent(question), question).toBe(intent)
    }
  })

  it('still understands the Filipino originals', () => {
    expect(matchIntent('Magkano kinita ko ngayong linggo?')).toBe('profit_period')
    expect(matchIntent('Nasaan ang puhunan ko?')).toBe('capital_where')
    expect(matchIntent('Sino ang may pinakamalaking utang?')).toBe('biggest_utang')
  })

  it('writes the whole answer — headline, detail and evidence — in the asked language', () => {
    for (const [question, intent] of cases) {
      // Same intent, same ledger, same numbers: the only variable is the
      // language, which is what makes this a real test of the switch.
      expect(matchIntent(question), question).toBe(intent)
      const english = answerIntent(intent, context, 'en')
      const filipino = answerIntent(intent, context, 'fil')
      const shape = (answer: typeof english) =>
        [answer.headline, ...answer.detail, ...answer.evidence.map((e) => e.label)].join(' | ')

      expect(shape(english).length).toBeGreaterThan(0)
      expect(shape(filipino), `${intent} is identical in both languages`).not.toBe(shape(english))
    }
  })

  it('produces identical numbers in both languages', () => {
    const english = ask('How much did I earn this week?', context, 'en')
    const filipino = ask('Magkano kinita ko ngayong linggo?', context, 'fil')
    const numbers = (text: string) => text.match(/₱[\d,.]+/g) ?? []

    // The money is the money: only the words around it may differ.
    expect(numbers(filipino.headline)).toEqual(numbers(english.headline))
    expect(numbers(filipino.detail.join(' '))).toEqual(numbers(english.detail.join(' ')))
  })

  it('offers example questions in the language it is read in', () => {
    const english = ask('sino ang pangulo ng pilipinas', context, 'en')
    const filipino = ask('sino ang pangulo ng pilipinas', context, 'fil')

    expect(english.intent).toBe('unknown')
    expect(english.detail.join(' ')).toContain('Where is my capital?')
    expect(filipino.detail.join(' ')).toContain('Nasaan ang puhunan ko?')
  })
})

describe('engine copy carried as data is bilingual', () => {
  it('labels every capital position in both languages', () => {
    const composition = capitalComposition(twin, 'en')
    for (const component of composition.components) {
      bothLanguages(component.label, `capital component ${component.key}`)
      if (component.note) bothLanguages(component.note, `note for ${component.key}`)
    }

    const provenance = capitalProvenance(twin)
    for (const line of [...provenance.sources, ...provenance.uses]) {
      bothLanguages(line.label, `provenance line ${line.key}`)
    }
  })

  it('writes the capital narrative in the requested language', () => {
    const english = capitalComposition(twin, 'en').narrative
    const filipino = capitalComposition(twin, 'fil').narrative

    expect(english.length).toBe(filipino.length)
    for (let i = 0; i < english.length; i += 1) {
      expect(filipino[i]).not.toBe(english[i])
    }
  })

  it('names every band in both languages', () => {
    for (const band of ['strong', 'good', 'watch', 'critical'] as const) {
      bothLanguages(BAND_COPY[band], `band ${band}`)
    }
    expect(bandLabel(bandFor(76), 'fil')).toBe('Maayos')
    expect(bandLabel(bandFor(76), 'en')).toBe('Good')
  })

  it('keeps the score history labels in the reading language', () => {
    const english = scoreHistory(ledger, 4, NOW, 'en').weeks.map((w) => w.label)
    const filipino = scoreHistory(ledger, 4, NOW, 'fil').weeks.map((w) => w.label)

    for (const label of english) expect(label).toMatch(/^[A-Z][a-z]{2} \d+/)
    for (const label of filipino) expect(label).toMatch(/^[A-Z][a-z]{2} \d+/)
    expect(filipino).not.toEqual(english)
  })

  it('describes every plan, feature and offline model in both languages', () => {
    for (const tier of TIERS) {
      bothLanguages(tier.tagline, `${tier.id} tagline`)
      bothLanguages(tier.audience, `${tier.id} audience`)
      bothLanguages(tier.period, `${tier.id} period`)
    }
    bothLanguages(INSTITUTIONAL.name, 'institutional name')
    bothLanguages(INSTITUTIONAL.tagline, 'institutional tagline')

    for (const feature of FEATURES) {
      bothLanguages(feature.label, `feature ${feature.key}`)
      if (feature.note) bothLanguages(feature.note, `feature note ${feature.key}`)
    }

    for (const model of OFFLINE_MODELS) {
      bothLanguages(model.label, `model ${model.key}`)
      bothLanguages(model.languages, `model languages ${model.key}`)
      bothLanguages(model.license, `model licence ${model.key}`)
      bothLanguages(model.why, `model rationale ${model.key}`)
    }
  })

  it('has a score computed in either language that never changes its value', () => {
    const context = {
      twin,
      metrics: periodMetrics(ledger, 7, NOW),
      openingInventoryValueCentavos: 0,
    }
    expect(computeScore(context, 'en').value).toBe(computeScore(context, 'fil').value)
  })

  it('has date tables with all twelve months and seven days', () => {
    for (const lang of LANGS) {
      for (let month = 0; month < 12; month += 1) {
        const date = new Date(2026, month, 15)
        expect(monthShort(date, lang).length).toBeGreaterThan(1)
      }
      for (let day = 0; day < 7; day += 1) {
        expect(weekdayLong(new Date(2026, 8, 13 + day), lang).length).toBeGreaterThan(2)
      }
    }
    expect(monthShort(new Date(2026, 8, 15), 'fil')).toBe('Set')
    expect(monthShort(new Date(2026, 8, 15), 'en')).toBe('Sep')
    expect(weekdayLong(new Date(2026, 8, 15), 'fil')).toBe('Martes')
    expect(weekdayLong(new Date(2026, 8, 15), 'en')).toBe('Tuesday')
  })
})
