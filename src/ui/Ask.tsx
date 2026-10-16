import { useEffect, useMemo, useState } from 'react'
import { explainAnswer, isAiConfigured } from '../ai.ts'
import { AnswerChartView } from './charts.tsx'
import { Button, Card, Chip, LockedCard, Pill, SectionTitle, inputClass } from './components.tsx'
import { ask, chartIsWorthDrawing } from '../engine/index.ts'
import type { Answer } from '../engine/index.ts'
import type { Negosyo } from '../store.ts'
import { AI_QUESTION_LIMIT } from '../billing.ts'
import type { Billing } from '../billing.ts'
import { Pat } from './Pat.tsx'
import { spokenAnswer } from '../speech.ts'
import { isFatalSpeechFailure, useDictation } from './useDictation.ts'
import { setSpeakEnabled, useSpeakEnabled, useSpeech } from './useSpeech.ts'
import { useLang, useT } from '../i18n/index.ts'
import type { UIStr } from '../i18n/index.ts'

/**
 * The questions an owner actually asks, as tappable tiles rather than a
 * horizontally-scrolling chip row: on a phone, eight things you can see at once
 * beat ten things you have to swipe to discover.
 *
 * Each tile holds a *key*, not a sentence, so the question an owner taps is
 * written in the language they are reading — and because `matchIntent` reads both
 * languages, tapping the English one is answered in English.
 */
const STARTERS: { qKey: UIStr; labelKey: UIStr; icon: string }[] = [
  { qKey: 'askEx.profit', labelKey: 'askEx.profitLabel', icon: 'M4 17l6-6 4 4 6-8M20 7v5h-5' },
  { qKey: 'askEx.capitalWhere', labelKey: 'askEx.capitalWhereLabel', icon: 'M3 7h18v11H3zM16 12.5h2' },
  { qKey: 'askEx.provenance', labelKey: 'askEx.provenanceLabel', icon: 'M7 17L17 7M9 7h8v8' },
  {
    qKey: 'askEx.topProduct',
    labelKey: 'askEx.topProductLabel',
    icon: 'M12 3l2.6 5.6 6.1.8-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.4l6.1-.8z',
  },
  {
    qKey: 'askEx.slow',
    labelKey: 'askEx.slowLabel',
    icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5v5l3 2',
  },
  {
    qKey: 'askEx.biggestUtang',
    labelKey: 'askEx.biggestUtangLabel',
    icon: 'M15 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M21 19v-1a4 4 0 0 0-3-3.8',
  },
  { qKey: 'askEx.profitChange', labelKey: 'askEx.profitChangeLabel', icon: 'M4 7l6 6 4-4 6 8M20 17v-5h-5' },
  { qKey: 'askEx.score', labelKey: 'askEx.scoreLabel', icon: 'M3 12h4l2-6 3 12 2-6h7' },
]

interface Turn {
  text: string
  /** The owner said it rather than typed it. */
  outLoud: boolean
}

