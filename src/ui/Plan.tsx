import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, Card, Pill, SectionTitle, SimulatedNote } from './components.tsx'
import {
  AI_QUESTION_LIMIT,
  INSTITUTIONAL,
  PAYMENT_METHODS,
  formatDate,
  formatPlanPrice,
  invoicePlanName,
  liveFeatures,
  paymentMethodLabel,
  priceFor,
  tierById,
  tierRank,
  visibleTiers,
} from '../billing.ts'
import type { Billing, BillingPeriod, MockInvoice, PaymentMethod, TierId } from '../billing.ts'
import { summarizeCohort } from '../cohort.ts'
import { pick, useLang, useT } from '../i18n/index.ts'

/**
 * The pricing page, and the checkout that only pretends to charge.
 *
 * No payment gateway is contacted, no card or wallet details are transmitted,
 * and nothing here should be mistaken for a live billing integration. What the
 * screen *does* prove is the shape of the business model: two plans, one
 * honest sentence per plan, and a hard line between what is free because it
 * costs nothing to serve and what is paid because it does — a server and AI.
 *
 * Receipts are the one place a *retired* plan may still be named, through
 * `invoicePlanName`: a receipt records what was paid, not what is on offer.
 */

type Step = 'browse' | 'method' | 'processing' | 'done'

