import { describe, expect, it } from 'vitest'
import {
  AI_QUESTION_LIMIT,
  FEATURES,
  PRO_ANNUAL_CENTAVOS,
  RETIRED_PLANS,
  TIERS,
  aiQuestionsUsed,
  cancel,
  can,
  createEntitlement,
  downgrade,
  effectiveTier,
  formatPlanPrice,
  invoicePlanName,
  isActive,
  liveFeatures,
  migrateOffSale,
  planName,
  planPrice,
  priceFor,
  purchase,
  recordAiQuestion,
  remainingAiQuota,
  requiredTier,
  resume,
  tierById,
  tierRank,
  visibleTiers,
} from './billing.ts'
import type { StoredEntitlement } from './billing.ts'
import { pesos } from './engine/money.ts'

const AT = '2026-09-15T08:00:00.000Z'

/**
 * An entitlement exactly as an older build left it: on the ₱199 NEGOSYO plan,
 * with the receipt that paid for it and no stored plan name (that field arrived
 * with the retirement). This state can no longer be *bought* — it can only be
 * found in `localStorage` — so the tests build it by hand rather than going
 * through `purchase`, which is the point.
 */
function legacyNegosyoEntitlement(): StoredEntitlement {
  return {
    tier: 'negosyo',
    since: AT,
    renewsAt: '2026-10-15T08:00:00.000Z',
    cancelAtPeriodEnd: false,
    usage: { aiQuestionsThisMonth: 0, periodStart: AT },
    invoices: [
      {
        id: 'inv-legacy',
        at: AT,
        tier: 'negosyo',
        amountCentavos: pesos(199),
        method: 'gcash',
        reference: 'SIM-NEG-000001',
        period: 'monthly',
        simulated: true,
      },
    ],
  }
}

describe('pricing', () => {
  it('publishes the two plans that are actually for sale', () => {
    expect(TIERS.map((t) => t.id)).toEqual(['free', 'pro'])
    expect(tierById('free').priceCentavos).toBe(0)
    expect(tierById('pro').priceCentavos).toBe(pesos(99))
  })

  it('keeps the retired plan as a price and a name, and as nothing else', () => {
    // A receipt that says ₱199 has to keep saying what it was. The retired plan
    // is therefore not deleted — it is moved out of the shop.
    expect(RETIRED_PLANS.negosyo.priceCentavos).toBe(pesos(199))
    expect(RETIRED_PLANS.negosyo.name).toBe('SeePat NEGOSYO')
    expect(planPrice('negosyo')).toBe(pesos(199))
    expect(planName('negosyo')).toBe('SeePat NEGOSYO')
    // And it is not a plan: nothing offers it, and it is not in the price ladder.
    expect(visibleTiers().map((t) => t.id as string)).toEqual(['free', 'pro'])
    expect(TIERS.map((t) => t.id as string)).not.toContain('negosyo')
  })

  it('ladders upward so an upgrade always costs more than the plan below', () => {
    // The order of TIERS is load-bearing, not cosmetic: `migrateOffSale` picks a
    // fallback entitlement by position in `visibleTiers()`, so the list has to
    // stay sorted by price for that to land on the right plan.
    const prices = TIERS.map((t) => t.priceCentavos)
    expect(prices).toEqual([...prices].sort((a, b) => a - b))
    const sold = visibleTiers().map((t) => t.priceCentavos)
    expect(sold).toEqual([...sold].sort((a, b) => a - b))
  })

  it('reads a whole-peso price as a price tag, not a ledger figure', () => {
    expect(formatPlanPrice(pesos(99))).toBe('₱99')
    expect(formatPlanPrice(pesos(199))).toBe('₱199')
    expect(formatPlanPrice(0)).toBe('₱0')
  })
})

describe('the rule that keeps the free tier safe, in both directions', () => {
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

  it('puts NOTHING cost-free behind a paywall', () => {
    // The other half of the same rule, and the one that was missing: PRO is sold
    // as "what needs a server". A paid feature that runs entirely on the owner's
    // phone at ₱0 contradicts the pricing page's own explanation, and it was
    // exactly the state of Score history and restocking advice — pure arithmetic
    // over the local ledger, charged for.
    const paidLive = liveFeatures().filter((f) => f.tier !== 'free')
    expect(paidLive.length).toBeGreaterThan(0)
    for (const feature of paidLive) {
      expect(
        feature.onDevice,
        `${feature.key} is sold but costs nothing to serve — either make it free or make it real`,
      ).toBe(false)
    }
  })

  it('gives the Score, its history and restock advice to the free tier', () => {
    expect(requiredTier('score_current')).toBe('free')
    expect(requiredTier('score_history')).toBe('free')
    expect(requiredTier('restocking')).toBe('free')
  })
})

