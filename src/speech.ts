/**
 * SeePat's voice — the other direction.
 *
 * The app has always been able to *hear* (see `asr.ts`); this file is the half
 * that *speaks*. It is the same trade as the recognizer: the phone does the
 * talking, so it costs SeePat nothing per answer and works with no signal. That
 * is why speaking is a FREE feature in `billing.ts` while LLM narration is not.
 *
 * Three things here are load-bearing and worth stating before the code:
 *
 *  1. **What gets read is prepared, not read raw.** An answer is typeset for the
 *     eye: `₱4,183.65`, `·` bullets, em-dashes. A speech engine reads those
 *     literally, and "peso sign four comma one eight three point six five" is
 *     not an answer. `speakableText` turns the typeset line into the spoken one
 *     — and because it is pure, what the voice says is asserted in tests rather
 *     than trusted to a demo.
 *
 *  2. **Long text is chunked.** Chrome silently stops speaking a long single
 *     utterance, and an answer card is routinely 400+ characters. Chunking at
 *     sentence boundaries keeps the whole answer audible and makes `stop()`
 *     instant.
 *
 *  3. **Silence is reported, never hidden.** A phone with no Tagalog voice is a
 *     real case. We do not fail: `chooseVoice` falls back across languages and
 *     reports whether the voice actually speaks the asked language, so the UI can
 *     say so instead of quietly reading Tagalog in an English accent.
 */

import { pick } from './i18n/index.ts'
import type { Bilingual, Lang } from './i18n/index.ts'

/** The locale we ask the platform for. Mirrors `SPOKEN_LOCALE` on the ASR side. */
export function localeFor(lang: Lang): string {
  return lang === 'fil' ? 'fil-PH' : 'en-PH'
}

/** The subset of a platform voice this module needs — so it is testable. */
export interface VoiceLike {
  name: string
  lang: string
  default?: boolean
}

/*
 * The two-letter subtags that actually mean the asked language.
 *
 * `tl` is included because platforms disagree about which is the ISO code for
 * Tagalog — Android ships voices tagged `fil-PH`, older engines tag them `tl-PH`
 * — and a voice we never look for is a voice the owner is told they do not have.
 */
const NATIVE: Record<Lang, string[]> = { fil: ['fil', 'tl'], en: ['en'] }

export interface VoiceChoice {
  voice: VoiceLike
  /**
   * False when the best available voice speaks a *different* language than the
   * one asked for. The words still come out; they just come out accented.
   */
  exact: boolean
}

/**
 * Best available voice for a language, or null when there are none at all.
 *
 * Exact locale first (`fil-PH`), then a language match (`fil`, `tl`), then the
 * cross-language fallback. A `default` voice breaks ties, because a platform that
 * marks one voice as default means it is the one it knows how to drive.
 */
export function chooseVoice(voices: readonly VoiceLike[], lang: Lang): VoiceChoice | null {
  if (voices.length === 0) return null
  const normalized = voices.map((voice) => ({ voice, code: voice.lang.toLowerCase().replace('_', '-') }))
  const locale = localeFor(lang).toLowerCase()
  const native = NATIVE[lang]
  const otherNative = NATIVE[lang === 'fil' ? 'en' : 'fil']

  // Ordered widest-last, so the first tier that matches anything is the best
  // voice on offer. The first two tiers are the asked language; everything after
  // is a cross-language fallback and is reported as inexact.
  const tiers: ((code: string) => boolean)[] = [
    (code) => code === locale,
    (code) => native.includes(code.split('-')[0]),
    (code) => code === (lang === 'fil' ? 'en-ph' : 'fil-ph'),
    (code) => otherNative.includes(code.split('-')[0]),
    () => true,
  ]

  for (let i = 0; i < tiers.length; i += 1) {
    const pool = normalized.filter((candidate) => tiers[i](candidate.code))
    if (pool.length === 0) continue
    const match = pool.find((candidate) => candidate.voice.default) ?? pool[0]
    return { voice: match.voice, exact: i < 2 }
  }
  return null
}

