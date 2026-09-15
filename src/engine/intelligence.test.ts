import { describe, expect, it } from 'vitest'
import { formatPHP } from './money.ts'
import { computeTwin, deriveTwin } from './twin.ts'
import { periodMetrics } from './metrics.ts'
import { SCORE_VERSION, bandFor, bandLabel, computeScore } from './score.ts'
import { ask, matchIntent } from './narrator.ts'
import { parseSpoken, parseSpokenNumber, draftToTransaction, detectDraftKind } from './voice.ts'
import { seedLedger, DEMO_SKUS, DEMO_CUSTOMERS } from './demo.ts'
import type { Ledger } from './types.ts'
import type { Lang } from '../i18n/index.ts'

const NOW = new Date(2026, 8, 20, 18, 0, 0)
const ledger: Ledger = seedLedger(NOW)
const twin = computeTwin(ledger)

function scoreOf(l: Ledger, now: Date, lang: Lang = 'en') {
  return computeScore(
    {
      twin: computeTwin(l),
      metrics: periodMetrics(l, 7, now),
      openingInventoryValueCentavos: 0,
    },
    lang,
  )
}

describe('Sipat Score', () => {
  it('is versioned', () => {
    expect(scoreOf(ledger, NOW).version).toBe(SCORE_VERSION)
  })

  it('publishes weights that sum to exactly 1', () => {
    const total = scoreOf(ledger, NOW).dimensions.reduce((s, d) => s + d.weight, 0)
    expect(total).toBeCloseTo(1, 10)
  })

  it('is decomposable: contributions sum to the headline value', () => {
    const score = scoreOf(ledger, NOW)
    const summed = score.dimensions.reduce((s, d) => s + d.contribution, 0)
    expect(Math.round(summed)).toBe(score.value)
  })

  it('is reproducible — the same ledger always yields the same score', () => {
    expect(scoreOf(ledger, NOW).value).toBe(scoreOf(ledger, NOW).value)
  })

  it('keeps every sub-score inside 0–100', () => {
    for (const d of scoreOf(ledger, NOW).dimensions) {
      expect(d.score).toBeGreaterThanOrEqual(0)
      expect(d.score).toBeLessThanOrEqual(100)
    }
  })

  it('explains each dimension in plain language', () => {
    for (const d of scoreOf(ledger, NOW).dimensions) {
      expect(d.explanation.length).toBeGreaterThan(10)
      expect(d.rawValue.length).toBeGreaterThan(0)
    }
  })

  it('bands consistently with the documented example of 76, shown as Maayos in Filipino', () => {
    // The band is a key now, and the label is dressed for display — which is what
    // lets the same reading read as "Maayos" or "Good" without the engine
    // knowing which language it is being read in.
    expect(bandFor(76)).toBe('good')
    expect(bandFor(90)).toBe('strong')
    expect(bandFor(55)).toBe('watch')
    expect(bandFor(20)).toBe('critical')

    expect(bandLabel(bandFor(76), 'fil')).toBe('Maayos')
    expect(bandLabel(bandFor(76), 'en')).toBe('Good')
    expect(bandLabel(bandFor(90), 'fil')).toBe('Malakas')
    expect(bandLabel(bandFor(20), 'fil')).toBe('Problema')
  })

  it('reads the same arithmetic in both languages', () => {
    const en = scoreOf(ledger, NOW, 'en')
    const fil = scoreOf(ledger, NOW, 'fil')

    // The numbers must not move when the language changes — only the sentences.
    expect(fil.value).toBe(en.value)
    expect(fil.band).toBe(en.band)
    expect(fil.dimensions.map((d) => d.score)).toEqual(en.dimensions.map((d) => d.score))
    expect(fil.dimensions.map((d) => d.key)).toEqual(en.dimensions.map((d) => d.key))

    // …and the sentences must actually differ, or the switch is a no-op.
    for (let i = 0; i < en.dimensions.length; i += 1) {
      expect(fil.dimensions[i].explanation).not.toBe(en.dimensions[i].explanation)
    }
    // Only the two dimensions whose raw value carries a unit *word* differ there;
    // a percentage or a bare ratio is the same figure in either language, and
    // asserting otherwise would be testing the translator's punctuation.
    expect(en.dimensions[1].rawValue).toContain('a week')
    expect(fil.dimensions[1].rawValue).toContain('linggong gastos')
    expect(en.dimensions[2].rawValue).toContain('in 7 days')
    expect(fil.dimensions[2].rawValue).toContain('bawat 7 araw')
  })

  it('carries both short label and formal term for every dimension', () => {
    for (const dim of scoreOf(ledger, NOW, 'en').dimensions) {
      for (const lang of ['en', 'fil'] as Lang[]) {
        expect(dim.label[lang].length).toBeGreaterThan(1)
        expect(dim.term[lang].length).toBeGreaterThan(1)
      }
    }
  })

  it('flags insufficient data rather than inventing a score', () => {
    const empty: Ledger = { ...ledger, transactions: [] }
    expect(scoreOf(empty, NOW).sufficientData).toBe(false)
  })
})

