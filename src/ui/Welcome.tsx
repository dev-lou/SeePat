import { useEffect, useRef, useState } from 'react'
import { Donut, ProgressRing } from './components.tsx'
import { Pat } from './Pat.tsx'
import type { PatWardrobe } from './Pat.tsx'
import { formatPHP, formatPercent } from '../engine/index.ts'
import type { Negosyo } from '../store.ts'
import { LANGS, pick, useLang, useSetLang, useT } from '../i18n/index.ts'
import type { UIStr } from '../i18n/index.ts'
import {
  WELCOME_SLIDES,
  isLastSlide,
  markWelcomeSeen,
  stepSlide,
  welcomeSlideCount,
} from '../onboarding.ts'

/**
 * The welcome deck: three slides, shown once, then gone.
 *
 * Two decisions make it worth the interruption rather than a nuisance.
 *
 * **It shows the product instead of describing it.** Every slide's artwork is a
 * real component from the app — the listen waveform, the capital donut rendered
 * from the owner's own ledger, the Sipat Score ring — not a stock illustration of
 * a phone. The owner sees the interface they are about to get, which is the one
 * thing a tour can do that a screenshot cannot.
 *
 * **Pat walks through the story.** All three slides are the same owl in a
 * different outfit (ears → reading glasses → apron), which is the character
 * doing its job: the deck reads as one narrator rather than three feature
 * cards.
 *
 * The copy is three taglines that are all claims the product can keep: what it
 * does for you, what it shows you that a sales notebook cannot, and what it costs
 * (nothing, and your records stay on the phone).
 */

interface SlideSpec {
  id: (typeof WELCOME_SLIDES)[number]
  eyebrow: UIStr
  tagline: UIStr
  body: UIStr
  wardrobe: PatWardrobe
  visual: 'voice' | 'capital' | 'offline'
}

const SLIDES: SlideSpec[] = [
  {
    id: 'speak',
    eyebrow: 'welcome.speak.eyebrow',
    tagline: 'welcome.speak.tagline',
    body: 'welcome.speak.body',
    wardrobe: 'ears',
    visual: 'voice',
  },
  {
    id: 'see',
    eyebrow: 'welcome.see.eyebrow',
    tagline: 'welcome.see.tagline',
    body: 'welcome.see.body',
    wardrobe: 'reading',
    visual: 'capital',
  },
  {
    id: 'yours',
    eyebrow: 'welcome.yours.eyebrow',
    tagline: 'welcome.yours.tagline',
    body: 'welcome.yours.body',
    wardrobe: 'books',
    visual: 'offline',
  },
]

/**
 * The meter's silhouette: quiet at the edges, two peaks through the middle, with
 * the tallest bar just off-centre where a stressed syllable would land. Read as
 * a shape it should look like someone speaking, not like a bar chart.
 */
const WAVE = [
  0.18, 0.34, 0.55, 0.78, 0.62, 0.9, 0.5, 0.72, 0.42, 0.86, 1, 0.66, 0.48, 0.94, 0.58, 0.76, 0.4,
  0.68, 0.5, 0.82, 0.44, 0.6, 0.32, 0.2,
]
const SEGMENT_COLORS = ['#1b45a6', '#b07f08', '#ce1126', '#0284c7', '#7c3aed']

