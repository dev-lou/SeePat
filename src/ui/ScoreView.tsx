import { useMemo, useState } from 'react'
import { AreaChart } from './charts.tsx'
import {
  Card,
  CollapsibleSection,
  HeroLabel,
  HeroShell,
  MiniBars,
  Pill,
  ProgressRing,
  SectionTitle,
  Stat,
  useCountUp,
} from './components.tsx'
import { bandLabel, formatPHP, scoreHistory } from '../engine/index.ts'
import type { Negosyo } from '../store.ts'
import { pick, useLang, useT } from '../i18n/index.ts'

export function ScoreView({ negosyo }: { negosyo: Negosyo }) {
  const { score, derived, week, ledger, now } = negosyo
  const lang = useLang()
  const t = useT()

  // The same deterministic score, applied to the ledger as it stood at the end
  // of each of the last eight weeks. Nothing is stored or back-filled.
  const trend = useMemo(() => scoreHistory(ledger, 8, now, lang), [ledger, now, lang])
  const latestWeek = trend.weeks[trend.weeks.length - 1]
  const bestWeek = trend.weeks.reduce(
    (best, w) => (w.value > best.value ? w : best),
    trend.weeks[0] ?? { value: 0, label: '—' },
  )
  const sparse = trend.weeks.filter((w) => !w.hasData).length

  // Only consider weeks starting from the store's first recorded activity,
  // so a new store doesn't render 5 blank zero bars for the weeks before it opened.
  const activeStartIndex = trend.weeks.findIndex((w) => w.hasData)
  const activeWeeks =
    activeStartIndex >= 0 ? trend.weeks.slice(activeStartIndex) : trend.weeks.slice(-3)
  const activeSparse = activeWeeks.filter((w) => !w.hasData).length

  const unlockedTrendChart =
    activeSparse === 0 && activeWeeks.length >= 2 ? (
      <div className="surface rounded-card p-3.5">
        <AreaChart
          values={activeWeeks.map((w) => w.value)}
          labels={activeWeeks.map((w) => w.label)}
          height={104}
        />
      </div>
    ) : (
      <div className="surface rounded-card p-3.5">
        <MiniBars
          values={activeWeeks.map((w) => (w.hasData ? w.value : 0))}
          labels={activeWeeks.map((w) => w.label)}
        />
      </div>
    )

  const ringScore = useCountUp(score.value, 1400)

  // One focus sentence instead of a report: the first priority, else the first
  // thing to watch, else the first strength. Tone follows the source — red
  // means act, amber means watch, green means keep going.
  const focus =
    score.priorities.length > 0
      ? { tone: 'bad' as const, eyebrow: t('score.priority'), text: score.priorities[0] }
      : score.watch.length > 0
        ? { tone: 'warn' as const, eyebrow: t('score.watch'), text: score.watch[0] }
        : score.strengths.length > 0
          ? { tone: 'good' as const, eyebrow: t('score.strong'), text: score.strengths[0] }
          : null
  const focusRest =
    (focus?.eyebrow === t('score.priority') ? score.priorities.length - 1 : 0) +
    (focus?.eyebrow === t('score.watch') ? score.watch.length - 1 : 0) +
    (focus?.eyebrow === t('score.strong') ? score.strengths.length - 1 : 0)

  // Dimensions start collapsed: name, bar and mark visible, the reasoning one
  // tap away. The weakest dimension opens first contact already made — no,
  // everything starts shut; the focus card above carries the one thing to do.
  const [expandedDim, setExpandedDim] = useState<string | null>(null)

  return (
    <div className="space-y-5">
      {/* The score is the one number an owner should be able to read at arm's
          length, so it gets a gauge rather than a line of text — and the arc
          carries a soft glow, which is what makes it read as lit rather than
          painted on. */}
      <HeroShell className="p-6 py-7 shadow-[0_20px_50px_-15px_rgba(8,16,50,0.55)]">
        <div className="flex flex-col items-center">
          <HeroLabel>{score.version}</HeroLabel>
          <div className="mt-4">
            <ProgressRing
              value={score.value}
              size={172}
              stroke={14}
              track="rgba(255,255,255,0.18)"
              gradient="luminous"
            >
              <span className="figure-xl text-[clamp(2.25rem,13vw,3.2rem)] font-black leading-none text-white tabular-nums drop-shadow-sm">
                {Math.round(ringScore)}
              </span>
              <span className="mt-2 text-[0.8125rem] font-bold tracking-wide text-white/90">
                {t('score.outOf')}
              </span>
            </ProgressRing>
          </div>
          <span className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-1.5 text-[0.8125rem] font-black uppercase tracking-wider text-white backdrop-blur-md border border-white/20 shadow-xs">
            <span className="h-2 w-2 rounded-full bg-gold-400 shadow-[0_0_8px_rgba(250,204,21,0.8)]" />
            {bandLabel(score.band, lang).toUpperCase()}
          </span>
          {!score.sufficientData ? (
            <p className="mt-3.5 max-w-[17rem] text-center text-[0.8125rem] leading-relaxed text-white/90">
              {t('score.insufficient')}
            </p>
          ) : null}
        </div>
      </HeroShell>

      {/* The one thing to do: a tinted panel in the focus tone, not another
          list. The full reading lives collapsed below; this is the answer for
          an owner who reads one sentence and puts the phone away. */}
      {focus ? (
        <div className="px-3.5">
          <div
            className={`rounded-2xl border p-4 shadow-e2 backdrop-blur-md ${
              focus.tone === 'bad'
                ? 'border-red-300/60 bg-gradient-to-br from-red-50/95 to-red-100/50'
                : focus.tone === 'warn'
                  ? 'border-amber-300/60 bg-gradient-to-br from-amber-50/95 to-amber-100/50'
                  : 'border-emerald-500/25 bg-gradient-to-br from-emerald-50/95 to-emerald-100/40'
            }`}
          >
            <div
              className={`eyebrow ${
                focus.tone === 'bad'
                  ? 'text-red-700'
                  : focus.tone === 'warn'
                    ? 'text-amber-700'
                    : 'text-emerald-700'
              }`}
            >
              {focus.eyebrow}
            </div>
            <p className="mt-1.5 text-[0.9375rem] font-semibold leading-relaxed text-fg">
              {focus.text}
            </p>
            {focusRest > 0 ? (
              <p className="mt-1.5 text-[0.8125rem] font-semibold text-fg-faint">
                {t('score.moreBelow', { n: focusRest })}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <Card>
        <SectionTitle hint={t('score.weightsHint')}>{t('score.dimensions')}</SectionTitle>
        {/*
         * One dimension per row, stacked rather than split into columns.
         *
         * Each row used to be a line of its own: the name and its gloss on the
         * left, the mark on the right, then the measured figure and the scoring
         * rule side by side underneath. That is fine on a phone at normal text size
         * and unreadable at the largest one, where each of those columns collapses
         * to about four words and the explanation reads as a ladder of single
         * words. Stacked, every line gets the full width it needs at any reading
         * size — which is the whole point of offering one.
         */}
        <ul className="divide-y divide-line">
          {score.dimensions.map((dim) => {
            // One nameable colour per state, reused for dot, bar and mark pill
            // so a glance tells the story before a single word is read.
            const tone = dim.score >= 70 ? 'good' : dim.score >= 45 ? 'warn' : 'bad'
            const open = expandedDim === dim.key
            return (
              <li key={dim.key} className="py-2.5 first:pt-0 last:pb-0">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setExpandedDim(open ? null : dim.key)}
                  className="flex w-full items-center gap-3 rounded-xl px-1 py-1.5 text-left transition active:bg-sunken/60"
                >
                  <span
                    aria-hidden
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                      tone === 'good'
                        ? 'bg-emerald-600 shadow-[0_0_6px_rgba(5,150,105,0.6)]'
                        : tone === 'warn'
                          ? 'bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.6)]'
                          : 'bg-red-600 shadow-[0_0_6px_rgba(220,38,38,0.6)]'
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    {/* The dimension name is a scorecard label, not a sentence:
                        uppercase and wide-tracked, the way a printed scoresheet
                        names its rows. */}
                    <span className="eyebrow block truncate text-fg">{pick(lang, dim.label)}</span>
                    {/* A light track with one solid, fully-rounded fill — not a
                        gradient bar. A two-stop gradient on a *mark* means two
                        colours that each have to clear 3:1 on their own, and it
                        makes a dimension's colour unnameable. */}
                    <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-sunken">
                      <span
                        className={`chart-bar block h-full rounded-full ${
                          tone === 'good' ? 'bg-emerald-700' : tone === 'warn' ? 'bg-amber-600' : 'bg-red-600'
                        }`}
                        style={{ width: `${Math.min(100, dim.score)}%` }}
                      />
                    </span>
                  </span>
                  <span
                    className={`num inline-flex h-9 min-w-11 shrink-0 items-center justify-center rounded-full px-2.5 text-[0.9375rem] font-black tabular-nums border ${
                      tone === 'good'
                        ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-800'
                        : tone === 'warn'
                          ? 'border-amber-500/30 bg-amber-500/15 text-amber-800'
                          : 'border-red-500/25 bg-red-500/10 text-red-700'
                    }`}
                  >
                    {Math.round(dim.score)}
                  </span>
                  <svg
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    className={`h-4 w-4 shrink-0 text-fg-faint transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                {open ? (
                  <div className="collapsible-body mt-1 space-y-1.5 rounded-xl bg-sunken/50 px-3.5 py-3">
                    <p className="text-[0.8125rem] leading-snug text-fg-muted">
                      {pick(lang, dim.term)} · {t('score.counts', { pct: Math.round(dim.weight * 100) })}
                    </p>
                    <p className="text-[0.875rem] leading-relaxed font-semibold text-fg">{dim.rawValue}</p>
                    <p className="text-[0.8125rem] leading-relaxed text-fg-faint">
                      <span className="font-bold text-fg-subtle">{t('score.whyThis')}: </span>
                      {dim.explanation}
                    </p>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      </Card>

      {/* The full reading waits collapsed: the focus card above already gave
          the one sentence that matters, and this is where the rest lives. */}
      <div className="px-3.5">
      <CollapsibleSection id="score-reading" title={t('score.explanation')}>
        <div className="space-y-3.5">
          <div>
            <div className="eyebrow text-emerald-700">{t('score.strong')}</div>
            {score.strengths.length > 0 ? (
              score.strengths.map((s) => (
                <div key={s} className="text-[0.875rem] leading-relaxed text-fg-muted">
                  {s}
                </div>
              ))
            ) : (
              <div className="text-[0.875rem] leading-relaxed text-fg-faint">{t('score.noStrength')}</div>
            )}
          </div>
          <div>
            <div className="eyebrow text-amber-700">{t('score.watch')}</div>
            {score.watch.length > 0 ? (
              score.watch.map((s) => (
                <div key={s} className="text-[0.875rem] leading-relaxed text-fg-muted">
                  {s}
                </div>
              ))
            ) : (
              <div className="text-[0.875rem] leading-relaxed text-fg-faint">{t('score.noWatch')}</div>
            )}
          </div>
          <div>
            <div className="eyebrow text-red-700">{t('score.priority')}</div>
            {score.priorities.length > 0 ? (
              score.priorities.map((s) => (
                <div key={s} className="text-[0.875rem] leading-relaxed text-fg-muted">
                  {s}
                </div>
              ))
            ) : (
              <div className="text-[0.875rem] leading-relaxed text-fg-faint">{t('score.noPriority')}</div>
            )}
          </div>
        </div>
      </CollapsibleSection>
      </div>

      {/*
       * History is free, and it is not a courtesy — it is the screen.
       *
       * It used to sit behind PRO with a locked preview above it, and the preview
       * was the problem: to show an eight-week curve to someone who had not
       * recorded eight weeks, it *invented* one (a synthetic ramp around the true
       * values). That is the one thing this product promises not to do. The curve
       * here is `scoreHistory(ledger, 8)` — the same fixed rules applied to the
       * owner's own log, with blank weeks left blank.
       */}
      <Card>
        <div className="flex items-center justify-between gap-2">
          <SectionTitle hint={t('score.weeks8')}>{t('score.historyTitle')}</SectionTitle>
          <Pill tone={trend.direction === 'up' ? 'good' : trend.direction === 'down' ? 'bad' : 'neutral'}>
            {trend.delta === null
              ? '—'
              : `${trend.delta > 0 ? '+' : ''}${trend.delta} ${trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '→'}`}
          </Pill>
        </div>

        {unlockedTrendChart}

        {/* `fit-grid-3`: three figures need roughly 95px each, so below 380px
            this becomes two-up with the last figure spanning the full width. */}
        <div className="fit-grid-3 mt-3 grid grid-cols-3 gap-x-3 gap-y-4 border-t border-line pt-3">
          <Stat
            label={t('score.thisWeek')}
            value={String(latestWeek?.value ?? score.value)}
            sub={latestWeek ? bandLabel(latestWeek.band, lang) : undefined}
            tone={(latestWeek?.value ?? 0) >= 70 ? 'good' : 'bad'}
          />
          <Stat
            label={t('score.best')}
            value={String(bestWeek.value)}
            sub={bestWeek.label}
          />
          <Stat
            label={t('score.sparse')}
            value={String(sparse)}
            sub={t('score.noSales')}
          />
        </div>

        {/* The footnote is the app's second voice (`.aside`): lighter weight,
            secondary ink — the one line on the scorecard that addresses the
            reader rather than measuring her. */}
        <div className="rule-set mt-3.5" aria-hidden />
        <p className="aside mt-3 text-[0.875rem] leading-relaxed text-fg-faint">
          {t('score.recomputed')}
        </p>
      </Card>

      <div className="px-3.5">
      <CollapsibleSection id="score-basis" title={t('score.basisTitle')} hint={t('dash.days7')}>
        <div className="fit-grid-2 grid grid-cols-2 gap-x-4 gap-y-2 text-[0.875rem]">
          <Row label={t('score.basisSales')} value={formatPHP(week.revenueCentavos)} />
          <Row label={t('score.basisMargin')} value={`${(week.netMargin * 100).toFixed(1)}%`} />
          <Row label={t('score.basisInventory')} value={formatPHP(derived.inventoryValueCentavos)} />
          <Row label={t('score.basisReceivables')} value={formatPHP(derived.receivablesCentavos)} />
        </div>
        <div className="rule-set mt-3.5" aria-hidden />
        <p className="aside mt-3 text-[0.875rem] leading-relaxed text-fg-faint">
          {t('score.deterministic')}
        </p>
      </CollapsibleSection>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    // The label wraps rather than shrink-collapsing, and the amount holds its
    // width: a money figure that loses a digit to fit is the one failure this
    // screen cannot afford.
    <div className="flex items-baseline justify-between gap-2 leading-relaxed">
      <span className="min-w-0 text-fg-subtle">{label}</span>
      <span className="num shrink-0 text-fg-muted">{value}</span>
    </div>
  )
}
