import { describe, expect, it } from 'vitest'
import {
  AI_QUESTION_LIMIT,
  FEATURES,
  TIERS,
  aiQuestionsUsed,
  cancel,
  can,
  createEntitlement,
  downgrade,
  effectiveTier,
  formatPlanPrice,
  isActive,
  nextTier,
  purchase,
  recordAiQuestion,
  remainingAiQuota,
  requiredTier,
  resume,
  tierById,
} from './billing.ts'
import { pesos } from './engine/money.ts'

const AT = '2026-09-15T08:00:00.000Z'

describe('pricing', () => {
  it('publishes the three tiers at the documented prices', () => {
    expect(tierById('free').priceCentavos).toBe(0)
    expect(tierById('pro').priceCentavos).toBe(pesos(99))
    expect(tierById('negosyo').priceCentavos).toBe(pesos(199))
  })

  it('ladders upward so an upgrade always costs more than the tier below', () => {
    const prices = TIERS.map((t) => t.priceCentavos)
    expect(prices).toEqual([...prices].sort((a, b) => a - b))
    expect(nextTier('free')?.id).toBe('pro')
    expect(nextTier('pro')?.id).toBe('negosyo')
    expect(nextTier('negosyo')).toBeNull()
  })

  it('reads a whole-peso price as a price tag, not a ledger figure', () => {
    expect(formatPlanPrice(pesos(99))).toBe('₱99')
    expect(formatPlanPrice(pesos(199))).toBe('₱199')
    expect(formatPlanPrice(0)).toBe('₱0')
  })
})

describe('the rule that keeps the free tier safe', () => {
  it('puts NOTHING cost-bearing in the free tier', () => {
    // This is the unit-economics invariant. Voice transcription and LLM calls
    // are the only features with a per-use cost, so a free feature that is not
    // on-device would mean SeePat pays for every free user — precisely the
    // failure the concept note flagged at ₱137/month per heavy voice user.
    const freeFeatures = FEATURES.filter((f) => f.tier === 'free')
    expect(freeFeatures.length).toBeGreaterThan(0)
    for (const feature of freeFeatures) {
      expect(feature.onDevice, `${feature.key} is free but costs money to serve`).toBe(true)
    }
  })

  it('keeps the only AI feature out of the free tier', () => {
    expect(requiredTier('ai_narration')).toBe('pro')
    expect(FEATURES.filter((f) => !f.onDevice).some((f) => f.tier === 'free')).toBe(false)
  })
})

describe('gating', () => {
  const free = createEntitlement(AT)
  const pro = purchase(free, 'pro', 'gcash', AT)
  const negosyo = purchase(free, 'negosyo', 'maya', AT)

  it('gives the free tier the whole core loop, including voice', () => {
    expect(can(free, 'ledger')).toBe(true)
    expect(can(free, 'capital_views')).toBe(true)
    expect(can(free, 'ask_deterministic')).toBe(true)
    expect(can(free, 'voice_capture')).toBe(true)
    expect(can(free, 'offline_voice_model')).toBe(true)
    expect(can(free, 'score_current')).toBe(true)
  })

  it('reserves the cost-bearing and server-side features for paid tiers', () => {
    expect(can(free, 'ai_narration')).toBe(false)
    expect(can(free, 'cloud_backup')).toBe(false)
    expect(can(free, 'score_history')).toBe(false)
    expect(can(free, 'multi_user')).toBe(false)
  })

  it('unlocks PRO without unlocking NEGOSYO', () => {
    expect(can(pro, 'ai_narration')).toBe(true)
    expect(can(pro, 'cloud_backup')).toBe(true)
    expect(can(pro, 'restocking')).toBe(true)
    expect(can(pro, 'multi_user')).toBe(false)
    expect(can(pro, 'forecasting')).toBe(false)
    expect(can(pro, 'benchmarking')).toBe(false)
  })

  it('lets the top tier use everything below it', () => {
    for (const feature of FEATURES) {
      expect(can(negosyo, feature.key), feature.key).toBe(true)
    }
  })
})