export function AskScreen({
  negosyo,
  billing,
  onUpgrade,
  onOpenOffline,
}: {
  negosyo: Negosyo
  billing: Billing
  onUpgrade: () => void
  /** The on-device voice model is the remedy when the browser cannot listen. */
  onOpenOffline: () => void
}) {
  const lang = useLang()
  const t = useT()
  const [question, setQuestion] = useState('')
  /**
   * Only what was ASKED is stored, never the answer.
   *
   * Answers are deterministic functions of the question, the ledger and the
   * language — so keeping the questions and re-deriving on a language change is
   * what makes the switch total: an answer given in Tagalog comes back in English
   * instead of sitting there in the old language. Storing the rendered answer
   * would have been the obvious implementation and the reason the switch leaks.
   */
  const [asked, setAsked] = useState<Turn[]>([])

  const speakOn = useSpeakEnabled()
  const speech = useSpeech(lang)
  /** Which card is currently being read, so its button can offer "stop". */
  const [reading, setReading] = useState<number | null>(null)

  const context = { ledger: negosyo.ledger, twin: negosyo.twin, now: negosyo.now }
  const history = useMemo(
    () => asked.map((turn) => ({ ...turn, answer: ask(turn.text, context, lang) })),
    [asked, lang, negosyo.ledger, negosyo.twin, negosyo.now],
  )

  /*
   * The question that was just asked *by voice* is answered by voice.
   *
   * That is the whole point of the loop the owner started: she chose to talk, so
   * being answered in silence would be the surprising outcome. A question that
   * was typed is never read out on its own — she can still ask for it, and the
   * toggle in this card turns the automatic half off for good.
   */
  function askIt(text: string, outLoud: boolean) {
    const trimmed = text.trim()
    if (!trimmed) return
    setAsked((current) => [{ text: trimmed, outLoud }, ...current].slice(0, 8))
    setQuestion('')
    setReading(null)
    if (outLoud && speakOn && speech.supported) {
      // Answered from the same call the card is about to render, so the voice and
      // the card can never be reading two different answers.
      speech.say(spokenAnswer(ask(trimmed, context, lang)))
      setReading(0)
    }
  }

  const dictation = useDictation({ onQuestion: (text) => askIt(text, true) })

  // SeePat stops looking like she is reading the moment she stops.
  useEffect(() => {
    if (!speech.speaking) setReading(null)
  }, [speech.speaking])

  /*
   * A failure the owner can act on gets a button, not just a sentence — the same
   * rule the Voice screen follows. In a browser built without Google's speech
   * service, browser recognition can never work however well the owner speaks, so
   * the only route to a spoken question is the on-device model: switch to it if it
   * is installed, or fetch it if it is not.
   */
  const remedy: { label: string; action: () => void } | null = (() => {
    // Two ways to get here: the browser has no recognizer at all (so the mic was
    // never usable, and no error will ever arrive to explain it), or one failed
    // with a code that another try cannot fix.
    const unusable = !dictation.available
    const fatal = dictation.errorCode !== null && isFatalSpeechFailure(dictation.errorCode)
    if (!unusable && !fatal) return null
    if (dictation.canInstall) return { label: t('voice.downloadModel'), action: onOpenOffline }
    return { label: t('voice.switchOffline'), action: dictation.preferOffline }
  })()

  const voiceAllowed = billing.can('voice_capture')

  const micGlyph = (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="currentColor" aria-hidden="true">
      <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" />
    </svg>
  )

  return (
    <div className="space-y-4">
      <Card>
        {/* Pat in the reading glasses: this is the screen where the app looks at
            the books and tells you what it sees. Ears while listening, pleased
            while speaking — the face follows the pipeline, not a timer. */}
        <div className="flex items-start gap-1">
          <div className="-mt-1 -mb-2 -ml-2 shrink-0">
            <Pat
              wardrobe="reading"
              mood={dictation.listening ? 'listening' : speech.speaking ? 'pleased' : 'steady'}
              size={82}
            />
          </div>
          <div className="min-w-0 flex-1">
            <SectionTitle>{t('ask.title')}</SectionTitle>
            <span className="mb-2.5 inline-block max-w-full rounded-full border border-brand-500/20 bg-brand-50/70 px-3 py-1 text-[0.8125rem] leading-snug font-bold text-brand-800">
              {t('ask.noLlm')}
            </span>
            <p className="mb-3 text-[0.8125rem] leading-relaxed text-fg-subtle">
              {t('ask.intro')}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-stretch gap-2">
          <input
            className={`${inputClass} mt-0 min-w-0 flex-1 bg-white/80 backdrop-blur-md rounded-2xl`}
            placeholder={t('ask.placeholder')}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') askIt(question, false)
            }}
          />
          <Button className="min-h-12 shrink-0 px-6 font-bold shadow-pop" onClick={() => askIt(question, false)}>
            {t('ask.ask')}
          </Button>
        </div>

        {/*
         * The mic is the second way to ask, not a decoration on the first: the
         * whole product is built around speaking a sale, so speaking the question
         * about those sales is the same gesture, one screen over.
         */}
        {voiceAllowed ? (
          <button
            type="button"
            onClick={() => {
              if (dictation.listening) {
                dictation.stop()
                return
              }
              // SeePat must not hear her own voice. Stopping first also means the
              // answer being read cannot end up inside the next question.
              speech.stop()
              dictation.start()
            }}
            disabled={!dictation.available}
            aria-label={dictation.listening ? t('ask.voiceListening') : t('ask.voiceAsk')}
            className={`mt-2.5 flex min-h-12 w-full items-center justify-center gap-2.5 rounded-2xl border px-4 text-[0.9375rem] font-bold shadow-xs transition active:scale-[0.99] disabled:opacity-50 ${
              dictation.listening
                ? 'mic-ring border-red-600 bg-red-600 text-white shadow-[0_0_28px_rgba(220,38,38,0.55)]'
                : 'border-white/80 bg-white/70 text-brand-800 backdrop-blur-md hover:border-brand-500/40'
            }`}
          >
            {micGlyph}
            <span>
              {dictation.listening
                ? t('ask.voiceListening')
                : dictation.transcribing
                  ? t('ask.voiceTranscribing')
                  : t('ask.voiceAsk')}
            </span>
          </button>
        ) : (
          <LockedCard
            title={t('ask.voiceAsk')}
            body={t('voice.lockedBody')}
            tierLabel="PRO"
            onUpgrade={onUpgrade}
          />
        )}

        {/* While the mic is open, the words appear as they are recognized — the
            only proof the owner has that the phone is listening to her and not
            to the store. */}
        {dictation.listening || dictation.transcribing ? (
          <div className="mt-2.5 rounded-2xl border border-red-200 bg-red-50 px-3.5 py-3">
            <div className="flex items-center gap-2">
              <span className="mic-ring h-2.5 w-2.5 shrink-0 rounded-full bg-red-600" aria-hidden />
              <span className="text-[0.8125rem] font-bold tracking-wide text-red-800 uppercase">
                {dictation.listening ? t('ask.voiceListening') : t('ask.voiceTranscribing')}
              </span>
            </div>
            <p className="mt-1.5 min-h-6 text-[0.9375rem] leading-snug font-medium text-fg">
              {dictation.interim || t('ask.voiceHint')}
            </p>
          </div>
        ) : null}

        {dictation.error ? (
          <p className="mt-2.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-[0.8125rem] leading-relaxed text-amber-900">
            {dictation.error}
          </p>
        ) : null}

        {/* A disabled mic with no explanation is the worst state this card can be
            in: the owner cannot tell a missing microphone apart from a browser
            that will never listen. Saying which one it is, with the route to a
            working one, is the whole difference. */}
        {voiceAllowed && !dictation.available ? (
          <p className="mt-2.5 rounded-xl border border-line bg-sunken px-3 py-2.5 text-[0.8125rem] leading-relaxed text-fg-subtle">
            {t('ask.voiceNoEngine')}
          </p>
        ) : null}

        {remedy ? (
          <Button variant="ghost" className="mt-2 w-full" onClick={remedy.action}>
            {remedy.label}
          </Button>
        ) : null}

        {/* Which engine is listening matters here: one needs the internet and one
            does not, and the owner is deciding whether to trust it with a
            question in a store with no signal. */}
        {dictation.available && dictation.engineLabel && !dictation.listening ? (
          <p className="mt-2 text-[0.8125rem] leading-relaxed text-fg-faint">
            {t('voice.engineLabel')}: {dictation.engineLabel[lang]}
          </p>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <p className="aside text-[0.9375rem] leading-snug text-fg-subtle">{t('ask.free')}</p>
          <Chip active={speakOn} onClick={() => setSpeakEnabled(!speakOn)}>
            {t('ask.speakAuto')} · {speakOn ? t('app.speakOn') : t('app.speakOff')}
          </Chip>
        </div>
      </Card>

      {/* Until something is asked, the screen would otherwise be a card over a
          field of nothing. The starters fill it with the questions themselves. */}
      {history.length === 0 ? (
        <Card>
          <SectionTitle hint={t('ask.startHint')}>{t('ask.startTitle')}</SectionTitle>
          <div className="fit-grid-2 grid grid-cols-2 gap-3">
            {STARTERS.map((starter) => (
              <button
                key={starter.qKey}
                type="button"
                onClick={() => askIt(t(starter.qKey), false)}
                className="surface-raise flex min-h-20 items-start gap-3 rounded-2xl border border-white/80 bg-white/70 backdrop-blur-md p-3.5 text-left shadow-xs transition-all duration-200 hover:border-brand-500/30 active:scale-[0.98]"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-brand-600 to-brand-400 text-white shadow-[0_4px_12px_-2px_rgba(42,58,214,0.35)]">
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d={starter.icon} />
                  </svg>
                </span>
                <span className="text-[0.875rem] leading-snug font-bold text-fg">
                  {t(starter.labelKey)}
                </span>
              </button>
            ))}
          </div>
          <p className="mt-3.5 border-t border-line pt-3.5 text-[0.8125rem] leading-relaxed text-fg-faint">
            {t('ask.startFooter')}
          </p>
        </Card>
      ) : null}

      {/*
       * Answers are readings the engine produced from the ledger.
       *
       * The AI upsell follows the newest answer rather than preceding it: the
       * answer is what the owner asked for, and it now carries the chart and the
       * voice, so putting a PRO card in front of it would be selling before
       * answering. Above the older answers it still gets seen, without standing
       * between the question and its answer.
       */}
      {history.map((turn, index) => {
        const answer = turn.answer
        const isNewest = index === 0
        const readingThis = reading === index && speech.speaking
        // The card is built first and returned either alone or with the AI card
        // after it, so the newest answer never has a PRO upsell in front of it.
        const card = (
          <Card key={`${answer.intent}-${index}`} material={isNewest ? 'brand' : 'plain'}>
            {/* The question is the owner's own words, so it takes the second voice
                (weight 500, secondary ink); the reading underneath is the app's, so
                it is set in the headline weight it shares with every figure. One
                glance tells you who said what. The mic glyph on the question is how
                a spoken turn stays distinguishable from a typed one. */}
            <div className="aside flex items-start gap-1.5 text-[0.9375rem] leading-snug text-fg-subtle">
              {turn.outLoud ? (
                <span className="mt-0.5 shrink-0 text-brand-700" title={t('ask.askedOutLoud')}>
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                    <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" />
                  </svg>
                  <span className="sr-only">{t('ask.askedOutLoud')}</span>
                </span>
              ) : null}
              <span className="min-w-0">{answer.question}</span>
            </div>
            <p className="headline mt-1.5 text-[1.0625rem] leading-snug text-fg">{answer.headline}</p>

            {isNewest && answer.chart && chartIsWorthDrawing(answer.chart) ? (
              <AnswerChartView chart={answer.chart} lang={lang} />
            ) : null}

            {answer.detail.length > 0 ? (
              <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
                {answer.detail.map((line) => (
                  <li key={line} className="text-[0.875rem] leading-relaxed text-fg-muted">
                    {line}
                  </li>
                ))}
              </ul>
            ) : null}

            {answer.evidence.length > 0 ? (
              <div className="mt-3 space-y-1 border-t border-line pt-3">
                <div className="eyebrow text-brand-700">{t('ask.evidence')}</div>
                {answer.evidence.map((item, i) => (
                  <div
                    key={`${item.label}-${i}`}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[0.875rem]"
                  >
                    {/* Both sides may wrap: these values are sentences, not peso
                        figures, so a `shrink-0` value squeezed the label into a
                        single vertical column of letters on a phone. The row keeps
                        its label-left/value-right shape when both fit, and the
                        value drops to its own line when they do not. */}
                    <span className="min-w-0 leading-snug text-fg-subtle">{item.label}</span>
                    <span className="min-w-0 text-right leading-snug text-fg-muted">{item.value}</span>
                  </div>
                ))}
              </div>
            ) : null}

            {answer.actions.length > 0 ? (
              <div className="mt-3 space-y-1 border-t border-line pt-3">
                <div className="eyebrow text-amber-700">{t('ask.actions')}</div>
                {answer.actions.map((action) => (
                  <div key={action} className="text-[0.875rem] leading-relaxed text-amber-800">
                    {action}
                  </div>
                ))}
              </div>
            ) : null}

            {/* A spoken question is not a misheard one until the answers stop
                fitting: when the parser finds no intent, the questions it DOES
                understand are offered as taps, so a bad transcript is one tap
                from an answer instead of a dead end. */}
            {isNewest && answer.intent === 'unknown' ? (
              <div className="mt-3 border-t border-line pt-3">
                <div className="eyebrow text-brand-700">{t('ask.didYouMean')}</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {STARTERS.slice(0, 4).map((starter) => (
                    <Chip key={starter.qKey} onClick={() => askIt(t(starter.qKey), false)}>
                      {t(starter.labelKey)}
                    </Chip>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Hearing the answer is the other half of asking by voice. It is
                offered on every card, not only the newest: a figure worth
                re-reading is usually an older one. */}
            <div className="mt-3 border-t border-line pt-3">
              {speech.supported ? (
                <Button
                  variant={isNewest ? 'brand' : 'ghost'}
                  className="min-h-11 w-full"
                  onClick={() => {
                    if (readingThis) {
                      speech.stop()
                      return
                    }
                    speech.say(spokenAnswer(answer))
                    setReading(index)
                  }}
                >
                  <span className="inline-flex items-center justify-center gap-2">
                    <svg
                      viewBox="0 0 24 24"
                      className="h-4 w-4 shrink-0"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M4 9.5h3l4.5-3.6v12.2L7 14.5H4zM15.5 8.6a4.6 4.6 0 0 1 0 6.8M18.2 6a8 8 0 0 1 0 12" />
                    </svg>
                    {readingThis ? t('ask.speakStop') : t('ask.speak')}
                  </span>
                </Button>
              ) : (
                <p className="text-[0.8125rem] leading-relaxed text-fg-faint">{t('ask.speakNoVoice')}</p>
              )}

              {readingThis ? (
                <p className="eyebrow mt-2 text-brand-700">{t('ask.speaking')}</p>
              ) : null}

              {/*
               * The accent note. A phone with no Tagalog voice still reads the
               * answer — in an English voice — and an owner hearing mangled
               * Tagalog deserves to know why rather than concluding the app is
               * broken. It appears only after something has actually been read.
               */}
              {readingThis && speech.voiceExact === false && lang === 'fil' ? (
                <p className="mt-2 text-[0.8125rem] leading-relaxed text-amber-800">
                  {t('ask.speakAccented')}
                </p>
              ) : null}
            </div>
          </Card>
        )
        return isNewest ? (
          [card, <AiNarrationCard key="ai" answer={answer} billing={billing} onUpgrade={onUpgrade} />]
        ) : (
          card
        )
      })}
    </div>
  )
}

/**
 * The AI layer, isolated to the one place it belongs.
 *
 * The concept note's central architectural claim is that AI never produces the
 * numbers — it only explains numbers the deterministic engine already computed.
 * This card is that claim, visible: the only thing an AI call is ever handed is
 * a headline plus the ledger figures behind it, never the raw business.
 *
 * It is also the only feature in the product with a real marginal cost, which is
 * why it is the only thing on this screen that is metered and gated. The
 * explanation itself is not wired to a model in the prototype; showing exactly
 * what *would* be sent is more honest than faking a paragraph, and it makes the
 * trust boundary legible to anyone evaluating the pitch.
 */
function AiNarrationCard({
  answer,
  billing,
  onUpgrade,
}: {
  answer: Answer
  billing: Billing
  onUpgrade: () => void
}) {
  const t = useT()
  const lang = useLang()
  const [requested, setRequested] = useState(false)
  const [aiText, setAiText] = useState<string | null>(null)
  const [aiBusy, setAiBusy] = useState(false)

  // Light ink on a light card: this same evidence block is previewed inside the
  // dark vault (LockedCard frosts it), but here it sits on paper — white text
  // on white was unreadable, which is the bug being fixed.
  const evidence = (
    <div className="rounded-xl border border-line bg-card p-3">
      <ul className="space-y-2">
        <li className="text-[0.875rem] leading-relaxed font-semibold text-fg">
          {answer.headline}
        </li>
        {answer.evidence.map((item, index) => (
          <li
            // Indexed, because the evidence labels are not unique: the Score
            // answer reports several findings all labelled "Strong", and keying
            // on the label alone made React log a duplicate-key warning.
            key={`${item.label}-${index}`}
            className="flex items-baseline justify-between gap-3 text-[0.875rem]"
          >
            <span className="min-w-0 leading-snug text-fg-muted">{item.label}</span>
            <span className="num shrink-0 text-right font-medium text-fg">{item.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )

  if (!billing.can('ai_narration')) {
    return (
      <LockedCard
        title={t('ask.aiTitle')}
        body={t('ask.aiLockedBody')}
        tierLabel="PRO"
        onUpgrade={onUpgrade}
        preview={evidence}
      />
    )
  }

  const remaining = billing.aiQuestionsRemaining

  if (remaining <= 0) {
    return (
      <Card flat className="border-amber-300 bg-amber-50">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="eyebrow text-amber-700">{t('ask.aiTitle')}</h2>
          <Pill tone="warn">{t('ask.aiRemaining', { n: 0 })}</Pill>
        </div>
        <p className="mt-2 text-[0.8125rem] leading-relaxed text-fg-subtle">
          {t('ask.aiExhausted', { n: AI_QUESTION_LIMIT })}
        </p>
        <Button variant="ghost" className="mt-3 w-full" onClick={onUpgrade}>
          {t('shared.seePlans')}
        </Button>
      </Card>
    )
  }

  return (
    <Card flat className="border-brand-600/40 bg-brand-50">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="eyebrow text-brand-700">{t('ask.aiTitle')}</h2>
        <Pill tone={remaining > 60 ? 'good' : 'warn'}>{t('ask.aiRemaining', { n: remaining })}</Pill>
      </div>

      {requested ? (
        <>
          <p className="mt-2 text-[0.8125rem] leading-relaxed text-fg-subtle">
            {t('ask.aiWouldSend')}
          </p>
          <div className="mt-2.5">{evidence}</div>
          {aiText ? (
            <p className="mt-2.5 text-[0.875rem] leading-relaxed text-fg">{aiText}</p>
          ) : (
            <p className="mt-2.5 text-[0.8125rem] leading-relaxed text-fg-faint">
              {t('ask.aiNotWired')}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="mt-2 text-[0.8125rem] leading-relaxed text-fg-subtle">
            {t('ask.aiExplainPrompt')}
          </p>
          <Button
            className="mt-3.5 min-h-12 w-full"
            disabled={aiBusy}
            onClick={() => {
              // The meter is charged *after* the door opens, not before.
              //
              // Charging first was a real defect: with no provider configured,
              // explainAnswer always throws AiNotConfigured, so the owner spent
              // one of their 300 questions and got the "no AI is connected"
              // note — a counter that ticks down while nothing is bought. A
              // question is metered when it is actually asked.
              if (!isAiConfigured()) {
                setRequested(true)
                return
              }
              billing.recordAiQuestion()
              setRequested(true)
              setAiBusy(true)
              void explainAnswer({
                headline: answer.headline,
                evidence: answer.evidence,
                lang,
              })
                .then((text) => setAiText(text))
                .catch(() => setAiText(null))
                .finally(() => setAiBusy(false))
            }}
          >
            {t('ask.explainWithAi')}
          </Button>
        </>
      )}
    </Card>
  )
}
