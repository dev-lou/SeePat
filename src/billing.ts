import { useCallback, useState } from 'react'
import { formatPHP, pesos } from './engine/money.ts'
import type { Centavos } from './engine/money.ts'
import { readPersisted, writePersisted } from './storage.ts'
import { dayMonthYear } from './i18n/index.ts'
import type { Bilingual, Lang } from './i18n/index.ts'

/**
 * Simulated SaaS entitlements.
 *
 * There is no payment gateway and no server here, deliberately. What this file
 * exists to encode is the *rule* the pricing is built on, so the free tier can
 * never quietly become loss-making as features are added:
 *
 *     On-device is free. Server is paid.
 *
 * Everything that runs on the owner's own phone — the ledger, the Twin, the
 * capital views, the deterministic narrator, the browser speech recognizer, the
 * bundled offline model — costs SeePat ₱0 in marginal cost, so it can sit in
 * the free tier without losing money, and it costs nothing to leave the app
 * free for a market of 1.1 million microenterprises.
 *
 * What is *sold* is what has a marginal cost or needs a server to be worth
 * anything: LLM narration (metered), cloud backup, score history, forecasting,
 * benchmarking, multi-user. Stopping a subscription withdraws a service, so
 * "subscribe once and keep the value" cannot happen — there is nothing
 * downloadable to arbitrage. `FEATURES` records `onDevice` per feature and
 * `billing.test.ts` asserts that no free feature is cost-bearing: the unit
 * economics are enforced by the suite rather than remembered by a human.
 */

export type TierId = 'free' | 'pro' | 'negosyo'

export interface Tier {
  id: TierId
  name: string
  /** Sits above "Free" on the pricing card. */
  short: string
  priceCentavos: Centavos
  period: Bilingual
  tagline: Bilingual
  audience: Bilingual
  highlight?: boolean
}

// Plan names (brand + tier word) are not translated: FREE / PRO / NEGOSYO are the
// product's own words and already read correctly to both audiences.
export const TIERS: Tier[] = [
  {
    id: 'free',
    name: 'SeePat FREE',
    short: 'FREE',
    priceCentavos: pesos(0),
    period: { en: 'lifetime', fil: 'habang-buhay' },
    tagline: {
      en: 'Everything you need to start, running on your own phone.',
      fil: 'Lahat ng kailangan para makapagsimula — at tumatakbo sa phone mo.',
    },
    audience: {
      en: 'For the owner who is just starting to keep records.',
      fil: 'Para sa nagsisimula pa lang magtala.',
    },
  },
  {
    id: 'pro',
    name: 'SeePat PRO',
    short: 'PRO',
    priceCentavos: pesos(99),
    period: { en: '/month', fil: '/buwan' },
    tagline: {
      en: 'AI explains your numbers, and a safe copy of your records is kept online.',
      fil: 'Ipapaliwanag ng AI ang numero mo, at may safe na kopya ng rekord mo sa internet.',
    },
    audience: {
      en: 'For a store with steady sales that wants to understand its profit.',
      fil: 'Para sa may regular nang benta at gustong maintindihan ang kita.',
    },
    highlight: true,
  },
  {
    id: 'negosyo',
    name: 'SeePat NEGOSYO',
    short: 'NEGOSYO',
    priceCentavos: pesos(199),
    period: { en: '/month', fil: '/buwan' },
    tagline: {
      en: "A guess of next week's sales, how you compare with nearby stores, and accounts for your staff.",
      fil: 'Tantya ng benta sa susunod na linggo, paghahambing sa kalapit na tindahan, at account para sa mga tauhan mo.',
    },
    audience: {
      en: 'For a growing store with employees and suppliers.',
      fil: 'Para sa lumalaking tindahan na may empleyado at supplier.',
    },
  },
]

export const INSTITUTIONAL = {
  name: {
    en: 'Institution',
    fil: 'Institusyon',
  } as Bilingual,
  tagline: {
    en: 'One licence for many stores, with a single view for cooperatives, LGUs, and livelihood programs.',
    fil: 'Isang lisensya para sa maraming tindahan, iisang tanawin para sa kooperatiba, LGU, at livelihood program.',
  } as Bilingual,
}

const RANK: Record<TierId, number> = { free: 0, pro: 1, negosyo: 2 }

export function tierRank(tier: TierId): number {
  return RANK[tier]
}