describe('Ask My Negosyo understands the documented questions', () => {
  const cases: [string, string][] = [
    ['Magkano kinita ko ngayong linggo?', 'profit_period'],
    ['Nasaan ang puhunan ko?', 'capital_where'],
    ['Saan napunta ang pera ko?', 'capital_provenance'],
    ['Ano ang pinakamalakas kong paninda?', 'top_product'],
    ['Ano ang hindi gumagalaw na paninda?', 'slow_movers'],
    ['Sino ang may pinakamalaking utang?', 'biggest_utang'],
    ['Bakit bumaba ang kita ko?', 'profit_change'],
    ['Bakit wala akong cash kahit malakas ang benta?', 'cash_why_low'],
    ['Kung ganito ang benta ko, magkano kaya ang kikitain ko next week?', 'sales_forecast'],
    ['Kumusta ang negosyo ko?', 'score'],
    ['Ano ang dapat kong bilhin bukas?', 'restock'],
  ]

  for (const [question, intent] of cases) {
    it(`maps "${question}" to ${intent}`, () => {
      expect(matchIntent(question)).toBe(intent)
    })
  }

  it('answers every documented question with content', () => {
    for (const [question] of cases) {
      const answer = ask(question, { ledger, twin, now: NOW }, 'fil')
      expect(answer.headline.length).toBeGreaterThan(0)
      expect(answer.intent).not.toBe('unknown')
    }
  })

  it('is deterministic — no LLM, no drift', () => {
    const a = ask('Magkano kinita ko ngayong linggo?', { ledger, twin, now: NOW }, 'fil')
    const b = ask('Magkano kinita ko ngayong linggo?', { ledger, twin, now: NOW }, 'fil')
    expect(a).toEqual(b)
  })

  it('answers about capital with the composition total', () => {
    const answer = ask('Nasaan ang puhunan ko?', { ledger, twin, now: NOW }, 'fil')
    const d = deriveTwin(twin)
    expect(answer.headline).toContain(formatPHP(d.equityCentavos))
  })

  it('never reports a profit figure that is just the sales figure', () => {
    const answer = ask('Magkano kinita ko ngayong linggo?', { ledger, twin, now: NOW }, 'fil')
    const metrics = periodMetrics(ledger, 7, NOW)
    expect(metrics.netProfitCentavos).not.toBe(metrics.revenueCentavos)
    expect(answer.headline).toContain(formatPHP(metrics.netProfitCentavos))
  })

  it('offers example questions when it does not understand', () => {
    const answer = ask('sino ang pangulo ng pilipinas', { ledger, twin, now: NOW }, 'fil')
    expect(answer.intent).toBe('unknown')
    expect(answer.detail.join(' ')).toContain('Nasaan ang puhunan ko?')
  })

  it('grounds the cash question in real ledger numbers', () => {
    const metrics = periodMetrics(ledger, 7, NOW)
    const answer = ask('Bakit wala akong cash kahit malakas ang benta?', {
      ledger,
      twin,
      now: NOW,
    }, 'fil')
    expect(answer.detail.join(' ')).toContain(formatPHP(metrics.uncollectedCentavos))
  })
})

