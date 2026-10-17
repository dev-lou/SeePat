import { useEffect, useState } from 'react'
import { AreaChart } from './charts.tsx'
import {
  Bar,
  Card,
  ChecklistCard,
  CollapsibleSection,
  Delta,
  Donut,
  HeroShell,
  NoticeBanner,
  PrintSheet,
  ProgressRing,
  SectionTitle,
  SegmentedControl,
  useCountUp,
} from './components.tsx'
import { PatSays } from './PatSays.tsx'
import { bandLabel, formatPHP, formatPercent } from '../engine/index.ts'
import { computeRestock } from '../engine/restock.ts'
import { topSellers } from '../engine/movers.ts'
import { buildWeeklyReport } from '../report.ts'
import type { Negosyo } from '../store.ts'
import { monthShort, pick, useLang, useT, weekdayLong, weekdayShort } from '../i18n/index.ts'
import {
  checklistVisible,
  dismissChecklist,
  getChecklist,
  markChecklistStep,
} from '../onboarding.ts'
import type { ChecklistStep } from '../onboarding.ts'

// The capital breakdown in the product's own palette — brand blue, gold, flag
// red — with two data hues after that, because five categories cannot be told
// apart in three colours. Gold here is the 600 step: bright yellow is a 1.7:1
// mark on white and would simply disappear.
const SEGMENT_COLORS = ['#2a3ad6', '#b0830a', '#ce1126', '#0284c7', '#7c3aed']

/**
 * The hairline under a section heading.
 *
 * It is a divider, not an ornament: a card with a title, a line, and then a
 * block of figures reads as a panel with a header, where the same card without
 * the line reads as a stack of unrelated rows. `SectionTitle` lives in
 * src/ui/components.tsx and is shared by every screen, so the line sits here
 * instead — pulled up by its own negative margin so it lands just under the
 * words rather than down in the heading's bottom margin.
 */
function HeadingRule() {
  return <div className="-mt-2 mb-3.5 border-t border-line" aria-hidden />
}

export type DashTab = 'tala' | 'boses' | 'tanong' | 'score'

