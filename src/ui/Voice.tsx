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
  Sheet,
  inputClass,
} from './components.tsx'
import { useToast } from './Toast.tsx'
import { Pat, moodForVoice } from './Pat.tsx'
import { SAMPLE_UTTERANCES, getEngines } from '../asr.ts'
import type { AsrErrorCode, AsrStatus } from '../asr.ts'
import { OFFLINE_ENGINE_ID, RUNTIME_APPROX_MB, WHISPER_MODEL, useVoiceModel } from '../asr-offline.ts'
import {
  formatPHP,
  parseSpoken,
  pesos,
  pricePerBaseUnit,
  pricePerDisplayUnit,
} from '../engine/index.ts'
import type { Sku, Transaction } from '../engine/index.ts'
import { newTxnId } from '../store.ts'
import type { Negosyo } from '../store.ts'
import type { Billing } from '../billing.ts'
import { pick, useLang, useT } from '../i18n/index.ts'
import type { UIStr } from '../i18n/index.ts'

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

type DraftKindLocal = 'cash_sale' | 'credit_sale' | 'purchase' | 'expense'

/**
 * The kinds a spoken sentence can become, in the order an owner thinks of them.
 *
 * The order is deliberate: the two things that happen all day lead, the two that
 * happen occasionally follow. Labels come from `record.mode.*`, so the words on
 * this sheet are the words on the Ledger.
 */
const DRAFT_KINDS: { id: DraftKindLocal; labelKey: UIStr }[] = [
  { id: 'cash_sale', labelKey: 'record.mode.cash_sale' },
  { id: 'credit_sale', labelKey: 'record.mode.credit_sale' },
  { id: 'purchase', labelKey: 'record.mode.purchase' },
  { id: 'expense', labelKey: 'record.mode.expense' },
]

/**
 * Three lines a page.
 *
 * Three is where the sheet still fits above the confirm button on a 640px-tall
 * phone without scrolling — and a confirmation the owner has to scroll is a
 * confirmation that gets skimmed, which is the one thing this step cannot be.
 */
