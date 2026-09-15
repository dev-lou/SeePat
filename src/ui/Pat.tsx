import { useId } from 'react'
import type { ScoreBand } from '../engine/index.ts'
import type { Warning } from '../engine/index.ts'
import type { Lang } from '../i18n/index.ts'
import { pick, useLang, useT } from '../i18n/index.ts'

/**
 * Pat, the SeePat owl.
 *
 * One character, one face — and a wardrobe. Pat is the same bird everywhere in
 * the app; only the outfit changes with the job the screen is doing: an apron
 * when it is keeping the books, headphones when it is listening, glasses when it
 * is reading (sipat means to observe), a beanie when you are about to go
 * offline. That is how a mascot reads as a character rather than as a stock
 * illustration glued onto each page.
 *
 * Why inline SVG with CSS keyframes and not Lottie or Rive: this app precaches
 * its shell for offline use, and every install pays that weight on prepaid
 * data. A Lottie player would add ~250KB of runtime and Rive ~100KB of WASM — a
 * 20-46% larger install — to put a bird on the dashboard. This is paths plus a
 * stylesheet: no dependency, no network request, cannot fail offline.
 *
 * What makes it look alive is the timing, not the library. Every part moves on
 * its own period (3.6s / 4.3s / 4.4s / 5.1s / 6.2s / 6.9s / 7.3s / 9.7s), so
 * nothing lands on the same beat twice and the loop never becomes legible. Most
 * importantly the eyelids never stop: holding them still is what made an earlier
 * version look like a still image.
 */

export type PatMood = 'steady' | 'pleased' | 'concerned' | 'listening' | 'thinking'

/**
 * Which job Pat is dressed for. Every variant keeps the identical body, face
 * and palette — only an accessory is added, because the character has to be
 * recognisable before the prop is.
 */
export type PatWardrobe =
  /** The bookkeeper: apron and pen. Dashboard. */
  | 'books'
  /** The listener: headphones. Voice. */
  | 'ears'
  /** The reader: reading glasses. Ask and Score. */
  | 'reading'
  /** Ready for a bad connection: beanie. Offline. */
  | 'offline'
  /** No prop at all. */
  | 'plain'

export type PatTone = 'light' | 'dark'

const BAND_MOOD: Record<ScoreBand, PatMood> = {
  strong: 'pleased',
  good: 'steady',
  // The bottom two bands share one face on purpose: Pat has three expressions,
  // and inventing a fourth would mean drawing a shape no other screen uses. The
  // sentence in the bubble carries the severity.
  watch: 'concerned',
  critical: 'concerned',
}

/** Mood from the Sipat Score band — pure, so Pat can never disagree with the gauge. */
export function moodForBand(band: ScoreBand): PatMood {
  return BAND_MOOD[band]
}

/**
 * Mood for the Voice screen, which has the app's only genuine latency: an
 * on-device model really does take seconds to transcribe. So Pat's "working"
 * face is wired to that, not to a decorative spinner on a call that returns
 * instantly.
 */
export function moodForVoice(state: {
  listening: boolean
  transcribing: boolean
  hasError: boolean
  hasDraft: boolean
}): PatMood {
  if (state.hasError) return 'concerned'
  if (state.transcribing) return 'thinking'
  if (state.listening) return 'listening'
  if (state.hasDraft) return 'pleased'
  return 'steady'
}

export interface TipSources {
  warnings: Warning[]
  priorities: string[]
  strengths: string[]
  /** False while there is too little history for the ratios to mean anything. */
  sufficientData: boolean
}

/**
 * The single sentence Pat is allowed to say.
 *
 * Pat never invents a word: every candidate below is a sentence the
 * deterministic engine already produced and already translated. That keeps the
 * mascot inside the trust boundary the AI card makes visible — there is no
 * second place where language about the owner's money gets written.
 */
export function patTip(sources: TipSources, lang: Lang, fallback: string): string {
  const warning = sources.warnings[0]
  if (warning) return pick(lang, { en: warning.message, fil: warning.messageFil })
  if (!sources.sufficientData) return fallback
  return sources.priorities[0] ?? sources.strengths[0] ?? fallback
}

