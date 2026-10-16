import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties, ReactNode } from 'react'
import { useT } from '../i18n/index.ts'
import { readPersisted, writePersisted } from '../storage.ts'

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
      className={`w-full !border-x-0 border-y px-4.5 py-5 ${tone} ${interactive ? 'surface-raise' : ''} ${className}`}
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
      className={`jewel grain relative w-full overflow-hidden border-b border-white/20 rounded-b-3xl p-5.5 shadow-jewel ${className}`}
    >
      {/* The lighting is in the card's own gradient now (blue from the top-right,
          yellow at the foot) — two blurred blobs on top of it doubled the light
          and washed the lower half of the card out to a lighter blue than the
          contrast audit ever saw. */}
      <div className="relative">{children}</div>
    </div>
  )
}

/** Eyebrow label on the jewel surface — gold, the way the brand lockup is. */
export function HeroLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[0.8125rem] font-bold tracking-[0.06em] text-gold-300 uppercase">
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
      className={`num inline-flex min-h-6 items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.8125rem] font-bold ${
        surface === 'dark' ? dark : light
      }`}
    >
      <span className="text-[0.75rem] leading-none">{glyph}</span>
      {label}
    </span>
  )
}

/**
 * A figure in the jewel card's bottom rail.
 *
 * The figure is fluid (see `.fit-grid-3` in index.css for the grid it sits in)
 * and it is never truncated: "₱38,9…" is not a smaller number, it is the wrong
 * one. `emphasis` is for the figure that summarises the row — cash on hand.
 */
export function HeroStat({
  label,
  value,
  accent = false,
  emphasis = false,
}: {
  label: string
  value: string
  accent?: boolean
  emphasis?: boolean
}) {
  return (
    /*
     * `money-cell` (index.css) makes this cell a query container, so the figure
     * is sized against the column it is actually in rather than against the
     * viewport: a third of a row on a tablet, half of one on a phone, or a
     * full-width line once the grid collapses to two columns.
     *
     * `emphasis` therefore changes COLOUR, not size: the cell that carries it
     * (cash on hand) is a narrow column at tablet width and a full-width line on
     * a small phone, and no single font size is right in both.
     */
    <div className="money-cell min-w-0">
      <div
        className={`text-[0.8125rem] leading-snug tracking-wide text-white uppercase ${
          emphasis ? 'font-bold' : 'font-semibold'
        }`}
      >
        {label}
      </div>
      <div
        className={`figure-lg mt-1.5 leading-none ${
          accent ? 'text-gold-300' : 'text-white'
        }`}
      >
        {value}
      </div>
    </div>
  )
}

/**
 * Section heading with an optional note beside it.
 *
 * The row wraps and the note may shrink. It used to be `shrink-0` on a
 * `justify-between` row: on a 280px phone a note like "these need a connection"
 * took the whole line and squeezed the heading into one word per line. Nothing was
 * clipped, so it never showed up as a truncation bug — the screen just looked
 * broken, which is the same complaint one step later.
 */
export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 className="headline min-w-0 text-[1.0625rem] leading-snug text-fg">{children}</h2>
      {hint ? (
        <span className="num min-w-0 rounded-full bg-sunken px-2.5 py-1 text-[0.8125rem] leading-snug font-semibold text-fg-subtle">
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
    <div className="money-cell min-w-0">
      <div className={`text-[0.8125rem] font-semibold ${labelClass}`}>{label}</div>
      <div className={`figure-lg mt-1.5 leading-none ${toneClass}`}>
        {value}
      </div>
      {/* `sub` wraps rather than truncating: it carries the sentence that makes the
          figure mean something ("of every ₱100 sold"), and a clipped explanation is
          worse than no explanation. The figure above it still truncates, because a
          number that does not fit its column is a layout problem. */}
      {sub ? <div className={`mt-1.5 text-[0.8125rem] leading-snug ${labelClass}`}>{sub}</div> : null}
    </div>
  )
}

