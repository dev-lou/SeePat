import { useMemo } from 'react'
import { AreaChart } from './charts.tsx'
import {
  Card,
  HeroLabel,
  HeroShell,
  LockedCard,
  MiniBars,
  Pill,
  ProgressRing,
  SectionTitle,
  Stat,
  useCountUp,
} from './components.tsx'
import { bandLabel, formatPHP, scoreHistory } from '../engine/index.ts'
import type { Negosyo } from '../store.ts'
import type { Billing } from '../billing.ts'
import { pick, useLang, useT } from '../i18n/index.ts'

export function ScoreView({
  negosyo,
  billing,
  onUpgrade,
}: {
  negosyo: Negosyo
  billing: Billing
  onUpgrade: () => void
}) {
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

  // A week with no sales still produces a score — cash cover and expense control
  // do not need revenue — but drawing that bar would read as "this week was fine".
  // The chart shows a gap instead; the number is still there in the label.
  // Two shapes, chosen by the data rather than by taste: a continuous curve when
  // every week has sales, and columns when some weeks are blank — a column can
  // simply not be drawn, whereas an area chart would have to plunge to zero and
  // invent a collapse that never happened.
  const trendChart =
    sparse === 0 ? (
      <div className="rounded-2xl border border-line bg-card p-3.5 shadow-e1">
        <AreaChart
          values={trend.weeks.map((w) => w.value)}
          labels={trend.weeks.map((w) => w.label)}
          height={104}
        />
      </div>
    ) : (
      <div className="rounded-2xl border border-line bg-card p-3.5 shadow-e1">
        <MiniBars
          values={trend.weeks.map((w) => (w.hasData ? w.value : 0))}
          labels={trend.weeks.map((w) => w.label)}
        />
      </div>
    )

  const ringScore = useCountUp(score.value, 1400)

  return (
    <div className="space-y-4">
      {/* The score is the one number an owner should be able to read at arm's
          length, so it gets a gauge rather than a line of text — and the arc
          carries a soft glow, which is what makes it read as lit rather than
          painted on. */}
      <HeroShell className="py-6">
        <div className="flex flex-col items-center">
          <HeroLabel>{score.version}</HeroLabel>
          <div className="mt-4">
            <ProgressRing
              value={score.value}
              size={168}
              stroke={14}
              track="rgba(255,255,255,0.18)"
              gradient="luminous"
            >
              <span className="figure-xl text-[3.2rem] leading-none text-white tabular-nums">
                {Math.round(ringScore)}
              </span>
              <span className="mt-2 text-[0.64rem] font-bold tracking-wide text-white/90">
                {t('score.outOf')}
              </span>
            </ProgressRing>
          </div>
          <span className="mt-4 rounded-full bg-white/15 px-3.5 py-1.5 text-[0.7rem] font-bold tracking-wide text-white backdrop-blur-sm">
            {bandLabel(score.band, lang).toUpperCase()}
          </span>
          {!score.sufficientData ? (
            <p className="mt-3.5 max-w-[16rem] text-center text-[0.72rem] leading-relaxed text-white/90">
              {t('score.insufficient')}
            </p>
          ) : null}
        </div>
      </HeroShell>

      <Card>
        <SectionTitle hint={t('score.weightsHint')}>{t('score.dimensions')}</SectionTitle>
        <ul className="space-y-3">
          {score.dimensions.map((dim) => (
            <li key={dim.key}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-fg-muted">
                  {pick(lang, dim.label)}
                  <span className="ml-1.5 text-[0.65rem] text-fg-faint">{pick(lang, dim.term)}</span>
                </span>
                <span className="shrink-0 text-sm font-medium tabular-nums text-fg">
                  {Math.round(dim.score)}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                  <div
                    className={`chart-bar h-full rounded-full ${
                      dim.score >= 70
                        ? 'bg-gradient-to-r from-emerald-800 to-emerald-600'
                        : dim.score >= 45
                          // Both stops are now 700-and-deeper: the 600 step cleared
                          // 3:1 against the foot of a card gradient by 0.02, which
                          // is not a margin, it is a coincidence.
                          ? 'bg-gradient-to-r from-amber-800 to-amber-700'
                          : 'bg-gradient-to-r from-red-700 to-red-600'
                    }`}
                    style={{ width: `${Math.min(100, dim.score)}%` }}
                  />
                </div>
                <span className="w-12 shrink-0 text-right text-[0.65rem] tabular-nums text-fg-faint">
                  ×{dim.weight.toFixed(2)}
                </span>
              </div>
              <div className="mt-1 flex justify-between gap-3 text-[0.68rem] text-fg-faint">
                <span>{dim.explanation}</span>
                <span className="shrink-0 text-fg-subtle">{dim.rawValue}</span>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <SectionTitle>{t('score.explanation')}</SectionTitle>
        <div className="space-y-3">
          <div>
            <div className="eyebrow text-emerald-700">{t('score.strong')}</div>
            {score.strengths.length > 0 ? (
              score.strengths.map((s) => (
                <div key={s} className="text-xs text-fg-muted">
                  {s}
                </div>
              ))
            ) : (
              <div className="text-xs text-fg-faint">{t('score.noStrength')}</div>
            )}
          </div>
          <div>
            <div className="eyebrow text-amber-700">{t('score.watch')}</div>
            {score.watch.length > 0 ? (
              score.watch.map((s) => (
                <div key={s} className="text-xs text-fg-muted">
                  {s}
                </div>
              ))
            ) : (
              <div className="text-xs text-fg-faint">{t('score.noWatch')}</div>
            )}
          </div>
          <div>
            <div className="eyebrow text-red-700">{t('score.priority')}</div>
            {score.priorities.length > 0 ? (
              score.priorities.map((s) => (
                <div key={s} className="text-xs text-fg-muted">
                  {s}
                </div>
              ))
            ) : (
              <div className="text-xs text-fg-faint">{t('score.noPriority')}</div>
            )}
          </div>
        </div>
      </Card>

      {billing.can('score_history') ? (
        <Card>
          <div className="flex items-center justify-between gap-2">
            <SectionTitle hint={t('score.weeks8')}>{t('score.historyTitle')}</SectionTitle>
            <Pill tone={trend.direction === 'up' ? 'good' : trend.direction === 'down' ? 'bad' : 'neutral'}>
              {trend.delta === null
                ? '—'
                : `${trend.delta > 0 ? '+' : ''}${trend.delta} ${trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '→'}`}
            </Pill>
          </div>

          {trendChart}

          <div className="mt-3 grid grid-cols-3 gap-3 border-t border-line pt-3">
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

          <p className="mt-3 border-t border-line pt-3 text-[0.68rem] leading-relaxed text-fg-faint">
            {t('score.recomputed')}
          </p>
        </Card>
      ) : (
        <LockedCard
          title={t('score.historyTitle')}
          body={t('score.lockedBody')}
          tierLabel="PRO"
          onUpgrade={onUpgrade}
          preview={trendChart}
        />
      )}

      <Card>
        <SectionTitle hint={t('dash.days7')}>{t('score.basisTitle')}</SectionTitle>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <Row label={t('score.basisSales')} value={formatPHP(week.revenueCentavos)} />
          <Row label={t('score.basisMargin')} value={`${(week.netMargin * 100).toFixed(1)}%`} />
          <Row label={t('score.basisInventory')} value={formatPHP(derived.inventoryValueCentavos)} />
          <Row label={t('score.basisReceivables')} value={formatPHP(derived.receivablesCentavos)} />
        </div>
        <p className="mt-3 border-t border-line pt-3 text-[0.68rem] text-fg-faint">
          {t('score.deterministic')}
        </p>
      </Card>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-fg-subtle">{label}</span>
      <span className="tabular-nums text-fg-muted">{value}</span>
    </div>
  )
}