export function tierById(id: TierId): Tier {
  return TIERS.find((t) => t.id === id) ?? TIERS[0]
}

export function nextTier(tier: TierId): Tier | null {
  const index = TIERS.findIndex((t) => t.id === tier)
  return TIERS[index + 1] ?? null
}

// ---------------------------------------------------------------------------
// Feature gates
// ---------------------------------------------------------------------------

export type FeatureKey =
  | 'ledger'
  | 'inventory'
  | 'utang'
  | 'capital_views'
  | 'ask_deterministic'
  | 'voice_capture'
  | 'offline_voice_model'
  | 'score_current'
  | 'ai_narration'
  | 'score_history'
  | 'cloud_backup'
  | 'receipt_ocr'
  | 'restocking'
  | 'multi_user'
  | 'forecasting'
  | 'supplier_intelligence'
  | 'benchmarking'
  | 'reports_export'

export interface FeatureDef {
  key: FeatureKey
  label: Bilingual
  /** Minimum tier that unlocks this. */
  tier: TierId
  /** True when it runs entirely on the owner's device at ₱0 marginal cost. */
  onDevice: boolean
  /**
   * `planned` features exist in the roadmap but have no working code behind
   * them yet. The Plan screen only lists `live` features, so vapor can never
   * be sold — see `liveFeatures` and the honesty test in billing.test.ts.
   */
  status?: 'live' | 'planned'
  note?: Bilingual
}

export const FEATURES: FeatureDef[] = [
  // --- FREE: on-device, zero marginal cost ----------------------------------
  {
    key: 'ledger',
    label: { en: 'Ledger — sales, expenses, purchases, payments', fil: 'Tala — benta, gastos, bili, bayad' },
    tier: 'free',
    onDevice: true,
  },
  {
    key: 'inventory',
    label: { en: 'Stock and inventory', fil: 'Paninda at stock' },
    tier: 'free',
    onDevice: true,
  },
  {
    key: 'utang',
    label: { en: 'What you owe, what is owed to you', fil: 'Utang sa iyo at sa supplier' },
    tier: 'free',
    onDevice: true,
  },
  {
    key: 'capital_views',
    label: {
      en: 'Where is my capital? · Where did the money go?',
      fil: 'Nasaan ang Puhunan Ko? · Saan Napunta ang Pera Ko?',
    },
    tier: 'free',
    onDevice: true,
  },
  {
    key: 'ask_deterministic',
    label: { en: 'Ask My Negosyo — unlimited', fil: 'Ask My Negosyo — walang limitasyon' },
    tier: 'free',
    onDevice: true,
    note: {
      en: 'Answered from your own records. Nothing here is guessed by AI.',
      fil: 'Sinasagot mula sa sarili mong rekord. Walang hinuhula rito ang AI.',
    },
  },
  {
    key: 'voice_capture',
    label: { en: 'Voice — speak to record a sale', fil: 'Boses — pagsasalita para magtala' },
    tier: 'free',
    onDevice: true,
    note: {
      en: 'Your phone does the listening. It is free, and it never costs you anything.',
      fil: 'Ang phone mo ang nakikinig. Libre ito, wala kang babayaran.',
    },
  },
  {
    key: 'offline_voice_model',
    label: {
      en: 'Offline Voice — download once, works with no signal',
      fil: 'Boses Kahit Walang Internet — i-download minsan, gagana kahit walang signal',
    },
    tier: 'free',
    onDevice: true,
    note: {
      en: 'It stays on your phone after one download. Nothing to pay for afterwards.',
      fil: 'Mananatili ito sa phone mo pagkatapos ng isang download. Wala nang babayaran pagkatapos.',
    },
  },
  {
    key: 'score_current',
    label: { en: "Sipat Score — today's reading", fil: 'Sipat Score — marka ngayon' },
    tier: 'free',
    onDevice: true,
  },

  // --- PRO: has a marginal cost, or needs a server --------------------------
  {
    key: 'ai_narration',
    label: { en: 'AI explanation of your numbers', fil: 'AI na paliwanag ng numero mo' },
    tier: 'pro',
    onDevice: false,
    note: {
      en: 'Costs us every time you ask. This is the only part that uses AI.',
      fil: 'May bayad kami sa bawat tanong. Ito lang ang bahaging gumagamit ng AI.',
    },
  },
  {
    key: 'score_history',
    label: { en: 'How your Score moved, week by week', fil: 'Galaw ng Score mo linggo-linggo' },
    tier: 'pro',
    onDevice: false,
  },
  {
    key: 'cloud_backup',
    label: {
      en: 'A safe copy of your records online, on every phone you use',
      fil: 'Safe na kopya ng rekord mo sa internet, sa lahat ng phone mo',
    },
    tier: 'pro',
    onDevice: false,
  },
  {
    key: 'receipt_ocr',
    label: {
      en: 'Receipts — take a photo and the numbers are typed in for you',
      fil: 'Resibo — kunan ng litrato at kusang maipapasok ang mga numero',
    },
    tier: 'pro',
    onDevice: false,
    status: 'planned',
  },
  {
    key: 'restocking',
    label: { en: 'Advice on what to buy again, and when', fil: 'Payo kung ano ang bibilhin muli at kailan' },
    tier: 'pro',
    onDevice: false,
  },

  // --- NEGOSYO: compounding value that needs a server -----------------------
  {
    key: 'multi_user',
    label: {
      en: 'Several people can use it, each with their own access, and every change is recorded',
      fil: 'Marami ang pwedeng gumamit, may sariling access ang bawat isa, at naitala ang bawat pagbabago',
    },
    tier: 'negosyo',
    onDevice: false,
    status: 'planned',
  },
  {
    key: 'forecasting',
    label: {
      en: 'A guess of next week: sales, spending, and which items may run out',
      fil: 'Tantya sa susunod na linggo: benta, gastos, at mga panindang maaaring maubos',
    },
    tier: 'negosyo',
    onDevice: false,
    status: 'planned',
  },
  {
    key: 'supplier_intelligence',
    label: { en: 'What you buy, from whom, and at what price', fil: 'Ano ang binibili mo, kanino, at magkano' },
    tier: 'negosyo',
    onDevice: false,
    status: 'planned',
  },
  {
    key: 'benchmarking',
    label: {
      en: 'See how your store compares with other stores nearby',
      fil: 'Tingnan ang pagkakaiba ng tindahan mo sa kalapit na tindahan',
    },
    tier: 'negosyo',
    onDevice: false,
    status: 'planned',
  },
  {
    key: 'reports_export',
    label: {
      en: 'Reports you can print or send, and adding many records at once',
      fil: 'Mga ulat na pwede mong i-print o ipadala, at pagpasok ng maraming rekord nang sabay',
    },
    tier: 'negosyo',
    onDevice: false,
    status: 'planned',
  },
]