export function Welcome({ negosyo, onDone }: { negosyo: Negosyo; onDone: () => void }) {
  const t = useT()
  const lang = useLang()
  const setLang = useSetLang()
  const total = welcomeSlideCount()
  const [index, setIndex] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const [drag, setDrag] = useState(0)
  const [dragging, setDragging] = useState(false)
  const gesture = useRef<{ id: number; x: number; y: number; claimed: boolean } | null>(null)

  const slide = SLIDES[index]
  const last = isLastSlide(index, total)

  function finish() {
    markWelcomeSeen()
    setLeaving(true)
    // Let the fade play before the app takes the screen, so the handoff is a
    // dissolve rather than a cut.
    setTimeout(onDone, 260)
  }

  function go(delta: number) {
    setDrag(0)
    setIndex((current) => stepSlide(current, delta, total))
  }

  /*
   * The swipe. One pointer implementation rather than a touch one, so a mouse
   * drag on a laptop behaves identically to a thumb on a phone — and the slide
   * FOLLOWS the finger, because a deck that only reacts after you let go feels
   * like a button, not like a deck.
   *
   * Two details that make the difference between "works" and "feels right":
   *   - the gesture is only claimed once it is clearly more horizontal than
   *     vertical, so a diagonal drag never hijacks a scroll;
   *   - the ends have resistance. Dragging right on the first slide moves a
   *     little and springs back, which tells the user it is the beginning rather
   *     than leaving them to wonder whether the swipe failed.
   */
  const DRAG_COMMIT = 56

  function onPointerDown(event: React.PointerEvent) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, claimed: false }
  }

  function onPointerMove(event: React.PointerEvent) {
    const g = gesture.current
    if (!g || g.id !== event.pointerId) return
    const dx = event.clientX - g.x
    const dy = event.clientY - g.y

    if (!g.claimed) {
      if (Math.abs(dx) < 10) return
      if (Math.abs(dx) < Math.abs(dy)) {
        // A vertical gesture: hand it back to the page and forget it.
        gesture.current = null
        return
      }
      g.claimed = true
      setDragging(true)
      event.currentTarget.setPointerCapture?.(event.pointerId)
    }

    const blocked = (index === 0 && dx > 0) || (last && dx < 0)
    setDrag(blocked ? dx * 0.25 : dx)
  }

  function onPointerUp(event: React.PointerEvent) {
    const g = gesture.current
    gesture.current = null
    if (!g?.claimed) return
    setDragging(false)

    const dx = event.clientX - g.x
    if (Math.abs(dx) >= DRAG_COMMIT) {
      if (dx < 0 && last) finish()
      else go(dx < 0 ? 1 : -1)
      return
    }
    // Not far enough: spring back rather than leave the slide parked.
    setDrag(0)
  }

  // Keyboard: a deck like this is a dialog, and a dialog that traps the arrow
  // keys is a dialog people get stuck in.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') finish()
      else if (event.key === 'ArrowRight') go(1)
      else if (event.key === 'ArrowLeft') go(-1)
      else if (event.key === 'Enter' && isLastSlide(index, total)) finish()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // The real capital composition, so slide two is about THIS ledger.
  const segments = negosyo.composition.components
    .filter((c) => c.amountCentavos > 0)
    .map((c, i) => ({
      key: pick(lang, c.label),
      amount: c.amountCentavos,
      color: SEGMENT_COLORS[i % SEGMENT_COLORS.length],
    }))

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
      className={`fixed inset-0 z-50 flex flex-col bg-page transition-opacity duration-200 ${
        leaving ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {/* Same canvas as the shell, so the deck and the app are one surface. */}
      <div className="canvas-grid" aria-hidden />

      <div className="safe-top flex items-center justify-between px-4 pt-3">
        <div
          className="flex items-center gap-0.5 rounded-full p-0.5 surface"
          role="group"
          aria-label={t('welcome.languageLabel')}
        >
          {LANGS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setLang(option.id)}
              aria-pressed={lang === option.id}
              className={`rounded-full px-2.5 py-1 text-[0.66rem] font-bold transition ${
                lang === option.id ? 'bg-brand-700 text-white' : 'text-fg-subtle hover:text-fg'
              }`}
            >
              {option.native}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={finish}
          className="rounded-full px-3 py-1.5 text-[0.72rem] font-bold text-fg-subtle transition hover:bg-sunken hover:text-fg"
        >
          {t('welcome.skip')}
        </button>
      </div>

      <div
        className="flex min-h-0 flex-1 touch-pan-y select-none flex-col justify-center px-5 pb-2"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* Keyed so the entrance replays per slide rather than only on mount. */}
        <div
          key={slide.id}
          className="enter"
          style={{
            transform: `translateX(${drag}px)`,
            transition: dragging ? 'none' : 'transform 280ms cubic-bezier(0.22, 1, 0.36, 1)',
            // Fading as it travels tells the eye the card is being dismissed
            // rather than sliding against a wall.
            opacity: 1 - Math.min(0.45, Math.abs(drag) / 520),
          }}
        >
          <div className="flex flex-col items-center text-center">
            <Pat mood="steady" wardrobe={slide.wardrobe} size={116} />
            <div className="mt-1 flex min-h-[150px] w-full items-center justify-center">
              <SlideVisual which={slide.visual} negosyo={negosyo} segments={segments} />
            </div>
            <div className="eyebrow mt-2 text-gold-700">{t(slide.eyebrow)}</div>
            <h1
              id="welcome-title"
              className="headline mt-2 max-w-[19ch] text-[1.9rem] leading-[1.1] text-fg"
            >
              {t(slide.tagline)}
            </h1>
            <p className="mt-3 max-w-[38ch] text-[0.78rem] leading-relaxed text-fg-muted">
              {t(slide.body)}
            </p>
          </div>
        </div>
      </div>

      <div className="safe-bottom px-5 pb-5">
        <div className="mb-3 flex items-center justify-center gap-1.5" aria-hidden>
          {SLIDES.map((s, i) => (
            <span
              key={s.id}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === index ? 'w-6 bg-brand-700' : 'w-1.5 bg-line-strong'
              }`}
            />
          ))}
        </div>
        {/* Announced, not just drawn: the dots are the only visual progress cue. */}
        <p className="sr-only" aria-live="polite">
          {t('welcome.step', { n: index + 1, total })}
        </p>

        <div className="flex items-center gap-2">
          {index > 0 ? (
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label={t('welcome.step', { n: index, total })}
              className="surface grid size-12 place-items-center rounded-full text-[1rem] font-bold text-fg-muted transition active:scale-[0.96]"
            >
              <span aria-hidden>←</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => (last ? finish() : go(1))}
            className="flex-1 rounded-full bg-gradient-to-b from-brand-600 to-brand-800 px-4 py-3.5 text-[0.86rem] font-bold text-white shadow-e2 transition active:scale-[0.99]"
          >
            {last ? t('welcome.start') : t('welcome.next')}
          </button>
        </div>
        <p className="mt-3 text-center text-[0.66rem] text-fg-faint">{t('welcome.demoNote')}</p>
      </div>
    </div>
  )
}