const CURRENCY = '\u20b1'

/**
 * Typeset text → spoken text.
 *
 * Each rule exists because the raw form reads wrong out loud:
 *  - `₱4,183.65` → "4,183 pesos and 65 centavos" (an engine reads the bare symbol
 *    as "peso sign", and a decimal point as "point six five");
 *  - a bare `₱70` → "70 pesos";
 *  - `29.7%` → "29.7 percent";
 *  - `·` and `—` → a comma, which is what they mean: a breath, not a word;
 *  - a leading bullet is punctuation for the eye, so it is dropped rather than
 *    announced.
 *
 * Money with no centavos drops the trailing clause instead of saying "and 0
 * centavos": the owner is listening for the figure, and a redundant clause is
 * noise on every single answer.
 */
export function speakableText(text: string, lang: Lang): string {
  const money = (
    amount: string,
    centavos: string | undefined,
  ): string => {
    const unit = pick(lang, CURRENCY_WORDS)
    const cents = centavos ? Number(centavos) : 0
    if (!centavos || cents === 0) return `${amount} ${unit}`
    const centsUnit = pick(lang, CENTAVO_WORDS)
    return `${amount} ${unit} ${pick(lang, AND)} ${cents} ${centsUnit}`
  }

  return (
    text
      // `₱1,234.56` — the figure keeps its thousands separators, which every
      // engine reads correctly, and loses only the symbol.
      .replace(new RegExp(`${CURRENCY}\\s?([\\d,]+)\\.(\\d{2})`, 'g'), (_m, amount: string, cents: string) =>
        money(amount, cents),
      )
      // `₱1,234` and a dangling `₱12` after a minus sign.
      .replace(new RegExp(`${CURRENCY}\\s?([\\d,]+)`, 'g'), (_m, amount: string) => money(amount, undefined))
      .replace(/(\d)\s?%/g, (_m, figure: string) => `${figure} ${pick(lang, PERCENT_WORDS)}`)
      .replace(/^\s*[·•*-]\s+/gm, '')
      // A dash between two clauses is a pause, and a comma is how a pause is
      // spelled to a text-to-speech engine.
      .replace(/\s+[—–]\s+/g, ', ')
      .replace(/\s*·\s*/g, ', ')
      .replace(/[“”"]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
  )
}

const CURRENCY_WORDS: Bilingual = { en: 'pesos', fil: 'piso' }
const CENTAVO_WORDS: Bilingual = { en: 'centavos', fil: 'sentimo' }
const PERCENT_WORDS: Bilingual = { en: 'percent', fil: 'porsiyento' }
const AND: Bilingual = { en: 'and', fil: 'at' }

/**
 * Sentence boundaries without a lookbehind regex.
 *
 * Lookbehind is a parse-time SyntaxError on older Safari, and a syntax error in
 * a module takes the whole bundle down — a whole product broken to save eight
 * lines. So this walks the string instead.
 *
 * A full stop only ends a sentence when a space or the end of the string follows
 * it, which is what keeps `₱1,234.56` in one piece.
 */
function sentences(text: string): string[] {
  const out: string[] = []
  let start = 0
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const endsHere = char === '.' || char === '!' || char === '?'
    if (!endsHere) continue
    const next = text[i + 1]
    if (next !== undefined && next !== ' ') continue
    out.push(text.slice(start, i + 1))
    start = i + 2
    i += 1
  }
  if (start < text.length) out.push(text.slice(start))
  return out.map((s) => s.trim()).filter(Boolean)
}

/**
 * Cut a run with no clause break in it.
 *
 * At a *space* near the ceiling rather than at an exact character count, so a
 * word is never sliced in half. It matters for figures: a peso amount has no
 * space inside it, which is exactly why "1,234,567 pesos" always survives whole.
 * The half-way floor stops the search for a space from producing a stub chunk
 * just to honour a word boundary.
 */
function hardSplit(text: string, max: number): string[] {
  const out: string[] = []
  let rest = text.trim()
  while (rest.length > max) {
    const space = rest.slice(0, max + 1).lastIndexOf(' ')
    const at = space >= Math.floor(max / 2) ? space : max
    out.push(rest.slice(0, at).trim())
    rest = rest.slice(at).trim()
  }
  if (rest.length > 0) out.push(rest)
  return out
}

/** Split one over-long sentence, preferring the commas inside it. */
function splitLong(sentence: string, max: number): string[] {
  const out: string[] = []
  let current = ''
  const push = (piece: string): void => {
    if (current.length > 0) out.push(current)
    current = piece
  }
  // The separator is captured, so a comma stays attached to the clause it ends
  // and a chunk never begins with a stray one.
  for (const part of sentence.split(/(,\s+)/)) {
    if (part.length === 0) continue
    if (current.length + part.length <= max) {
      current += part
      continue
    }
    if (part.length > max) {
      push('')
      for (const piece of hardSplit(part, max)) out.push(piece)
      continue
    }
    push(part)
  }
  if (current.trim().length > 0) out.push(current)
  return out.map((s) => s.trim()).filter(Boolean)
}

/** Chunks of at most `max` characters, cut at sentence ends wherever possible. */
export function chunkForSpeech(text: string, max = 180): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  if (clean.length <= max) return [clean]

  const out: string[] = []
  let current = ''
  for (const sentence of sentences(clean)) {
    const pieces = sentence.length > max ? splitLong(sentence, max) : [sentence]
    for (const piece of pieces) {
      if (current.length === 0) {
        current = piece
      } else if (current.length + 1 + piece.length <= max) {
        current = `${current} ${piece}`
      } else {
        out.push(current)
        current = piece
      }
    }
  }
  if (current.length > 0) out.push(current)
  return out
}