export function featureDef(key: FeatureKey): FeatureDef {
  const found = FEATURES.find((f) => f.key === key)
  if (!found) throw new Error(`Unknown feature gate: ${key}`)
  return found
}

export function requiredTier(key: FeatureKey): TierId {
  return featureDef(key).tier
}

export function can(entitlement: Entitlement, key: FeatureKey): boolean {
  return tierRank(entitlement.tier) >= tierRank(requiredTier(key))
}

/** Features unlocked at exactly this tier, for the pricing card. */
export function featuresAtTier(tier: TierId): FeatureDef[] {
  return FEATURES.filter((f) => f.tier === tier)
}

/** Only features with working code behind them — the only ones the Plan screen may list. */
export function liveFeatures(): FeatureDef[] {
  return FEATURES.filter((f) => (f.status ?? 'live') === 'live')
}

/** Tiers shown on the pricing page. NEGOSYO stays in the type system but is
    hidden until staff/multi-device is built and asked for. */
export function visibleTiers(): Tier[] {
  return TIERS.filter((t) => t.id !== 'negosyo')
}

/** PRO annual prepay: ~2 months free. Price-sensitive markets commit yearly. */
export const PRO_ANNUAL_CENTAVOS: Centavos = pesos(999)

export type BillingPeriod = 'monthly' | 'annual'

export function priceFor(tier: TierId, period: BillingPeriod): Centavos {
  if (tier === 'pro' && period === 'annual') return PRO_ANNUAL_CENTAVOS
  return tierById(tier).priceCentavos
}

// ---------------------------------------------------------------------------
// Entitlement
// ---------------------------------------------------------------------------

export type PaymentMethod = 'gcash' | 'maya' | 'card'

export const PAYMENT_METHODS: { id: PaymentMethod; label: string; hint: string }[] = [
  { id: 'gcash', label: 'GCash', hint: '0917 000 0000' },
  { id: 'maya', label: 'Maya', hint: '0917 000 0000' },
  { id: 'card', label: 'Card', hint: '4111 1111 1111 1111' },
]

