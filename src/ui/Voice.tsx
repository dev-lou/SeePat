import { useMemo, useRef, useState } from 'react'
import {
  Button,
  Card,
  Chip,
  CustomSelect,
  Field,
  HeroShell,
  LockedCard,
  SectionTitle,
  inputClass,
} from './components.tsx'
import { useToast } from './Toast.tsx'
import { Pat, moodForVoice } from './Pat.tsx'
import { SAMPLE_UTTERANCES, getEngines } from '../asr.ts'
import type { AsrErrorCode, AsrStatus } from '../asr.ts'
import { OFFLINE_ENGINE_ID, RUNTIME_APPROX_MB, WHISPER_MODEL, useVoiceModel } from '../asr-offline.ts'
import { formatPHP, parseSpoken, pesos } from '../engine/index.ts'
import type { Sku, Transaction } from '../engine/index.ts'
import { newTxnId } from '../store.ts'
import type { Negosyo } from '../store.ts'
import type { Billing } from '../billing.ts'
import { pick, useLang, useT } from '../i18n/index.ts'

/**
 * A fixed waveform silhouette. Deterministic on purpose: a random one would
 * reshuffle on every render, which reads as noise rather than as a level meter.
 */
const WAVE = [
  0.28, 0.5, 0.82, 0.42, 1, 0.64, 0.36, 0.72, 0.46, 0.94, 0.58, 0.32, 0.78, 0.52, 1, 0.44, 0.68,
  0.88, 0.38, 0.6, 0.28,
]

interface EditedLine {
  key: string
  skuId: string
  skuName: string
  qtyDisplay: string
  priceDisplay: string
}

function toBaseQty(sku: Sku | undefined, displayQty: number): number {
  if (sku?.baseUnit === 'g') return Math.round(displayQty * 1000)
  return Math.round(displayQty)
}

function fromBaseQty(sku: Sku | undefined, baseQty: number): number {
  if (sku?.baseUnit === 'g') return baseQty / 1000
  return baseQty
}