export interface SpeakableAnswer {
  headline: string
  detail: string[]
  actions: string[]
}

/**
 * What the voice actually says, out of everything the card shows.
 *
 * The card is a document — evidence table, bullet examples, action list — and
 * reading all of it out loud is worse than reading none of it. So: the headline
 * (which always carries the figure), then the three supporting lines, then the
 * single most important action. Suggested-example bullets are dropped, because
 * they are instructions for what to *type*, not part of the answer.
 */
export function spokenAnswer(answer: SpeakableAnswer): string {
  const supporting = answer.detail
    // An example question is shown as a bullet, and "Try these:" is the label
    // above such a list — with the bullets gone, a dangling lead-in would be read
    // as the end of the answer.
    .filter((line) => !line.startsWith('·') && !line.trimEnd().endsWith(':'))
    .slice(0, 3)
  return [answer.headline, ...supporting, answer.actions[0]]
    .map((line) => (line ?? '').trim())
    .filter((line) => line.length > 0)
    .join(' ')
}

// --- The engine --------------------------------------------------------------

export type SpeechOutcome = 'spoken' | 'cancelled' | 'unsupported' | 'empty' | 'error'

export function isSpeechSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.speechSynthesis !== 'undefined' &&
    typeof window.SpeechSynthesisUtterance !== 'undefined'
  )
}

/**
 * How long a chunk is expected to take to say.
 *
 * Roughly 110ms per character — the slow end of normal speech, and generous
 * enough that a real utterance is never cut off. It is not a timeout that stops
 * the voice; it is when we stop *waiting* for a report about it.
 */
function budgetMs(chunk: string): number {
  return Math.max(2000, chunk.length * 110)
}

/** How often the synthesizer's own state is consulted while a chunk is read. */
const CHECK_INTERVAL_MS = 600

/**
 * How long to allow for an utterance to reach the queue before concluding it
 * never will.
 *
 * Queuing is not always synchronous — the call can return before the engine has
 * picked the utterance up — so one quiet reading is not proof of anything. Two
 * poll intervals of it, and the platform is not going to speak this chunk.
 */
const QUEUE_GRACE_MS = 1500