const MOOD_KEY = {
  steady: 'pat.moodSteady',
  pleased: 'pat.moodPleased',
  concerned: 'pat.moodConcerned',
  listening: 'pat.moodListening',
  thinking: 'pat.moodThinking',
} as const

export function Pat({
  mood = 'steady',
  wardrobe = 'plain',
  tone = 'light',
  size = 96,
  className = '',
}: {
  mood?: PatMood
  wardrobe?: PatWardrobe
  tone?: PatTone
  size?: number
  className?: string
}) {
  const lang = useLang()
  const t = useT()
  // Two Pats can share a page, so every clip id is instance-scoped.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const c = tone === 'dark' ? DARK : LIGHT

  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={`pat ${className}`}
      data-mood={mood}
      data-tone={tone}
      data-wardrobe={wardrobe}
      role="img"
      // The mood is the only thing a sighted user reads from the bird, so it is
      // the only thing worth announcing. The bubble beside Pat is real text.
      aria-label={`Pat — ${t(MOOD_KEY[mood])}`}
      lang={lang === 'fil' ? 'fil' : 'en'}
    >
      <defs>
        <clipPath id={`${uid}-eye-l`}>
          <circle cx="46" cy="52" r="13" />
        </clipPath>
        <clipPath id={`${uid}-eye-r`}>
          <circle cx="74" cy="52" r="13" />
        </clipPath>
        {/* The apron is clipped to the belly so it cannot spill past the body. */}
        <clipPath id={`${uid}-belly`}>
          <path d="M60 24c20 0 34 16 34 37 0 22-15 37-34 37S26 83 26 61c0-21 14-37 34-37Z" />
        </clipPath>
      </defs>

      {/* The instrument ring: a gauge bezel, not decoration. It is the element
          that says "device" rather than "cartoon". */}
      <circle
        className="pat-orbit"
        cx="60"
        cy="60"
        r="55"
        fill="none"
        strokeWidth="1.3"
        strokeDasharray="2 7"
        strokeLinecap="round"
      />
      {/* A gauge sweep along the bottom of the dial. It used to sit across the
          top, where a 100-degree gold arc over the head read as a headband
          rather than as an instrument. */}
      <circle
        cx="60"
        cy="60"
        r="55"
        fill="none"
        stroke={c.arc}
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeDasharray="96 250"
        transform="rotate(30 60 60)"
      />
      <circle className="pat-glow" cx="60" cy="62" r="26" style={{ filter: 'blur(10px)' }} />

      <g className="pat-float">
        <g className="pat-sway">
          <g className="pat-breathe">
            {/* Ear tufts — the owl signature, and the slowest twitch in the rig. */}
            <path className="pat-tuft-l" d="M40 34 26 14l23 8Z" style={{ fill: c.tuft }} />
            <path className="pat-tuft-r" d="M80 34 94 14l-23 8Z" style={{ fill: c.tuft }} />

            {/* Wings as stroked arcs: one clean line each, which stays legible at
                40px where a feathered shape would turn to mud. */}
            <path
              className="pat-wing-l"
              d="M31 59C25 70 26 83 33 91"
              fill="none"
              stroke={c.wing}
              strokeWidth="7"
              strokeLinecap="round"
            />
            <path
              className="pat-wing-r"
              d="M89 59c6 11 5 24-2 32"
              fill="none"
              stroke={c.wing}
              strokeWidth="7"
              strokeLinecap="round"
            />

            {/* Feet */}
            <path
              d="M52 99v5m0 0-4 3m4-3 4 3M68 99v5m0 0-4 3m4-3 4 3"
              fill="none"
              stroke={c.foot}
              strokeWidth="2.6"
              strokeLinecap="round"
            />

            {/* Body, then the facial disc on top of it. */}
            <path
              d="M60 24c20 0 34 16 34 37 0 22-15 37-34 37S26 83 26 61c0-21 14-37 34-37Z"
              style={{ fill: c.body }}
            />

            {/* The wardrobe. Drawn before the face so a hood or band never covers
                the eyes — the face is the character. */}
            <g clipPath={`url(#${uid}-belly)`}>{outfit(wardrobe, c)}</g>

            <ellipse cx="60" cy="50" rx="31" ry="27" style={{ fill: c.face }} />

            {/* Beak between the eyes: the only warm note on the face. */}
            <path d="M60 58 66.5 68 60 74 53.5 68Z" style={{ fill: c.beak }} />

            {/* Eyes — the same eye the mark is built around. */}
            <circle cx="46" cy="52" r="13" style={{ fill: c.eye }} />
            <circle cx="74" cy="52" r="13" style={{ fill: c.eye }} />
            <circle cx="46" cy="52" r="13" fill="none" stroke={c.ring} strokeWidth="2.4" />
            <circle cx="74" cy="52" r="13" fill="none" stroke={c.ring} strokeWidth="2.4" />

            <g className="pat-pupil">
              <circle cx="46" cy="53" r="6" style={{ fill: c.pupil }} />
              <circle cx="74" cy="53" r="6" style={{ fill: c.pupil }} />
              <circle cx="49" cy="50.5" r="1.7" style={{ fill: c.glint }} />
              <circle cx="77" cy="50.5" r="1.7" style={{ fill: c.glint }} />
            </g>

            {/* Lids: face-coloured, parked closed at scaleY(0), clipped to the eye
                so a blink reads as an eye shutting, not a curtain dropping. */}
            <g clipPath={`url(#${uid}-eye-l)`}>
              <rect className="pat-lid" x="33" y="39" width="26" height="26" style={{ fill: c.face }} />
            </g>
            <g clipPath={`url(#${uid}-eye-r)`}>
              <rect
                className="pat-lid pat-lid-b"
                x="61"
                y="39"
                width="26"
                height="26"
                style={{ fill: c.face }}
              />
            </g>

            {/* Mood pose. Colour and a single line, never a new silhouette, so Pat
                stays the same bird in every state. */}
            <g
              className="pat-pose pat-pose-worry"
              style={{ stroke: c.brow }}
              strokeWidth="3.2"
              strokeLinecap="round"
              fill="none"
            >
              <path d="M35 33 56 38.5M85 33 64 38.5" />
            </g>
            <g
              className="pat-pose pat-pose-happy"
              style={{ stroke: c.brow }}
              strokeWidth="3.2"
              strokeLinecap="round"
              fill="none"
            >
              <path d="M35 34q11-8 21-2M85 34q-11-8-21-2" />
            </g>

            {/* Accessories that sit over the face. */}
            {wardrobe === 'ears' ? headphones(c) : null}
            {wardrobe === 'reading' ? glasses(c) : null}
            {wardrobe === 'offline' ? beanie(c) : null}
          </g>
        </g>
      </g>
    </svg>
  )
}

