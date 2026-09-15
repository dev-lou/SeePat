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
    <div className="relative flex items-center gap-2 pr-7">
      {/* Pat is deliberately large here: at 100px the blink and the float are
          legible on a phone, and the character reads as the app's, not as an
          icon in a list. The negative margin lets it sit on the bubble's line
          rather than inside a box of its own. */}
      <div className="shrink-0 -my-1 -ml-1">
        <Pat mood={mood} wardrobe="books" tone={tone} size={100} />
      </div>

      <div className="relative min-w-0 flex-1 rounded-card border border-line bg-card p-3 shadow-e1">
        {/* The bubble tail: one rotated square tucked under the card's edge, so
            Pat is visibly the one speaking. */}
        <span
          aria-hidden
          className="absolute -left-1.5 top-1/2 size-3 -translate-y-1/2 rotate-45 rounded-[2px] border-b border-l border-line bg-card"
        />
        <div className="eyebrow text-gold-700">{t('pat.says')}</div>
        <p className="mt-1 text-[0.78rem] leading-snug text-fg-muted">{tip}</p>
        {onOpenScore ? (
          <button
            type="button"
            onClick={onOpenScore}
            className="mt-2 text-[0.7rem] font-bold text-brand-700 underline decoration-brand-200 underline-offset-2 transition hover:decoration-brand-600"
          >
            {t('dash.scoreTitle')}
          </button>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={t('pat.tipClose')}
        className="absolute right-0 top-1 grid size-7 place-items-center rounded-full text-fg-faint transition hover:bg-sunken hover:text-fg"
      >
        <span aria-hidden className="text-[0.9rem] leading-none">
          ×
        </span>
      </button>
    </div>
  )
}