const DRAFT_PAGE = 3

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
  const [draftKind, setDraftKind] = useState<DraftKindLocal>('cash_sale')
  const [draftCustomer, setDraftCustomer] = useState<string | undefined>(undefined)
  const [posted, setPosted] = useState('')
  /** Words the parser could not place — the only sign part of a sentence was lost. */
  const [draftUnresolved, setDraftUnresolved] = useState<string[]>([])
  /** The amount for a spoken expense, which has no items at all. */
  const [draftAmount, setDraftAmount] = useState('')
  const [page, setPage] = useState(0)
  const engineRef = useRef<ReturnType<typeof getEngines>[number] | null>(null)
  /*
   * What the current session produced, held in a ref rather than in state on
   * purpose: the engine's end callback can fire in the same tick as its error
   * callback, and reading `error`/`transcript` state there would see the values
   * from *before* the update. The ref is what the session actually did.
   */
  const sessionRef = useRef<{ final: string; partial: string; failed: boolean; settled: boolean }>({
    final: '',
    partial: '',
    failed: false,
    settled: false,
  })

  /*
   * Shop words the recognizer should listen for, rebuilt when the ledger's
   * items change. Chrome biases recognition toward these (and picks the
   * hypothesis that hears them); every other browser ignores the hint. Names
   * and aliases both count, because the owner says what is on the shelf.
   */
  const speechHints = useMemo(
    () => ({ phrases: ledger.skus.flatMap((sku) => [sku.name, ...sku.aliases]) }),
    [ledger.skus],
  )

  const engine = engines.find((e) => e.id === engineId)
  // Data-driven rather than hardcoded: voice happens to be free today because
  // the browser does the recognizing at no cost to us. If that ever changes,
  // the gate changes in billing.ts and this screen follows automatically.
  const voiceAllowed = billing.can('voice_capture')

  // Typed mode lifts the type card above the mic hero: when typing is the job,
  // the keyboard surface leads and the mic waits below. The screen stays where
  // it is — no auto-scroll — so the swap itself is what the owner sees.
  const typedMode = engineId === 'typed'

  /*
   * A take is never the whole list. Both engines end a take early — the
   * browser recognizer stops at the first pause (`continuous = false` in
   * asr.ts), the offline mic stops 1.8s after speech ends (audio.ts) — so a
   * long list arrives as several short takes. Appending keeps every take's
   * items: tap the mic again and the new lines join the draft. Replacing is
   * only for typed text, where the box already holds the whole sentence.
   */
  function buildDraft(text: string, append = false) {
    const draft = parseSpoken(text, ledger, lang)
    setDraftKind(draft.kind)
    // A take that names nobody must not evict the customer an earlier take
    // named: "…si Nena" followed by "…at tatlong coke" is still Nena's utang.
    if (draft.customerId !== undefined || !append) setDraftCustomer(draft.customerId)
    // A spoken expense is an amount, not a basket: "nagbayad ako ng kuryente 500"
    // has no line to edit, so its figure is kept separately from the line total.
    if (draft.amountCentavos || !append) {
      setDraftAmount(draft.amountCentavos ? String(draft.amountCentavos / 100) : '')
    }
    const fresh = draft.lines.map((line, index) => {
      const sku = ledger.skus.find((s) => s.id === line.skuId)
      return {
        // Unique per take, not per position: two takes both starting at
        // index 0 with the same item would otherwise share a React key and
        // the second line would never render.
        key: `${Date.now()}-${index}-${line.skuId}`,
        skuId: line.skuId,
        skuName: line.skuName,
        qtyDisplay: String(fromBaseQty(sku, line.qty)),
        // Back into the unit the owner prices in: a line stores the price of
        // one base unit, and asking about rice in grams is asking the wrong
        // question (see pricePerDisplayUnit).
        priceDisplay: String(pricePerDisplayUnit(sku?.baseUnit ?? 'pc', line.unitPriceCentavos) / 100),
      }
    })
    if (append && edited && edited.length > 0 && fresh.length > 0) {
      const merged = [...edited, ...fresh]
      setEdited(merged)
      // Land on the last page, where the just-added lines are: opening on
      // page 1 would hide the very items the owner just said.
      setPage(Math.max(0, Math.ceil(merged.length / DRAFT_PAGE) - 1))
      setDraftUnresolved((current) => [...current, ...(draft.unresolved ?? [])])
    } else {
      // Every new draft opens on its first page: the owner is looking at a fresh
      // sentence, and leaving the pager on page 3 would hide its first items.
      setPage(0)
      setEdited(fresh)
      setDraftUnresolved(draft.unresolved ?? [])
    }
    setPosted('')
    setError(draft.lines.length === 0 && (!append || (edited?.length ?? 0) === 0) ? t('voice.error.noItems') : '')
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
    sessionRef.current = { final: '', partial: '', failed: false, settled: false }
    const instance = getEngines().find((e) => e.id === engineId)
    engineRef.current = instance ?? null
    const hints = speechHints
    instance?.start(
      (result) => {
        setTranscript(result.transcript)
        if (result.final) {
          // Stashed, not shown: the words join the box once, in onEnd below.
          // Writing them here too would put every take in twice.
          const session = sessionRef.current
          session.final = session.final ? `${session.final} ${result.transcript}` : result.transcript
          setListening(false)
          setStatus(null)
        } else {
          sessionRef.current.partial = result.transcript
        }
      },
      (message, code) => {
        sessionRef.current.failed = true
        sessionRef.current.settled = true
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
        const session = sessionRef.current
        // One take, one delivery: stopping now finalizes through this callback,
        // so a second arrival must not append the words twice.
        if (session.settled) return
        session.settled = true
        setListening(false)
        setStatus(null)
        if (session.final) {
          // The take's words join whatever is already in the box: a second
          // take continues the list instead of erasing the first take.
          setDraftText((current) => (current ? `${current} ${session.final}` : session.final))
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
          buildDraft(session.final, true)
          return
        }
        /*
         * The take ended mid-sentence — the 25-second cap cut a long sale, or
         * the owner tapped stop while Google still held the words as interim.
         * Those words are still what was said, so they are kept in the box for
         * finishing by hand or by another tap, exactly as the Ask screen treats
         * a stopped take. Reporting "nothing heard" over visible words taught
         * owners the mic was broken; losing the words made it true. Still not
         * parsed, for the reason above: half a sentence must never become
         * quantities on its own.
         */
        if (session.partial.trim().length > 0 && !session.failed) {
          setDraftText((current) => (current ? `${current} ${session.partial}` : session.partial))
          return
        }
        // Nothing usable came back. If the engine already explained why, that
        // message stands; if it just died, say so plainly.
        if (!session.failed) setError(t('voice.error.nothingHeard'))
      },
      hints,
    )
  }

  function stopListening() {
    const id = engine?.id
    // A take that already landed has nothing left to stop — raising a
    // "transcribing" state now would stick, because onEnd already ran.
    if (sessionRef.current.settled) return
    engineRef.current?.stop()
    engineRef.current = null
    setListening(false)
    // Stopping asks the engine for its final words, which land in onEnd:
    // a finished take is parsed into a draft, a partial one joins the box
    // for hand-finishing. The screen stays on "transcribing" until then —
    // for the internet engine that is a blink, for the offline engine it is
    // seconds. Nothing is appended here: appending now and in onEnd would put
    // every take in twice. The typed engine never opens a session, so the old
    // path stands for it.
    if (id === OFFLINE_ENGINE_ID || id === 'web-speech') {
      setStatus('transcribing')
      return
    }
    setStatus(null)
    // Stopped mid-sentence, so these words are unfinished — they join the box
    // for hand-finishing or for the next take to continue from.
    if (transcript) setDraftText((current) => (current ? `${current} ${transcript}` : transcript))
  }

  function cancelDraft() {
    setEdited(null)
    setPage(0)
    setDraftUnresolved([])
    // The box is the draft's memory: leaving last time's words in it would
    // merge them into the next take's lines.
    setDraftText('')
    setDraftAmount('')
  }

  function confirm() {
    const at = new Date().toISOString()

    /*
     * An expense is its own record, and until this branch existed a sentence the
     * engine classified as a gastos was posted as a cash SALE — revenue that
     * never happened and cash that never came in. It was the worst bug on this
     * screen, and it is fixed here rather than in the engine because the engine
     * was already right.
     */
    if (draftKind === 'expense') {
      const value = pesos(Number(draftAmount))
      if (value <= 0) {
        setError(t('record.flash.needAmount'))
        return
      }
      const txn: Transaction = {
        id: newTxnId('exp'),
        at,
        kind: 'expense',
        amountCentavos: value,
        paid: 'cash',
        note: draftText,
        source: 'voice',
      }
      add(txn)
      const msg = t('record.flash.expense', { amount: formatPHP(value) })
      setPosted(msg)
      setError('')
      toast.show({
        title: msg,
        tone: 'success',
        undoLabel,
        onUndo: () => {
          removeTransaction(txn.id)
          toast.show({ title: t('record.deleteUndone'), tone: 'info' })
        },
      })
      cancelDraft()
      setTranscript('')
      return
    }

    if (!edited || edited.length === 0) return
    // Human-in-the-loop guard: a manually added line starts empty, and an
    // empty qty/price must block — never post a zero-qty or NaN line.
    const bad = edited.some(
      (l) => !l.skuId || !(Number(l.qtyDisplay) > 0) || !(Number(l.priceDisplay) > 0),
    )
    if (bad) return
    const lines = edited.map((l) => {
      const sku = ledger.skus.find((s) => s.id === l.skuId)
      return {
        skuId: l.skuId,
        qty: toBaseQty(sku, Number(l.qtyDisplay)),
        unitPriceCentavos: pricePerBaseUnit(sku?.baseUnit ?? 'pc', pesos(Number(l.priceDisplay))),
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
    // Same as cancelling: the next take must start from silence, not from
    // the words that were just recorded.
    setDraftText('')
    setDraftAmount('')
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

  /*
   * The words the parser could not place — minus any that are already sitting
   * in a line above it.
   *
   * The engine reports every word that matched no item and no number, and it
   * reports them even when the sentence was understood: "limang Lucky Me" lists
   * "lucky, me" as unresolved while the sheet shows a correct Lucky Me line. A
   * warning that fires on a correct parse is worse than no warning, because the
   * owner learns to skip the line that is supposed to catch a real mishearing.
   */
  const unplaced = draftUnresolved.filter(
    (word) => !(edited ?? []).some((line) => line.skuName.toLowerCase().includes(word.toLowerCase())),
  )

  const draftTotal = (edited ?? []).reduce((sum, l) => {
    const sku = ledger.skus.find((s) => s.id === l.skuId)
    return (
      sum +
      toBaseQty(sku, Number(l.qtyDisplay)) *
        pricePerBaseUnit(sku?.baseUnit ?? 'pc', pesos(Number(l.priceDisplay)))
    )
  }, 0)

  // Paging is clamped rather than asserted: removing a line while the owner is
  // on the last page would otherwise leave `page` past the end and render an
  // empty table with a pager that cannot go back.
  const lineCount = edited?.length ?? 0
  const pageCount = Math.max(1, Math.ceil(lineCount / DRAFT_PAGE))
  const safePage = Math.min(page, pageCount - 1)
  const pageLines = (edited ?? []).slice(safePage * DRAFT_PAGE, safePage * DRAFT_PAGE + DRAFT_PAGE)
  const rangeStart = safePage * DRAFT_PAGE + 1
  const rangeEnd = Math.min(lineCount, (safePage + 1) * DRAFT_PAGE)
  const hasDraft = edited !== null
  // An expense draft has an amount and no lines, so the sheet shows one field.
  const expenseMode = draftKind === 'expense'
  const voiceInvalid = (edited ?? []).some(
    (l) => !l.skuId || !(Number(l.qtyDisplay) > 0) || !(Number(l.priceDisplay) > 0),
  )

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
        {/* No hint here. "Listening with" was a label without a value at the
            right edge of the card — clipped on a narrow phone, and the chips
            directly below already answer it. */}
        <SectionTitle>{t('voice.title')}</SectionTitle>
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

      {/*
       * The draft arrives as a SHEET, not as a card in the page.
       *
       * This is the one moment the app asks the owner to check its work, and an
       * inline card fails that job in three ways: it is below the mic hero on a
       * long screen, so it can be missed entirely; it pushes the page around as
       * it appears; and it reads as more of the same screen rather than as a step
       * that is waiting on an answer. A sheet comes up over everything at the
       * bottom, where the thumb already is.
       */}
      {hasDraft ? (
        <Sheet
          title={t('voice.draftSheetTitle')}
          hint={t('voice.draftSheetHint')}
          closeLabel={t('voice.cancel')}
          onClose={cancelDraft}
        >
          {/*
           * What kind of record this is.
           *
           * The engine reads the sentence and guesses, but a guess is not a
           * decision: "umutang" misheard as a sale puts money in cash that never
           * came in, and a gastos misheard as a sale invents revenue. So the
           * owner gets the last word, before anything is saved.
           */}
          <div>
            <div className="eyebrow text-fg-subtle">{t('voice.fieldKind')}</div>
            <div
              role="group"
              aria-label={t('voice.fieldKind')}
              className="mt-2 flex flex-wrap gap-1.5"
            >
              {DRAFT_KINDS.map((kind) => (
                <Chip
                  key={kind.id}
                  active={draftKind === kind.id}
                  onClick={() => setDraftKind(kind.id)}
                >
                  {kind.id === 'credit_sale' ? t('voice.kindUtang') : t(kind.labelKey)}
                </Chip>
              ))}
            </div>
          </div>

          <p className="mt-3 text-[0.8125rem] leading-relaxed text-fg-subtle">
            {t('voice.confirmIntro')}
          </p>
          {(edited?.length ?? 0) > 0 ? (
            <p className="mt-2 rounded-xl border border-brand-500/25 bg-brand-50/70 px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-brand-800">
              {t('voice.appendHint')}
            </p>
          ) : null}

          {/* A word the parser could not place is the only sign that part of the
              sentence was lost — so it is shown before the numbers, not after. */}
          {unplaced.length > 0 ? (
            <p className="mt-2.5 rounded-xl border border-amber-300/70 bg-amber-50 px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-amber-800">
              {t('voice.unresolved', { what: unplaced.join(', ') })}
            </p>
          ) : null}

          {expenseMode ? (
            <div className="mt-3.5">
              <Field label={t('record.field.amount')}>
                <input
                  className={`${inputClass} ring-1 ring-brand-600/40`}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={draftAmount}
                  onChange={(e) => setDraftAmount(e.target.value)}
                />
              </Field>
            </div>
          ) : lineCount === 0 ? (
            <p className="mt-3.5 rounded-xl border border-dashed border-line-strong px-3.5 py-3 text-[0.875rem] leading-relaxed text-fg-subtle">
              {t('voice.noLines')}
            </p>
          ) : (
          <div className="mt-3.5 space-y-3.5">
            {pageLines.map((line) => {
              const sku = ledger.skus.find((s) => s.id === line.skuId)
              return (
                <div
                  key={line.key}
                  className="rounded-2xl border border-brand-200/80 bg-white/80 backdrop-blur-md p-4 shadow-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 flex-1 text-base leading-snug font-medium text-fg">
                      {line.skuName || t('receipt.newItem')}
                    </span>
                    <button
                      type="button"
                      className="inline-flex min-h-11 items-center px-2 text-[0.8125rem] font-bold text-red-700"
                      onClick={() =>
                        setEdited((current) => (current ?? []).filter((l) => l.key !== line.key))
                      }
                      aria-label={t('voice.removeLine')}
                    >
                      ×
                    </button>
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
                    <Field
                      label={
                        sku?.baseUnit === 'g'
                          ? t('record.field.pricePerKilo')
                          : t('record.field.unitPrice')
                      }
                    >
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

            {/* The pager only exists when there is something to page through: a
                control that never has a second page is a control the owner has to
                learn for nothing. */}
            {lineCount > DRAFT_PAGE ? (
              <div className="flex items-center justify-between gap-2 rounded-2xl border border-line bg-sunken px-2.5 py-2">
                <Button
                  variant="ghost"
                  className="min-h-10 px-3.5 text-[0.8125rem]"
                  disabled={safePage === 0}
                  onClick={() => setPage(Math.max(0, safePage - 1))}
                >
                  {t('voice.pagePrev')}
                </Button>
                <span className="num text-[0.8125rem] font-bold text-fg-subtle">
                  {t('voice.page', { n: `${rangeStart}–${rangeEnd}`, total: lineCount })}
                </span>
                <Button
                  variant="ghost"
                  className="min-h-10 px-3.5 text-[0.8125rem]"
                  disabled={safePage >= pageCount - 1}
                  onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
                >
                  {t('voice.pageNext')}
                </Button>
              </div>
            ) : null}
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => {
                const key = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
                setEdited((current) => [
                  ...(current ?? []),
                  { key, skuId: '', skuName: '', qtyDisplay: '1', priceDisplay: '' },
                ])
                setPage(Math.max(0, Math.ceil(((edited?.length ?? 0) + 1) / DRAFT_PAGE) - 1))
              }}
            >
              {t('voice.addLine')}
            </Button>
            {voiceInvalid ? (
              <p className="text-[0.875rem] font-semibold text-red-700">{t('voice.needAll')}</p>
            ) : null}
          </div>
          )}

          {draftKind === 'credit_sale' ? (
            <div className="mt-3.5">
              <Field label={t('voice.field.customerUtang')}>
                <CustomSelect
                  value={draftCustomer ?? ''}
                  onChange={(val) => setDraftCustomer(val || undefined)}
                  /* Walk-in is an explicit choice rather than the silent default:
                     utang with no name cannot be collected, so it has to be
                     something the owner picked, not something that happened —
                     which is why the field opens empty and Walk-in is one of the
                     options rather than the placeholder. */
                  placeholder={t('record.select')}
                  options={[
                    ...ledger.customers.map((c) => ({ value: c.id, label: c.name })),
                    { value: 'walk_in', label: t('utang.walkInName') },
                  ]}
                />
              </Field>
              {draftCustomer ? null : (
                <p className="mt-2 text-[0.8125rem] leading-relaxed text-fg-subtle">
                  {t('voice.utangNeedsName')}
                </p>
              )}
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
            <Button variant="ghost" className="min-h-12 flex-1" onClick={cancelDraft}>
              {t('voice.cancel')}
            </Button>
            <Button
              className="min-h-12 flex-1"
              disabled={!expenseMode && (lineCount === 0 || voiceInvalid)}
              onClick={confirm}
            >
              {t('voice.confirmAndRecord')}
            </Button>
          </div>
        </Sheet>
      ) : null}

      {posted ? (
        <Card flat className="border-emerald-200 bg-emerald-50">
          <p className="text-base leading-relaxed text-emerald-700">{posted}</p>
        </Card>
      ) : null}
    </div>
  )
}