export interface MockInvoice {
  id: string
  at: string
  tier: TierId
  amountCentavos: Centavos
  method: PaymentMethod
  reference: string
  /** Monthly or annual prepay. Defaults to monthly for old receipts. */
  period: BillingPeriod
  /** Always true. No money moves. */
  simulated: true
}

export interface Entitlement {
  tier: TierId
  since: string
  /** Null on the free tier. */
  renewsAt: string | null
  cancelAtPeriodEnd: boolean
  usage: {
    aiQuestionsThisMonth: number
    periodStart: string
  }
  invoices: MockInvoice[]
}

/** Fair-use cap on the one feature that actually costs us per use. */
export const AI_QUESTION_LIMIT = 300

const SUBSCRIPTION_DAYS = 30

export function createEntitlement(at: string = new Date().toISOString()): Entitlement {
  return {
    tier: 'free',
    since: at,
    renewsAt: null,
    cancelAtPeriodEnd: false,
    usage: { aiQuestionsThisMonth: 0, periodStart: at },
    invoices: [],
  }
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

function sameMonth(a: string, b: Date): boolean {
  const x = new Date(a)
  return x.getFullYear() === b.getFullYear() && x.getMonth() === b.getMonth()
}

/**
 * A cancelled subscription stays usable until it expires — which is what a real
 * one does, and what makes the prototype's behaviour recognisable to anyone who
 * has ever cancelled a subscription.
 */
export function isActive(entitlement: Entitlement, now: Date = new Date()): boolean {
  if (entitlement.tier === 'free') return true
  if (!entitlement.cancelAtPeriodEnd || !entitlement.renewsAt) return true
  return new Date(entitlement.renewsAt).getTime() > now.getTime()
}

/** The tier actually in force right now, after any expiry. */
export function effectiveTier(entitlement: Entitlement, now: Date = new Date()): TierId {
  return isActive(entitlement, now) ? entitlement.tier : 'free'
}

export function aiQuestionsUsed(entitlement: Entitlement, now: Date = new Date()): number {
  return sameMonth(entitlement.usage.periodStart, now)
    ? entitlement.usage.aiQuestionsThisMonth
    : 0
}

export function remainingAiQuota(entitlement: Entitlement, now: Date = new Date()): number {
  return Math.max(0, AI_QUESTION_LIMIT - aiQuestionsUsed(entitlement, now))
}

export function mockReference(at: string, tier: TierId): string {
  const digits = `${new Date(at).getTime()}`.slice(-6)
  return `SIM-${tier.slice(0, 3).toUpperCase()}-${digits}`
}

/**
 * The simulated purchase. Pure: given an entitlement and a choice of tier, it
 * returns the next entitlement and the receipt that caused it. The UI only
 * *renders* this. No network, no gateway, no card data ever leaves the device.
 */
export function purchase(
  entitlement: Entitlement,
  tier: Exclude<TierId, 'free'>,
  method: PaymentMethod,
  at: string = new Date().toISOString(),
  reference?: string,
  period: BillingPeriod = 'monthly',
): Entitlement {
  const invoice: MockInvoice = {
    id: `inv-${new Date(at).getTime()}`,
    at,
    tier,
    amountCentavos: priceFor(tier, period),
    method,
    reference: reference ?? mockReference(at, tier),
    period,
    simulated: true,
  }
  return {
    ...entitlement,
    tier,
    since: at,
    renewsAt: addDays(at, period === 'annual' ? 365 : SUBSCRIPTION_DAYS),
    cancelAtPeriodEnd: false,
    usage: { aiQuestionsThisMonth: 0, periodStart: at },
    invoices: [invoice, ...entitlement.invoices],
  }
}

export function downgrade(entitlement: Entitlement, at: string = new Date().toISOString()): Entitlement {
  return { ...createEntitlement(at), invoices: entitlement.invoices }
}

/** Cancels at period end: paid features keep working until `renewsAt`. */
export function cancel(entitlement: Entitlement): Entitlement {
  if (entitlement.tier === 'free') return entitlement
  return { ...entitlement, cancelAtPeriodEnd: true }
}

export function resume(entitlement: Entitlement): Entitlement {
  return { ...entitlement, cancelAtPeriodEnd: false }
}

export function recordAiQuestion(
  entitlement: Entitlement,
  now: Date = new Date(),
): Entitlement {
  const fresh = sameMonth(entitlement.usage.periodStart, now)
  return {
    ...entitlement,
    usage: {
      periodStart: fresh ? entitlement.usage.periodStart : now.toISOString(),
      aiQuestionsThisMonth: (fresh ? entitlement.usage.aiQuestionsThisMonth : 0) + 1,
    },
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Plan prices read as "₱99", not "₱99.00" — this is a price tag, not a ledger. */
export function formatPlanPrice(centavos: Centavos): string {
  const p = centavos / 100
  return Number.isInteger(p) ? `₱${p}` : formatPHP(centavos)
}

export function paymentMethodLabel(method: PaymentMethod): string {
  return PAYMENT_METHODS.find((m) => m.id === method)?.label ?? method
}

/**
 * A receipt date follows the reading language, not the device locale.
 *
 * It is formatted from `i18n`'s table rather than `toLocaleDateString`, because a
 * browser without a `fil-PH` locale falls back to English silently — which is how
 * "Sep 15, 2026" ends up sitting in the middle of a Filipino receipt on exactly
 * the devices least likely to have the locale installed.
 */
export function formatDate(iso: string, lang: Lang): string {
  return dayMonthYear(new Date(iso), lang)
}

// ---------------------------------------------------------------------------
// Persistence — same guarded idiom as the ledger store, so a blocked
// localStorage (private mode) degrades to an in-memory session instead of
// breaking the demo.
// ---------------------------------------------------------------------------

/** `legacyKey` carries the slot from before the TimbangAI → SeePat rename. */
const STORAGE = { key: 'seepat.entitlement.v1', legacyKey: 'timbangai.entitlement.v1' }

function isEntitlement(value: unknown): value is Entitlement {
  if (typeof value !== 'object' || value === null) return false
  const c = value as Partial<Entitlement>
  return (
    (c.tier === 'free' || c.tier === 'pro' || c.tier === 'negosyo') &&
    typeof c.since === 'string' &&
    Array.isArray(c.invoices) &&
    typeof c.usage === 'object' &&
    c.usage !== null
  )
}

function load(): Entitlement | null {
  const raw = readPersisted(STORAGE)
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return isEntitlement(parsed) ? parsed : null
  } catch {
    return null
  }
}

function persist(entitlement: Entitlement): void {
  writePersisted(STORAGE, JSON.stringify(entitlement))
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface Billing {
  entitlement: Entitlement
  /** Tier in force right now — after any cancelled-and-expired subscription. */
  tier: TierId
  isActive: boolean
  can: (key: FeatureKey) => boolean
  requiredTier: (key: FeatureKey) => TierId
  aiQuestionsUsed: number
  aiQuestionsRemaining: number
  purchase: (tier: Exclude<TierId, 'free'>, method: PaymentMethod, period?: BillingPeriod) => MockInvoice
  downgrade: () => void
  cancel: () => void
  resume: () => void
  recordAiQuestion: () => void
}

export function useEntitlement(): Billing {
  const [now] = useState(() => new Date())
  const [entitlement, setEntitlement] = useState<Entitlement>(
    () => load() ?? createEntitlement(),
  )

  const update = useCallback((next: Entitlement) => {
    persist(next)
    setEntitlement(next)
  }, [])

  const buy = useCallback(
    (tier: Exclude<TierId, 'free'>, method: PaymentMethod, period: BillingPeriod = 'monthly'): MockInvoice => {
      const at = new Date().toISOString()
      const next = purchase(entitlement, tier, method, at, undefined, period)
      persist(next)
      setEntitlement(next)
      return next.invoices[0]
    },
    [entitlement],
  )

  const tier = effectiveTier(entitlement, now)

  return {
    entitlement,
    tier,
    isActive: isActive(entitlement, now),
    can: (key) => can(entitlement, key) && isActive(entitlement, now),
    requiredTier,
    aiQuestionsUsed: aiQuestionsUsed(entitlement, now),
    aiQuestionsRemaining: remainingAiQuota(entitlement, now),
    purchase: buy,
    downgrade: () => update(downgrade(entitlement)),
    cancel: () => update(cancel(entitlement)),
    resume: () => update(resume(entitlement)),
    recordAiQuestion: () => update(recordAiQuestion(entitlement, new Date())),
  }
}
