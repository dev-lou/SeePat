import { useState } from 'react'
import { Pat, moodForBand, patTip } from './Pat.tsx'
import type { PatMood, TipSources } from './Pat.tsx'
import type { ScoreBand } from '../engine/index.ts'
import { useLang, useT } from '../i18n/index.ts'

/**
 * What Pat says: one sentence, lifted straight from the engine.
 *
 * It replaces the scolding banner the dashboard used to open with, because a
 * warning nobody can dismiss is a warning nobody reads twice. Dismissible, it
 * becomes something the owner chooses to consult — and it still says the same
 * deterministic sentence the ledger produced, in the language they picked.
 */
export function PatSays({
  band,
  sources,
  tone = 'light',
  onOpenScore,
}: {
  band: ScoreBand
  sources: TipSources
  tone?: 'light' | 'dark'
  onOpenScore?: () => void
}) {
  const lang = useLang()
  const t = useT()
  const [dismissed, setDismissed] = useState(false)

  if (dismissed) return null

  const tip = patTip(sources, lang, t('pat.tipFallback'))
  // A ledger error outranks the score: an unreadable book is a worse fact than a
  // soft margin, and the two can be true at once.
  const mood: PatMood = sources.warnings.length > 0 ? 'concerned' : moodForBand(band)

  return (
    <div className="relative flex items-center gap-2 pr-12">
      {/*
       * Pat is deliberately large here: at 100px the blink and the float are
       * legible on a phone, and the character reads as the app's, not as an icon
       * in a list.
       *
       * The size is a clamp rather than a fixed 100px, because the 100px bird plus
       * a 48px dismiss target left the sentence in a 92px bubble on a 280px phone —
       * about four words per line for the one sentence that carries the advice. The
       * wrapper is a square that shrinks to 56px at the narrowest, and Pat fills it
       * (`className="h-full w-full"` beats the SVG's width/height attributes), so
       * the drawing scales instead of the component changing shape.
       *
       * The negative margin lets it sit on the bubble's line rather than inside a
       * box of its own.
       */}
      <div className="-my-1 -ml-1 h-[clamp(3.5rem,20vw,6.25rem)] w-[clamp(3.5rem,20vw,6.25rem)] shrink-0">
        <Pat mood={mood} wardrobe="books" tone={tone} size={100} className="h-full w-full" />
      </div>

      <div className="relative min-w-0 flex-1 rounded-3xl border border-brand-500/20 bg-gradient-to-br from-white/95 to-brand-50/50 p-4 shadow-e2 backdrop-blur-xl">
        {/* The bubble tail */}
        <span
          aria-hidden
          className="absolute -left-1.5 top-1/2 size-3 -translate-y-1/2 rotate-45 rounded-[2px] border-b border-l border-brand-500/20 bg-white"
        />
        <div className="inline-flex items-center gap-1.5 rounded-full bg-gold-400/20 px-2.5 py-0.5 text-[0.65rem] font-black uppercase tracking-wider text-gold-800 border border-gold-400/30">
          <span className="h-1.5 w-1.5 rounded-full bg-gold-500 shadow-[0_0_6px_rgba(234,179,8,0.8)]" />
          <span>{t('pat.says')}</span>
        </div>
        <p className="mt-2 text-[0.875rem] font-medium leading-relaxed text-fg">{tip}</p>
        {onOpenScore ? (
          <button
            type="button"
            onClick={onOpenScore}
            className="mt-2.5 inline-flex items-center gap-1 text-[0.8125rem] font-extrabold text-brand-700 transition hover:text-brand-900 group"
          >
            <span>{t('dash.scoreTitle')}</span>
            <span className="transition-transform group-hover:translate-x-0.5">→</span>
          </button>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={t('pat.tipClose')}
        className="absolute top-1/2 right-0 grid size-11 -translate-y-1/2 place-items-center rounded-full text-fg-faint transition hover:bg-sunken hover:text-fg"
      >
        <span aria-hidden className="text-[1.15rem] leading-none">
          ×
        </span>
      </button>
    </div>
  )
}
