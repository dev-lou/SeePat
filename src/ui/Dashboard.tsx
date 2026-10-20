import { useState } from 'react'
import type { ReactNode } from 'react'
import { AreaChart } from './charts.tsx'
import {
  Bar,
  Button,
  Card,
  CollapsibleSection,
  Delta,
  Donut,
  HeroShell,
  NoticeBanner,
  PrintSheet,
  ProgressRing,
  SectionTitle,
  SegmentedControl,
  Sheet,
  useCountUp,
} from './components.tsx'
import { PatSays } from './PatSays.tsx'
import { bandLabel, formatPHP, formatPercent } from '../engine/index.ts'
import { computeRestock } from '../engine/restock.ts'
import { topSellers } from '../engine/movers.ts'
import { buildWeeklyReport, periodReport, reportRange } from '../report.ts'
import type { ReportKind } from '../report.ts'
import type { Negosyo } from '../store.ts'
import { dayMonth, monthShort, pick, useLang, useT, weekdayLong, weekdayShort } from '../i18n/index.ts'

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

/*
 * Shortcut icons: hand-drawn-feel stroke icons (Lucide-style, 24-grid) drawn
 * inline — no emoji, no image fetch, nothing to fail offline. Each shortcut
 * owns a tint from the product palette so the row reads as five distinct
 * destinations, not five grey buttons.
 */
function ShortcutIcon({ d, tint }: { d: ReactNode; tint: string }) {
  return (
    <span aria-hidden className={`flex h-9 w-9 items-center justify-center rounded-xl ${tint}`}>
      <svg
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {d}
      </svg>
    </span>
  )
}

const ICON_PRINTER = (
  <>
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6" />
    <rect x="6" y="14" width="12" height="8" rx="1" />
  </>
)

const ICON_CLIPBOARD = (
  <>
    <rect x="8" y="2" width="8" height="4" rx="1" />
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <path d="M12 11h4" />
    <path d="M12 16h4" />
    <path d="M8 11h.01" />
    <path d="M8 16h.01" />
  </>
)

const ICON_PACKAGE = (
  <>
    <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
    <path d="m3.3 7 8.7 5 8.7-5" />
    <path d="M12 22V12" />
  </>
)

const ICON_RECEIPT = (
  <>
    <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
    <path d="M14 8H8" />
    <path d="M16 12H8" />
    <path d="M13 16H8" />
  </>
)

const ICON_DATABASE = (
  <>
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M3 5v14a9 3 0 0 0 18 0V5" />
    <path d="M3 12a9 3 0 0 0 18 0" />
  </>
)

const ICON_CHAT = (
  <>
    <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <path d="M12 17h.01" />
  </>
)