export function VoiceScreen({
  negosyo,
  billing,
  onUpgrade,
  onOpenOffline,
}: {
  negosyo: Negosyo
  billing: Billing
  onUpgrade: () => void
  onOpenOffline: () => void
}) {
  const { ledger, add, removeTransaction } = negosyo
  const lang = useLang()
  const t = useT()
  const toast = useToast()
  const undoLabel = lang === 'fil' ? 'I-undo' : 'Undo'
  const voiceModel = useVoiceModel()

  // Rebuilt when a model lands, so the Offline chip stops reporting itself as
  // unavailable the moment the download finishes rather than on the next reload.
  const engines = useMemo(() => getEngines(), [voiceModel.installed])
  const [engineId, setEngineId] = useState(engines[0]?.id ?? 'typed')
  const [listening, setListening] = useState(false)
  const [status, setStatus] = useState<AsrStatus | null>(null)
  const [transcript, setTranscript] = useState('')
  const [draftText, setDraftText] = useState('')
  const [error, setError] = useState('')
  const [errorCode, setErrorCode] = useState<AsrErrorCode | null>(null)
  const [edited, setEdited] = useState<EditedLine[] | null>(null)
  const [draftKind, setDraftKind] = useState<'cash_sale' | 'credit_sale' | 'purchase' | 'expense'>(
    'cash_sale',
  )
  const [draftCustomer, setDraftCustomer] = useState<string | undefined>(undefined)
  const [posted, setPosted] = useState('')
  const engineRef = useRef<ReturnType<typeof getEngines>[number] | null>(null)
  /*
   * What the current session produced, held in a ref rather than in state on
   * purpose: the engine's end callback can fire in the same tick as its error
   * callback, and reading `error`/`transcript` state there would see the values
   * from *before* the update. The ref is what the session actually did.
   */
  const sessionRef = useRef<{ final: string; failed: boolean }>({ final: '', failed: false })

  const engine = engines.find((e) => e.id === engineId)
  // Data-driven rather than hardcoded: voice happens to be free today because
  // the browser does the recognizing at no cost to us. If that ever changes,
  // the gate changes in billing.ts and this screen follows automatically.
  const voiceAllowed = billing.can('voice_capture')

  // Typed mode lifts the type card above the mic hero: when typing is the job,
  // the keyboard surface leads and the mic waits below. The screen stays where
  // it is — no auto-scroll — so the swap itself is what the owner sees.
  const typedMode = engineId === 'typed'

  function buildDraft(text: string) {
    const draft = parseSpoken(text, ledger, lang)
    setDraftKind(draft.kind)
    setDraftCustomer(draft.customerId)
    setEdited(
      draft.lines.map((line, index) => {
        const sku = ledger.skus.find((s) => s.id === line.skuId)
        return {
          key: `${index}-${line.skuId}`,
          skuId: line.skuId,
          skuName: line.skuName,
          qtyDisplay: String(fromBaseQty(sku, line.qty)),
          priceDisplay: String(line.unitPriceCentavos / 100),
        }
      }),
    )
    setPosted('')
    setError(draft.lines.length === 0 ? t('voice.error.noItems') : '')
  }

  function startListening() {
    if (!engine || !engine.available) {
      setError(t('voice.error.noEngine'))
      return
    }
    setError('')
    setErrorCode(null)
    setTranscript('')
    setStatus(null)
    setListening(true)
    sessionRef.current = { final: '', failed: false }
    const instance = getEngines().find((e) => e.id === engineId)
    engineRef.current = instance ?? null
    instance?.start(
      (result) => {
        setTranscript(result.transcript)
        if (result.final) {
          sessionRef.current.final = result.transcript
          setListening(false)
          setStatus(null)
          setDraftText(result.transcript)
        }
      },
      (message, code) => {
        sessionRef.current.failed = true
        setError(message)
        setErrorCode(code ?? null)
        setListening(false)
        setStatus(null)
      },
      (next) => setStatus(next),
      () => {
        // The session is over, whatever the reason. Leaving the listening state
        // on the assumption that a callback is coming is how the mic ended up
        // pulsing red at an owner who had already stopped talking.
        setListening(false)
        setStatus(null)
        const session = sessionRef.current
        if (session.final) {
          setDraftText(session.final)
          /*
           * Parse as soon as a complete take lands, so the flow is speak → check
           * → confirm instead of speak → tap → tap. Nothing is posted by doing
           * this: `buildDraft` fills the confirmation table, and the ledger is
           * untouched until "Confirm and record".
           *
           * A *partial* transcript is deliberately not parsed — stopping the mic
           * mid-sentence leaves the words in the box for the owner to finish.
           * Half a sentence parses to wrong quantities, and quantities are the
           * part that must never be inferred.
           */
          buildDraft(session.final)
          return
        }
        // Nothing usable came back. If the engine already explained why, that
        // message stands; if it just died, say so plainly.
        if (!session.failed) setError(t('voice.error.nothingHeard'))
      },
    )
  }

  function stopListening() {
    engineRef.current?.stop()
    engineRef.current = null
    setListening(false)
    setStatus(null)
    if (transcript) setDraftText(transcript)
  }

  function confirm() {
    if (!edited || edited.length === 0) return
    const at = new Date().toISOString()
    const lines = edited.map((l) => {
      const sku = ledger.skus.find((s) => s.id === l.skuId)
      return {
        skuId: l.skuId,
        qty: toBaseQty(sku, Number(l.qtyDisplay)),
        unitPriceCentavos: pesos(Number(l.priceDisplay)),
      }
    })

    const total = lines.reduce((s, l) => s + l.qty * l.unitPriceCentavos, 0)

    if (draftKind === 'credit_sale') {
      const txn: Transaction = {
        id: newTxnId('utang'),
        at,
        kind: 'credit_sale',
        lines,
        customerId: draftCustomer ?? 'walk_in',
        note: draftText,
        source: 'voice',
      }
      add(txn)
      const msg = t('voice.posted.utang', { amount: formatPHP(total) })
      setPosted(msg)
      toast.show({
        title: msg,
        tone: 'success',
        undoLabel,
        onUndo: () => {            removeTransaction(txn.id)
          toast.show({
            title: lang === 'fil' ? 'Na-undo ang utang' : 'Credit sale undone',
            tone: 'info',
          })
        },
      })
    } else if (draftKind === 'purchase') {
      const txn: Transaction = {
        id: newTxnId('pur'),
        at,
        kind: 'purchase',
        lines: lines.map((l) => ({
          skuId: l.skuId,
          qty: l.qty,
          unitCostCentavos: l.unitPriceCentavos,
        })),
        paidCentavos: total,
        note: draftText,
        source: 'voice',
      }
      add(txn)
      const msg = t('voice.posted.purchase', { amount: formatPHP(total) })
      setPosted(msg)
      toast.show({
        title: msg,
        tone: 'success',
        undoLabel,
        onUndo: () => {            removeTransaction(txn.id)
          toast.show({
            title: lang === 'fil' ? 'Na-undo ang bili' : 'Purchase undone',
            tone: 'info',
          })
        },
      })
    } else {
      const txn: Transaction = {
        id: newTxnId('sal'),
        at,
        kind: 'cash_sale',
        lines,
        note: draftText,
        source: 'voice',
      }
      add(txn)
      const msg = t('voice.posted.sale', { amount: formatPHP(total) })
      setPosted(msg)
      toast.show({
        title: msg,
        tone: 'success',
        undoLabel,
        onUndo: () => {            removeTransaction(txn.id)
          toast.show({
            title: lang === 'fil' ? 'Na-undo ang benta' : 'Sale undone',
            tone: 'info',
          })
        },
      })
    }
    setEdited(null)
    setTranscript('')
  }

  // Sipat's face is wired to the real pipeline, not to a timer: it looks like it
  // is working only while the on-device model is actually transcribing.
  const voiceMood = moodForVoice({
    listening,
    transcribing: status === 'transcribing',
    hasError: error !== '',
    hasDraft: (edited?.length ?? 0) > 0,
  })

  /*
   * A failure the owner can act on gets a button, not just a sentence. This is
   * the case that matters: in a browser with no speech service, browser
   * recognition can never work no matter how well the owner speaks, so the only
   * route to voice is the on-device model — either switch to it if it is already
   * installed, or fetch it.
   */
  const offlineRoute:
    | { label: string; action: () => void }
    | null = (() => {
    if (!errorCode || !['network', 'language', 'blocked'].includes(errorCode)) return null
    if (voiceModel.installed) {
      return {
        label: t('voice.switchOffline'),
        action: () => {
          setEngineId(OFFLINE_ENGINE_ID)
          setError('')
          setErrorCode(null)
        },
      }
    }
    return { label: t('voice.downloadModel'), action: onOpenOffline }
  })()

  const draftTotal = (edited ?? []).reduce((sum, l) => {
    const sku = ledger.skus.find((s) => s.id === l.skuId)
    return sum + toBaseQty(sku, Number(l.qtyDisplay)) * pesos(Number(l.priceDisplay))
  }, 0)

  /*
   * The type-it surface, rendered above or below the mic hero depending on the
   * picked engine (see the swap below). Brand-tinted while typing is the job,
   * plain otherwise — the tint is how the screen says "this one is live".
   * Samples are frosted suggestion slips with a quotation mark, not flat grey
   * chips: each is a sentence to SAY, one tap fills the box and builds the
   * draft in the same motion.
   */
  const typeCard = (
    <div className="swap-mount">
      <Card material={typedMode ? 'brand' : 'plain'}>
        <SectionTitle hint={t('voice.typeHint')}>{t('voice.typeTitle')}</SectionTitle>
        <textarea
          className={`${inputClass} min-h-24 resize-none`}
          placeholder={t('voice.placeholder')}
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          rows={3}
        />
        <Button className="mt-3 w-full" onClick={() => buildDraft(draftText)} disabled={!draftText.trim()}>
          {t('voice.makeDraft')}
        </Button>
        <div className="mt-4">
          <div className="eyebrow text-fg-faint">{t('voice.samples')}</div>
          <div className="mt-2 space-y-2">
            {SAMPLE_UTTERANCES.map((sample) => (
              <button
                key={sample}
                type="button"
                className="aside flex min-h-11 w-full items-center gap-2.5 rounded-2xl border border-white/80 bg-white/70 px-3.5 py-2.5 text-left text-[0.875rem] leading-snug text-fg-subtle shadow-xs backdrop-blur-md transition hover:border-brand-500/40 hover:text-fg active:scale-[0.99]"
                onClick={() => {
                  setDraftText(sample)
                  buildDraft(sample)
                }}
              >
                <span
                  aria-hidden
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600/10 text-[0.9375rem] font-black text-brand-700"
                >
                  &ldquo;
                </span>
                <span className="min-w-0 flex-1">{sample}</span>
              </button>
            ))}
          </div>
        </div>
      </Card>
    </div>
  )

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle hint={t('voice.engineLabel')}>{t('voice.title')}</SectionTitle>
        <div className="flex flex-wrap gap-1.5 p-1.5 rounded-2xl bg-white/60 backdrop-blur-md border border-white/80 shadow-xs">
          {engines.map((e) => (
            <Chip key={e.id} active={engineId === e.id} onClick={() => setEngineId(e.id)}>
              {pick(lang, e.label)}
              {!e.available ? ` ${t('voice.engineUnavailable')}` : ''}
            </Chip>
          ))}
        </div>
        {engine ? (
          <p className="mt-3 text-[0.8125rem] leading-relaxed text-fg-subtle">
            {pick(lang, engine.note)}
          </p>
        ) : null}
      </Card>

      {!voiceAllowed ? (
        <LockedCard
          title={t('voice.title')}
          body={t('voice.lockedBody')}
          tierLabel="PRO"
          onUpgrade={onUpgrade}
        />
      ) : null}

      {/* In typed mode the draft surface leads: the mic hero drops below it.
          Both mount fresh on the switch, so the reorder arrives with animation
          rather than a jump cut. */}
      {typedMode ? typeCard : null}

      <HeroShell key={typedMode ? 'typed' : 'mic'} className={`swap-mount p-6 shadow-[0_20px_50px_-15px_rgba(8,16,50,0.55)] ${voiceAllowed ? '' : 'opacity-45'}`}>
        <div className="relative flex flex-col items-center">
          <Pat mood={voiceMood} wardrobe="ears" tone="dark" size={132} className="-mb-2" />
          <button
            type="button"
            onClick={listening ? stopListening : startListening}
            disabled={!engine?.available || !voiceAllowed}
            className={`relative flex h-24 w-24 items-center justify-center rounded-full transition active:scale-95 disabled:opacity-40 ${
              listening
                ? 'mic-ring bg-red-600 shadow-[0_0_35px_rgba(220,38,38,0.7)]'
                : 'bg-white shadow-[0_10px_30px_-5px_rgba(255,255,255,0.4)] hover:scale-105'
            }`}
            aria-label={listening ? t('voice.stopListening') : t('voice.startListening')}
          >
            <svg
              viewBox="0 0 24 24"
              className={`h-10 w-10 ${listening ? 'fill-white' : 'fill-brand-700'}`}
            >
              <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" />
            </svg>
          </button>
          {/* The waveform is the screen's proof of life: static and low while the
              mic is off, tall and animated the moment it is listening. */}
          <div
            className={`mt-5 flex h-8 items-center justify-center gap-[3px] ${
              listening ? 'wave-on' : ''
            }`}
            aria-hidden="true"
          >
            {WAVE.map((amplitude, index) => (
              <span
                key={index}
                className="w-[3px] rounded-full bg-white"
                style={{
                  height: `${amplitude * (listening ? 100 : 38)}%`,
                  animationDelay: `${(index % 7) * 95}ms`,
                }}
              />
            ))}
          </div>

          <p className="mt-4 text-center text-[0.9375rem] font-semibold text-white">
            {status === 'transcribing'
              ? t('voice.status.transcribing')
              : listening
                ? t('voice.status.listening')
                : t('voice.status.prompt')}
          </p>
          {voiceModel.installed ? (
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <span className="rounded-full bg-white/15 px-3 py-1.5 text-[0.8125rem] font-semibold text-white backdrop-blur-sm">
                {t('voice.offlineWorks')}
              </span>
              <span className="num text-[0.8125rem] font-semibold text-white/90">
                {voiceModel.megabytes}MB
              </span>
            </div>
          ) : null}
          {transcript ? (
            /*
             * What the owner said is a QUOTATION, so it is set as one: the app's
             * second voice (weight 500 against the 800 of every figure), in white
             * on the dark card, inside real quotation marks. It is the only thing
             * on this screen that came out of a person rather than out of a
             * calculation, and the type has to say so.
             */
            <p className="aside mt-4 text-center text-[1.0625rem] leading-snug text-white">
              &ldquo;{transcript}&rdquo;
            </p>
          ) : null}
          {error ? (
            <p className="mt-3 text-center text-[0.875rem] leading-relaxed text-red-100">{error}</p>
          ) : null}
          {offlineRoute ? (
            /* A white pill on the dark card: it is an action, and on this surface
               a light control is the one that reads as pressable. */
            <button
              type="button"
              onClick={offlineRoute.action}
              className="btn btn-quiet mt-4"
            >
              {offlineRoute.label}
            </button>
          ) : null}
        </div>
      </HeroShell>


      {!voiceModel.installed ? (
        /* Dashed rather than solid: this card is an invitation to set something
           up, and a dashed edge says "not yet" without a single word. */
        <Card className="border-y border-dashed border-line-strong">
          <SectionTitle hint={t('offline.onceHint')}>{t('voice.offlineTitle')}</SectionTitle>
          <p className="text-[0.8125rem] leading-relaxed text-fg-subtle">
            {/* Weights plus runtime, computed from the catalogue so the figure
                quoted here cannot drift from the one the Offline screen shows. */}
            {t('voice.offlineIntro', { mb: WHISPER_MODEL.approxMB + RUNTIME_APPROX_MB })}
          </p>
          <Button variant="ghost" className="mt-3 w-full" onClick={onOpenOffline}>
            {t('voice.downloadModel')}
          </Button>
        </Card>
      ) : null}

      {typedMode ? null : typeCard}

      {edited && edited.length > 0 ? (
        <Card flat className="border-brand-500/40 bg-gradient-to-br from-brand-50/90 to-white/90 backdrop-blur-md shadow-e2">
          {/*
           * Wraps, and the stamp may take its own line: at 280px in the largest
           * reading size the title and a stamp cannot share a row, and a stamp
           * squeezed narrow reads as a smudge rather than as a label.
           */}
          <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
            <h2 className="headline min-w-0 text-[1.0625rem] leading-snug text-fg">
              {t('voice.draftTitle')}
            </h2>
            <span className="stamp text-amber-700">{t('voice.draftUnposted')}</span>
          </div>
          <p className="mb-3.5 text-[0.8125rem] leading-relaxed text-fg-subtle">
            {t('voice.confirmIntro')}
          </p>

          <div className="space-y-3.5">
            {edited.map((line) => {
              const sku = ledger.skus.find((s) => s.id === line.skuId)
              return (
                <div
                  key={line.key}
                  className="rounded-2xl border border-brand-200/80 bg-white/80 backdrop-blur-md p-4 shadow-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 flex-1 text-base leading-snug font-medium text-fg">
                      {line.skuName}
                    </span>
                    <CustomSelect
                      value={line.skuId}
                      size="sm"
                      mt={false}
                      className="w-44 shrink-0"
                      onChange={(val) =>
                        setEdited((current) =>
                          (current ?? []).map((l) =>
                            l.key === line.key
                              ? {
                                  ...l,
                                  skuId: val,
                                  skuName:
                                    ledger.skus.find((s) => s.id === val)?.name ??
                                    l.skuName,
                                }
                              : l,
                          ),
                        )
                      }
                      options={ledger.skus.map((s) => ({ value: s.id, label: s.name }))}
                    />
                  </div>
                  {/* `fit-grid-2`: on a small phone the quantity and price stack,
                      so the two numbers being confirmed stay legible and easy to
                      tap rather than becoming 68px boxes. */}
                  <div className="fit-grid-2 mt-3 grid grid-cols-2 gap-3.5">
                    <Field
                      label={t('record.field.qty')}
                      hint={sku?.baseUnit === 'g' ? t('voice.hintPerKilo') : sku?.unit}
                    >
                      <input
                        className={`${inputClass} ring-1 ring-brand-600/40`}
                        type="number"
                        inputMode="decimal"
                        step="any"
                        value={line.qtyDisplay}
                        onChange={(e) =>
                          setEdited((current) =>
                            (current ?? []).map((l) =>
                              l.key === line.key ? { ...l, qtyDisplay: e.target.value } : l,
                            ),
                          )
                        }
                      />
                    </Field>
                    <Field label={t('record.field.unitPrice')}>
                      <input
                        className={`${inputClass} ring-1 ring-brand-600/40`}
                        type="number"
                        inputMode="decimal"
                        step="any"
                        value={line.priceDisplay}
                        onChange={(e) =>
                          setEdited((current) =>
                            (current ?? []).map((l) =>
                              l.key === line.key ? { ...l, priceDisplay: e.target.value } : l,
                            ),
                          )
                        }
                      />
                    </Field>
                  </div>
                </div>
              )
            })}
          </div>

          {draftKind === 'credit_sale' ? (
            <div className="mt-3">
              <Field label={t('voice.field.customerUtang')}>
                <CustomSelect
                  value={draftCustomer ?? ''}
                  onChange={(val) => setDraftCustomer(val || undefined)}
                  placeholder={t('record.walkIn')}
                  options={ledger.customers.map((c) => ({ value: c.id, label: c.name }))}
                />
              </Field>
            </div>
          ) : null}

          <div className="rule-set mt-4" aria-hidden />
          {/*
           * The total closes the draft. `money-cell` sizes the figure against
           * this row rather than the viewport, and the row WRAPS: the label is
           * short in English and longer in Tagalog, while the figure beside it is
           * `nowrap` — so without wrapping, a long label would squeeze a peso
           * amount that is not allowed to break.
           */}
          <div className="money-cell mt-3.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="eyebrow text-fg-subtle">{t('voice.total')}</span>
            <span className="figure-lg num leading-none text-fg">{formatPHP(draftTotal)}</span>
          </div>

          {/* Stacked, always: two side-by-side buttons at 280px leave the words
              "Confirm and record" no room, and this is the button that saves the
              money. */}
          <div className="mt-3.5 flex flex-col gap-2.5">
            <Button variant="ghost" className="min-h-12 flex-1" onClick={() => setEdited(null)}>
              {t('voice.cancel')}
            </Button>
            <Button className="min-h-12 flex-1" onClick={confirm}>
              {t('voice.confirmAndRecord')}
            </Button>
          </div>
        </Card>
      ) : null}

      {posted ? (
        <Card flat className="border-emerald-200 bg-emerald-50">
          <p className="text-base leading-relaxed text-emerald-700">{posted}</p>
        </Card>
      ) : null}
    </div>
  )
}
