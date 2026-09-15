import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useT } from '../i18n/index.ts'

/**
 * Counts a figure up to its value on mount, and eases to any new value after.
 * Money that snaps into place reads as a static label; money that ticks up reads
 * as *live*. Respects prefers-reduced-motion by jumping straight to the value.
 */
export function useCountUp(target: number, duration = 1100): number {
  const [display, setDisplay] = useState(0)
  const fromRef = useRef(0)

  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      fromRef.current = target
      setDisplay(target)
      return
    }
    const from = fromRef.current
    let raf = 0
    let start: number | null = null
    const step = (t: number) => {
      if (start === null) start = t
      const p = Math.min(1, (t - start) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      const next = from + (target - from) * eased
      fromRef.current = next
      setDisplay(next)
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])

  return display
}

/**
 * The ordinary card.
 *
 * The fill, the edge and the shadow all live in `.surface` (see index.css), so
 * every screen in the app is lit by one physics. `material` is for the cards
 * that MEAN something — a plan, an engine reading — rather than merely holding
 * something; it is a tint on the same surface, not a second surface.
 */
export function Card({
  children,
  className = '',
  material = 'plain',
  interactive = false,
  flat = false,
}: {
  children: ReactNode
  className?: string
  material?: 'plain' | 'gold' | 'brand' | 'inset'
  interactive?: boolean
  /**
   * For state cards that carry their own fill (`bg-amber-50`, `bg-emerald-50`).
   * A background-image paints *over* a background-colour, so the standard
   * gradient would bury the state tint and leave a warning looking like an
   * ordinary card. Flat keeps the edge and the shadow and drops the gradient.
   */
  flat?: boolean
}) {
  const tone = flat
    ? 'surface-flat'
    : material === 'gold'
      ? 'surface-gold'
      : material === 'brand'
        ? 'surface-brand'
        : material === 'inset'
          ? 'surface-inset'
          : 'surface'
  return (
    <div
      className={`rounded-card p-4.5 ${tone} ${interactive ? 'surface-raise' : ''} ${className}`}
    >
      {children}
    </div>
  )
}

/**
 * The jewel surface. One dark, high-gloss card per screen — the only place the
 * app inverts — built from an emerald body, two corner light sources, a diagonal
 * sheen that sweeps once on mount, grain, and a 1px inner top highlight so the
 * card reads as a physical object rather than a filled rectangle.
 */
export function HeroShell({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={`jewel grain edge-light relative overflow-hidden rounded-sheet p-5 shadow-jewel ${className}`}
    >
      {/* A gold sun in the top-right corner and a deep blue lift bottom-left —
          the flag's two colours doing the lighting. Glow strength is capped,
          because these blobs sit behind text and a lighter backdrop is exactly
          what costs white copy its contrast. */}
      <div className="pointer-events-none absolute -right-16 -top-24 h-56 w-56 rounded-full bg-gold-400/14 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-28 -left-20 h-56 w-56 rounded-full bg-brand-500/18 blur-3xl" />
      <div className="relative">{children}</div>
    </div>
  )
}

/** Eyebrow label on the jewel surface — gold, the way the brand lockup is. */
export function HeroLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[0.64rem] font-bold tracking-[0.1em] text-gold-300 uppercase">
      {children}
    </div>
  )
}

/**
 * Change chip. `up` on the jewel goes bright because a rising number should feel
 * like a small win; `down` leans on rose so it is never mistaken for neutral.
 */
export function Delta({
  label,
  direction = 'up',
  surface = 'light',
}: {
  label: string
  direction?: 'up' | 'down' | 'flat'
  surface?: 'light' | 'dark'
}) {
  const light = {
    up: 'bg-emerald-50 text-emerald-700',
    down: 'bg-red-50 text-red-700',
    flat: 'bg-sunken text-fg-subtle',
  }[direction]
  // On the jewel every variant keeps white text: a translucent tint *is* a
  // lighter background, and a lighter background is what makes tinted text drop
  // back under 4.5:1. Direction is carried by the arrow instead.
  const dark = 'bg-white/15 text-white'
  const glyph = direction === 'up' ? '▲' : direction === 'down' ? '▼' : '•'
  return (
    <span
      className={`num inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.62rem] font-bold ${
        surface === 'dark' ? dark : light
      }`}
    >
      <span className="text-[0.5rem] leading-none">{glyph}</span>
      {label}
    </span>
  )
}

