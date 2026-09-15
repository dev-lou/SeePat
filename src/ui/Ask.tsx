import { useMemo, useState } from 'react'
import { Button, Card, LockedCard, Pill, SectionTitle, inputClass } from './components.tsx'
import { ask } from '../engine/index.ts'
import type { Answer } from '../engine/index.ts'
import type { Negosyo } from '../store.ts'
import { AI_QUESTION_LIMIT } from '../billing.ts'
import type { Billing } from '../billing.ts'
import { Pat } from './Pat.tsx'
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

export function AskScreen({
  negosyo,
  billing,
  onUpgrade,
}: {
  negosyo: Negosyo
  billing: Billing
  onUpgrade: () => void
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
  const [asked, setAsked] = useState<string[]>([])
  const history: Answer[] = useMemo(
    () => asked.map((q) => ask(q, { ledger: negosyo.ledger, twin: negosyo.twin, now: negosyo.now }, lang)),
    [asked, lang, negosyo.ledger, negosyo.twin, negosyo.now],
  )

  function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed) return
    setAsked((current) => [trimmed, ...current].slice(0, 8))
    setQuestion('')
  }

  return (
    <div className="space-y-4">
      <Card>
        {/* Pat in the reading glasses: this is the screen where the app looks at
            the books and tells you what it sees. */}
        <div className="flex items-start gap-1">
          <div className="shrink-0 -mb-2 -ml-2 -mt-1">
            <Pat wardrobe="reading" mood="steady" size={82} />
          </div>
          <div className="min-w-0 flex-1">
            <SectionTitle hint={t('ask.noLlm')}>{t('ask.title')}</SectionTitle>
            <p className="mb-3 text-[0.7rem] text-fg-subtle">{t('ask.intro')}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <input
            className={`${inputClass} mt-0`}
            placeholder={t('ask.placeholder')}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send(question)
            }}
          />
          <Button onClick={() => send(question)}>{t('ask.ask')}</Button>
        </div>
        <p className="mt-2 text-[0.65rem] text-fg-faint">{t('ask.free')}</p>
      </Card>

      {/* Until something is asked, the screen would otherwise be a card over a
          field of nothing. The starters fill it with the questions themselves. */}
      {history.length === 0 ? (
        <Card>
          <SectionTitle hint={t('ask.startHint')}>{t('ask.startTitle')}</SectionTitle>
          <div className="grid grid-cols-2 gap-2.5">
            {STARTERS.map((starter) => (
              <button
                key={starter.qKey}
                type="button"
                onClick={() => send(t(starter.qKey))}
                className="flex items-start gap-2.5 rounded-2xl border border-line bg-gradient-to-br from-card to-sunken/50 p-3 text-left shadow-e1 transition-all duration-200 active:scale-[0.97] active:border-brand-700/40"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-700/10 text-brand-700">
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d={starter.icon} />
                  </svg>
                </span>
                <span className="text-[0.72rem] leading-snug font-semibold text-fg-muted">
                  {t(starter.labelKey)}
                </span>
              </button>
            ))}
          </div>
          <p className="mt-3.5 border-t border-line pt-3.5 text-[0.68rem] leading-relaxed text-fg-faint">
            {t('ask.startFooter')}
          </p>
        </Card>
      ) : null}

      {history[0] ? (
        <AiNarrationCard answer={history[0]} billing={billing} onUpgrade={onUpgrade} />
      ) : null}

      {/* Answers are readings the engine produced from the ledger, so the newest
          one takes the navy tint — the same "computed, not guessed" material the
          AI card uses when it is locked. Older answers stay plain so the newest
          reading is the one that stands out. */}
      {history.map((answer, index) => (
        <Card key={`${answer.intent}-${index}`} material={index === 0 ? 'brand' : 'plain'}>
          <div className="text-[0.7rem] text-fg-faint">{answer.question}</div>
          <p className="mt-1 text-base font-medium text-fg">{answer.headline}</p>

          {answer.detail.length > 0 ? (
            <ul className="mt-3 space-y-1 border-t border-line pt-3">
              {answer.detail.map((line) => (
                <li key={line} className="text-xs text-fg-muted">
                  {line}
                </li>
              ))}
            </ul>
          ) : null}

          {answer.evidence.length > 0 ? (
            <div className="mt-3 space-y-1 border-t border-line pt-3">
              <div className="eyebrow text-brand-700">{t('ask.evidence')}</div>
              {answer.evidence.map((item, i) => (
                <div key={`${item.label}-${i}`} className="flex justify-between gap-3 text-xs">
                  <span className="text-fg-subtle">{item.label}</span>
                  <span className="text-right text-fg-muted">{item.value}</span>
                </div>
              ))}
            </div>
          ) : null}

          {answer.actions.length > 0 ? (
            <div className="mt-3 space-y-1 border-t border-line pt-3">
              <div className="eyebrow text-amber-700">{t('ask.actions')}</div>
              {answer.actions.map((action) => (
                <div key={action} className="text-xs text-amber-800">
                  {action}
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      ))}
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
  const [requested, setRequested] = useState(false)

  const evidence = (
    <ul className="space-y-1">
      <li className="text-xs text-fg-muted">{answer.headline}</li>
      {answer.evidence.map((item) => (
        <li key={item.label} className="flex justify-between gap-3 text-xs">
          <span className="text-fg-subtle">{item.label}</span>
          <span className="text-fg-muted">{item.value}</span>
        </li>
      ))}
    </ul>
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
        <div className="flex items-center justify-between gap-2">
          <h2 className="eyebrow text-amber-700">{t('ask.aiTitle')}</h2>
          <Pill tone="warn">{t('ask.aiRemaining', { n: 0 })}</Pill>
        </div>
        <p className="mt-1.5 text-[0.72rem] leading-relaxed text-fg-subtle">
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
      <div className="flex items-center justify-between gap-2">
        <h2 className="eyebrow text-brand-700">{t('ask.aiTitle')}</h2>
        <Pill tone={remaining > 60 ? 'good' : 'warn'}>{t('ask.aiRemaining', { n: remaining })}</Pill>
      </div>

      {requested ? (
        <>
          <p className="mt-1.5 text-[0.7rem] leading-relaxed text-fg-subtle">
            {t('ask.aiWouldSend')}
          </p>
          <div className="mt-2 rounded-2xl border border-line bg-sunken p-3">{evidence}</div>
          <p className="mt-2 text-[0.65rem] leading-relaxed text-fg-faint">
            {t('ask.aiNotWired')}
          </p>
        </>
      ) : (
        <>
          <p className="mt-1.5 text-[0.72rem] leading-relaxed text-fg-subtle">
            {t('ask.aiExplainPrompt')}
          </p>
          <Button
            className="mt-3 w-full"
            onClick={() => {
              billing.recordAiQuestion()
              setRequested(true)
            }}
          >
            {t('ask.explainWithAi')}
          </Button>
        </>
      )}
    </Card>
  )
}