/** How long to keep the "speaking" flag up while queued audio drains. */
const DRAIN_TIMEOUT_MS = 4000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * Wait for the platform to actually be quiet.
 *
 * The flag must not clear while the voice is still talking, and `onend` on the
 * last utterance is not enough to know that: an engine that never fires `onend`
 * (measured in the desktop preview, which reported `speaking: false` for an
 * utterance we were still waiting on) would leave the button on "stop reading"
 * forever had this not existed. `speechSynthesis` itself is the source of truth.
 */
async function drain(): Promise<void> {
  const synth = window.speechSynthesis
  const end = Date.now() + DRAIN_TIMEOUT_MS
  while (Date.now() < end && (synth.speaking || synth.pending)) {
    await delay(200)
  }
}

let speaking = false
const listeners = new Set<() => void>()

/** A `null` alternative means no voice was ever chosen: the answer was not read. */
let lastVoiceExact: boolean | null = null
const voiceListeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function emitVoice(): void {
  for (const listener of voiceListeners) listener()
}

export function isSpeaking(): boolean {
  return speaking
}

export function subscribeSpeaking(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Whether the voice that read the last answer actually spoke the asked
 * language. `false` is the honest case the UI has to mention: a phone with no
 * Tagalog voice still reads Tagalog, in an English voice.
 */
export function lastVoiceWasExact(): boolean | null {
  return lastVoiceExact
}

export function subscribeVoice(listener: () => void): () => void {
  voiceListeners.add(listener)
  return () => {
    voiceListeners.delete(listener)
  }
}

function setSpeaking(next: boolean): void {
  if (speaking === next) return
  speaking = next
  emit()
}

/** Resolves the in-flight chunk early, so `cancel()` never leaves a pending wait. */
let releaseCurrent: (() => void) | null = null

export function stopSpeaking(): void {
  if (!isSpeechSupported()) return
  releaseCurrent?.()
  releaseCurrent = null
  try {
    window.speechSynthesis.cancel()
  } catch {
    // Nothing was speaking, or the platform refused. Either way we are stopped.
  }
  setSpeaking(false)
}

/**
 * Voices arrive asynchronously in Chrome (empty list until `voiceschanged`), and
 * a first answer read with an empty list would be read by whatever the platform
 * picks — which is exactly the wrong-language case we are trying to avoid.
 */
async function voicesReady(timeoutMs = 2500): Promise<readonly VoiceLike[]> {
  const synth = window.speechSynthesis
  const immediate = synth.getVoices()
  if (immediate.length > 0) return immediate
  return new Promise((resolve) => {
    let settled = false
    const done = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      synth.removeEventListener('voiceschanged', done)
      resolve(synth.getVoices())
    }
    const timer = setTimeout(done, timeoutMs)
    synth.addEventListener('voiceschanged', done)
  })
}

/**
 * Prime the voice list inside a user tap.
 *
 * Phone browsers load voices lazily — the first read on a fresh page can find
 * an empty list and speak with the wrong voice, or nothing at all. Calling
 * this from the mic button (a real user gesture) also gives platforms that
 * gate speech behind interaction a chance to unlock before the answer arrives.
 * Fire-and-forget: every outcome, including unsupported, is normal here.
 */
export function warmSpeech(): void {
  if (!isSpeechSupported()) return
  try {
    void voicesReady().then(() => {})
  } catch {
    // Voice list is best-effort; the read path reports honestly on its own.
  }
}