/**
 * The wardrobe. Each prop is a handful of geometric shapes in the system's own
 * tokens — never a new shape language, and never at the cost of the silhouette.
 */
function outfit(wardrobe: PatWardrobe, c: Palette) {
  if (wardrobe !== 'books') return null
  return (
    <g>
      {/* Bookkeeper's apron: bib, two straps over the shoulders, a pen pocket. */}
      <path d="M47 74h26v24a5 5 0 0 1-5 5H52a5 5 0 0 1-5-5Z" style={{ fill: c.apron }} />
      <path
        d="M50 74 44 44M70 74l6-30"
        fill="none"
        stroke={c.apron}
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path d="M55 82h10v7H55Z" style={{ fill: c.pocket }} />
      <path d="M60 83v5" stroke={c.pen} strokeWidth="2" strokeLinecap="round" />
    </g>
  )
}

function headphones(c: Palette) {
  return (
    <g>
      <path
        d="M34 52C34 30 46 20 60 20s26 10 26 32"
        fill="none"
        stroke={c.prop}
        strokeWidth="7"
        strokeLinecap="round"
      />
      <rect x="24" y="46" width="14" height="20" rx="7" style={{ fill: c.prop }} />
      <rect x="82" y="46" width="14" height="20" rx="7" style={{ fill: c.prop }} />
    </g>
  )
}