export function Bar({
  label,
  amount,
  share,
  tone = 'brand',
  note,
  color,
}: {
  label: string
  amount: string
  share: number
  tone?: 'brand' | 'offset' | 'muted'
  note?: string
  /**
   * Exact fill colour, used when the bar must match a sibling mark — the
   * capital donut's segments. Every audited stop below clears 3:1 on white,
   * and so must any colour passed here: it is a data mark, not decoration.
   */
  color?: string
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
        <span className="min-w-0 text-[0.875rem] leading-snug font-medium text-fg-muted">{label}</span>
        <span className="num shrink-0 text-[0.9375rem] font-bold text-fg">{amount}</span>
      </div>
      <div className="mt-2 flex items-center gap-2.5">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-sunken">
          <div
            className={`chart-bar h-full rounded-full ${color ? '' : fill}`}
            style={{ width: `${width}%`, ...(color ? { backgroundColor: color } : {}) }}
          />
        </div>
        <span className="num w-12 shrink-0 text-right text-[0.8125rem] font-semibold text-fg-faint">
          {pct.toFixed(0)}%
        </span>
      </div>
      {note ? <div className="mt-1.5 text-[0.8125rem] leading-relaxed text-fg-faint">{note}</div> : null}
    </div>
  )
}

/**
 * Column chart with a baseline, rounded tops and the peak called out.
 *
 * Two things here exist so eight columns survive a narrow phone, because this
 * chart is also rendered inside a ~130px column as the locked Sipat preview:
 *
 *  - every column is `min-w-0`, so the flex row can actually shrink instead of
 *    being held open by its own labels;
 *  - the gutter and the label size are fluid, since eight 10px gutters alone are
 *    70px of a 280px phone;
 *  - below 175px of container width (index.css, `.mini-bars`) the labels thin
 *    out to just the current one. The preview sits behind a blur under a lock,
 *    and a row of half-cut dates behind a blur reads as a rendering fault.
 */