describe('simulated checkout', () => {
  it('issues a receipt that is explicitly marked simulated', () => {
    const ent = purchase(createEntitlement(AT), 'pro', 'gcash', AT)
    const invoice = ent.invoices[0]
    expect(invoice.simulated).toBe(true)
    expect(invoice.amountCentavos).toBe(pesos(99))
    expect(invoice.method).toBe('gcash')
    expect(invoice.reference).toMatch(/^SIM-PRO-\d{6}$/)
    expect(ent.tier).toBe('pro')
  })

  it('sets a 30-day renewal date and clears the month tally', () => {
    let ent = purchase(createEntitlement(AT), 'pro', 'gcash', AT)
    ent = recordAiQuestion(ent, new Date(AT))
    expect(ent.usage.aiQuestionsThisMonth).toBe(1)

    const renewed = purchase(ent, 'negosyo', 'card', '2026-09-25T08:00:00.000Z')
    expect(renewed.renewsAt).toBe('2026-10-25T08:00:00.000Z')
    expect(renewed.usage.aiQuestionsThisMonth).toBe(0)
    expect(renewed.invoices).toHaveLength(2)
  })

  it('never accumulates price in floating point', () => {
    const ent = purchase(createEntitlement(AT), 'negosyo', 'card', AT)
    expect(Number.isInteger(ent.invoices[0].amountCentavos)).toBe(true)
    expect(ent.invoices[0].amountCentavos).toBe(19900)
  })
})

describe('cancelling cannot leave the owner holding a paid asset', () => {
  it('keeps a cancelled plan alive until it expires, then falls back to free', () => {
    let ent = purchase(createEntitlement(AT), 'pro', 'gcash', AT)
    ent = cancel(ent)

    expect(isActive(ent, new Date('2026-09-20T00:00:00.000Z'))).toBe(true)
    expect(effectiveTier(ent, new Date('2026-09-20T00:00:00.000Z'))).toBe('pro')
    expect(can(ent, 'ai_narration')).toBe(true)

    const after = new Date('2026-10-20T00:00:00.000Z')
    expect(isActive(ent, after)).toBe(false)
    expect(effectiveTier(ent, after)).toBe('free')
  })

  it('can be resumed before it expires', () => {
    const ent = resume(cancel(purchase(createEntitlement(AT), 'pro', 'gcash', AT)))
    expect(ent.cancelAtPeriodEnd).toBe(false)
    expect(isActive(ent, new Date('2027-01-01T00:00:00.000Z'))).toBe(true)
  })

  it('drops back to free without touching the ledger or the receipt history', () => {
    const paid = purchase(createEntitlement(AT), 'negosyo', 'card', AT)
    const back = downgrade(paid, AT)
    expect(back.tier).toBe('free')
    expect(back.renewsAt).toBeNull()
    expect(back.invoices).toHaveLength(1)
    expect(can(back, 'multi_user')).toBe(false)
  })
})

describe('AI fair-use meter', () => {
  it('counts questions within the month and resets across the boundary', () => {
    let ent = purchase(createEntitlement(AT), 'pro', 'gcash', AT)
    for (let i = 0; i < 5; i += 1) ent = recordAiQuestion(ent, new Date(AT))
    expect(aiQuestionsUsed(ent, new Date('2026-09-30T00:00:00.000Z'))).toBe(5)

    // A new month is a new allowance — the owner is never silently billed.
    const october = new Date('2026-10-02T00:00:00.000Z')
    expect(aiQuestionsUsed(ent, october)).toBe(0)
    expect(remainingAiQuota(ent, october)).toBe(AI_QUESTION_LIMIT)
  })

  it('never reports a negative allowance', () => {
    let ent = purchase(createEntitlement(AT), 'pro', 'gcash', AT)
    for (let i = 0; i < AI_QUESTION_LIMIT + 10; i += 1) ent = recordAiQuestion(ent, new Date(AT))
    expect(remainingAiQuota(ent, new Date(AT))).toBe(0)
  })
})