/** Glasses sit on the face, so they take the prop gold in both tones. */
function glasses(c: Palette) {
  return (
    <g stroke={c.prop} strokeWidth="2.6" fill="none">
      <circle cx="46" cy="52" r="18.5" />
      <circle cx="74" cy="52" r="18.5" />
      <path d="M64.5 50h-9" strokeLinecap="round" />
      <path d="M28 49l-7-4M92 49l7-4" strokeLinecap="round" />
    </g>
  )
}

/**
 * The beanie: a band across the brow and a soft crown — the "load the offline
 * kit before the signal drops" look. Navy and flag red in both tones, because
 * it is worn on the white face either way.
 */
function beanie(c: Palette) {
  return (
    <g>
      <path d="M30 36c0-16 13-24 30-24s30 8 30 24Z" style={{ fill: c.hat }} />
      <path d="M29 36h62a5 5 0 0 1 0 10H29a5 5 0 0 1 0-10Z" style={{ fill: c.hatBand }} />
      <circle cx="60" cy="10" r="5" style={{ fill: c.hatBand }} />
    </g>
  )
}

interface Palette {
  /** The bird itself. The only part that inverts on a dark surface. */
  body: string
  wing: string
  tuft: string
  foot: string
  /**
   * The face, which is identical in both tones: Pat is the same character, and
   * the navy eye inside a white disc is the same eye the SeePat mark is built
   * around. A face that changed with the surface would be a different bird.
   */
  face: string
  eye: string
  ring: string
  pupil: string
  glint: string
  beak: string
  brow: string
  /** The gauge sweep, which reads against whatever Pat is standing on. */
  arc: string
  /** Props worn on the face or body, so they need contrast against those. */
  prop: string
  apron: string
  pocket: string
  pen: string
  hat: string
  hatBand: string
}

/**
 * Illustration palette. Every value is a token from the existing system — navy
 * structure, gold accent, flag red — so Pat cannot drift away from the brand if
 * the palette is re-tuned.
 */
/** The face and every prop are shared; only these keys differ per surface. */
const FACE: Pick<Palette, 'face' | 'eye' | 'ring' | 'pupil' | 'glint' | 'beak' | 'brow' | 'prop' | 'hat' | 'hatBand'> = {
  face: '#ffffff',
  eye: '#ffffff',
  // Navy eye ring on a white disc: 11:1, and the same eye as the brand mark.
  ring: 'var(--color-brand-900)',
  pupil: 'var(--color-brand-900)',
  glint: '#ffffff',
  beak: 'var(--color-gold-600)',
  brow: 'var(--color-red-600)',
  prop: 'var(--color-gold-600)',
  hat: 'var(--color-brand-700)',
  hatBand: 'var(--color-red-600)',
}

const LIGHT: Palette = {
  ...FACE,
  body: 'var(--color-brand-800)',
  wing: 'var(--color-brand-900)',
  tuft: 'var(--color-brand-900)',
  foot: 'var(--color-brand-900)',
  arc: 'var(--color-gold-600)',
  apron: 'var(--color-gold-300)',
  pocket: 'var(--color-gold-600)',
  pen: 'var(--color-brand-900)',
}

/**
 * On the navy jewel surface a navy bird would vanish, so the body inverts into
 * the lit material instead — the same light-on-dark relationship as the gold
 * sun in the card's corner. The white face disc is what keeps the inverting
 * bird recognisable as the same character, so the face itself never changes.
 */
const DARK: Palette = {
  ...FACE,
  body: 'var(--color-gold-300)',
  wing: 'var(--color-gold-500)',
  tuft: 'var(--color-gold-500)',
  foot: 'var(--color-gold-500)',
  arc: 'var(--color-gold-300)',
  apron: 'var(--color-brand-700)',
  pocket: 'var(--color-gold-400)',
  pen: 'var(--color-brand-900)',
}