function speakChunk(
  chunk: string,
  voice: VoiceLike | null,
  utterLang: string,
): Promise<{ outcome: 'ok' | 'cancelled' | 'error'; busy: boolean }> {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis
    const utterance = new window.SpeechSynthesisUtterance(chunk)
    // A Tagalog voice reads the English loanwords in these answers fine; an
    // English voice reading Tagalog is the fallback we already know about.
    // `utterLang` is always a locale something on the phone can actually
    // speak — never a bare request for a voice that is not installed, which
    // some phones answer with silence.
    utterance.lang = utterLang
    if (voice) utterance.voice = voice as SpeechSynthesisVoice
    // Slightly under normal pace. These are figures an owner is writing down or
    // checking against a notebook, and a reading is not a broadcast.
    utterance.rate = 0.98
    utterance.pitch = 1

    let settled = false
    let everBusy = false
    const finish = (outcome: 'ok' | 'cancelled' | 'error'): void => {
      if (settled) return
      settled = true
      clearInterval(poll)
      if (releaseCurrent === release) releaseCurrent = null
      resolve({ outcome, busy: everBusy })
    }
    const release = (): void => finish('cancelled')
    releaseCurrent = release

    utterance.onend = () => finish('ok')
    utterance.onerror = () => finish('error')

    /*
     * `onend` is the normal path; this poll is what makes the state honest when
     * it does not arrive.
     *
     * Two outcomes, and they are deliberately different:
     *  - the synthesizer is neither speaking nor holding anything queued, so the
     *    platform is done with speech no matter what it did or did not report —
     *    this is 'ok'; the utterance is over.
     *  - it is still speaking past its expected duration, which on a phone means
     *    a slow engine rather than a broken one. Also 'ok': the queue keeps its
     *    order, and `drain` below is what keeps the flag truthful.
     */
    const beganAt = Date.now()
    const deadline = beganAt + budgetMs(chunk)
    const poll = setInterval(() => {
      if (synth.speaking || synth.pending) {
        everBusy = true
        // Still talking past its expected length. Not an error: a slow engine is
        // still an engine, and the queue keeps its order.
        if (Date.now() >= deadline) finish('ok')
        return
      }
      // Quiet again, having been busy: the utterance is over, whatever `onend`
      // had to say about it.
      if (everBusy || Date.now() - beganAt >= QUEUE_GRACE_MS) finish('ok')
    }, CHECK_INTERVAL_MS)

    try {
      synth.speak(utterance)
    } catch {
      finish('error')
    }
  })
}

/**
 * Say one answer out loud. Cancels whatever was speaking first — two answers
 * talking over each other is the failure mode of a talk button, not a feature.
 *
 * Resolves with what happened rather than throwing, because every outcome here is
 * a normal one: no voice installed, nothing to say, or the owner changed their
 * mind mid-sentence.
 */
export async function speak(text: string, lang: Lang): Promise<SpeechOutcome> {
  if (!isSpeechSupported()) return 'unsupported'
  stopSpeaking()

  const chunks = chunkForSpeech(speakableText(text, lang))
  if (chunks.length === 0) return 'empty'

  const choice = chooseVoice(await voicesReady(), lang)
  lastVoiceExact = choice === null ? false : choice.exact
  emitVoice()
  // When the platform lists no voices at all (some phones, some standalone
  // installs), the utterance must not ask for a locale nothing can speak —
  // Filipino with no Filipino voice is silence. English is the voice every
  // phone has, so it is the fallback; the Tagalog words still come out, just
  // accented, which the UI already discloses.
  const utterLang = choice?.voice?.lang ?? (lang === 'fil' ? 'en-US' : localeFor(lang))

  setSpeaking(true)
  try {
    let read = 0
    let refused = 0
    let busy = false
    for (const chunk of chunks) {
      const result = await speakChunk(chunk, choice?.voice ?? null, utterLang)
      if (result.outcome === 'cancelled') return 'cancelled'
      // A chunk that errored is not fatal on its own: a phone that refuses one
      // utterance will often read the next, and losing the last line beats
      // losing the whole answer. Only a run where nothing at all came out is
      // reported as a failure.
      if (result.outcome === 'ok') read += 1
      else refused += 1
      busy = busy || result.busy
    }
    if (read === 0 && refused > 0) return 'error'
    // Every chunk "finished" yet the speaker never moved: nothing was heard,
    // so saying 'spoken' would be a lie the screen cannot detect. Report it
    // and the UI raises the honest notice instead of sitting in silence.
    if (!busy) return 'error'
    await drain()
    return 'spoken'
  } finally {
    releaseCurrent = null
    setSpeaking(false)
  }
}