/**
 * The most recent unit price this ledger actually recorded for a SKU. Reads the
 * sale lines backwards so the example is priced at today's real number, not at a
 * remembered one — and returns 0 when the SKU has never been sold, which the
 * caller renders as no amount rather than as ₱0.00.
 */
function lastSalePrice(negosyo: Negosyo, skuId: string | undefined): number {
  if (!skuId) return 0
  const txn = negosyo.ledger.transactions
  for (let i = txn.length - 1; i >= 0; i -= 1) {
    const entry = txn[i]
    if (!entry) continue

    // Sales price what the owner sold it for; purchases price what it cost. Kept
    // as two branches rather than one, because a slide about a SALE must never
    // quote a purchase cost — and the types only keep them apart this way.
    const sale =
      entry.kind === 'cash_sale' || entry.kind === 'credit_sale'
        ? [...entry.lines].reverse().find((l) => l.skuId === skuId && l.unitPriceCentavos > 0)
        : undefined
    if (sale) return sale.unitPriceCentavos

    const purchase =
      entry.kind === 'purchase'
        ? [...entry.lines].reverse().find((l) => l.skuId === skuId && l.unitCostCentavos > 0)
        : undefined
    if (purchase) return purchase.unitCostCentavos
  }
  return 0
}

/**
 * The slide artwork. Each one is a real component from the app rather than a
 * drawing of one, because the promise of a tour is "this is what you get".
 */