/** A figure in the jewel card's bottom rail. */
export function HeroStat({
  label,
  value,
  accent = false,
}: {
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <div className="min-w-0">
      <div className="text-[0.6rem] font-semibold tracking-wide text-white uppercase">
        {label}
      </div>
      <div
        className={`figure-lg mt-1.5 truncate text-[1.02rem] leading-none ${
          accent ? 'text-gold-300' : 'text-white'
        }`}
      >
        {value}
      </div>
    </div>
  )
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-3.5 flex items-baseline justify-between gap-3">
      <h2 className="headline text-[0.98rem] text-fg">{children}</h2>
      {hint ? (
        <span className="num shrink-0 rounded-full bg-sunken px-2 py-0.5 text-[0.62rem] font-semibold text-fg-subtle">
          {hint}
        </span>
      ) : null}
    </div>
  )
}

export function Stat({
  label,
  value,
  sub,
  tone = 'neutral',
  inverse = false,
}: {
  label: string
  value: string
  sub?: string
  tone?: 'neutral' | 'good' | 'bad'
  /** For figures sitting on the jewel card, where the paper ramp inverts. */
  inverse?: boolean
}) {
  // On the jewel every figure is white: a pink "bad" figure on emerald reads as
  // a rendering bug, and the tone already shows in the cards below.
  const toneClass = inverse
    ? 'text-white'
    : tone === 'good'
      ? 'text-emerald-700'
      : tone === 'bad'
        ? 'text-red-700'
        : 'text-fg'
  const labelClass = inverse ? 'text-white/90' : 'text-fg-faint'
  return (
    <div className="min-w-0">
      <div className={`text-[0.66rem] font-semibold ${labelClass}`}>{label}</div>
      <div className={`figure-lg mt-1.5 truncate text-[1.02rem] leading-none ${toneClass}`}>
        {value}
      </div>
      {sub ? <div className={`mt-1.5 truncate text-[0.66rem] ${labelClass}`}>{sub}</div> : null}
    </div>
  )
}

export function Bar({
  label,
  amount,
  share,
  tone = 'brand',
  note,
}: {
  label: string
  amount: string
  share: number
  tone?: 'brand' | 'offset' | 'muted'
  note?: string
}) {
  const pct = Math.abs(share) * 100
  const width = Math.min(100, pct)
  // Both ends of the gradient clear 3:1 against white. A bar that fades into a
  // pastel has a visible tip and an invisible tail, which reads as a rendering
  // glitch — and fails the non-text contrast floor a data mark has to meet.
  const fill =
    tone === 'offset'
      ? 'bg-gradient-to-r from-red-700 to-red-600'
      : tone === 'muted'
        ? 'bg-slate-500'
        : 'bg-gradient-to-r from-brand-800 to-brand-600'
  return (
    <div className="py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[0.8rem] font-medium text-fg-muted">{label}</span>
        <span className="num shrink-0 text-[0.82rem] font-bold text-fg">{amount}</span>
      </div>
      <div className="mt-2 flex items-center gap-2.5">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-sunken">
          <div
            className={`chart-bar h-full rounded-full ${fill}`}
            style={{ width: `${width}%` }}
          />
        </div>
        <span className="num w-9 shrink-0 text-right text-[0.64rem] font-semibold text-fg-faint">
          {pct.toFixed(0)}%
        </span>
      </div>
      {note ? <div className="mt-1.5 text-[0.65rem] text-fg-faint">{note}</div> : null}
    </div>
  )
}