export function Dashboard({
  negosyo,
  onOpenScore,
  onOpenUtang,
  onGo,
}: {
  negosyo: Negosyo
  onOpenScore: () => void
  /** The utang book — offered wherever the screen names money owed. */
  onOpenUtang?: () => void
  onGo: (tab: DashTab) => void
}) {
  const { today, week, twin, derived, composition, provenance, score, ledger } = negosyo
  const lang = useLang()
  const t = useT()

  const sales = week.dailySales
  const todaySales = sales[sales.length - 1]?.amountCentavos ?? 0
  const prevSales = sales[sales.length - 2]?.amountCentavos ?? 0

  // Day-over-day is computed from the ledger's own daily sales, so it is a real
  // number — not a decoration. Yesterday at zero has no percentage to show, so
  // the chip says so rather than dividing by nothing.
  const deltaPct = prevSales > 0 ? ((todaySales - prevSales) / prevSales) * 100 : null
  const deltaDirection: 'up' | 'down' | 'flat' =
    deltaPct === null ? 'flat' : deltaPct > 0.5 ? 'up' : deltaPct < -0.5 ? 'down' : 'flat'
  const deltaLabel =
    deltaPct === null
      ? t('dash.deltaUnknown')
      : t('dash.delta', { sign: deltaPct >= 0 ? '+' : '', pct: deltaPct.toFixed(0) })

  const heroValue = useCountUp(today.netProfitCentavos)

  // Date words come from the language tables, not the device locale: "Tuesday,
  // Sep 15" sitting inside an all-Tagalog screen is the seam that makes a
  // product feel translated rather than written.
  const todayLabel = `${weekdayLong(negosyo.now, lang)}, ${monthShort(negosyo.now, lang)} ${negosyo.now.getDate()}`

  const dayLabels = sales.map((d) => weekdayShort(new Date(`${d.date}T12:00:00`), lang))

  // One colour per capital line, shared by the donut and the bars below it:
  // a segment that is gold in the ring and blue in the list represents
  // nothing. Offsets (owed to suppliers) are always the flag red; everything
  // else walks the palette in order. The donut draws only the positives.
  // Positives walk the palette in order; the flag-red stop is skipped for them
  // so no asset can ever wear the same red as the offset row. Offsets are
  // always that red.
  const positivePalette = SEGMENT_COLORS.filter((hex) => hex !== '#ce1126')
  const capitalRows: { component: (typeof composition.components)[number]; color: string }[] = []
  {
    let paletteIndex = 0
    for (const c of composition.components) {
      if (c.amountCentavos === 0) continue
      if (c.kind === 'offset') {
        capitalRows.push({ component: c, color: '#ce1126' })
      } else {
        capitalRows.push({
          component: c,
          color: positivePalette[paletteIndex % positivePalette.length],
        })
        paletteIndex += 1
      }
    }
  }
  const assetSegments = capitalRows
    .filter((row) => row.component.amountCentavos > 0)
    .map((row) => ({
      key: pick(lang, row.component.label),
      amount: row.component.amountCentavos,
      color: row.color,
    }))

  const slowMoverValue = Object.entries(twin.inventory).reduce((sum, [id, stock]) => {
    const sold = week.salesBySku[id]?.qtySold ?? 0
    return sold === 0 && stock.valueCentavos > 0 ? sum + stock.valueCentavos : sum
  }, 0)

  // One panel at a time: the view switch below the actions decides which of
  // these renders, so a new owner meets two cards under the hero instead of a
  // six-section report. `today` is the default — it holds the next step and the
  // score teaser, the two things that answer "what now?".
  const [view, setView] = useState<'today' | 'week' | 'capital'>('today')
  // Urgent, so it sits outside the panels and above the fold — but closable,
  // because a banner nobody can dismiss is a banner nobody reads twice.
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const [checklist, setChecklist] = useState(getChecklist)

  // The first sale completes the checklist by itself: no tap required, the
  // ledger is the proof the step happened.
  useEffect(() => {
    setChecklist((prev) => {
      if (ledger.transactions.length === 0 || prev.done.includes('sale')) return prev
      return markChecklistStep(prev, 'sale')
    })
  }, [ledger.transactions.length])

  function handleChecklistStep(id: string) {
    if (id === 'sale') {
      onGo('tala')
      return
    }
    setChecklist((prev) => markChecklistStep(prev, id as ChecklistStep))
    if (id === 'voice') onGo('boses')
    else if (id === 'score') onOpenScore()
  }

  const checklistSteps = [
    {
      id: 'sale',
      label: t('dash.checklist.sale'),
      done: ledger.transactions.length > 0 || checklist.done.includes('sale'),
    },
    { id: 'voice', label: t('dash.checklist.voice'), done: checklist.done.includes('voice') },
    { id: 'score', label: t('dash.checklist.score'), done: checklist.done.includes('score') },
  ]

  // Restock advice from data already on the phone: days of stock left per SKU.
  // Zero serving cost: it reads the owner's own stock and her own week, so it is
  // free and always was. It used to be sold as a PRO feature, which the pricing
  // page's own rule ("what needs a server is what you pay for") could not
  // justify — the numbers never left the phone.
  const restock = computeRestock(ledger, twin, week.salesBySku)

  // The other half of the same idea: what is selling, ranked by what it kept.
  // `topSellers` is the same comparison the spoken answer uses, and a test holds
  // the two together so the screen can never contradict the answer.
  const bestSellers = topSellers(ledger, week.salesBySku, 5)

  function printWeek() {
    if (typeof window === 'undefined') return
    const pre = document.getElementById('seepat-weekly-report')
    if (pre) {
      pre.textContent = buildWeeklyReport({
        weekLabel: todayLabel,
        revenueCentavos: week.revenueCentavos,
        expensesCentavos: week.revenueCentavos - week.netProfitCentavos,
        netProfitCentavos: week.netProfitCentavos,
        cashCentavos: twin.cashCentavos,
        receivablesCentavos: derived.receivablesCentavos,
        recordsCount: ledger.transactions.length,
      })
    }
    window.print()
  }

  const warnings = twin.warnings.slice(0, 3)
  const bannerLines = warnings.slice(0, 2).map((w) => pick(lang, { en: w.message, fil: w.messageFil }))

  const bannerVisible = warnings.length > 0 && !bannerDismissed

  // Where Pat reads from: the ledger's own diagnostics first, then the score's
  // priorities and strengths — every one of them a sentence the engine wrote.
  //
  // Pat skips whatever the banner is already showing. The two sit a card apart on
  // the same screen, and the app was printing one warning twice, word for word —
  // which reads as an app with nothing else to say, and buries the priority
  // ("collect first") underneath a technical note about a missing customer.
  const patSources = {
    warnings: bannerVisible ? twin.warnings.slice(bannerLines.length) : twin.warnings,
    priorities: score.priorities,
    strengths: score.strengths,
    sufficientData: score.sufficientData,
  }

  const twinCells: { label: string; value: string; tone?: 'good' | 'bad' }[] = [
    { label: t('dash.statTotalAssets'), value: formatPHP(derived.totalAssetsCentavos) },
    { label: t('dash.statPayables'), value: formatPHP(derived.totalLiabilitiesCentavos) },
    { label: t('dash.statEquity'), value: formatPHP(derived.equityCentavos), tone: 'good' },
    { label: t('dash.statInventory'), value: formatPHP(derived.inventoryValueCentavos) },
    { label: t('dash.statReceivables'), value: formatPHP(derived.receivablesCentavos) },
    {
      label: t('dash.statSlow'),
      value: formatPHP(slowMoverValue),
      tone: slowMoverValue > 0 ? 'bad' : 'good',
    },
  ]

  return (
    <div className="space-y-5">
      {/* The one dark surface on the screen: the day's real take, lit from behind,
          with the week's shape drawn underneath it. Everything else stays quiet so
          this number owns the top of the fold.

          Full-bleed, like the banking reference this product is measured against:
          the navy runs edge to edge with a rounded foot, and the quick-action
          card below overlaps that foot — one dark header, one white instrument
          panel, no margins interrupting either. */}
      <HeroShell className="p-5.5 shadow-[0_20px_50px_-15px_rgba(8,16,50,0.55)]">
        {/*
         * The label, not a badge.
         *
         * This row used to hold two rounded pills — "REAL PROFIT TODAY" and a
         * score chip — and the pair read as generated dashboard furniture: two
         * lozenges of chrome above a number that needs no frame. The score also
         * lived twice on this screen (here and in the card below) and a third
         * time as its own destination in the dock, so the pill was the least
         * useful of the three. What is left is the one thing the figure needs:
         * what it is and what day it covers.
         */}
        <div className="flex items-center gap-2">
          <span className="text-[0.7rem] font-extrabold tracking-[0.18em] text-gold-300/90 uppercase">
            {t('dash.heroLabel')}
          </span>
        </div>

        <div className="figure-xl mt-4 text-[clamp(2.1rem,11.5vw,3.5rem)] leading-none font-black text-white tabular-nums drop-shadow-sm">
          {formatPHP(Math.round(heroValue))}
        </div>

        <p className="aside mt-2 text-[0.9375rem] leading-relaxed text-white/85">
          {t('dash.heroExplain')}
        </p>

        <div className="mt-3.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <span className="text-[0.8125rem] font-medium text-white/90">{todayLabel}</span>
          <Delta label={deltaLabel} direction={deltaDirection} surface="dark" />
        </div>

        <div className="mt-4">
          <AreaChart
            values={sales.map((d) => d.amountCentavos)}
            labels={dayLabels}
            surface="dark"
            height={88}
          />
        </div>

        <div className="fit-grid-3 mt-5 grid grid-cols-3 gap-2.5 border-t border-white/15 pt-4">
          <div className="money-cell min-w-0 rounded-2xl bg-white/[0.08] backdrop-blur-md p-3 border border-white/10">
            <div className="text-[0.7rem] font-bold tracking-wider text-white/70 uppercase">{t('dash.revenue')}</div>
            <div className="figure-lg mt-1 text-[1.0625rem] font-extrabold text-white leading-none">{formatPHP(today.revenueCentavos)}</div>
          </div>
          <div className="money-cell min-w-0 rounded-2xl bg-white/[0.08] backdrop-blur-md p-3 border border-white/10">
            <div className="text-[0.7rem] font-bold tracking-wider text-white/70 uppercase">{t('dash.expenses')}</div>
            <div className="figure-lg mt-1 text-[1.0625rem] font-extrabold text-white leading-none">{formatPHP(today.expensesCentavos)}</div>
          </div>
          <div className="money-cell min-w-0 rounded-2xl bg-gradient-to-b from-white/15 to-white/5 backdrop-blur-md p-3 border border-gold-300/40 shadow-[0_4px_16px_-4px_rgba(255,213,74,0.3)]">
            <div className="text-[0.7rem] font-black tracking-wider text-gold-300 uppercase">{t('dash.cash')}</div>
            {/*
              * The box, and — when there is any — what is sitting in an e-wallet.
              *
              * The hero figure used to be money on hand, which quietly included
              * GCash: an owner counting the drawer at night would find less than
              * the app claimed and have no way to tell why. So the headline is
              * now the countable number, and the float is named underneath it in
              * smaller type. It only appears when it is non-zero, because a zero
              * row on every screen is noise.
              */}
            <div className="figure-lg mt-1 text-[1.0625rem] font-black text-gold-300 leading-none">
              {formatPHP(derived.cashInBoxCentavos)}
            </div>
            {derived.walletCentavos > 0 ? (
              <div className="mt-1 text-[0.75rem] leading-snug font-bold text-gold-200/90">
                {t('dash.wallet', { amount: formatPHP(derived.walletCentavos) })}
              </div>
            ) : null}
          </div>
        </div>

        {/*
         * Sales and cash are different numbers, and utang is the only reason
         * they differ. Without this line the owner sees Sales ₱8,980 next to
         * Cash ₱3,100 with no explanation — which reads like an error in the
         * app rather than money sitting in a neighbour's pocket.
         *
         * It only appears when there is something to explain, and the button is
         * the fix, not a link to a report: the person to ask is already known.
         */}
        {today.uncollectedCentavos > 0 ? (
          <div className="mt-3.5 rounded-2xl border border-amber-300/40 bg-amber-400/15 px-3.5 py-3">
            <p className="text-[0.8125rem] font-semibold leading-relaxed text-amber-100">
              {t('dash.utangLine', { amount: formatPHP(today.uncollectedCentavos) })}
            </p>
            {onOpenUtang ? (
              <button type="button" onClick={onOpenUtang} className="btn btn-quiet mt-2.5">
                {t('dash.collectCta')}
              </button>
            ) : null}
          </div>
        ) : null}
      </HeroShell>

      {/* Dismissible warnings: at most two lines plus a count, right under the
          hero. The full list used to be its own section at the very bottom —
          the last thing a worried owner would ever reach. */}
      {warnings.length > 0 && !bannerDismissed ? (
        <div className="px-3.5">
          <NoticeBanner
            title={t('dash.watchTitle')}
            lines={bannerLines}
            moreCount={warnings.length - bannerLines.length}
            moreLabel={
              warnings.length > bannerLines.length
                ? t('dash.banner.more', { n: warnings.length - bannerLines.length })
                : undefined
            }
            onDismiss={() => setBannerDismissed(true)}
            dismissLabel={t('dash.banner.dismiss')}
          />
        </div>
      ) : null}

      {/* First-run guide: three steps, resumable, gone once done or hidden. */}
      {checklistVisible(checklist) ? (
        <div className="px-3.5">
          <ChecklistCard
            title={t('dash.checklist.title')}
            steps={checklistSteps}
            onStep={handleChecklistStep}
            onDismiss={() => setChecklist((prev) => dismissChecklist(prev))}
            dismissLabel={t('dash.checklist.dismiss')}
          />
        </div>
      ) : null}

      {/* The view switch: Ngayon | 7 araw | Puhunan. Tabs stay destinations;
          this chooses which panel shows, so only one of them is ever open. */}
      <div className="px-3.5">
        <SegmentedControl
          label={t('dash.view.label')}
          value={view}
          onChange={setView}
          options={[
            { id: 'today', label: t('dash.view.today') },
            { id: 'week', label: t('dash.view.week') },
            { id: 'capital', label: t('dash.view.capital') },
          ]}
        />
      </div>

      {view === 'today' ? (
      <>
      {/* Sipat sits directly under the hero because the brief is about the number
          above it: it is the sentence the engine would say about today's take. */}
      <div className="px-3.5">
        <PatSays band={score.band} sources={patSources} onOpenScore={onOpenScore} />
      </div>

      {/* Score teaser: the ring is the same gauge as the Score tab, styled as an ultra-luxury fintech dial */}
      <div className="px-3.5">
        <button
          type="button"
          onClick={onOpenScore}
          className="surface surface-raise group relative flex w-full flex-col items-start gap-3 overflow-hidden rounded-2xl p-4.5 text-left border border-white/80 shadow-[0_8px_30px_rgb(0,0,0,0.04)] min-[380px]:flex-row min-[380px]:items-center min-[380px]:gap-4.5"
        >
        <div className="relative shrink-0">
          <ProgressRing value={score.value} size={78} stroke={9} gradient="deep">
            <span className="figure-lg text-[1.25rem] font-black leading-none text-fg">{score.value}</span>
          </ProgressRing>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[0.6875rem] font-extrabold uppercase tracking-wider text-brand-700">{t('dash.scoreTitle')}</span>
            <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[0.625rem] font-black uppercase tracking-wider text-emerald-800 border border-emerald-500/20">
              {bandLabel(score.band, lang)}
            </span>
          </div>
          <div className="headline mt-1 text-[1.05rem] font-bold text-fg">
            {bandLabel(score.band, lang)}
          </div>
          <p className="aside mt-1 text-[0.84rem] leading-relaxed text-fg-subtle">
            {score.strengths[0] ?? t('dash.scoreEmpty')}
          </p>
        </div>
        <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sunken/80 text-fg-muted group-hover:bg-brand-600 group-hover:text-white transition-all duration-200 shadow-xs min-[380px]:flex">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </button>
      </div>
      </>
      ) : null}

      {view === 'week' ? (
      <>
      <Card>
        <SectionTitle hint={t('dash.days7')}>{t('dash.weekTitle')}</SectionTitle>
        <HeadingRule />
        <div className="fit-grid-3 grid grid-cols-3 gap-2.5">
          <div className="rounded-2xl border border-brand-500/15 bg-gradient-to-br from-brand-500/[0.06] to-transparent p-3.5 backdrop-blur-md">
            <div className="text-[0.7rem] font-bold tracking-wider text-brand-800 uppercase">{t('dash.revenue')}</div>
            <div className="figure-lg mt-1 text-[1.0625rem] font-black text-fg leading-none">{formatPHP(week.revenueCentavos)}</div>
            <div className="mt-2 text-[0.6875rem] font-semibold text-fg-faint flex items-center gap-1">
              <span className="text-brand-600">▲</span> 7-day sales
            </div>
          </div>
          <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.08] to-transparent p-3.5 backdrop-blur-md">
            <div className="text-[0.7rem] font-bold tracking-wider text-emerald-800 uppercase">{t('dash.profit')}</div>
            <div className={`figure-lg mt-1 text-[1.0625rem] font-black leading-none ${week.netProfitCentavos >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
              {formatPHP(week.netProfitCentavos)}
            </div>
            <div className="mt-2 text-[0.6875rem] font-semibold text-emerald-800 flex items-center gap-1">
              <span>●</span> {week.netProfitCentavos >= 0 ? 'Net positive' : 'Negative'}
            </div>
          </div>
          <div className="rounded-2xl border border-violet-500/15 bg-gradient-to-br from-violet-500/[0.06] to-transparent p-3.5 backdrop-blur-md">
            <div className="text-[0.7rem] font-bold tracking-wider text-violet-800 uppercase">{t('dash.margin')}</div>
            <div className="figure-lg mt-1 text-[1.0625rem] font-black text-fg leading-none">{formatPercent(week.netMargin)}</div>
            <div className="mt-2 text-[0.6875rem] font-medium text-fg-faint truncate">{t('dash.marginSub')}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={printWeek}
          className="mt-3.5 inline-flex min-h-11 items-center gap-2 rounded-full border border-line-strong px-4 text-[0.875rem] font-bold text-fg-muted transition active:translate-y-px"
        >
          {t('report.print')}
        </button>
        {/*
         * The print-only surface: hidden on screen, the only thing on paper.
         *
         * `printWeek` fills this element and prints it in the same tick, so the
         * sheet is permanent and its content is not: a `pre` React owns and the
         * printer overwrites is exactly what this needs to be. `PrintSheet`
         * handles the portal and the print marker together — see it for why the
         * marker cannot be set from here.
         */}
        <PrintSheet>
          <pre
            id="seepat-weekly-report"
            className="print-sheet print-sheet-body print-report"
            aria-hidden
          />
        </PrintSheet>
      </Card>
      <div className="px-3.5">
      <CollapsibleSection id="dash-restock" title={t('restock.title')} defaultOpen={restock.length > 0}>
        {restock.length === 0 ? (
          <p className="text-[0.875rem] leading-relaxed text-fg-faint">{t('restock.empty')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {restock.map((r) => (
              <li key={r.skuId} className="flex items-center gap-3 py-2.5">
                <span
                  aria-hidden
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                    r.severity === 'out'
                      ? 'bg-red-600'
                      : r.severity === 'low'
                        ? 'bg-amber-500'
                        : 'bg-emerald-600'
                  }`}
                />
                <span className="min-w-0 flex-1 text-[0.875rem] leading-snug text-fg">
                  {r.name}
                </span>
                <span className={`num shrink-0 text-[0.8125rem] font-bold ${r.severity === 'out' ? 'text-red-700' : 'text-fg-subtle'}`}>
                  {r.severity === 'out' ? t('restock.out') : t('restock.days', { n: Math.max(0, Math.floor(r.daysLeft)) })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        id="dash-best"
        title={t('dash.bestTitle')}
        hint={t('dash.bestHint')}
        defaultOpen={bestSellers.length > 0}
      >
        {bestSellers.length === 0 ? (
          <p className="text-[0.875rem] leading-relaxed text-fg-faint">{t('dash.bestEmpty')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {bestSellers.map((item) => (
              <li key={item.skuId} className="flex items-baseline gap-3 py-2.5">
                <span className="min-w-0 flex-1 text-[0.875rem] leading-snug text-fg">
                  {item.name}
                </span>
                <span className="num shrink-0 text-[0.8125rem] text-fg-faint">
                  {t('dash.bestQty', { n: item.qtyDisplay, unit: item.unit })}
                </span>
                {/* Margin, not revenue: the amount this item actually kept is the
                    number that decides whether to buy more of it. */}
                <span className="num shrink-0 text-[0.875rem] font-bold text-emerald-700">
                  {formatPHP(item.marginCentavos)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleSection>
      </div>
      </>
      ) : null}

      {view === 'capital' ? (
      <div className="space-y-3 px-3.5">
      <CollapsibleSection id="dash-capital" title={t('dash.capitalTitle')} hint={t('dash.today')} defaultOpen>
        <div className="flex flex-col items-center sm:flex-row sm:items-center sm:justify-around gap-4 py-2">
          <Donut
            segments={assetSegments}
            centerLabel={t('dash.capitalCenter')}
            centerValue={formatPHP(composition.netAssetsCentavos)}
          />
        </div>
        <div className="mt-4 space-y-1.5 border-t border-line/70 pt-3">
          {capitalRows.map(({ component: c, color }) => (
            <Bar
              key={c.key}
              label={pick(lang, c.label)}
              amount={formatPHP(c.amountCentavos)}
              share={c.share}
              tone={c.kind === 'offset' ? 'offset' : 'brand'}
              note={c.note ? pick(lang, c.note) : undefined}
              color={color}
            />
          ))}
        </div>
        <ul className="mt-4 space-y-2 border-t border-line/70 pt-3.5">
          {composition.narrative.map((line) => (
            <li key={line} className="flex items-start gap-2.5 text-[0.875rem] leading-relaxed text-fg-muted">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600 shadow-[0_0_6px_rgba(42,58,214,0.6)]" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </CollapsibleSection>

      <CollapsibleSection
        id="dash-provenance"
        title={t('dash.provenanceTitle')}
        hint={provenance.reconciled ? t('dash.matched') : t('dash.mismatched')}
      >
        <p className="aside mb-4 text-[0.9375rem] leading-relaxed text-fg-subtle">
          {t('dash.provenanceBody')}
        </p>
        <div className="fit-grid-2 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-line bg-sunken/40 p-3.5">
            <div className="text-[0.6875rem] font-black uppercase tracking-wider text-fg-faint mb-2.5 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
              {t('dash.sources')}
            </div>
            {provenance.sources.map((s) => (
              <div key={s.key} className="flex justify-between items-baseline gap-2 border-b border-line/60 py-2 last:border-b-0">
                <span className="min-w-0 text-[0.84rem] leading-snug text-fg-muted">
                  {pick(lang, s.label)}
                </span>
                <span className="num shrink-0 text-[0.875rem] font-bold text-fg">
                  {formatPHP(s.amountCentavos)}
                </span>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-line bg-sunken/40 p-3.5">
            <div className="text-[0.6875rem] font-black uppercase tracking-wider text-fg-faint mb-2.5 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-gold-500" />
              {t('dash.uses')}
            </div>
            {provenance.uses.map((u) => (
              <div key={u.key} className="flex justify-between items-baseline gap-2 border-b border-line/60 py-2 last:border-b-0">
                <span className="min-w-0 text-[0.84rem] leading-snug text-fg-muted">
                  {pick(lang, u.label)}
                </span>
                <span className="num shrink-0 text-[0.875rem] font-bold text-fg">
                  {formatPHP(u.amountCentavos)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection id="dash-twin" title={t('dash.twinTitle')} hint={t('dash.twinHint')}>
        <div className="fit-grid-2 grid grid-cols-2 gap-2.5">
          {twinCells.map((cell) => (
            <div
              key={cell.label}
              className="money-cell min-w-0 rounded-2xl border border-line/80 bg-white/60 backdrop-blur-md p-3.5 shadow-xs transition hover:border-brand-500/30"
            >
              <div className="text-[0.75rem] leading-snug font-bold tracking-wide text-fg-faint uppercase">
                {cell.label}
              </div>
              <div
                className={`figure-lg mt-1.5 leading-none font-black text-[1.15rem] ${
                  cell.tone === 'good'
                    ? 'text-emerald-700'
                    : cell.tone === 'bad'
                      ? 'text-red-700'
                      : 'text-fg'
                }`}
              >
                {cell.value}
              </div>
            </div>
          ))}
        </div>
        <p className="aside mt-3.5 text-[0.875rem] leading-relaxed text-fg-faint">
          {t('dash.invariant', { n: ledger.transactions.length })}
        </p>
      </CollapsibleSection>
      </div>
      ) : null}
    </div>
  )
}