export function MiniBars({ values, labels }: { values: number[]; labels: string[] }) {
  const max = Math.max(1, ...values)
  const peakIndex = values.indexOf(Math.max(...values))
  return (
    <div className="mini-bars flex items-end gap-[clamp(0.2rem,1.5vw,0.5rem)]">
      {values.map((value, index) => {
        const empty = value === 0
        const height = empty ? 3 : Math.max(10, (value / max) * 100)
        const isPeak = index === peakIndex && !empty
        return (
          <div
            key={labels[index] ?? index}
            className="mini-bars__col flex min-w-0 flex-1 flex-col items-center gap-2"
          >
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
              /* 0.75rem, not a fluid clamp: a tick label is the one thing on this
                 chart that must stay above the 12px floor, and 2.8vw put it at
                 10.9px on a 390px phone. The narrow case is handled by the
                 container query in index.css, not by shrinking the type. */
              className={`mini-bars__label num text-[0.75rem] ${
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
        {/* `money-cell` against the fixed 156px box: the centre figure scales to
            the donut instead of a viewport clamp, so a thirteen-character net
            worth still fits inside the ring at the largest reading size. */}
        <div className="money-cell absolute inset-0 flex flex-col items-center justify-center px-7 text-center">
          <span className="text-[0.75rem] font-bold tracking-wide text-fg-faint uppercase">
            {centerLabel}
          </span>
          <span className="figure-lg mt-1 leading-none text-fg">{centerValue}</span>
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
      aria-pressed={active}
      /*
       * `.tag` (index.css) carries the shape and both states, keyed off
       * `aria-pressed` rather than a class, so the selected chip is also the chip
       * a screen reader announces as selected.
       *
       * The long-label problem is solved in there too: a chip whose label is long
       * — "Offline voice (no internet)" is the worst of them — wraps rather than
       * pushing the card wider than the phone.
       */
      className={`tag ${active ? 'tag-active !bg-ink-900 !text-white' : ''}`}
    >
      {children}
    </button>
  )
}

/**
 * The key.
 *
 * All four variants are drawn in index.css (`.btn` + `.btn-ink` / `.btn-gold` /
 * `.btn-quiet` / `.btn-danger`): a flat fill, a hard 3px bottom edge, one cut
 * corner, and a press that moves the whole key down onto its edge. The only
 * thing this component decides is which ink to use — because a control that
 * looks pressed is a control the owner can tell she hit, and the previous
 * gradient button could not show that at all.
 */
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
  variant?: 'primary' | 'ghost' | 'danger' | 'gold' | 'brand'
  disabled?: boolean
  type?: 'button' | 'submit'
  className?: string
}) {
  const variants = {
    primary: 'btn-ink',
    brand: 'btn-brand',
    gold: 'btn-gold',
    ghost: 'btn-quiet',
    danger: 'btn-danger',
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`btn ${variants[variant]} ${className}`}
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
      <span className="text-[0.8125rem] font-bold tracking-wide text-fg-subtle uppercase">
        {label}
      </span>
      {children}
      {hint ? <span className="mt-1.5 block text-[0.8125rem] leading-relaxed text-fg-faint">{hint}</span> : null}
    </label>
  )
}

/*
 * `min-w-0` matters more than it looks: a number input carries an intrinsic
 * width of about twenty characters, so inside a narrow grid column it pushes the
 * row wider than the phone instead of shrinking. At 280px with the largest text
 * size that was an 18px sideways scroll on the voice-confirmation screen.
 */
export const inputClass =
  'mt-2 min-h-12 w-full min-w-0 rounded-[1.1rem] border border-line-strong bg-card px-4 py-3.5 text-[1rem] text-fg shadow-e1 outline-none transition placeholder:text-fg-faint focus:border-brand-600 focus:ring-4 focus:ring-brand-600/15'

export interface SelectOption {
  value: string
  label: string
  hint?: string
}

/**
 * Custom dropdown selector with smooth rounded edges, frosted glassmorphism popup,
 * animated chevron, checkmark badges, and touch-optimized item targets.
 */
export function CustomSelect({
  value,
  onChange,
  options,
  placeholder = 'Choose...',
  disabled = false,
  className = '',
  size = 'md',
  mt = true,
}: {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  className?: string
  size?: 'sm' | 'md'
  mt?: boolean
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [coords, setCoords] = useState<{
    top: number
    left: number
    width: number
    placeAbove: boolean
  } | null>(null)

  const updateCoords = () => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      setOpen(false)
      return
    }
    const spaceBelow = window.innerHeight - rect.bottom
    const placeAbove = spaceBelow < 220 && rect.top > 220
    setCoords({
      top: placeAbove ? rect.top - 6 : rect.bottom + 6,
      left: rect.left,
      width: rect.width,
      placeAbove,
    })
  }

  useEffect(() => {
    if (!open) {
      setCoords(null)
      return
    }
    updateCoords()

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        menuRef.current &&
        !menuRef.current.contains(target)
      ) {
        setOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const handleScroll = () => {
      updateCoords()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', handleScroll)
    window.addEventListener('scroll', handleScroll, true)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', handleScroll)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [open])

  const selectedOption = options.find((o) => o.value === value)

  return (
    <div className={`relative ${open ? 'z-30' : ''} ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`${mt ? 'mt-2' : ''} flex w-full items-center justify-between gap-2.5 rounded-[1.2rem] border bg-white/90 px-4 text-left font-medium text-fg shadow-xs backdrop-blur-md transition-all duration-200 outline-none ${
          size === 'sm' ? 'min-h-10 py-2 text-[0.875rem]' : 'min-h-12 py-3 text-[1rem]'
        } ${
          disabled
            ? 'cursor-not-allowed opacity-50 bg-sunken/60 border-line'
            : open
              ? 'border-brand-600 bg-white ring-4 ring-brand-600/15 shadow-sm'
              : 'border-line-strong hover:border-brand-500/50 hover:bg-white active:scale-[0.995]'
        }`}
      >
        <span className={`min-w-0 flex-1 truncate ${selectedOption ? 'text-fg font-semibold' : 'text-fg-faint'}`}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <svg
          viewBox="0 0 20 20"
          className={`h-4.5 w-4.5 shrink-0 transition-transform duration-200 ${
            open ? 'rotate-180 text-brand-600' : 'text-fg-muted'
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 7.5l5 5 5-5" />
        </svg>
      </button>

      {open && coords && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={menuRef}
              role="listbox"
              tabIndex={-1}
              style={{
                position: 'fixed',
                top: coords.placeAbove ? undefined : `${coords.top}px`,
                bottom: coords.placeAbove ? `${window.innerHeight - coords.top}px` : undefined,
                left: `${coords.left}px`,
                width: `${coords.width}px`,
                zIndex: 99999,
              }}
              className="dropdown-menu-enter max-h-64 overflow-y-auto no-scrollbar overscroll-contain rounded-[1.35rem] border border-white/80 bg-white/95 p-1.5 shadow-[0_24px_54px_-8px_rgba(15,23,42,0.3),0_8px_24px_-4px_rgba(42,58,214,0.18)] backdrop-blur-2xl ring-1 ring-black/[0.06]"
            >
              {placeholder && (
                <button
                  type="button"
                  role="option"
                  aria-selected={!value}
                  onClick={() => {
                    onChange('')
                    setOpen(false)
                  }}
                  className={`flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-[0.875rem] font-medium transition-all ${
                    !value
                      ? 'bg-brand-50 text-brand-800 font-bold border border-brand-500/20'
                      : 'text-fg-subtle hover:bg-sunken/80 hover:text-fg'
                  }`}
                >
                  <span>{placeholder}</span>
                  {!value ? (
                    <span className="flex h-4.5 w-4.5 items-center justify-center rounded-full bg-brand-600 text-white text-[0.65rem] shadow-xs">
                      ✓
                    </span>
                  ) : null}
                </button>
              )}
              {options.map((opt) => {
                const isSelected = opt.value === value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      onChange(opt.value)
                      setOpen(false)
                    }}
                    className={`group flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-[0.9375rem] transition-all duration-150 ${
                      isSelected
                        ? 'bg-gradient-to-r from-brand-500/10 to-brand-500/5 text-brand-800 font-bold border border-brand-500/20 shadow-xs'
                        : 'text-fg font-medium hover:bg-brand-50 hover:text-brand-900 active:scale-[0.99]'
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                    {opt.hint ? (
                      <span className="ml-2 text-[0.8125rem] font-normal text-fg-subtle">
                        {opt.hint}
                      </span>
                    ) : null}
                    {isSelected ? (
                      <span className="ml-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white text-[0.7rem] shadow-xs">
                        ✓
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>,
            document.body
          )
        : null}
    </div>
  )
}

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
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[0.8125rem] font-bold ${tones[tone]}`}>
      {children}
    </span>
  )
}

export function EmptyState({
  title,
  body,
  icon,
  action,
}: {
  title: string
  body: string
  icon?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="rounded-card border border-dashed border-line-strong bg-card/70 px-5 py-7 text-center">
      {icon ? (
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-sunken text-fg-subtle">
          {icon}
        </div>
      ) : null}
      <p className="text-[0.9375rem] font-semibold text-fg-muted">{title}</p>
      <p className="mt-1.5 text-[0.875rem] leading-relaxed text-fg-faint">{body}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  )
}

/**
 * The vault: the paywall as a dark jewel card, in one place so every gate
 * looks and behaves the same.
 *
 * Gold on near-black instead of brown on cream — a locked feature should read
 * as something valuable kept aside, not as a warning. The lock sits in a lit
 * gold ring, the tier rides a gold pill, and the key is the gold button: the
 * one control on the card a thumb should find first.
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
    <div className="jewel grain relative w-full overflow-hidden !border-x-0 border-y border-white/20 px-4.5 py-5 shadow-jewel">
      {/* A gold hairline across the top: the one line on this card that is
          ornament, marking the boundary between free and paid. */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-300/70 to-transparent"
      />
      <div className="relative flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[0.85rem] border border-gold-300/40 bg-white/10 shadow-[0_0_16px_rgba(255,213,74,0.25)]">
          <svg
            viewBox="0 0 24 24"
            className="h-4.5 w-4.5 text-gold-300"
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
            <h2 className="headline text-[1.0625rem] text-white">{title}</h2>
            <span className="inline-flex items-center rounded-full border border-gold-300/40 bg-gold-400/15 px-2.5 py-1 text-[0.8125rem] font-bold text-gold-300">
              {tierLabel}
            </span>
          </div>
          <p className="mt-2 text-[0.875rem] leading-relaxed text-white/85">{body}</p>

          {preview ? (
            <div className="relative mt-3.5 overflow-hidden rounded-2xl border border-white/15 bg-black/25 shadow-inner">
              <div className="pointer-events-none select-none opacity-80">
                {preview}
              </div>
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#070e28]/55 backdrop-blur-[3.5px]">
                <div className="inline-flex items-center gap-1.5 rounded-full border border-gold-300/40 bg-gold-400/20 px-3 py-1 text-[0.75rem] font-black uppercase tracking-wider text-gold-300 shadow-md backdrop-blur-md">
                  <svg
                    viewBox="0 0 24 24"
                    className="h-3.5 w-3.5 text-gold-300"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="4" y="10" width="16" height="10" rx="2" />
                    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                  </svg>
                  <span>{tierLabel} Preview</span>
                </div>
              </div>
            </div>
          ) : null}

          <Button variant="gold" className="mt-3.5 w-full" onClick={onUpgrade}>
            {ctaLabel ?? t('plan.upgradeTo', { tier: tierLabel })}
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * Segmented view switch — one panel at a time, not a wall of panels.
 *
 * Tabs are for destinations, filters narrow a list, and this is the third job:
 * a small mutually-exclusive *view* choice (Today / 7 days / Capital). Built on
 * the app's `.tag` physics so the chosen segment is the dark one, announced via
 * `aria-pressed` like every other chip in the app.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: T; label: string }[]
  value: T
  onChange: (next: T) => void
  label: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex gap-1.5 overflow-x-auto no-scrollbar rounded-2xl border border-white/80 bg-white/60 p-1.5 shadow-xs backdrop-blur-md"
    >
      {options.map((opt) => {
        // The active segment keeps the full `.tag[aria-pressed]` ink fill; only
        // inactive segments go transparent so the frosted track shows through.
        // (An earlier version forced `!bg-transparent` on all three, which also
        // beat the active fill and left white text on a clear background.)
        const active = value === opt.id
        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.id)}
            className={`tag min-h-11 flex-1 whitespace-nowrap px-3 ${active ? '' : '!border-transparent !bg-transparent !shadow-none'}`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * A section that starts closed and earns its space.
 *
 * The dashboard used to render every panel fully open — capital, provenance,
 * twin grid, warnings — which is what made a new owner feel she had to read a
 * report before she could record a sale. Collapsed by default (unless
 * `defaultOpen`), the choice persists in localStorage so the app remembers
 * which panels an owner actually opens.
 */
export function CollapsibleSection({
  id,
  title,
  hint,
  defaultOpen = false,
  children,
}: {
  id: string
  title: ReactNode
  hint?: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(() => {
    const raw = readPersisted({ key: `seepat.section.${id}` })
    if (raw === '1') return true
    if (raw === '0') return false
    return defaultOpen
  })
  function toggle() {
    setOpen((prev) => {
      writePersisted({ key: `seepat.section.${id}` }, prev ? '0' : '1')
      return !prev
    })
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-white/80 bg-white/60 shadow-xs backdrop-blur-md">
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-left transition active:bg-white/50"
      >
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <span className="headline min-w-0 text-[1rem] leading-snug text-fg">{title}</span>
          {hint ? (
            <span className="num min-w-0 rounded-full bg-sunken px-2.5 py-0.5 text-[0.75rem] leading-snug font-semibold text-fg-subtle">
              {hint}
            </span>
          ) : null}
        </span>
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className={`h-4.5 w-4.5 shrink-0 text-fg-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open ? <div className="collapsible-body border-t border-line/60 px-4 py-4">{children}</div> : null}
    </div>
  )
}

/**
 * A warning that can be dismissed, because a banner nobody can close is a
 * banner nobody reads twice. Max two lines + a count; the full list lives in
 * the section it came from.
 */
export function NoticeBanner({
  tone = 'warn',
  title,
  lines,
  moreCount = 0,
  moreLabel,
  onDismiss,
  dismissLabel,
}: {
  tone?: 'warn' | 'bad'
  title: string
  lines: string[]
  moreCount?: number
  moreLabel?: string
  onDismiss: () => void
  dismissLabel: string
}) {
  const palette =
    tone === 'bad'
      ? 'border-red-300/60 from-red-50/90 to-red-100/40 text-red-900'
      : 'border-amber-300/60 from-amber-50/90 to-amber-100/40 text-amber-900'
  const dot = tone === 'bad' ? 'bg-red-600' : 'bg-amber-600'
  return (
    <div
      role="alert"
      className={`relative rounded-2xl border bg-gradient-to-br px-4 py-3.5 pr-12 shadow-e2 backdrop-blur-md ${palette}`}
    >
      <p className="text-[0.8125rem] font-black tracking-wide uppercase">{title}</p>
      <ul className="mt-1.5 space-y-1.5">
        {lines.map((line) => (
          <li key={line} className="flex items-start gap-2 text-[0.875rem] leading-relaxed font-medium">
            <span className={`mt-1.5 block h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />
            <span>{line}</span>
          </li>
        ))}
      </ul>
      {moreCount > 0 && moreLabel ? (
        <p className="mt-1.5 pl-4 text-[0.8125rem] font-semibold opacity-80">{moreLabel}</p>
      ) : null}
      <button
        type="button"
        onClick={onDismiss}
        aria-label={dismissLabel}
        className="absolute top-2 right-2 grid size-11 place-items-center rounded-full transition hover:bg-black/5 active:bg-black/10"
      >
        <span aria-hidden className="text-[1.15rem] leading-none">
          ×
        </span>
      </button>
    </div>
  )
}

/**
 * The resumable first-run checklist: three steps, never a wall of docs.
 * Progress persists; dismissing hides it for good.
 */
export function ChecklistCard({
  title,
  steps,
  onStep,
  onDismiss,
  dismissLabel,
}: {
  title: string
  steps: { id: string; label: string; done: boolean }[]
  onStep: (id: string) => void
  onDismiss: () => void
  dismissLabel: string
}) {
  const doneCount = steps.filter((s) => s.done).length
  if (doneCount === steps.length) return null
  return (
    <div className="surface rounded-2xl border border-white/80 p-4 shadow-e2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.8125rem] font-black tracking-wide text-brand-800 uppercase">
          {title} · {doneCount}/{steps.length}
        </p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          className="grid size-9 place-items-center rounded-full text-fg-faint transition hover:bg-sunken hover:text-fg"
        >
          <span aria-hidden className="text-[1.05rem] leading-none">
            ×
          </span>
        </button>
      </div>
      <ol className="mt-2.5 space-y-2">
        {steps.map((step, index) => (
          <li key={step.id}>
            <button
              type="button"
              disabled={step.done}
              onClick={() => onStep(step.id)}
              className={`flex min-h-11 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition active:scale-[0.99] ${
                step.done
                  ? 'border-emerald-500/25 bg-emerald-50/70'
                  : 'border-line bg-white/70 hover:border-brand-500/40'
              }`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[0.75rem] font-black ${
                  step.done ? 'bg-emerald-600 text-white' : 'bg-sunken text-fg-muted'
                }`}
              >
                {step.done ? '✓' : index + 1}
              </span>
              <span
                className={`text-[0.875rem] leading-snug font-semibold ${step.done ? 'text-emerald-800 line-through' : 'text-fg'}`}
              >
                {step.label}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** Amber strip used wherever a number or a price is a simulation. */
export function SimulatedNote({ children }: { children: ReactNode }) {
  const t = useT()
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-3">
      <div className="flex items-start gap-2.5">
        <span className="stamp mt-0.5 shrink-0 text-amber-700">{t('shared.simulated')}</span>
        <p className="text-[0.8125rem] leading-relaxed text-amber-800">{children}</p>
      </div>
    </div>
  )
}
