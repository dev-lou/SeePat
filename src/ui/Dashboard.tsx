import { AreaChart } from './charts.tsx'
import {
  Bar,
  Card,
  Delta,
  Donut,
  HeroLabel,
  HeroShell,
  HeroStat,
  ProgressRing,
  SectionTitle,
  Stat,
  useCountUp,
} from './components.tsx'
import { PatSays } from './PatSays.tsx'
import { bandLabel, formatPHP, formatPercent } from '../engine/index.ts'
import type { Negosyo } from '../store.ts'
import { monthShort, pick, useLang, useT, weekdayLong, weekdayShort } from '../i18n/index.ts'

// The capital breakdown in the flag's own palette — navy, gold, flag red — with
// two data hues after that, because five categories cannot be told apart in
// three colours. Gold here is the 600 step: bright gold is a 1.7:1 mark on white
// and would simply disappear.
const SEGMENT_COLORS = ['#1b45a6', '#b07f08', '#ce1126', '#0284c7', '#7c3aed']

export function Dashboard({ negosyo, onOpenScore }: { negosyo: Negosyo; onOpenScore: () => void }) {
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

  const assetSegments = composition.components
    .filter((c) => c.amountCentavos > 0)
    .map((c, index) => ({
      key: pick(lang, c.label),
      amount: c.amountCentavos,
      color: SEGMENT_COLORS[index % SEGMENT_COLORS.length],
    }))

  const slowMoverValue = Object.entries(twin.inventory).reduce((sum, [id, stock]) => {
    const sold = week.salesBySku[id]?.qtySold ?? 0
    return sold === 0 && stock.valueCentavos > 0 ? sum + stock.valueCentavos : sum
  }, 0)

  const warnings = twin.warnings.slice(0, 3)

  // Where Pat reads from: the ledger's own diagnostics first, then the score's
  // priorities and strengths — every one of them a sentence the engine wrote.
  const patSources = {
    warnings: twin.warnings,
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
    <div className="space-y-4">
      {/* The one dark surface on the screen: the day's real take, lit from behind,
          with the week's shape drawn underneath it. Everything else stays quiet so
          this number owns the top of the fold. */}
      <HeroShell>
        <div className="flex items-start justify-between gap-3">
          <HeroLabel>{t('dash.heroLabel')}</HeroLabel>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[0.62rem] font-bold text-white backdrop-blur-sm">
            <span className="text-brand-200">★</span>
            {score.value}
            <span className="font-semibold text-white">{bandLabel(score.band, lang)}</span>
          </span>
        </div>

        <div className="figure-xl mt-3 text-[2.9rem] leading-none text-white tabular-nums">
          {formatPHP(Math.round(heroValue))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <span className="text-[0.68rem] font-medium text-white/90">{todayLabel}</span>
          <Delta label={deltaLabel} direction={deltaDirection} surface="dark" />
        </div>

        <div className="mt-4">
          <AreaChart
            values={sales.map((d) => d.amountCentavos)}
            labels={dayLabels}
            surface="dark"
            height={82}
          />
        </div>

        {/* Hairline-divided rail: three figures, one row, no card-in-card. */}
        <div className="mt-4 grid grid-cols-3 divide-x divide-white/15 border-t border-white/15 pt-4">
          <div className="pr-3">
            <HeroStat label={t('dash.revenue')} value={formatPHP(today.revenueCentavos)} />
          </div>
          <div className="px-3">
            <HeroStat label={t('dash.expenses')} value={formatPHP(today.expensesCentavos)} />
          </div>
          <div className="pl-3">
            <HeroStat label={t('dash.cash')} value={formatPHP(twin.cashCentavos)} accent />
          </div>
        </div>
      </HeroShell>

      {/* Sipat sits directly under the hero because the brief is about the number
          above it: it is the sentence the engine would say about today's take. */}
      <PatSays band={score.band} sources={patSources} onOpenScore={onOpenScore} />

      {/* Score teaser: the ring is the same gauge as the Score tab, so the two
          screens are visibly the same instrument at two sizes. */}
      <button
        type="button"
        onClick={onOpenScore}
        className="flex w-full items-center gap-4 rounded-card border border-line bg-gradient-to-br from-card to-brand-50/70 p-4 text-left shadow-e2 transition active:scale-[0.99]"
      >
        <ProgressRing value={score.value} size={74} stroke={8}>
          <span className="figure-lg text-[1.15rem] leading-none text-fg">{score.value}</span>
        </ProgressRing>
        <div className="min-w-0 flex-1">
          <div className="eyebrow text-brand-700">{t('dash.scoreTitle')}</div>
          <div className="headline mt-1.5 text-[1rem] text-fg">{bandLabel(score.band, lang)}</div>
          <p className="mt-1 line-clamp-2 text-[0.72rem] leading-relaxed text-fg-subtle">
            {score.strengths[0] ?? t('dash.scoreEmpty')}
          </p>
        </div>
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5 shrink-0 text-fg-faint"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 5l7 7-7 7" />
        </svg>
      </button>

      <Card>
        <SectionTitle hint={t('dash.days7')}>{t('dash.weekTitle')}</SectionTitle>
        <div className="grid grid-cols-3 gap-3">
          <Stat label={t('dash.revenue')} value={formatPHP(week.revenueCentavos)} />
          <Stat
            label={t('dash.profit')}
            value={formatPHP(week.netProfitCentavos)}
            tone={week.netProfitCentavos >= 0 ? 'good' : 'bad'}
          />
          <Stat label={t('dash.margin')} value={formatPercent(week.netMargin)} />
        </div>
      </Card>

      <Card>
        <SectionTitle hint={t('dash.today')}>{t('dash.capitalTitle')}</SectionTitle>
        <Donut
          segments={assetSegments}
          centerLabel={t('dash.capitalCenter')}
          centerValue={formatPHP(composition.netAssetsCentavos)}
        />
        <div className="mt-4 border-t border-line pt-1">
          {composition.components
            .filter((c) => c.amountCentavos !== 0)
            .map((c) => (
              <Bar
                key={c.key}
                label={pick(lang, c.label)}
                amount={formatPHP(c.amountCentavos)}
                share={c.share}
                tone={c.kind === 'offset' ? 'offset' : 'brand'}
                note={c.note ? pick(lang, c.note) : undefined}
              />
            ))}
        </div>
        <ul className="mt-3 space-y-1.5 border-t border-line pt-3.5">
          {composition.narrative.map((line) => (
            <li key={line} className="flex gap-2 text-[0.75rem] leading-relaxed text-fg-muted">
              <span className="text-brand-600">●</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <SectionTitle hint={provenance.reconciled ? t('dash.matched') : t('dash.mismatched')}>
          {t('dash.provenanceTitle')}
        </SectionTitle>
        <p className="mb-3.5 text-[0.72rem] leading-relaxed text-fg-subtle">
          {t('dash.provenanceBody')}
        </p>
        <div className="grid grid-cols-2 gap-x-4">
          <div>
            <div className="eyebrow mb-2 text-fg-faint">{t('dash.sources')}</div>
            {provenance.sources.map((s) => (
              <div key={s.key} className="flex justify-between gap-2 border-b border-line/70 py-1.5">
                <span className="truncate text-[0.75rem] text-fg-muted">{pick(lang, s.label)}</span>
                <span className="num shrink-0 text-[0.75rem] font-semibold text-fg">
                  {formatPHP(s.amountCentavos)}
                </span>
              </div>
            ))}
          </div>
          <div>
            <div className="eyebrow mb-2 text-fg-faint">{t('dash.uses')}</div>
            {provenance.uses.map((u) => (
              <div key={u.key} className="flex justify-between gap-2 border-b border-line/70 py-1.5">
                <span className="truncate text-[0.75rem] text-fg-muted">{pick(lang, u.label)}</span>
                <span className="num shrink-0 text-[0.75rem] font-semibold text-fg">
                  {formatPHP(u.amountCentavos)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle hint={t('dash.twinHint')}>{t('dash.twinTitle')}</SectionTitle>
        {/* Hairlines via a 1px grid gap, so six figures read as one table instead
            of six floating labels. */}
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-line">
          {twinCells.map((cell) => (
            <div key={cell.label} className="bg-card px-3.5 py-3">
              <div className="text-[0.64rem] font-semibold text-fg-faint">{cell.label}</div>
              <div
                className={`figure-lg mt-1.5 truncate text-[0.98rem] leading-none ${
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
        <p className="mt-3.5 text-[0.68rem] leading-relaxed text-fg-faint">
          {t('dash.invariant', { n: ledger.transactions.length })}
        </p>
      </Card>

      {warnings.length > 0 ? (
        <div className="rounded-card border border-amber-200 bg-gradient-to-br from-amber-50 to-card p-4.5 shadow-e2">
          <SectionTitle>{t('dash.watchTitle')}</SectionTitle>
          <ul className="space-y-2">
            {warnings.map((w) => (
              <li
                key={`${w.code}-${w.txnId ?? ''}-${w.message}`}
                className="flex gap-2 text-[0.75rem] leading-relaxed text-amber-800"
              >
                {/* amber-700, not 600: a bullet is a mark, and it has to clear 3:1
                    against the foot of a card gradient, not just its top. */}
                <span className="text-amber-700">●</span>
                {/* Both languages travel with the warning, so the twin never has
                    to be recomputed just because the owner switched. */}
                <span>{pick(lang, { en: w.message, fil: w.messageFil })}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
