import { useId } from 'react'

/**
 * Catmull-Rom → cubic bezier. A polyline of 7 points reads as a jagged zigzag;
 * a smoothed curve reads as a *trend*. Tension is kept at 0.2 so the curve never
 * overshoots below zero on a flat series (overshoot would invent a loss that the
 * ledger does not contain).
 */
export function smoothPath(points: [number, number][], tension = 0.2): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0][0]} ${points[0][1]}`
  let d = `M ${points[0][0]} ${points[0][1]}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? p2
    const c1x = p1[0] + (p2[0] - p0[0]) * tension
    const c1y = p1[1] + (p2[1] - p0[1]) * tension
    const c2x = p2[0] - (p3[0] - p1[0]) * tension
    const c2y = p2[1] - (p3[1] - p1[1]) * tension
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`
  }
  return d
}

type Surface = 'dark' | 'light'
type Tone = 'brand' | 'gold' | 'sky'

/*
 * One line colour per surface, straight off the audited palette — 3:1 against
 * the surface it is drawn on, checked in tools/contrast-check.mjs rather than by
 * eye.
 *
 * On the dark card the brand series is *yellow*, and on a light card it is the
 * electric blue: bright yellow is a 3:1 graphic on the dark card and roughly
 * 1.7:1 on white, where it would simply vanish. Same series, two inks, because
 * the surface decides which one is legible.
 */
const SKIN: Record<Tone, Record<Surface, { line: string; fill: string; grid: string }>> = {
  brand: {
    dark: {
      line: '#ffd54a',
      fill: 'rgb(255 213 74 / 0.34)',
      grid: 'rgb(255 255 255 / 0.18)',
    },
    light: { line: '#2a3ad6', fill: 'rgb(42 58 214 / 0.16)', grid: 'rgb(11 11 15 / 0.08)' },
  },
  gold: {
    dark: { line: '#ffe68d', fill: 'rgb(255 230 141 / 0.36)', grid: 'rgb(255 255 255 / 0.18)' },
    light: { line: '#b0830a', fill: 'rgb(176 131 10 / 0.16)', grid: 'rgb(11 11 15 / 0.08)' },
  },
  sky: {
    dark: { line: '#7dd3fc', fill: 'rgb(125 211 252 / 0.36)', grid: 'rgb(255 255 255 / 0.18)' },
    light: { line: '#0284c7', fill: 'rgb(2 132 199 / 0.16)', grid: 'rgb(11 11 15 / 0.08)' },
  },
}

/**
 * Full-bleed smooth area chart.
 *
 * The viewBox is scaled with `preserveAspectRatio="none"` so it always fills its
 * container exactly, and the stroke is then pinned with
 * `vector-effect="non-scaling-stroke"` — otherwise stretching the viewBox
 * stretches the pen with it and the trend line comes out fat and blurry.
 */
export function AreaChart({
  values,
  labels,
  tone = 'brand',
  surface = 'light',
  height = 96,
  valueLabel,
}: {
  values: number[]
  labels?: string[]
  tone?: Tone
  surface?: Surface
  height?: number
  /** Rendered as a floating chip over the last (most recent) point. */
  valueLabel?: string
}) {
  const uid = useId().replace(/:/g, '')
  const skin = SKIN[tone][surface]
  const W = 320
  const H = 100
  const padTop = 10
  const padBottom = 6

  const max = Math.max(...values, 1)
  const n = Math.max(values.length, 2)
  const x = (i: number) => (i / (n - 1)) * W
  const y = (v: number) => H - padBottom - (v / max) * (H - padTop - padBottom)

  const points = values.map((v, i) => [x(i), y(v)] as [number, number])
  const line = smoothPath(points)
  const area = `${line} L ${W} ${H} L 0 ${H} Z`
  const last = points[points.length - 1] ?? [0, H]
  // Still needed for the marker; only the chip stopped using it (see below).
  const lastLeft = (last[0] / W) * 100
  const lastTop = (last[1] / H) * 100

  return (
    <div className="w-full">
      <div className="relative w-full" style={{ height }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full overflow-visible"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={`a${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={skin.fill} />
              {/* This is the area UNDER the line, not a band marking a value —
                  the value is the 3px stroke, which is one audited colour. So
                  this is the one place a gradient is still right: a flat tint
                  that stops at a hard edge reads as a stain on the card. */}
              <stop offset="100%" stopColor={skin.fill} stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* One baseline to read magnitude against — no top rule, so the space
              above the curve stays open instead of framing an empty axis. It is
              decoration: a gridline cannot reach 3:1 without turning into a
              bright band, so the *data* marks (3px line, marker, labels) are
              what carry the meaning and what the contrast budget is spent on. */}
          <line x1="0" y1={H - padBottom} x2={W} y2={H - padBottom} stroke={skin.grid} strokeWidth="1" vectorEffect="non-scaling-stroke" />

          <path d={area} fill={`url(#a${uid})`} className="chart-area" />
          <path
            d={line}
            fill="none"
            stroke={skin.line}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            pathLength={1}
            className="chart-line"
            /* The glow exists only on the dark card, where a lit line is the
               product's one piece of theatre. On white it would be a smudge. */
            style={
              surface === 'dark'
                ? { filter: 'drop-shadow(0 0 7px rgb(255 213 74 / 0.45))' }
                : undefined
            }
          />
        </svg>

        {/* The marker is a DOM node, not an SVG circle, so it stays perfectly
            round no matter how the chart is stretched. */}
        <span
          className="absolute -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${lastLeft}%`, top: `${lastTop}%` }}
        >
          {/* The ring is the *card* colour rather than white, so the halo always
              matches the surface the mark is on — the marker is the newest value
              and it should read as lit, not as a dot with a white border. */}
          <span
            className={`block h-2 w-2 rounded-full ${
              surface === 'dark' ? 'bg-gold-200' : 'bg-brand-600'
            } ring-4 ${surface === 'dark' ? 'ring-black/50' : 'ring-card'}`}
          />
        </span>

        {/*
           * The value chip is anchored to the right edge rather than centred on the
           * last point.
           *
           * It used to be centred at `left: 88%`, which is the last point pushed in
           * from the edge — and half a chip past that still ran off the card on a
           * 280px phone, where it was clipped inside the jewel card's
           * `overflow-hidden`. The chip always marks the *most recent* value, which
           * is by construction the point at the right edge, so anchoring it there
           * is both the honest placement and the one that cannot overflow at any
           * width. `max-w-full` keeps a long figure inside the plot.
           */}
        {valueLabel ? (
          <span
            className={`absolute right-0 max-w-full -translate-y-full whitespace-nowrap rounded-lg px-2 py-1 text-[0.8125rem] font-bold num ${
              surface === 'dark'
                ? 'bg-white/15 text-white backdrop-blur-sm'
                : 'bg-fg text-white'
            }`}
            style={{ top: `${Math.max(12, lastTop - 8)}%` }}
          >
            {valueLabel}
          </span>
        ) : null}
      </div>

      {/*
       * Ticks are the smallest type in the app (12px, the floor) and the
       * reading-size setting can make them 25% larger, so they wrap onto a second
       * row with a gap instead of colliding — which matters most at 280px, where
       * seven weekday labels at 12px are wider than the card. `leading-none` keeps
       * that second row tight so it does not eat the chart's space.
       *
       * On a light surface the row also gets a hairline above it, which is what
       * makes the ticks read as an axis rather than as loose text under a plot. On
       * the dark card there is no rule: a bright line there would compete with the
       * trend it is meant to sit under.
       */}
      {labels && labels.length > 0 ? (
        <div
          className={`mt-2.5 flex flex-wrap justify-between gap-x-2 gap-y-1 leading-none ${
            surface === 'dark' ? '' : 'border-t border-line pt-2'
          }`}
        >
          {labels.map((label, i) => (
            <span
              key={`${label}-${i}`}
              className={`num text-[0.75rem] ${
                i === labels.length - 1
                  ? surface === 'dark'
                    ? 'font-bold text-white'
                    : 'font-bold text-fg-muted'
                  : surface === 'dark'
                    ? 'text-white/90'
                    : 'text-fg-faint'
              }`}
            >
              {label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** Minimal trend line with no axes at all — for tight spaces. */
export function Sparkline({
  values,
  tone = 'brand',
  height = 28,
  className = '',
}: {
  values: number[]
  tone?: Tone
  height?: number
  className?: string
}) {
  const uid = useId().replace(/:/g, '')
  const skin = SKIN[tone].light
  const W = 100
  const H = 32
  const max = Math.max(...values, 1)
  const n = Math.max(values.length, 2)
  const points = values.map(
    (v, i) => [(i / (n - 1)) * W, H - 4 - (v / max) * (H - 12)] as [number, number],
  )
  const line = smoothPath(points)
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={className}
      style={{ height }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`s${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={skin.fill} />
          <stop offset="100%" stopColor="transparent" />
        </linearGradient>
      </defs>
      <path d={`${line} L ${W} ${H} L 0 ${H} Z`} fill={`url(#s${uid})`} className="chart-area" />
      <path
        d={line}
        fill="none"
        stroke={skin.line}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        pathLength={1}
        className="chart-line"
      />
    </svg>
  )
}
