import { useMemo, useRef, useState } from 'react'
import {
  Button,
  Card,
  Chip,
  Field,
  HeroShell,
  LockedCard,
  Pill,
  SectionTitle,
  inputClass,
} from './components.tsx'
import { Pat, moodForVoice } from './Pat.tsx'
import { SAMPLE_UTTERANCES, getEngines } from '../asr.ts'
import type { AsrErrorCode, AsrStatus } from '../asr.ts'
import { OFFLINE_ENGINE_ID, useVoiceModel } from '../asr-offline.ts'
import { formatPHP, parseSpoken, pesos } from '../engine/index.ts'
import type { Sku } from '../engine/index.ts'
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
  const { ledger, add } = negosyo
  const lang = useLang()
  const t = useT()
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
      add({
        id: newTxnId('utang'),
        at,
        kind: 'credit_sale',
        lines,
        customerId: draftCustomer ?? 'walk_in',
        note: draftText,
        source: 'voice',
      })
      setPosted(t('voice.posted.utang', { amount: formatPHP(total) }))
    } else if (draftKind === 'purchase') {
      add({
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
      })
      setPosted(t('voice.posted.purchase', { amount: formatPHP(total) }))
    } else {
      add({
        id: newTxnId('sal'),
        at,
        kind: 'cash_sale',
        lines,
        note: draftText,
        source: 'voice',
      })
      setPosted(t('voice.posted.sale', { amount: formatPHP(total) }))
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

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle hint={t('voice.engineLabel')}>{t('voice.title')}</SectionTitle>
        <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {engines.map((e) => (
            <Chip key={e.id} active={engineId === e.id} onClick={() => setEngineId(e.id)}>
              {pick(lang, e.label)}
              {!e.available ? ` ${t('voice.engineUnavailable')}` : ''}
            </Chip>
          ))}
        </div>
        {engine ? (
          <p className="mt-2 text-[0.7rem] text-fg-subtle">{pick(lang, engine.note)}</p>
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

      {/* The mic lives on the jewel surface: a white button on emerald reads as
          the primary action from across the room. */}
      <HeroShell className={voiceAllowed ? '' : 'opacity-45'}>
        <div className="pointer-events-none absolute -right-14 -top-20 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-col items-center">
          <Pat mood={voiceMood} wardrobe="ears" tone="dark" size={132} className="-mb-2" />
          <button
            type="button"
            onClick={listening ? stopListening : startListening}
            disabled={!engine?.available || !voiceAllowed}
            className={`relative flex h-24 w-24 items-center justify-center rounded-full transition active:scale-95 disabled:opacity-40 ${
              // red-600, not red-500: the white mic glyph needs 4.5:1, and flag
              // red at full strength is the first step that gives it.
              listening ? 'mic-ring bg-red-600' : 'bg-white'
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

          <p className="mt-4 text-center text-[0.78rem] font-semibold text-white">
            {status === 'transcribing'
              ? t('voice.status.transcribing')
              : listening
                ? t('voice.status.listening')
                : t('voice.status.prompt')}
          </p>
          {voiceModel.installed ? (
            <div className="mt-3 flex items-center gap-2">
              <span className="rounded-full bg-white/15 px-2.5 py-1 text-[0.66rem] font-semibold text-white backdrop-blur-sm">
                {t('voice.offlineWorks')}
              </span>
              <span className="num text-[0.66rem] font-semibold text-white/90">
                {voiceModel.megabytes}MB
              </span>
            </div>
          ) : null}
          {transcript ? (
            <p className="mt-3.5 text-center text-sm font-medium text-white">
              &ldquo;{transcript}&rdquo;
            </p>
          ) : null}
          {error ? (
            <p className="mt-3 text-center text-[0.72rem] leading-relaxed text-red-100">{error}</p>
          ) : null}
          {offlineRoute ? (
            <button
              type="button"
              onClick={offlineRoute.action}
              className="mt-3 rounded-full bg-white px-4 py-2 text-[0.72rem] font-semibold text-brand-700 transition active:scale-95"
            >
              {offlineRoute.label}
            </button>
          ) : null}
        </div>
      </HeroShell>


      {!voiceModel.installed ? (
        <Card className="border-dashed">
          <SectionTitle hint={t('offline.onceHint')}>{t('voice.offlineTitle')}</SectionTitle>
          <p className="text-[0.7rem] leading-relaxed text-fg-subtle">
            {t('voice.offlineIntro')}
          </p>
          <Button variant="ghost" className="mt-3 w-full" onClick={onOpenOffline}>
            {t('voice.downloadModel')}
          </Button>
        </Card>
      ) : null}

      <Card>
        <SectionTitle hint={t('voice.typeHint')}>{t('voice.typeTitle')}</SectionTitle>
        <textarea
          className={`${inputClass} min-h-20 resize-none`}
          placeholder={t('voice.placeholder')}
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
        />
        <Button className="mt-3 w-full" onClick={() => buildDraft(draftText)} disabled={!draftText.trim()}>
          {t('voice.makeDraft')}
        </Button>
        <div className="mt-3 flex flex-wrap gap-2">
          {SAMPLE_UTTERANCES.map((sample) => (
            <button
              key={sample}
              type="button"
              className="rounded-full border border-line bg-card px-2.5 py-1 text-[0.68rem] text-fg-subtle"
              onClick={() => {
                setDraftText(sample)
                buildDraft(sample)
              }}
            >
              {sample.length > 38 ? `${sample.slice(0, 38)}…` : sample}
            </button>
          ))}
        </div>
      </Card>

      {edited && edited.length > 0 ? (
        <Card flat className="border-brand-600/40 bg-brand-50">
          <div className="flex items-center justify-between">
            <SectionTitle>{t('voice.draftTitle')}</SectionTitle>
            <Pill tone="warn">{t('voice.draftUnposted')}</Pill>
          </div>
          <p className="mb-3 text-[0.7rem] text-fg-subtle">
            {t('voice.confirmIntro')}
          </p>

          <div className="space-y-3">
            {edited.map((line) => {
              const sku = ledger.skus.find((s) => s.id === line.skuId)
              return (
                <div
                  key={line.key}
                  className="rounded-2xl border border-brand-300 bg-sunken p-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-fg">{line.skuName}</span>
                    <select
                      className="rounded-xl border border-line bg-line px-2 py-1 text-[0.7rem] text-fg-muted"
                      value={line.skuId}
                      onChange={(e) =>
                        setEdited((current) =>
                          (current ?? []).map((l) =>
                            l.key === line.key
                              ? {
                                  ...l,
                                  skuId: e.target.value,
                                  skuName:
                                    ledger.skus.find((s) => s.id === e.target.value)?.name ??
                                    l.skuName,
                                }
                              : l,
                          ),
                        )
                      }
                    >
                      {ledger.skus.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-3">
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
                <select
                  className={inputClass}
                  value={draftCustomer ?? ''}
                  onChange={(e) => setDraftCustomer(e.target.value || undefined)}
                >
                  <option value="">{t('record.walkIn')}</option>
                  {ledger.customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          ) : null}

          <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
            <span className="text-sm text-fg-muted">{t('voice.total')}</span>
            <span className="text-lg font-semibold tabular-nums text-fg">
              {formatPHP(draftTotal)}
            </span>
          </div>

          <div className="mt-3 flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setEdited(null)}>
              {t('voice.cancel')}
            </Button>
            <Button className="flex-1" onClick={confirm}>
              {t('voice.confirmAndRecord')}
            </Button>
          </div>
        </Card>
      ) : null}

      {posted ? (
        <Card flat className="border-emerald-200 bg-emerald-50">
          <p className="text-sm text-emerald-700">{posted}</p>
        </Card>
      ) : null}
    </div>
  )
}