describe('gating', () => {
  const free = createEntitlement(AT)
  const pro = purchase(free, 'pro', 'gcash', AT)

  it('gives the free tier the whole core loop, including voice', () => {
    for (const key of [
      'ledger',
      'inventory',
      'utang',
      'capital_views',
      'ask_deterministic',
      'voice_capture',
      'speak_answers',
      'offline_voice_model',
      'score_current',
      'score_history',
      'restocking',
    ] as const) {
      expect(can(free, key), `${key} must be free`).toBe(true)
    }
  })

  it('keeps only the server-side money cost behind PRO', () => {
    expect(can(free, 'ai_narration')).toBe(false)
    expect(can(free, 'cloud_backup')).toBe(false)
    expect(can(pro, 'ai_narration')).toBe(true)
    expect(can(pro, 'cloud_backup')).toBe(true)
  })

  it('refuses a planned feature at every tier, including the paid one', () => {
    // The pricing page may not list vapor (see `liveFeatures`), and `can()` may
    // not unlock it either. A screen that gated itself on `receipt_cloud_retry`
    // would otherwise render a working door onto an empty room.
    for (const key of [
      'receipt_cloud_retry',
      'multi_user',
      'forecasting',
      'supplier_intelligence',
      'benchmarking',
      'reports_export',
    ] as const) {
      expect(can(pro, key), `${key} has no code, so no tier may unlock it`).toBe(false)
    }
  })

  it('lets PRO use every live feature the app actually has', () => {
    for (const feature of liveFeatures()) {
      expect(can(pro, feature.key), feature.key).toBe(true)
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

  it('writes the plan name onto the receipt at the moment of purchase', () => {
    // Stored, not looked up: a receipt has to keep its own name even after the
    // plan it named is withdrawn from sale.
    const ent = purchase(createEntitlement(AT), 'pro', 'gcash', AT)
    expect(ent.invoices[0].planName).toBe('SeePat PRO')
    expect(invoicePlanName(ent.invoices[0])).toBe('SeePat PRO')
  })

  it('names a receipt from a retired plan from the retired table', () => {
    // The legacy path: no stored name, a tier that is no longer sold. It must
    // still read as what was paid, not as the plan it fell back to.
    const legacy = legacyNegosyoEntitlement()
    expect(invoicePlanName(legacy.invoices[0])).toBe('SeePat NEGOSYO')
  })

  it('sets a 30-day renewal date and clears the month tally', () => {
    let ent = purchase(createEntitlement(AT), 'pro', 'gcash', AT)
    ent = recordAiQuestion(ent, new Date(AT))
    expect(ent.usage.aiQuestionsThisMonth).toBe(1)

    const renewed = purchase(ent, 'pro', 'card', '2026-09-25T08:00:00.000Z')
    expect(renewed.renewsAt).toBe('2026-10-25T08:00:00.000Z')
    expect(renewed.usage.aiQuestionsThisMonth).toBe(0)
    expect(renewed.invoices).toHaveLength(2)
  })

  it('never accumulates price in floating point', () => {
    const ent = purchase(createEntitlement(AT), 'pro', 'card', AT)
    expect(Number.isInteger(ent.invoices[0].amountCentavos)).toBe(true)
    expect(ent.invoices[0].amountCentavos).toBe(9900)
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
    const paid = purchase(createEntitlement(AT), 'pro', 'card', AT)
    const back = downgrade(paid, AT)
    expect(back.tier).toBe('free')
    expect(back.renewsAt).toBeNull()
    expect(back.invoices).toHaveLength(1)
    expect(can(back, 'ai_narration')).toBe(false)
    // And free keeps everything the phone can do on its own.
    expect(can(back, 'score_history')).toBe(true)
  })
})

describe('the honesty rule: never sell vapor', () => {
  it('lists only live features on the pricing page', () => {
    const live = liveFeatures()
    // The cloud second-read for receipts, staff access, forecasting, supplier
    // intel, benchmarking and bulk reports have no working code — they must
    // stay planned. (The on-device receipt scan is already live, but it is
    // free and ungated, so it is not a PRO feature at all.)
    for (const key of [
      'receipt_cloud_retry',
      'multi_user',
      'forecasting',
      'supplier_intelligence',
      'benchmarking',
      'reports_export',
    ] as const) {
      expect(
        live.some((f) => f.key === key),
        `${key} must not be listed for sale before it is built`,
      ).toBe(false)
    }
    // And both sides of the line are real: the free half is what the phone can
    // do alone, the paid half is the server.
    for (const key of ['ai_narration', 'cloud_backup'] as const) {
      expect(
        live.some((f) => f.key === key),
        `${key} is the honest PRO bundle`,
      ).toBe(true)
    }
    for (const key of ['score_history', 'restocking'] as const) {
      expect(
        live.some((f) => f.key === key),
        `${key} runs on the phone, so it is free and still listed`,
      ).toBe(true)
    }
  })

  it('offers no third plan and cannot offer the withdrawn one', () => {
    expect(visibleTiers().map((t) => t.id)).toEqual(['free', 'pro'])
    // Whatever a caller maps, there is no *sold* list in this module that still
    // contains the retired plan — the defect was a screen reading a list that
    // did. `RETIRED_PLANS` is the only place it survives, and it is not a `Tier`.
    expect(TIERS.map((t) => t.id as string)).not.toContain('negosyo')
    expect(Object.keys(RETIRED_PLANS)).toEqual(['negosyo'])
  })

  it('retires a plan that was withdrawn after it was bought', () => {
    // The half the owner actually sees: withdrawing NEGOSYO from the pricing
    // page left an entitlement bought in the demo window sitting in
    // localStorage, so the header, the plan card and the demo picker all still
    // said NEGOSYO — a plan no longer for sale anywhere. PRO is ₱99 and NEGOSYO
    // was ₱199, so the fallback is the nearest plan that was already paid for:
    // nobody is moved up a price step, and nobody is dropped to free while
    // their money is still on the record.
    const bought = legacyNegosyoEntitlement()
    const retired = migrateOffSale(bought)

    expect(retired.tier).toBe('pro')
    expect(retired.renewsAt).toBe(bought.renewsAt)
    // The receipt survives, still naming what was paid.
    expect(retired.invoices).toEqual(bought.invoices)
    expect(retired.invoices[0].tier).toBe('negosyo')
    expect(invoicePlanName(retired.invoices[0])).toBe('SeePat NEGOSYO')
    // And while the entitlement is still on the old plan — the one render
    // before the migration — it outranks PRO rather than locking its owner out.
    expect(tierRank('negosyo')).toBeGreaterThan(tierRank('pro'))
  })

  it('leaves an entitlement on a plan that is still for sale alone', () => {
    for (const tier of ['free', 'pro'] as const) {
      const ent =
        tier === 'free' ? createEntitlement(AT) : purchase(createEntitlement(AT), 'pro', 'gcash', AT)
      expect(migrateOffSale(ent)).toBe(ent)
    }
  })

  it('never raises the price while retiring a plan, and only does it once', () => {
    const bought = legacyNegosyoEntitlement()
    const retired = migrateOffSale(bought)
    expect(planPrice(retired.tier)).toBeLessThanOrEqual(planPrice(bought.tier))
    expect(planPrice(retired.tier)).toBe(pesos(99))
    // Idempotent, because `load()` runs it on every start: a migration that
    // keeps migrating would walk an owner down the ladder one plan per reload.
    expect(migrateOffSale(retired)).toBe(retired)
  })

  it('prices PRO annual below twelve months, in whole pesos', () => {
    expect(PRO_ANNUAL_CENTAVOS).toBe(pesos(999))
    expect(priceFor('pro', 'annual')).toBe(pesos(999))
    expect(priceFor('pro', 'monthly')).toBe(pesos(99))
    expect(PRO_ANNUAL_CENTAVOS).toBeLessThan(pesos(99 * 12))
  })

  it('bills the annual receipt once and renews in a year', () => {
    const ent = purchase(createEntitlement(AT), 'pro', 'gcash', AT, undefined, 'annual')
    expect(ent.invoices[0].amountCentavos).toBe(pesos(999))
    expect(ent.invoices[0].period).toBe('annual')
    expect(ent.renewsAt).toBe('2027-09-15T08:00:00.000Z')
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