export function Dashboard({
  negosyo,
  onOpenScore,
  onOpenUtang,
  onOpenSupplier,
  onOpenOffline,
  onOpenItems,
  onOpenReceipt,
  onOpenAsk,
}: {
  negosyo: Negosyo
  onOpenScore: () => void
  /** The utang book — offered wherever the screen names money owed. */
  onOpenUtang?: () => void
  /** The supplier debts — where the "owed to suppliers" total can be seen. */
  onOpenSupplier?: () => void
  /** Backup + offline voice live on the Offline screen — one tap away. */
  onOpenOffline?: () => void
  /** My items — one tap from the Money page instead of via More. */
  onOpenItems?: () => void
  /** Receipt scan — one tap from the Money page instead of via More. */
  onOpenReceipt?: () => void
  /** Ask about the numbers — one tap from the Money page instead of via More. */
  onOpenAsk?: () => void
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

  // How the hero number is built, as rows that add up to it: sales minus the
  // cost of the goods sold minus expenses (minus spoilage & losses when there
  // is any). Without these the owner sees Sales next to a much smaller profit
  // with no visible subtraction in between — which reads as a bug in the app
  // rather than the price the goods themselves were bought for.
  const mathRows: { label: string; amountCentavos: number; sign: '+' | '−' }[] = [
    { label: t('dash.mathSales'), amountCentavos: today.revenueCentavos, sign: '+' },
    { label: t('dash.mathCogs'), amountCentavos: today.cogsCentavos, sign: '−' },
    { label: t('dash.mathExpenses'), amountCentavos: today.expensesCentavos, sign: '−' },
  ]
  if (today.shrinkageCentavos > 0) {
    mathRows.push({ label: t('dash.mathShrinkage'), amountCentavos: today.shrinkageCentavos, sign: '−' })
  }
  // A day with nothing in it needs no explanation; the strip would be four
  // rows of zeroes under a ₱0.00 hero.
  const mathVisible =
    today.revenueCentavos > 0 || today.expensesCentavos > 0 || today.shrinkageCentavos > 0

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

  // The report covers any range — day, week, month, year, current or past —
  // and the same figures feed the on-screen preview and the printed page, so
  // what the owner checks is what the paper carries.
  const [repKind, setRepKind] = useState<ReportKind>('week')
  const [repOffset, setRepOffset] = useState(0)
  const repRange = reportRange(repKind, repOffset, negosyo.now)
  const repFigures = periodReport(ledger, repRange.start, repRange.end)
  const thisYear = negosyo.now.getFullYear()
  const repYearSuffix = repRange.end.getFullYear() !== thisYear ? ` ${repRange.end.getFullYear()}` : ''
  const rangeLabel =
    repKind === 'day'
      ? `${weekdayLong(repRange.end, lang)}, ${monthShort(repRange.end, lang)} ${repRange.end.getDate()}${repYearSuffix}`
      : repKind === 'week'
        ? `${dayMonth(repRange.start, lang)}–${dayMonth(repRange.end, lang)}${repYearSuffix}`
        : repKind === 'month'
          ? `${monthShort(repRange.start, lang)} ${repRange.start.getFullYear()}`
          : `${repRange.start.getFullYear()}`
  const repTitleKey =
    repKind === 'day'
      ? 'report.titleDay'
      : repKind === 'week'
        ? 'report.titleWeek'
        : repKind === 'month'
          ? 'report.titleMonth'
          : 'report.titleYear'
  const reportInput = {
    weekLabel: rangeLabel,
    revenueCentavos: repFigures.revenueCentavos,
    cogsCentavos: repFigures.cogsCentavos,
    expensesCentavos: repFigures.expensesCentavos,
    shrinkageCentavos: repFigures.shrinkageCentavos,
    netProfitCentavos: repFigures.netProfitCentavos,
    cashCentavos: repFigures.cashCentavos,
    walletCentavos: repFigures.walletCentavos,
    receivablesCentavos: repFigures.receivablesCentavos,
    recordsCount: repFigures.recordsCount,
  }
  const previewRows = [
    { label: t('report.rowSales'), value: formatPHP(reportInput.revenueCentavos) },
    { label: t('report.rowCogs'), value: formatPHP(reportInput.cogsCentavos) },
    { label: t('report.rowExpenses'), value: formatPHP(reportInput.expensesCentavos) },
    ...(reportInput.shrinkageCentavos > 0
      ? [{ label: t('report.rowShrinkage'), value: formatPHP(reportInput.shrinkageCentavos) }]
      : []),
    { label: t('report.rowProfit'), value: formatPHP(reportInput.netProfitCentavos) },
    // The drawer line is the dashboard card's own number, repeated here so
    // the sheet and the card can never disagree the way "cash on hand"
    // once did (card: drawer only, sheet: everything including e-wallets).
    {
      label: t('report.rowDrawer'),
      value: formatPHP(reportInput.cashCentavos - reportInput.walletCentavos),
    },
    ...(reportInput.walletCentavos !== 0
      ? [{ label: t('report.rowWallet'), value: formatPHP(reportInput.walletCentavos) }]
      : []),
    { label: t('report.rowOwed'), value: formatPHP(reportInput.receivablesCentavos) },
    { label: t('report.rowRecords'), value: String(reportInput.recordsCount) },
  ]
  const [reportOpen, setReportOpen] = useState(false)

  function printWeek() {
    if (typeof window === 'undefined') return
    const pre = document.getElementById('seepat-weekly-report')
    if (pre) {
      pre.textContent = buildWeeklyReport(reportInput, t(repTitleKey, { label: rangeLabel }))
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

  // The greeting follows the clock on the owner's own phone: morning, hapon,
  // gabi. It is the first word on the screen, the way the tarsier greets first
  // in the reference — the numbers come right after, inside the bubble and
  // the hero below it.
  const hour = negosyo.now.getHours()
  const greeting =
    hour < 12 ? t('dash.greetMorning') : hour < 18 ? t('dash.greetAfternoon') : t('dash.greetEvening')

  return (
    <div className="space-y-5">
      {/* The greeting: date + Good morning. The shell header is hidden on this
          tab, so this block IS the top of the screen. One owl only — it roosts
          on the hero below, so none rides beside the words. */}
      <div className="px-3.5">
        <p className="eyebrow text-fg-faint">{todayLabel}</p>
        <h2 className="headline mt-1 text-[1.5rem] leading-tight text-fg">{greeting}</h2>
      </div>
      {/* Mascot + line, side by side: the full owl on the left, the bubble on
          the right with its tail pointing at him. Taps jump to the Score. */}
      <div className="px-3.5">
        <div className="mt-2.5 flex items-end gap-2.5">
          <button
            type="button"
            onClick={onOpenScore}
            className="owl-buddy shrink-0 transition-transform active:scale-95"
            aria-label={`SeePat Score ${score.value}/100 — ${bandLabel(score.band, lang)}`}
          >
            <img src="/seepat-mark.png" alt="" width={88} height={88} />
          </button>
          <div className="greet-bubble min-w-0 flex-1">
            <p className="text-[0.875rem] leading-relaxed text-fg-muted">
              <span className="num font-black text-fg">{formatPHP(Math.round(heroValue))}</span>{' '}
              {t('dash.heroExplain')}
            </p>
            <div className="mt-1.5">
              <Delta label={deltaLabel} direction={deltaDirection} />
            </div>
          </div>
        </div>
      </div>

      {/* The one dark surface on the screen: the day's real take, lit from behind,
          with the week's shape drawn underneath it. Everything else stays quiet so
          this number owns the top of the fold.

          Full-bleed, like the banking reference this product is measured against:
          the navy runs edge to edge with a rounded foot, and the quick-action
          card below overlaps that foot — one dark header, one white instrument
          panel, no margins interrupting either. */}
      <HeroShell className="p-5.5 shadow-[0_20px_50px_-15px_rgba(8,16,50,0.55)]">
        <div className="text-[0.7rem] font-extrabold tracking-[0.18em] text-gold-300/90 uppercase">
          {t('dash.heroLabel')}
        </div>

        <div className="figure-xl mt-3 text-[clamp(2.1rem,11.5vw,3.5rem)] leading-none font-black text-white tabular-nums drop-shadow-sm">
          {formatPHP(Math.round(heroValue))}
        </div>

        {mathVisible ? (
          <dl className="mx-auto mt-3 w-full max-w-60 space-y-1">
            {mathRows.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-3">
                <dt className="text-[0.75rem] font-semibold text-white/60">{row.label}</dt>
                <dd className="num text-[0.8125rem] font-bold whitespace-nowrap text-white/90 tabular-nums">
                  {row.sign} {formatPHP(row.amountCentavos)}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        <div className="mt-4">
          <AreaChart
            values={sales.map((d) => d.amountCentavos)}
            labels={dayLabels}
            surface="dark"
            height={88}
          />
        </div>

        {/*
          * The countable money, full width. Sales and expenses used to sit here
          * as cards — but the breakdown strip under the hero already carries
          * both, so the cards repeated the same two numbers twice on one
          * screen. The box is the only figure here that appears nowhere else.
          *
          * The box, and — when there is any — what is sitting in an e-wallet.
          * The hero figure used to be money on hand, which quietly included
          * GCash: an owner counting the drawer at night would find less than
          * the app claimed and have no way to tell why. So the headline is
          * now the countable number, and the float is named underneath it in
          * smaller type. It only appears when it is non-zero, because a zero
          * row on every screen is noise.
          */}
        <div className="money-cell mt-5 rounded-2xl border border-gold-300/40 bg-gradient-to-b from-white/15 to-white/5 px-3.5 py-3 shadow-[0_4px_16px_-4px_rgba(255,213,74,0.3)] backdrop-blur-md">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[0.7rem] font-black tracking-wider text-gold-300 uppercase">{t('dash.cash')}</div>
              {derived.walletCentavos > 0 ? (
                <div className="mt-1 text-[0.75rem] leading-snug font-bold text-gold-200/90">
                  {t('dash.wallet', { amount: formatPHP(derived.walletCentavos) })}
                </div>
              ) : null}
            </div>
            <div className="figure-lg num shrink-0 text-[1.25rem] font-black leading-none text-gold-300">
              {formatPHP(derived.cashInBoxCentavos)}
            </div>
          </div>
          {/*
            * Why the box can be full on a day the profit is negative: this is
            * every peso in the drawer — earlier days' takings and starting
            * cash included — while the hero is today's earnings alone. Without
            * this line a red −₱2,000 next to ₱42,000 reads as a contradiction.
            */}
          <p className="mt-1.5 text-[0.75rem] leading-snug font-semibold text-white/55">
            {t('dash.cashNote')}
          </p>
        </div>

        {/*
         * The two debts, always visible when either exists: who owes the owner
         * (tap → the Utang book, where each name can be collected), and what
         * the owner owes suppliers (supplier credit, cash loans taken — the
         * other half of "where did the money go?"). Hidden at zero, because a
         * zero row on every screen is noise.
         */}
        {derived.receivablesCentavos > 0 || derived.totalLiabilitiesCentavos > 0 ? (
          <div className="mt-3 space-y-2 border-t border-white/15 pt-3.5">
            {derived.receivablesCentavos > 0 ? (
              <button
                type="button"
                onClick={onOpenUtang}
                className="flex w-full items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.08] px-3.5 py-2.5 text-left backdrop-blur-md transition active:translate-y-px"
              >
                <span className="min-w-0">
                  <span className="block text-[0.7rem] font-bold tracking-wider text-white/70 uppercase">
                    {t('dash.statReceivables')}
                  </span>
                  <span className="num mt-0.5 block text-[1.0625rem] font-extrabold leading-none text-white">
                    {formatPHP(derived.receivablesCentavos)}
                  </span>
                  <span className="mt-0.5 block text-[0.75rem] font-semibold text-white/60">
                    {t('dash.debtors', {
                      n: Object.values(twin.receivables).filter((v) => v > 0).length,
                    })}
                  </span>
                </span>
                <span aria-hidden className="shrink-0 text-[1.125rem] font-bold text-white/60">
                  ›
                </span>
              </button>
            ) : null}
            {derived.totalLiabilitiesCentavos > 0 ? (
              <button
                type="button"
                onClick={onOpenSupplier}
                className="flex w-full items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.08] px-3.5 py-2.5 text-left backdrop-blur-md transition active:translate-y-px"
              >
                <span className="min-w-0">
                  <span className="block text-[0.7rem] font-bold tracking-wider text-white/70 uppercase">
                    {t('dash.statPayables')}
                  </span>
                  <span className="num mt-0.5 block text-[1.0625rem] font-extrabold leading-none text-white">
                    {formatPHP(derived.totalLiabilitiesCentavos)}
                  </span>
                </span>
                <span aria-hidden className="shrink-0 text-[1.125rem] font-bold text-white/60">
                  ›
                </span>
              </button>
            ) : null}
          </div>
        ) : null}

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

      {/* Shortcuts: the things owners hunted for — the printed weekly report,
          the utang statement, items, receipt scan, asking, and backup — one tap
          from the Money page instead of buried in a view, a book, or More. */}
      <div className="px-3.5">
        <div className="rounded-2xl border border-line/70 bg-white/70 p-3">
          <div className="text-[0.7rem] font-bold tracking-wider text-fg-faint uppercase">
            {t('dash.shortcutsTitle')}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setReportOpen(true)}
              className="inline-flex min-h-11 flex-col items-center justify-center gap-1.5 rounded-xl border border-line-strong px-2 py-2.5 text-[0.8125rem] font-bold text-fg-muted transition active:translate-y-px"
            >
              <ShortcutIcon d={ICON_PRINTER} tint="bg-brand-500/10 text-brand-700" />
              {t('dash.shortcutPrint')}
            </button>
            {onOpenUtang ? (
              <button
                type="button"
                onClick={onOpenUtang}
                className="inline-flex min-h-11 flex-col items-center justify-center gap-1.5 rounded-xl border border-line-strong px-2 py-2.5 text-[0.8125rem] font-bold text-fg-muted transition active:translate-y-px"
              >
                <ShortcutIcon d={ICON_CLIPBOARD} tint="bg-emerald-500/10 text-emerald-800" />
                {t('dash.shortcutUtang')}
              </button>
            ) : null}
            {onOpenItems ? (
              <button
                type="button"
                onClick={onOpenItems}
                className="inline-flex min-h-11 flex-col items-center justify-center gap-1.5 rounded-xl border border-line-strong px-2 py-2.5 text-[0.8125rem] font-bold text-fg-muted transition active:translate-y-px"
              >
                <ShortcutIcon d={ICON_PACKAGE} tint="bg-amber-500/15 text-amber-800" />
                {t('dash.shortcutItems')}
              </button>
            ) : null}
            {onOpenReceipt ? (
              <button
                type="button"
                onClick={onOpenReceipt}
                className="inline-flex min-h-11 flex-col items-center justify-center gap-1.5 rounded-xl border border-line-strong px-2 py-2.5 text-[0.8125rem] font-bold text-fg-muted transition active:translate-y-px"
              >
                <ShortcutIcon d={ICON_RECEIPT} tint="bg-violet-500/10 text-violet-800" />
                {t('dash.shortcutReceipt')}
              </button>
            ) : null}
            {onOpenAsk ? (
              <button
                type="button"
                onClick={onOpenAsk}
                className="inline-flex min-h-11 flex-col items-center justify-center gap-1.5 rounded-xl border border-line-strong px-2 py-2.5 text-[0.8125rem] font-bold text-fg-muted transition active:translate-y-px"
              >
                <ShortcutIcon d={ICON_CHAT} tint="bg-teal-500/10 text-teal-800" />
                {t('dash.shortcutAsk')}
              </button>
            ) : null}
            {onOpenOffline ? (
              <button
                type="button"
                onClick={onOpenOffline}
                className="inline-flex min-h-11 flex-col items-center justify-center gap-1.5 rounded-xl border border-line-strong px-2 py-2.5 text-[0.8125rem] font-bold text-fg-muted transition active:translate-y-px"
              >
                <ShortcutIcon d={ICON_DATABASE} tint="bg-sky-500/10 text-sky-800" />
                {t('dash.shortcutBackup')}
              </button>
            ) : null}
          </div>
        </div>
      </div>
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

      {/* Always mounted so the Print shortcut works from any view: `printWeek`
          fills this element and prints in the same tick. */}
      <PrintSheet>
        <pre
          id="seepat-weekly-report"
          className="print-sheet print-sheet-body print-report"
          aria-hidden
        />
      </PrintSheet>

      {/* Report preview: check the figures first, print second. The printed
          page carries exactly these numbers (see `reportInput`), so the preview
          is a promise the paper keeps. */}
      {reportOpen ? (
        <Sheet title={t('report.previewTitle')} hint={t('report.previewHint')} closeLabel={t('app.close')} onClose={() => setReportOpen(false)}>
          <SegmentedControl
            label={t('report.previewTitle')}
            value={repKind}
            onChange={(kind) => {
              setRepKind(kind)
              setRepOffset(0)
            }}
            options={[
              { id: 'day', label: t('report.periodDay') },
              { id: 'week', label: t('report.periodWeek') },
              { id: 'month', label: t('report.periodMonth') },
              { id: 'year', label: t('report.periodYear') },
            ]}
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setRepOffset((o) => o - 1)}
              aria-label={t('report.prevPeriod')}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-line-strong px-3 text-[1.125rem] font-bold text-fg-muted transition active:translate-y-px"
            >
              ‹
            </button>
            <span className="min-w-0 flex-1 truncate text-center text-[0.875rem] font-bold text-fg">{rangeLabel}</span>
            <button
              type="button"
              onClick={() => setRepOffset((o) => Math.min(0, o + 1))}
              disabled={repOffset >= 0}
              aria-label={t('report.nextPeriod')}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-line-strong px-3 text-[1.125rem] font-bold text-fg-muted transition active:translate-y-px disabled:opacity-40"
            >
              ›
            </button>
          </div>
          <ul className="mt-2 divide-y divide-line border-y border-line">
            {previewRows.map((row) => (
              <li key={row.label} className="flex items-baseline justify-between gap-4 py-2">
                <span className="text-[0.875rem] text-fg-subtle">{row.label}</span>
                <span className="num text-[0.9375rem] font-bold text-fg">{row.value}</span>
              </li>
            ))}
          </ul>
          <Button
            className="mt-3 w-full"
            onClick={() => {
              setReportOpen(false)
              printWeek()
            }}
          >
            {t('report.print')}
          </Button>
        </Sheet>
      ) : null}

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
            <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[0.6875rem] font-black uppercase tracking-wider text-emerald-800 border border-emerald-500/20">
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
          onClick={() => setReportOpen(true)}
          className="mt-3.5 inline-flex min-h-11 items-center gap-2 rounded-full border border-line-strong px-4 text-[0.875rem] font-bold text-fg-muted transition active:translate-y-px"
        >
          {t('report.print')}
        </button>
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