/** Column chart with a baseline, rounded tops and the peak called out. */
export function MiniBars({ values, labels }: { values: number[]; labels: string[] }) {
  const max = Math.max(1, ...values)
  const peakIndex = values.indexOf(Math.max(...values))
  return (
    <div className="flex items-end gap-1.5">
      {values.map((value, index) => {
        const empty = value === 0
        const height = empty ? 3 : Math.max(10, (value / max) * 100)
        const isPeak = index === peakIndex && !empty
        return (
          <div key={labels[index] ?? index} className="flex flex-1 flex-col items-center gap-2">
            <div className="relative flex h-28 w-full items-end">
              <div
                className={
                  empty
                    ? 'h-1.5 w-full rounded-full bg-line-strong'
                    : `chart-col w-full rounded-t-[7px] rounded-b-[3px] ${
                        isPeak
                          ? 'bg-gradient-to-t from-brand-800 via-brand-700 to-brand-600'
                          : 'bg-gradient-to-t from-brand-700 to-brand-600/80'
                      }`
                }
                style={{
                  ...(empty ? undefined : { height: `${height}%` }),
                  animationDelay: `${index * 65}ms`,
                }}
                title={
                  empty ? `${labels[index] ?? ''}: walang benta` : `${labels[index] ?? ''}: ${value}`
                }
              />
            </div>
            <span
              className={`num text-[0.6rem] ${
                index === values.length - 1 ? 'font-bold text-fg-muted' : 'text-fg-faint'
              }`}
            >
              {(labels[index] ?? '').slice(-2)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function Donut({
  segments,
  centerLabel,
  centerValue,
}: {
  segments: { key: string; amount: number; color: string }[]
  centerLabel: string
  centerValue: string
}) {
  const total = segments.reduce((sum, s) => sum + Math.abs(s.amount), 0) || 1
  const size = 156
  const stroke = 15
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  // A 3px gap between arcs is what separates a donut from a pie chart; the gap
  // is subtracted from each dash and the arcs are nudged by half of it so they
  // stay centred on their slice.
  const gap = segments.length > 1 ? 5 : 0
  let offset = 0

  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--color-sunken)"
            strokeWidth={stroke}
          />
          {segments.map((segment) => {
            const fraction = Math.abs(segment.amount) / total
            const dash = Math.max(0, circumference * fraction - gap)
            const element = (
              <circle
                key={segment.key}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={segment.color}
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset - gap / 2}
                className="chart-area"
              />
            )
            offset += circumference * fraction
            return element
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[0.58rem] font-bold tracking-wide text-fg-faint uppercase">
            {centerLabel}
          </span>
          <span className="figure-lg mt-1 max-w-[6.2rem] truncate text-[1.05rem] leading-none text-fg">
            {centerValue}
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * Radial gauge. Rounded cap, animated draw, and a luminous gradient tuned to the
 * surface it sits on — a bright mint reads on the jewel card, a deep emerald is
 * what stays legible on white.
 */
export function ProgressRing({
  value,
  max = 100,
  size = 150,
  stroke = 13,
  track = 'var(--color-sunken)',
  gradient = 'deep',
  children,
}: {
  value: number
  max?: number
  size?: number
  stroke?: number
  track?: string
  gradient?: 'deep' | 'luminous'
  children?: ReactNode
}) {
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const pct = Math.max(0, Math.min(1, value / max))
  const dash = circumference * pct

  // Luminous = gold on the navy jewel card, like a sun; deep = navy on a white
  // card. Every stop of each clears 3:1 against the surface it sits on.
  const stops =
    gradient === 'luminous'
      ? ['#fde38a', '#fbd350', '#f5c21d']
      : ['#1b45a6', '#12357f', '#0c2760']

  return (
    <div className="relative inline-flex" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <defs>
          <linearGradient id={`ring-${gradient}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={stops[0]} />
            <stop offset="55%" stopColor={stops[1]} />
            <stop offset="100%" stopColor={stops[2]} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#ring-${gradient})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          className="ring-progress"
          style={{
            '--ring-circumference': `${circumference}`,
            ...(gradient === 'luminous'
              ? { filter: 'drop-shadow(0 0 10px rgb(245 194 29 / 0.55))' }
              : {}),
          } as CSSProperties}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  )
}

export function Chip({
  active,
  onClick,
  children,
}: {
  active?: boolean
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full px-3.5 py-2 text-[0.75rem] font-semibold transition-all duration-200 active:scale-[0.97] ${
        active
          ? 'bg-brand-800 text-white shadow-pop'
          : 'border border-line bg-card text-fg-muted shadow-e1 hover:border-line-strong'
      }`}
    >
      {children}
    </button>
  )
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  type = 'button',
  className = '',
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'ghost' | 'danger'
  disabled?: boolean
  type?: 'button' | 'submit'
  className?: string
}) {
  const variants = {
    // brand-800 is the lightest emerald that still clears 4.5:1 against white
    // text; brand-500/600 buttons look vivid and fail AA.
    primary:
      'bg-gradient-to-b from-brand-700 to-brand-900 text-white font-bold shadow-pop hover:brightness-110',
    ghost: 'border border-line-strong bg-card text-fg-muted shadow-e1',
    danger: 'border border-red-200 bg-red-50 text-red-700',
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-2xl px-4 py-3.5 text-[0.83rem] transition-all duration-200 active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100 ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="text-[0.66rem] font-bold tracking-wide text-fg-subtle uppercase">
        {label}
      </span>
      {children}
      {hint ? <span className="mt-1.5 block text-[0.68rem] text-fg-faint">{hint}</span> : null}
    </label>
  )
}

export const inputClass =
  'mt-2 w-full rounded-2xl border border-line-strong bg-card px-4 py-3.5 text-[0.9rem] text-fg shadow-e1 outline-none transition placeholder:text-fg-faint focus:border-brand-700 focus:ring-4 focus:ring-brand-700/10'

export function Pill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'gold'
}) {
  const tones = {
    neutral: 'bg-sunken text-fg-subtle',
    good: 'bg-emerald-50 text-emerald-700',
    warn: 'bg-amber-50 text-amber-700',
    bad: 'bg-red-50 text-red-700',
    gold: 'bg-gold-50 text-gold-700',
  }
  return (
    <span className={`rounded-full px-2.5 py-1 text-[0.68rem] font-bold ${tones[tone]}`}>
      {children}
    </span>
  )
}

export function EmptyState({
  title,
  body,
  icon,
}: {
  title: string
  body: string
  icon?: ReactNode
}) {
  return (
    <div className="rounded-2xl border border-dashed border-line-strong bg-card/60 px-5 py-7 text-center">
      {icon ? (
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-sunken text-fg-subtle">
          {icon}
        </div>
      ) : null}
      <p className="text-[0.86rem] font-semibold text-fg-muted">{title}</p>
      <p className="mt-1.5 text-[0.75rem] leading-relaxed text-fg-faint">{body}</p>
    </div>
  )
}

/**
 * The soft paywall, in one place so every gate looks and behaves the same.
 *
 * Nothing premium is ever hidden behind a page the owner cannot reach: the
 * preview stays on screen, frosted just enough to be obviously real, and the
 * only exit is an upgrade path. That keeps a live demo from dead-ending while
 * still making the boundary between free and paid completely unambiguous.
 */
export function LockedCard({
  title,
  body,
  tierLabel,
  onUpgrade,
  preview,
  ctaLabel,
}: {
  title: string
  body: string
  tierLabel: string
  onUpgrade: () => void
  preview?: ReactNode
  ctaLabel?: string
}) {
  const t = useT()
  return (
    <div className="grain relative overflow-hidden rounded-card border border-gold-200 bg-gradient-to-br from-gold-50 to-card p-4.5 shadow-e2">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-gold-300 to-gold-500 shadow-e1">
          <svg
            viewBox="0 0 24 24"
            className="h-4.5 w-4.5 text-gold-700"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="4" y="10" width="16" height="10" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          </svg>
        </span>
        <div className="relative min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="headline text-[0.98rem] text-gold-700">{title}</h2>
            <Pill tone="gold">{tierLabel}</Pill>
          </div>
          <p className="mt-2 text-[0.75rem] leading-relaxed text-fg-muted">{body}</p>

          {preview ? (
            <div className="relative mt-3 overflow-hidden rounded-2xl">
              <div className="pointer-events-none select-none opacity-60">{preview}</div>
              <div className="absolute inset-0 bg-veil backdrop-blur-[3px]" />
            </div>
          ) : null}

          <Button className="mt-3.5 w-full" onClick={onUpgrade}>
            {ctaLabel ?? t('plan.upgradeTo', { tier: tierLabel })}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Amber strip used wherever a number or a price is a simulation. */
export function SimulatedNote({ children }: { children: ReactNode }) {
  const t = useT()
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-3">
      <div className="flex items-start gap-2.5">
        <span className="badge mt-0.5 shrink-0 text-amber-700">{t('shared.simulated')}</span>
        <p className="text-[0.7rem] leading-relaxed text-amber-800">{children}</p>
      </div>
    </div>
  )
}