export function PlanScreen({ billing }: { billing: Billing }) {
  const lang = useLang()
  const t = useT()
  const [pendingTier, setPendingTier] = useState<Exclude<TierId, 'free'> | null>(null)
  const [method, setMethod] = useState<PaymentMethod>('gcash')
  const [period, setPeriod] = useState<BillingPeriod>('monthly')
  const [step, setStep] = useState<Step>('browse')
  const [receipt, setReceipt] = useState<MockInvoice | null>(null)

  const current = tierById(billing.tier)
  const expiredButPaid = billing.entitlement.tier !== 'free' && billing.tier === 'free'

  // Browse-level billing period: re-prices the PRO story card live so an
  // owner sees monthly vs annual without opening checkout.
  const [browsePeriod, setBrowsePeriod] = useState<BillingPeriod>('monthly')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  function startCheckout(tier: Exclude<TierId, 'free'>, initialPeriod?: BillingPeriod) {
    setPendingTier(tier)
    setMethod('gcash')
    setPeriod(initialPeriod ?? browsePeriod)
    setStep('method')
  }

  function pay() {
    if (!pendingTier) return
    setStep('processing')
    const chosenPeriod = period
    // A deliberate pause. The point of the simulation is the *shape* of the
    // flow — choose, confirm, wait, get a receipt — not a spinner for its own
    // sake, but a receipt that appears instantly reads as fake in a demo.
    window.setTimeout(() => {
      setReceipt(billing.purchase(pendingTier, method, chosenPeriod))
      setStep('done')
    }, 1400)
  }

  function close() {
    setStep('browse')
    setPendingTier(null)
    setReceipt(null)
  }

  return (
    <div className="space-y-4">
      {/* The plan the owner is on takes the brand tint: it is the one card on this
          screen that is about her account rather than about an offer. */}
      <Card material="brand">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="eyebrow text-brand-700">{t('plan.currentTitle')}</div>
            {/* Fluid rather than a fixed 24px: the plan name is the longest string
                on this card ("SeePat NEGOSYO" on an old receipt) and it shares the
                row with the plan badge, so on a 280px phone it shrinks instead of
                wrapping under it. */}
            <div className="headline mt-1.5 text-[clamp(1.25rem,6.5vw,1.5rem)] leading-tight text-fg">
              {current.name}
            </div>
            <div className="meta mt-1 text-fg-subtle">
              {formatPlanPrice(current.priceCentavos)} {pick(lang, current.period)}
            </div>
          </div>
          <PlanBadge tier={billing.tier} />
        </div>

        {billing.tier !== 'free' && billing.entitlement.renewsAt ? (
          <p className="mt-3 border-t border-line pt-3 text-[0.8125rem] text-fg-subtle">
            {billing.entitlement.cancelAtPeriodEnd
              ? t('plan.cancelledUntil', {
                  date: formatDate(billing.entitlement.renewsAt, lang),
                })
              : t('plan.nextCharge', { date: formatDate(billing.entitlement.renewsAt, lang) })}
          </p>
        ) : null}

        {expiredButPaid ? (
          <p className="mt-3 border-t border-line pt-3 text-[0.8125rem] text-amber-700">
            {t('plan.expired')}
          </p>
        ) : null}

        {billing.tier !== 'free' ? (
          <div className="mt-3 flex gap-2">
            {billing.entitlement.cancelAtPeriodEnd ? (
              <Button variant="ghost" className="flex-1" onClick={billing.resume}>
                {t('plan.resume')}
              </Button>
            ) : (
              <Button variant="ghost" className="flex-1" onClick={billing.cancel}>
                {t('plan.cancel')}
              </Button>
            )}
          </div>
        ) : null}
      </Card>

      <div className="px-3.5">
        {/* The note's own stamp already says SIMULATED, so the copy starts with
            the sentence rather than repeating the word. */}
        <SimulatedNote>{t('plan.simulatedBody')}</SimulatedNote>
      </div>

      {/* Billing toggle: re-prices PRO live. Annual = ₱999 vs 12×₱99, so the
          badge names the real saving instead of a percentage. */}
      <div className="px-3.5">
        <div
          role="group"
          aria-label={t('plan.periodToggle')}
          className="flex items-center gap-1 rounded-full border border-line bg-card p-1 shadow-e1"
        >
          {(['monthly', 'annual'] as BillingPeriod[]).map((p) => {
            const selected = browsePeriod === p
            return (
              <button
                key={p}
                type="button"
                aria-pressed={selected}
                onClick={() => setBrowsePeriod(p)}
                className={`flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-full px-2 text-[0.8125rem] font-bold transition-all duration-200 ${
                  selected ? 'bg-ink-900 text-white shadow-pop' : 'text-fg-muted hover:text-fg'
                }`}
              >
                {p === 'monthly' ? t('plan.monthly') : t('plan.annual')}
                {p === 'annual' ? (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[0.6875rem] font-black ${
                      selected ? 'bg-gold-300 text-ink-900' : 'bg-gold-300/30 text-amber-800'
                    }`}
                  >
                    {t('plan.saveAnnual', {
                      amount: formatPlanPrice(priceFor('pro', 'monthly') * 12 - priceFor('pro', 'annual')),
                    })}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      </div>

      {visibleTiers().map((tier) => {
        const isCurrent = billing.tier === tier.id
        // Only features with working code are ever listed — planned items are
        // not sold. `liveFeatures` is the only source this page reads, so a
        // feature cannot be advertised before it exists.
        const live = liveFeatures()
        const included = live.filter((f) => tierRank(f.tier) <= tierRank(tier.id))
        const locked = live.filter((f) => tierRank(f.tier) > tierRank(tier.id))
        // Story-card split: 3 glanceable rows up front, everything else behind
        // the expander. PRO leads with its paid differentiators so the upgrade
        // reason is visible without scrolling; FREE leads with daily tools.
        const proOnly = included.filter((f) => f.tier === 'pro')
        const freeAnchors = included.filter((f) => f.tier === 'free')
        const top =
          tier.id === 'pro'
            ? [...proOnly, ...freeAnchors.slice(0, 1)].slice(0, 3)
            : included.slice(0, 3)
        const rest = included.slice(top.length)
        const open = expanded[tier.id] === true

        /*
         * The recommended column is the one dark card on the page — the same
         * near-black surface as the app's hero card. That is how a modern pricing
         * table marks its recommendation: no ribbon, no badge, no drop-shadow, just
         * a deliberately different surface where the eye already lands. With two
         * plans there is exactly one dark column (PRO) and FREE stays white, so
         * the column that reads as an offer is the one that has a price on it.
         */
        const ink = tier.highlight === true
        const soft = ink ? 'text-white/65' : 'text-fg-faint'
        const body = ink ? 'text-white/80' : 'text-fg-muted'

        return (
          <div
            key={tier.id}
            className={`plan-card relative w-full overflow-hidden border-y !border-x-0 p-5.5 shadow-e2 backdrop-blur-md ${
              ink
                ? 'plan-pro border-white/20 bg-gradient-to-br from-[#0c1445] via-[#091030] to-[#040714] text-white shadow-[0_20px_50px_-15px_rgba(8,16,50,0.55)]'
                : 'border-white/80 bg-white/70 shadow-xs'
            }`}
          >
            {/* One-time sheen sweep on the PRO card: ink-safe, motion-safe. */}
            {ink ? <span className="plan-pro-sheen" aria-hidden /> : null}
            {/* Story header: icon medallion + name + stamp on the left, price
                on the right. Glanceable in 3 seconds: what, how much, for whom. */}
            <div className="relative flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
                    ink
                      ? 'border border-gold-300/50 bg-gold-300/15 text-gold-300'
                      : 'border border-emerald-500/25 bg-emerald-500/10 text-emerald-700'
                  }`}
                  aria-hidden
                >
                  {tier.id === 'pro' ? (
                    <svg viewBox="0 0 24 24" className="h-5.5 w-5.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 3l2.6 5.6 6.1.8-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.4l6.1-.8z" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" className="h-5.5 w-5.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 9l8-5 8 5v9l-8 5-8-5zM4 9l8 5 8-5M12 14v7" />
                    </svg>
                  )}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className={`headline text-[1.05rem] ${ink ? 'text-white' : 'text-fg'}`}>
                      {tier.name}
                    </h2>
                    {ink ? (
                      <span className="rounded-full border border-gold-300/50 bg-gold-300/15 px-2.5 py-1 text-[0.6875rem] font-black tracking-[0.08em] text-gold-300 uppercase">
                        {t('plan.proStamp')}
                      </span>
                    ) : (
                      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[0.6875rem] font-black tracking-[0.08em] text-emerald-800 uppercase">
                        {t('plan.freeStamp')}
                      </span>
                    )}
                    {isCurrent ? (
                      ink ? (
                        <span className="rounded-full border border-white/25 px-2.5 py-1 text-[0.6875rem] font-extrabold tracking-[0.06em] text-white uppercase">
                          {t('plan.badgeCurrent')}
                        </span>
                      ) : (
                        <span className="stamp text-brand-700">{t('plan.badgeCurrent')}</span>
                      )
                    ) : null}
                  </div>
                  <p className={`mt-1 text-[0.8125rem] font-bold ${ink ? 'text-gold-300/90' : 'text-emerald-800'}`}>
                    {tier.id === 'pro' ? t('plan.proFor') : t('plan.freeFor')}
                  </p>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="money-cell">
                  <div className={`figure-xl leading-none ${ink ? 'text-white' : 'text-fg'}`}>
                    {tier.id === 'free'
                      ? formatPlanPrice(tier.priceCentavos)
                      : formatPlanPrice(priceFor(tier.id, browsePeriod))}
                  </div>
                </div>
                <div className={`eyebrow mt-1.5 ${soft}`}>
                  {tier.id === 'free'
                    ? pick(lang, tier.period)
                    : browsePeriod === 'annual'
                      ? t('plan.perYear')
                      : pick(lang, tier.period)}
                </div>
              </div>
            </div>

            {/* Daily-use trio: the 3 rows an owner actually reads. Icons carry
                meaning (basket = tala, mic = boses, spark = AI, cloud = backup)
                so a non-reader gets it from shape + 5 words. */}
            <p className={`relative mt-4 text-[0.6875rem] font-black tracking-[0.1em] uppercase ${soft}`}>
              {t('plan.topFeatures')}
            </p>
            <ul className="relative mt-1.5 space-y-1.5">
              {top.map((f) => (
                <li
                  key={f.key}
                  className={`flex items-center gap-2.5 rounded-2xl border px-3 py-2.5 text-[0.875rem] font-semibold leading-snug ${
                    ink ? 'border-white/12 bg-white/[0.07] text-white/90' : 'border-line bg-card text-fg-muted'
                  }`}
                >
                  <FeatureGlyph featureKey={f.key} ink={ink} />
                  <span>{pick(lang, f.label)}</span>
                </li>
              ))}
            </ul>

            {/* Everything else behind one expander: less text on load, full
                honesty one tap away. FREE also previews what stays locked so
                the upgrade reason is visible without leaving the card. */}
            {rest.length + locked.length > 0 ? (
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setExpanded((prev) => ({ ...prev, [tier.id]: !prev[tier.id] }))}
                className={`mt-2.5 flex w-full items-center justify-between gap-2 rounded-full border px-3.5 py-2.5 text-[0.8125rem] font-bold transition active:scale-[0.99] ${
                  ink
                    ? 'border-white/15 text-white/80 hover:bg-white/5'
                    : 'border-line-strong text-fg-subtle hover:text-fg'
                }`}
              >
                <span>{open ? t('plan.showLess') : t('plan.showMore', { n: rest.length + locked.length })}</span>
                <svg
                  viewBox="0 0 24 24"
                  className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
            ) : null}
            {open ? (
              <ul
                className={`relative mt-2.5 divide-y border-t ${
                  ink ? 'divide-white/10 border-white/15' : 'divide-line border-line/80'
                }`}
              >
                {rest.map((f) => (
                  <li key={f.key} className={`flex gap-2.5 py-2.5 text-[0.875rem] leading-relaxed ${body}`}>
                    <span
                      className={`mt-px flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full ${
                        ink ? 'bg-white/15' : 'bg-emerald-100'
                      }`}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className={`h-2.5 w-2.5 ${ink ? 'text-white' : 'text-emerald-700'}`}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    </span>
                    <span>{pick(lang, f.label)}</span>
                  </li>
                ))}
                {locked.map((f) => (
                  <li key={f.key} className={`flex gap-2.5 py-2.5 text-[0.875rem] leading-relaxed ${soft}`}>
                    <span
                      className={`mt-px flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border ${
                        ink ? 'border-white/25' : 'border-line-strong'
                      }`}
                    >
                      <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="5" y="10" width="14" height="10" rx="2" />
                        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                      </svg>
                    </span>
                    <span>{pick(lang, f.label)}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {tier.id === 'pro' ? (
              <p className={`relative mt-3 border-l-2 pl-3 text-[0.8125rem] leading-relaxed ${ink ? 'border-gold-300/50 text-white/65' : 'border-line-strong text-fg-subtle'}`}>
                {t('plan.proPays')}{' '}
                {t('plan.aiMeterNote', { n: AI_QUESTION_LIMIT })}
              </p>
            ) : null}

            {isCurrent ? null : tierRank(tier.id) > tierRank(billing.tier) ? (
              <Button
                className="relative mt-3.5 w-full rounded-full"
                variant={ink ? 'gold' : 'ghost'}
                onClick={() => startCheckout(tier.id as Exclude<TierId, 'free'>, browsePeriod)}
              >
                {t('plan.upgradeTo', { tier: tier.short })}
                {tier.id === 'pro' && browsePeriod === 'annual'
                  ? ` · ${formatPlanPrice(priceFor('pro', 'annual'))}${t('plan.perYear')}`
                  : ''}
              </Button>
            ) : (
              <Button
                className="relative mt-3.5 w-full rounded-full"
                variant="ghost"
                onClick={billing.downgrade}
              >
                {t('plan.backToTier', { tier: tier.short })}
              </Button>
            )}
          </div>
        )
      })}

      <Card material="inset" className="border-y border-line">
        <SectionTitle hint={t('plan.institutionalHint')}>{pick(lang, INSTITUTIONAL.name)}</SectionTitle>
        <p className="text-[0.875rem] leading-relaxed text-fg-subtle">
          {pick(lang, INSTITUTIONAL.tagline)}
        </p>
        {/* What an LGU actually buys, sketched with the shape of real data:
            cohort indicators only — no store's raw ledger ever appears here. */}
        <CohortPreview />
        <p className="mt-3 text-[0.875rem] leading-relaxed text-fg-subtle">
          {t('plan.cohortTitle')}: {t('plan.cohortBody')}
        </p>
        <Button variant="ghost" className="mt-3 w-full" onClick={close}>
          {t('plan.contact')}
        </Button>
      </Card>

      {billing.entitlement.invoices.length > 0 ? (
        <Card>
          <SectionTitle hint={t('plan.simulatedHint')}>{t('plan.receiptsTitle')}</SectionTitle>
          <ul className="divide-y divide-line">
            {billing.entitlement.invoices.map((invoice) => (
              <li key={invoice.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  {/* No `truncate`: at 280px it cut the plan name off the
                      receipt, and a receipt is the one row here someone might
                      need to read back to someone else. */}
                  <div className="text-[0.8125rem] leading-snug text-fg-muted">
                    {/* `invoicePlanName`, not the plan table: a receipt may name a
                        plan that is no longer sold, and that is the point — it
                        records what was paid, not what is on offer today. */}
                    {invoicePlanName(invoice)} · {paymentMethodLabel(invoice.method)}
                  </div>
                  <div className="text-[0.8125rem] text-fg-faint">
                    {invoice.reference} · {formatDate(invoice.at, lang)}
                  </div>
                </div>
                <span className="num shrink-0 text-[0.8125rem] text-fg-muted">
                  {formatPlanPrice(invoice.amountCentavos)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className="border-y border-line">
        <SectionTitle>{t('plan.whyPriceTitle')}</SectionTitle>
        <p className="text-[0.875rem] leading-relaxed text-fg-subtle">
          {t('plan.whyPriceBody')}
        </p>
      </Card>

      {step !== 'browse' ? (
        <CheckoutSheet
          step={step}
          tier={pendingTier}
          method={method}
          setMethod={setMethod}
          period={period}
          setPeriod={setPeriod}
          onPay={pay}
          onClose={close}
          receipt={receipt}
        />
      ) : null}
    </div>
  )
}

function CheckoutSheet({
  step,
  tier,
  method,
  setMethod,
  period,
  setPeriod,
  onPay,
  onClose,
  receipt,
}: {
  step: Step
  tier: Exclude<TierId, 'free'> | null
  method: PaymentMethod
  setMethod: (m: PaymentMethod) => void
  period: BillingPeriod
  setPeriod: (p: BillingPeriod) => void
  onPay: () => void
  onClose: () => void
  receipt: MockInvoice | null
}) {
  const t = useT()
  const lang = useLang()
  if (step === 'browse' || !tier) return null
  const plan = tierById(tier)
  const active = PAYMENT_METHODS.find((m) => m.id === method) ?? PAYMENT_METHODS[0]

  // Portalled to <body>. A `position: fixed` overlay is positioned against the
  // nearest ancestor that has a transform — and the screen's entrance animation
  // IS one — so nesting this inside the Plan screen anchored the sheet to the
  // screen instead of the viewport and pushed it off the bottom of the phone.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-scrim p-0 backdrop-blur-sm">
      <div className="safe-bottom w-full max-w-md rounded-t-3xl border border-line bg-card p-4 shadow-2xl">
        {step === 'method' ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <SectionTitle hint={t('plan.simulatedHint')}>{t('plan.checkoutTitle')}</SectionTitle>
                <p className="text-[0.875rem] leading-snug text-fg-muted">
                  {plan.name} · {formatPlanPrice(priceFor(tier, period))}{' '}
                  {period === 'annual' ? t('plan.perYear') : pick(lang, plan.period)}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="min-h-11 shrink-0 rounded-full border border-line-strong px-4 text-[0.8125rem] font-bold text-fg-subtle transition active:translate-y-px"
              >
                {t('app.close')}
              </button>
            </div>

            <div className="mt-3 flex gap-2" role="group" aria-label={t('plan.billingPeriod')}>
              {(['monthly', 'annual'] as BillingPeriod[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  aria-pressed={period === p}
                  className={`min-h-12 min-w-0 flex-1 rounded-2xl border px-3 py-2.5 text-[0.875rem] font-bold transition ${
                    period === p
                      ? 'border-ink-900 bg-ink-900 text-white'
                      : 'border-line-strong bg-card text-fg-subtle active:translate-y-px'
                  }`}
                >
                  {p === 'monthly'
                    ? `${t('plan.monthly')} · ${formatPlanPrice(priceFor(tier, 'monthly'))}`
                    : `${t('plan.annual')} · ${formatPlanPrice(priceFor(tier, 'annual'))}`}
                </button>
              ))}
            </div>

            <div className="mt-3 flex gap-2">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMethod(m.id)}
                  aria-pressed={m.id === method}
                  /* The selected wallet is filled rather than tinted, because the
                     tint was the only thing distinguishing it and a 10% wash of
                     brand blue is not a state anyone can read in daylight. */
                  className={`min-h-12 min-w-0 flex-1 rounded-2xl border px-3 py-2.5 text-[0.875rem] font-bold transition ${
                    m.id === method
                      ? 'border-ink-900 bg-ink-900 text-white'
                      : 'border-line-strong bg-card text-fg-subtle active:translate-y-px'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div className="mt-3 rounded-2xl border border-line bg-sunken p-3">
              <div className="eyebrow text-fg-faint">
                {t('plan.testNumber', { label: active.label })}
              </div>
              <div className="mt-1 font-mono text-[0.875rem] leading-snug text-fg-muted">
                {active.hint}
              </div>
            </div>

            <div className="mt-3">
              <SimulatedNote>{t('plan.checkoutWarning')}</SimulatedNote>
            </div>

            <Button className="mt-3 w-full" onClick={onPay}>
              {t('plan.paySimulated')}
            </Button>
          </>
        ) : null}

        {step === 'processing' ? (
          <div className="flex flex-col items-center py-6">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-line-strong border-t-brand-400" />
            <p className="mt-3 text-center text-[0.875rem] leading-snug text-fg-muted">
              {t('plan.confirming')}
            </p>
            <p className="mt-1 text-center text-[0.8125rem] leading-snug text-fg-faint">
              {t('plan.noRealNetwork')}
            </p>
          </div>
        ) : null}

        {step === 'done' && receipt ? (
          <>
            <div className="flex flex-col items-center py-2">
              <span className="flex h-12 w-12 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50">
                <svg
                  viewBox="0 0 24 24"
                  className="h-6 w-6 text-emerald-700"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 13l4 4L19 7" />
                </svg>
              </span>
              <p className="mt-3 text-center text-[1rem] font-semibold leading-snug text-fg">
                {t('plan.nowActive', { tier: plan.short })}
              </p>
              <p className="mt-1 text-center text-[0.8125rem] leading-snug text-fg-subtle">
                {formatPlanPrice(receipt.amountCentavos)} · {paymentMethodLabel(receipt.method)}
              </p>
            </div>

            <ul className="mt-3 space-y-1.5 border-t border-line pt-3 text-[0.8125rem]">
              {/* `flex-wrap` + `shrink-0` on the value: the row keeps its
                  label-left/value-right shape when both fit, and drops the value
                  onto its own line when they do not, instead of squeezing it. */}
              <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                <span className="min-w-0 text-fg-subtle">{t('plan.reference')}</span>
                <span className="shrink-0 font-mono text-fg-muted">{receipt.reference}</span>
              </li>
              <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                <span className="min-w-0 text-fg-subtle">{t('plan.date')}</span>
                <span className="shrink-0 text-fg-muted">{formatDate(receipt.at, lang)}</span>
              </li>
            </ul>

            <div className="mt-3">
              <SimulatedNote>{t('plan.receiptSimulated')}</SimulatedNote>
            </div>

            <Button className="mt-3 w-full" onClick={onClose}>
              {t('plan.done')}
            </Button>
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}

function CohortPreview() {
  // Illustrative shape, not a claim: three demo stores showing the aggregate
  // arithmetic an institutional buyer would see. Pilot data replaces this.
  const summary = summarizeCohort([
    { storeId: 'demo-1', recordingDays: 6, profitUp: true, completedOnboarding: true, scoreLatest: 72 },
    { storeId: 'demo-2', recordingDays: 4, profitUp: false, completedOnboarding: true, scoreLatest: 58 },
    { storeId: 'demo-3', recordingDays: 7, profitUp: true, completedOnboarding: false, scoreLatest: 81 },
  ])
  return (
    <div className="mt-3 grid grid-cols-3 gap-2.5 rounded-2xl border border-line bg-card p-3.5">
      <div>
        <div className="num text-[1.25rem] font-black leading-none text-fg">{summary.activeStores}/{summary.stores}</div>
        <div className="mt-1 text-[0.6875rem] font-bold uppercase tracking-wide text-fg-faint">active</div>
      </div>
      <div>
        <div className="num text-[1.25rem] font-black leading-none text-fg">
          {Math.round(summary.profitUpShare * 100)}%
        </div>
        <div className="mt-1 text-[0.6875rem] font-bold uppercase tracking-wide text-fg-faint">profit up</div>
      </div>
      <div>
        <div className="num text-[1.25rem] font-black leading-none text-fg">{summary.scoreMedian}</div>
        <div className="mt-1 text-[0.6875rem] font-bold uppercase tracking-wide text-fg-faint">median score</div>
      </div>
    </div>
  )
}

/**
 * One glyph per feature family so the top-3 rows read by shape, not by
 * sentence. Basket = records/stock, mic = voice, spark = AI, cloud = backup,
 * star = score, truck = restock, coin = capital/utang. Unknown keys fall back
 * to a tick — never a broken icon.
 */
function FeatureGlyph({ featureKey, ink }: { featureKey: string; ink: boolean }) {
  const path =
    featureKey === 'ledger' || featureKey === 'inventory'
      ? 'M4 9l8-5 8 5v9l-8 5-8-5zM4 9l8 5 8-5M12 14v7'
      : featureKey === 'utang' || featureKey === 'capital_views'
        ? 'M12 3v18M7 6h10M7 12h10M7 18h10M5 3h14v18H5z'
        : featureKey === 'voice_capture' || featureKey === 'speak_answers' || featureKey === 'offline_voice_model'
          ? 'M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z'
          : featureKey === 'ai_narration' || featureKey === 'ask_deterministic'
            ? 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18'
            : featureKey === 'cloud_backup'
              ? 'M7 18a4 4 0 0 1 0-8 6 6 0 0 1 11.5 1.5A3.5 3.5 0 0 1 17.5 18z'
              : featureKey === 'score_current' || featureKey === 'score_history'
                ? 'M12 3l2.6 5.6 6.1.8-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.4l6.1-.8z'
                : featureKey === 'restocking'
                  ? 'M3 7h13v8H3zM16 10h3l2 3v2h-5zM7 18a1.5 1.5 0 1 0 0-.01M18 18a1.5 1.5 0 1 0 0-.01'
                  : 'M20 6L9 17l-5-5'
  return (
    <span
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
        ink ? 'bg-white/12 text-gold-300' : 'bg-sunken text-fg-muted'
      }`}
      aria-hidden
    >
      <svg
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={path} />
      </svg>
    </span>
  )
}

function PlanBadge({ tier }: { tier: TierId }) {
  const tone = tier === 'free' ? 'neutral' : tier === 'pro' ? 'good' : 'warn'
  return <Pill tone={tone}>{tierById(tier).short}</Pill>
}