describe('constrained voice parsing', () => {
  it('reads Filipino numerals', () => {
    expect(parseSpokenNumber('sampu')).toBe(10)
    expect(parseSpokenNumber('lima')).toBe(5)
    expect(parseSpokenNumber('12')).toBe(12)
  })

  it('reads the ligature forms actually spoken', () => {
    expect(parseSpokenNumber('sampung')).toBe(10)
    expect(parseSpokenNumber('limang')).toBe(5)
    expect(parseSpokenNumber('dalawang')).toBe(2)
  })

  it('reads compound and assimilated teens', () => {
    expect(parseSpokenNumber("dalawampu't lima")).toBe(25)
    expect(parseSpokenNumber('labing-isa')).toBe(11)
    expect(parseSpokenNumber('labimpito')).toBe(17)
    expect(parseSpokenNumber('labinsiyam')).toBe(19)
  })

  it('reads Spanish-derived money words common in sari-sari stores', () => {
    expect(parseSpokenNumber('singko')).toBe(5)
    expect(parseSpokenNumber('diyes')).toBe(10)
    expect(parseSpokenNumber('bente')).toBe(20)
  })

  it('detects the intent verb', () => {
    expect(detectDraftKind('Sipat, nakabenta ako ng sampung Coke')).toBe('cash_sale')
    expect(detectDraftKind('Si Aling Nena umutang ng dalawang kilo bigas')).toBe('credit_sale')
    expect(detectDraftKind('Bumili ako ng paninda')).toBe('purchase')
  })

  it('parses the documented multi-item utterance', () => {
    const draft = parseSpoken(
      'Sipat, nakabenta ako ng sampung Coke mismo at limang Lucky Me',
      ledger,
      'fil',
    )
    expect(draft.kind).toBe('cash_sale')
    const coke = draft.lines.find((l) => l.skuId === 'coke')
    const lucky = draft.lines.find((l) => l.skuId === 'lucky')
    expect(coke?.qty).toBe(10)
    expect(lucky?.qty).toBe(5)
  })

  it('matches a customer on a credit sale', () => {
    const draft = parseSpoken('Si Aling Nena umutang ng dalawang kilo bigas', ledger, 'fil')
    expect(draft.kind).toBe('credit_sale')
    expect(draft.customerId).toBe('aling_nena')
  })

  it('converts kilos to the SKU base unit (grams)', () => {
    const draft = parseSpoken('Umutang si Kuya Ben ng dalawang kilo bigas', ledger, 'fil')
    const bigas = draft.lines.find((l) => l.skuId === 'bigas')
    expect(bigas?.qty).toBe(2000)
  })

  it('NEVER produces a postable record directly — confirmation is mandatory', () => {
    const draft = parseSpoken('nakabenta ako ng sampung Coke', ledger, 'fil')
    expect(draft.needsConfirmation).toBe(true)

    // The only path to a transaction requires explicitly confirmed lines.
    const posted = draftToTransaction(
      draft,
      [{ skuId: 'coke', qty: 11, unitPriceCentavos: 2500 }],
      'v-1',
      NOW.toISOString(),
    )
    expect(posted.kind).toBe('cash_sale')
    if (posted.kind === 'cash_sale') {
      // The owner's corrected figure wins over what was heard.
      expect(posted.lines[0].qty).toBe(11)
    }
  })

  it('surfaces words it could not place instead of silently dropping them', () => {
    const draft = parseSpoken('nakabenta ako ng sampung Coke at mansanas', ledger, 'fil')
    expect(draft.unresolved).toContain('mansanas')
  })

  it('reports when it recognised no goods at all', () => {
    const draft = parseSpoken('nakabenta ako ng kung ano ano', ledger, 'fil')
    expect(draft.lines).toHaveLength(0)
    expect(draft.summary).toContain('Walang nakilalang paninda')
  })

  it('is deterministic', () => {
    const a = parseSpoken('nakabenta ako ng sampung Coke', ledger, 'fil')
    const b = parseSpoken('nakabenta ako ng sampung Coke', ledger, 'fil')
    expect(a).toEqual(b)
  })
})

describe('demo data', () => {
  it('never leaves a SKU with negative stock — purchases must keep up with sales', () => {
    for (const [skuId, stock] of Object.entries(twin.inventory)) {
      expect(stock.qty, `${skuId} quantity`).toBeGreaterThanOrEqual(0)
      expect(stock.valueCentavos, `${skuId} value`).toBeGreaterThanOrEqual(0)
    }
  })

  it('reports no oversold warnings for the seeded history', () => {
    expect(twin.warnings.filter((w) => w.code === 'oversold_stock')).toHaveLength(0)
  })

  it('ships a non-empty twin so the product is useful before there is history', () => {
    expect(DEMO_SKUS.length).toBeGreaterThan(5)
    expect(DEMO_CUSTOMERS.length).toBeGreaterThan(2)
    expect(twin.revenueCentavos).toBeGreaterThan(0)
    expect(twin.capitalInjectedCentavos).toBeGreaterThan(0)
  })

  it('is deterministic across runs', () => {
    expect(seedLedger(NOW).transactions.length).toBe(seedLedger(NOW).transactions.length)
    expect(computeTwin(seedLedger(NOW)).revenueCentavos).toBe(twin.revenueCentavos)
  })
})
