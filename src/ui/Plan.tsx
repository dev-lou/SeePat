import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, Card, Pill, SectionTitle, SimulatedNote } from './components.tsx'
import {
  AI_QUESTION_LIMIT,
  FEATURES,
  INSTITUTIONAL,
  PAYMENT_METHODS,
  TIERS,
  formatDate,
  formatPlanPrice,
  paymentMethodLabel,
  tierById,
  tierRank,
} from '../billing.ts'
import type { Billing, MockInvoice, PaymentMethod, TierId } from '../billing.ts'
import { pick, useLang, useT } from '../i18n/index.ts'

/**
 * The pricing page, and the checkout that only pretends to charge.
 *
 * No payment gateway is contacted, no card or wallet details are transmitted,
 * and nothing here should be mistaken for a live billing integration. What the
 * screen *does* prove is the shape of the business model: three tiers, one
 * honest sentence per tier, and a hard line between what is free because it
 * costs nothing to serve and what is paid because it does.
 */

type Step = 'browse' | 'method' | 'processing' | 'done'

export function PlanScreen({ billing }: { billing: Billing }) {
  const lang = useLang()
  const t = useT()
  const [pendingTier, setPendingTier] = useState<Exclude<TierId, 'free'> | null>(null)
  const [method, setMethod] = useState<PaymentMethod>('gcash')
  const [step, setStep] = useState<Step>('browse')
  const [receipt, setReceipt] = useState<MockInvoice | null>(null)

  const current = tierById(billing.tier)
  const expiredButPaid = billing.entitlement.tier !== 'free' && billing.tier === 'free'

  function startCheckout(tier: Exclude<TierId, 'free'>) {
    setPendingTier(tier)
    setMethod('gcash')
    setStep('method')
  }

  function pay() {
    if (!pendingTier) return
    setStep('processing')
    // A deliberate pause. The point of the simulation is the *shape* of the
    // flow — choose, confirm, wait, get a receipt — not a spinner for its own
    // sake, but a receipt that appears instantly reads as fake in a demo.
    window.setTimeout(() => {
      setReceipt(billing.purchase(pendingTier, method))
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
      {/* The gold material: the plan the owner is on is the one thing on this
          screen that is about value, so it takes the value tint. */}
      <Card material="gold">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="eyebrow text-brand-700">{t('plan.currentTitle')}</div>
            <div className="headline mt-1.5 text-2xl leading-tight text-fg">{current.name}</div>
            <div className="meta mt-1 text-[0.62rem] text-fg-subtle">
              {formatPlanPrice(current.priceCentavos)} {pick(lang, current.period)}
            </div>
          </div>
          <PlanBadge tier={billing.tier} />
        </div>

        {billing.tier !== 'free' && billing.entitlement.renewsAt ? (
          <p className="mt-3 border-t border-line pt-3 text-[0.7rem] text-fg-subtle">
            {billing.entitlement.cancelAtPeriodEnd
              ? t('plan.cancelledUntil', {
                  date: formatDate(billing.entitlement.renewsAt, lang),
                })
              : t('plan.nextCharge', { date: formatDate(billing.entitlement.renewsAt, lang) })}
          </p>
        ) : null}

        {expiredButPaid ? (
          <p className="mt-3 border-t border-line pt-3 text-[0.7rem] text-amber-700">
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

      <SimulatedNote>
        <strong className="text-amber-800">{t('plan.simulatedLead')}</strong>{' '}
        {t('plan.simulatedBody')}
      </SimulatedNote>

      {TIERS.map((tier) => {
        const isCurrent = billing.tier === tier.id
        const included = FEATURES.filter((f) => tierRank(f.tier) <= tierRank(tier.id))
        const locked = FEATURES.filter((f) => tierRank(f.tier) > tierRank(tier.id))

        // Three plans should not look like three of the same card, and the accent
        // has to agree with the tier badge in the header: PRO is the gold
        // material, NEGOSYO takes the brand navy, and FREE stays plain so the two
        // paid columns are what the eye lands on.
        const accent =
          tier.highlight || tier.id === 'pro'
            ? 'gold'
            : tier.id === 'negosyo'
              ? 'brand'
              : 'plain'

        return (
          <div
            key={tier.id}
            className={`grain relative overflow-hidden rounded-card border p-4.5 shadow-e2 ${
              accent === 'gold'
                ? 'border-gold-200 bg-gradient-to-br from-gold-50 to-card'
                : accent === 'brand'
                  ? 'border-brand-200 bg-gradient-to-br from-brand-50 to-card'
                  : 'border-line bg-card'
            }`}
          >
            {/* A 3px accent rule across the top edge, the way a printed price
                sheet marks its recommended column. */}
            {accent === 'plain' ? null : (
              <span
                aria-hidden="true"
                className={`absolute inset-x-0 top-0 h-[3px] ${
                  accent === 'gold'
                    ? 'bg-gradient-to-r from-gold-400 via-gold-300 to-transparent'
                    : 'bg-gradient-to-r from-brand-600 via-brand-400 to-transparent'
                }`}
              />
            )}

            <div className="relative flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="headline text-[1.02rem] text-fg">{tier.name}</h2>
                  {tier.highlight ? <Pill tone="good">{t('plan.badgeBest')}</Pill> : null}
                  {tier.id === 'negosyo' ? <Pill tone="gold">{t('plan.badgeTop')}</Pill> : null}
                  {isCurrent ? <Pill tone="neutral">{t('plan.badgeCurrent')}</Pill> : null}
                </div>
                <p className="mt-1.5 text-[0.72rem] text-fg-subtle">{pick(lang, tier.tagline)}</p>
                <p className="mt-0.5 text-[0.68rem] text-fg-faint">{pick(lang, tier.audience)}</p>
              </div>
              <div className="shrink-0 text-right">
                <div className="figure-xl text-[1.85rem] leading-none text-fg">
                  {formatPlanPrice(tier.priceCentavos)}
                </div>
                <div className="mt-1 text-[0.65rem] font-semibold text-fg-faint">
                  {pick(lang, tier.period)}
                </div>
              </div>
            </div>

            <ul className="relative mt-3.5 space-y-2 border-t border-line/80 pt-3.5">
              {included.map((f) => (
                <li key={f.key} className="flex gap-2.5 text-[0.76rem] leading-snug text-fg-muted">
                  <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100">
                    <svg
                      viewBox="0 0 24 24"
                      className="h-2.5 w-2.5 text-emerald-700"
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
                <li key={f.key} className="flex gap-2.5 text-[0.76rem] leading-snug text-fg-faint">
                  <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-line-strong">
                    <svg
                      viewBox="0 0 24 24"
                      className="h-2 w-2 text-fg-faint"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                    >
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </span>
                  <span>{pick(lang, f.label)}</span>
                </li>
              ))}
            </ul>

            {tier.id === 'pro' ? (
              <p className="relative mt-3.5 rounded-2xl border border-line bg-card/70 px-3 py-2.5 text-[0.68rem] leading-relaxed text-fg-subtle shadow-e1">
                {t('plan.aiMeterNote', { n: AI_QUESTION_LIMIT })}
              </p>
            ) : null}

            {isCurrent ? null : tierRank(tier.id) > tierRank(billing.tier) ? (
              <Button
                className="relative mt-3.5 w-full"
                variant={tier.highlight || tier.id === 'negosyo' ? 'primary' : 'ghost'}
                onClick={() => startCheckout(tier.id as Exclude<TierId, 'free'>)}
              >
                {t('plan.upgradeTo', { tier: tier.short })}
              </Button>
            ) : (
              <Button
                className="relative mt-3.5 w-full"
                variant="ghost"
                onClick={billing.downgrade}
              >
                {t('plan.backToTier', { tier: tier.short })}
              </Button>
            )}
          </div>
        )
      })}

      <Card material="inset" className="border border-dashed border-line-strong">
        <SectionTitle hint={t('plan.institutionalHint')}>{pick(lang, INSTITUTIONAL.name)}</SectionTitle>
        <p className="text-[0.72rem] leading-relaxed text-fg-subtle">
          {pick(lang, INSTITUTIONAL.tagline)}
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
                  <div className="truncate text-xs text-fg-muted">
                    {tierById(invoice.tier).name} · {paymentMethodLabel(invoice.method)}
                  </div>
                  <div className="text-[0.65rem] text-fg-faint">
                    {invoice.reference} · {formatDate(invoice.at, lang)}
                  </div>
                </div>
                <span className="shrink-0 text-xs tabular-nums text-fg-muted">
                  {formatPlanPrice(invoice.amountCentavos)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className="border-line">
        <SectionTitle>{t('plan.whyPriceTitle')}</SectionTitle>
        <p className="text-[0.72rem] leading-relaxed text-fg-subtle">
          {t('plan.whyPriceBody')}
        </p>
        <p className="mt-2 text-[0.68rem] text-fg-faint">
          {t('plan.whyPriceFoot')}
        </p>
      </Card>

      {step !== 'browse' ? (
        <CheckoutSheet
          step={step}
          tier={pendingTier}
          method={method}
          setMethod={setMethod}
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
  onPay,
  onClose,
  receipt,
}: {
  step: Step
  tier: Exclude<TierId, 'free'> | null
  method: PaymentMethod
  setMethod: (m: PaymentMethod) => void
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
                <p className="text-sm text-fg-muted">
                  {plan.name} · {formatPlanPrice(plan.priceCentavos)} {pick(lang, plan.period)}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-line px-2 py-1 text-[0.7rem] text-fg-subtle"
              >
                {t('app.close')}
              </button>
            </div>

            <div className="mt-3 flex gap-2">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMethod(m.id)}
                  className={`flex-1 rounded-2xl border px-3 py-2 text-xs font-medium transition ${
                    m.id === method
                      ? 'border-brand-600/40 bg-brand-100 text-brand-800'
                      : 'border-line bg-card text-fg-subtle'
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
              <div className="mt-1 fonmeta text-sm text-fg-muted">{active.hint}</div>
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
            <p className="mt-3 text-sm text-fg-muted">{t('plan.confirming')}</p>
            <p className="mt-1 text-[0.68rem] text-fg-faint">{t('plan.noRealNetwork')}</p>
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
              <p className="mt-3 text-base font-semibold text-fg">
                {t('plan.nowActive', { tier: plan.short })}
              </p>
              <p className="mt-1 text-[0.7rem] text-fg-subtle">
                {formatPlanPrice(receipt.amountCentavos)} · {paymentMethodLabel(receipt.method)}
              </p>
            </div>

            <ul className="mt-3 space-y-1 border-t border-line pt-3 text-xs">
              <li className="flex justify-between gap-3">
                <span className="text-fg-subtle">{t('plan.reference')}</span>
                <span className="fonmeta text-fg-muted">{receipt.reference}</span>
              </li>
              <li className="flex justify-between gap-3">
                <span className="text-fg-subtle">{t('plan.date')}</span>
                <span className="text-fg-muted">{formatDate(receipt.at, lang)}</span>
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

function PlanBadge({ tier }: { tier: TierId }) {
  const tone = tier === 'free' ? 'neutral' : tier === 'pro' ? 'good' : 'warn'
  return <Pill tone={tone}>{tierById(tier).short}</Pill>
}