function SlideVisual({
  which,
  negosyo,
  segments,
}: {
  which: SlideSpec['visual']
  negosyo: Negosyo
  segments: { key: string; amount: number; color: string }[]
}) {
  const t = useT()

  if (which === 'voice') {
    /*
     * The example line is priced from the owner's OWN ledger rather than being
     * typed into the slide. The demo seeds a Coke SKU and sells it, so the unit
     * price here is a real transaction price and the total is real arithmetic —
     * a welcome slide is a promise about the product, and a made-up price in it
     * would be the first lie in the app.
     */
    const sku = negosyo.ledger.skus.find((s) => s.id === 'coke') ?? negosyo.ledger.skus[0]
    const unitPrice = lastSalePrice(negosyo, sku?.id)
    const qty = 5

    return (
      <div className="surface w-full max-w-sm rounded-card p-4">
        <div className="flex items-center gap-3">
          {/* The mic and its pulse, the same treatment as the live Voice screen. */}
          <span className="mic-ring grid h-11 w-11 shrink-0 place-items-center rounded-full bg-red-600">
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white" aria-hidden>
              <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" />
            </svg>
          </span>
          {/*
           * The level meter spans the FULL width between the mic and the card
           * edge. Two things make it read as a device rather than as decoration:
           * `justify-between` distributes the bars edge to edge (centring them
           * left a clump in the middle with dead space on both sides, which is
           * exactly what looked broken), and the heights follow a speech
           * silhouette — soft at the start, peaking twice, tapering off — instead
           * of a random spread that reads as noise.
           */}
          <div className="wave-on flex h-9 flex-1 items-center justify-between" aria-hidden>
            {WAVE.map((amplitude, index) => (
              <span
                key={index}
                className="w-[3px] shrink-0 rounded-full bg-brand-700"
                style={{ height: `${amplitude * 100}%`, animationDelay: `${(index % 7) * 95}ms` }}
              />
            ))}
          </div>
        </div>

        {/* Speech in, ledger out — the whole product in two lines. */}
        <div className="mt-3 border-t border-line pt-3 text-left">
          <div className="text-[0.66rem] text-fg-faint">{t('welcome.speak.uttered')}</div>
          <div className="mt-1 flex items-baseline justify-between gap-2 text-[0.8rem] font-semibold text-fg">
            <span className="truncate">
              {t('welcome.speak.parsed')} {qty} × {sku?.name ?? '—'}
            </span>
            <span className="num shrink-0">{unitPrice ? formatPHP(qty * unitPrice) : ''}</span>
          </div>
        </div>
      </div>
    )
  }

  if (which === 'capital') {
    return (
      <div className="surface flex w-full max-w-sm justify-center rounded-card p-4">
        <Donut
          segments={segments}
          centerLabel={t('dash.capitalCenter')}
          centerValue={formatPHP(negosyo.composition.netAssetsCentavos)}
        />
      </div>
    )
  }

  // Ownership, told with the ledger's own numbers: the score and the margin on
  // the left are real, and the three ticks on the right are the three things that
  // keep working when the signal drops.
  return (
    <div className="surface w-full max-w-sm rounded-card p-4">
      <div className="flex items-center justify-around gap-3">
        <ProgressRing value={negosyo.score.value} size={104} stroke={11}>
          <span className="figure-lg text-[1.4rem] leading-none text-fg">
            {negosyo.score.value}
          </span>
        </ProgressRing>
        <div className="min-w-0 text-left">
          <div className="eyebrow text-brand-700">{t('dash.scoreTitle')}</div>
          <div className="num mt-1 text-[0.78rem] text-fg-subtle">
            {t('dash.margin')} — {formatPercent(negosyo.week.netMargin)}
          </div>
          <ul className="mt-2 space-y-1 text-[0.72rem] text-fg-muted">
            {(['tab.ledger', 'tab.score', 'welcome.offlineVoice'] as const).map((key) => (
              <li key={key} className="flex items-center gap-1.5">
                <span className="text-emerald-600" aria-hidden>
                  ✓
                </span>
                {t(key)}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
