import { describe, expect, it } from 'vitest'
import { moodForBand, moodForVoice, patTip } from './Pat.tsx'
import type { TipSources } from './Pat.tsx'
import { UI, pick, setLang } from '../i18n/index.ts'
import type { Lang } from '../i18n/index.ts'
import { computeScore, computeTwin, periodMetrics, seedLedger } from '../engine/index.ts'
import type { Warning } from '../engine/index.ts'

/**
 * Pat's decision layer, tested without rendering anything.
 *
 * Two things here are worth a test rather than a glance. First, Pat must
 * never say something the engine did not already say — so `patTip` is asserted
 * to hand back the engine's own English and Filipino strings, not to invent
 * copy of its own. Second, the moods are a mapping the art depends on: if a
 * band stopped resolving, the bird would render in a mood no drawing exists for.
 */

const NOW = new Date(2026, 8, 16, 18, 0, 0)
const ledger = seedLedger(NOW)
const twin = computeTwin(ledger)
const metrics = periodMetrics(ledger, 7, NOW)
const score = computeScore(
  { twin, metrics, openingInventoryValueCentavos: 4_000_00 },
  'en',
)

const LANGS: Lang[] = ['en', 'fil']

const empty: TipSources = { warnings: [], priorities: [], strengths: [], sufficientData: true }

describe('Pat mood', () => {
  it('maps every score band to a mood that exists', () => {
    expect(moodForBand('strong')).toBe('pleased')
    expect(moodForBand('good')).toBe('steady')
    expect(moodForBand('watch')).toBe('concerned')
    expect(moodForBand('critical')).toBe('concerned')
  })

  it('follows the real pipeline on the Voice screen rather than a timer', () => {
    // Error outranks everything: an unreadable utterance is worse news than a
    // pending draft, and the two can be true at once.
    expect(moodForVoice({ listening: false, transcribing: false, hasError: true, hasDraft: true })).toBe(
      'concerned',
    )
    // Transcribing outranks listening: the mic is closed by then.
    expect(
      moodForVoice({ listening: true, transcribing: true, hasError: false, hasDraft: false }),
    ).toBe('thinking')
    expect(
      moodForVoice({ listening: true, transcribing: false, hasError: false, hasDraft: false }),
    ).toBe('listening')
    expect(
      moodForVoice({ listening: false, transcribing: false, hasError: false, hasDraft: true }),
    ).toBe('pleased')
    expect(
      moodForVoice({ listening: false, transcribing: false, hasError: false, hasDraft: false }),
    ).toBe('steady')
  })
})

describe('what Pat says', () => {
  const warning: Warning = {
    code: 'oversold_stock',
    message: 'You sold more Sky Flakes than the ledger had in stock.',
    messageFil: 'Mas marami ang naibenta mong Sky Flakes kaysa nasa stock.',
    txnId: 'txn-1',
  }

  it('speaks the ledger warning first, translated — in both languages', () => {
    const sources: TipSources = { ...empty, warnings: [warning] }
    expect(patTip(sources, 'en', 'fallback')).toBe(warning.message)
    expect(patTip(sources, 'fil', 'fallback')).toBe(warning.messageFil)
  })

  it('falls back to a score priority, then a strength, in the language it was asked for', () => {
    const withPriority = computeScore(
      { twin, metrics, openingInventoryValueCentavos: 4_000_00 },
      'fil',
    )
    const sources: TipSources = {
      warnings: [],
      priorities: withPriority.priorities,
      strengths: withPriority.strengths,
      sufficientData: true,
    }
    if (withPriority.priorities.length > 0) {
      expect(patTip(sources, 'fil', 'fallback')).toBe(withPriority.priorities[0])
    } else if (withPriority.strengths.length > 0) {
      expect(patTip(sources, 'fil', 'fallback')).toBe(withPriority.strengths[0])
    } else {
      expect(patTip(sources, 'fil', 'fallback')).toBe('fallback')
    }
  })

  it('says the honest fallback, not a guess, when there is too little history', () => {
    const sources: TipSources = { ...empty, sufficientData: false, priorities: ['ignore me'] }
    expect(patTip(sources, 'en', 'keep recording')).toBe('keep recording')
  })

  it('never returns an empty sentence in either language', () => {
    for (const lang of LANGS) {
      const tip = patTip(
        { warnings: [], priorities: score.priorities, strengths: score.strengths, sufficientData: true },
        lang,
        pick(lang, UI['pat.tipFallback']),
      )
      expect(tip.trim().length).toBeGreaterThan(0)
    }
  })

  it('carries a mood label for screen readers in both languages', () => {
    setLang('en')
    for (const key of [
      'pat.name',
      'pat.moodSteady',
      'pat.moodPleased',
      'pat.moodConcerned',
      'pat.moodListening',
      'pat.moodThinking',
      'pat.tipFallback',
      'pat.tipClose',
    ] as const) {
      for (const lang of LANGS) {
        expect(UI[key][lang].trim().length, `${key} is blank in ${lang}`).toBeGreaterThan(0)
      }
    }
  })
})
