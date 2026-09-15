import { useCallback, useSyncExternalStore } from 'react'
import { readPersisted, writePersisted } from '../storage.ts'

/**
 * Two languages, one switch.
 *
 * English is the default because that is the language the product is pitched and
 * reviewed in, and because the app is demoed to people who do not read Tagalog.
 * Tagalog is a first-class option, not a translation of last resort: the copy in
 * `fil` is the language the product was written in, so it is generally the
 * sharper of the two.
 *
 * Design notes worth keeping:
 *
 *  - **Language is not a React context.** A tiny external store with
 *    `useSyncExternalStore` means the engine can read the current language
 *    without a provider, the setting survives a reload, and nothing re-renders
 *    that does not display copy.
 *  - **Copy is data, not code.** Engine modules carry their own bilingual tables
 *    next to the logic that uses them (they are pure and take a `lang`), while
 *    all screen copy lives in `UI` below. Both paths go through `tr`, so there is
 *    exactly one interpolation and fallback rule in the app.
 */

export type Lang = 'en' | 'fil'

export const LANGS: { id: Lang; label: string; native: string }[] = [
  { id: 'en', label: 'English', native: 'English' },
  { id: 'fil', label: 'Tagalog', native: 'Tagalog' },
]

export const DEFAULT_LANG: Lang = 'en'

const LANG_STORAGE = { key: 'seepat.lang.v1' }

export function isLang(value: unknown): value is Lang {
  return value === 'en' || value === 'fil'
}

/** `{name}` placeholders, so a string can carry a figure without concatenation. */
export type Params = Record<string, string | number>

export function interpolate(template: string, params?: Params): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  )
}

/** A bilingual entry. `fil` is required — a missing translation is a build error, not a blank label. */
export type Entry = { en: string; fil: string }
export type Table = Record<string, Entry>

/**
 * Copy that lives as *data* rather than in a table — a label hanging off a
 * computed result, a note attached to a capital component. Same two-language
 * contract as `Entry`, but resolvable without a key lookup.
 */
export type Bilingual = Entry

/** Resolve a bilingual value. Used where the copy is carried by an object. */
export function pick(lang: Lang, value: Bilingual): string {
  return value[lang] ?? value.en
}

/** Optional copy — a note that may simply not exist. */
export function pickOptional(lang: Lang, value: Bilingual | undefined): string | undefined {
  return value ? pick(lang, value) : undefined
}

/**
 * Resolve a key against a table. A missing key returns the key itself rather
 * than throwing: a typo should show up as visible garbage in a screenshot, which
 * is how it gets noticed, and never as a crashed screen.
 */
export function tr(lang: Lang, table: Table, key: string, params?: Params): string {
  const entry = table[key]
  if (!entry) return key
  return interpolate(entry[lang] ?? entry.en, params)
}

// --- The store -------------------------------------------------------------

let current: Lang = readStored()

function readStored(): Lang {
  const raw = readPersisted(LANG_STORAGE)
  return isLang(raw) ? raw : DEFAULT_LANG
}

const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): Lang {
  return current
}

export function setLang(lang: Lang): void {
  if (lang === current) return
  current = lang
  writePersisted(LANG_STORAGE, lang)
  applyDocumentLang()
  for (const listener of listeners) listener()
}

/**
 * The root `lang` attribute is not decoration: it is what tells a screen reader
 * which language to pronounce and the browser how to break lines and hyphenate.
 * Leaving it at the static `en` while the screen reads Tagalog is the kind of
 * detail that only shows up for the users least able to work around it.
 */
function applyDocumentLang(): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = current === 'fil' ? 'fil' : 'en'
}

/** Called once at startup, after the stored preference has been read. */
export function syncDocumentLang(): void {
  applyDocumentLang()
}

/** The current language, and a setter. Safe to call outside React (engine, tests). */
export function getLang(): Lang {
  return current
}

export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useSetLang(): (lang: Lang) => void {
  return useCallback((lang: Lang) => setLang(lang), [])
}

/** A translator bound to the current language, for screen copy. */
export function useT(): (key: UIStr, params?: Params) => string {
  const lang = useLang()
  return useCallback((key: UIStr, params?: Params) => tr(lang, UI, key, params), [lang])
}

/**
 * A translator as a plain function, for the cases where a hook cannot be used —
 * an event handler that needs copy, or a helper outside a component.
 */
export function tNow(key: UIStr, params?: Params): string {
  return tr(current, UI, key, params)
}

// --- Dates -----------------------------------------------------------------

/**
 * Dates are built from tables rather than `toLocaleDateString`.
 *
 * Two reasons, both learned from this app specifically: a browser without a
 * `fil-PH` locale silently falls back to English, so half the market would read
 * "Tue, Sep 15" inside an otherwise Filipino screen; and the Score trend builds
 * a *range* from two dates, where the separator and abbreviation style have to
 * agree. A table is deterministic on every device.
 */
const MONTHS: Record<Lang, string[]> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  fil: ['Ene', 'Peb', 'Mar', 'Abr', 'May', 'Hun', 'Hul', 'Ago', 'Set', 'Okt', 'Nob', 'Dis'],
}

const WEEKDAYS_LONG: Record<Lang, string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  fil: ['Linggo', 'Lunes', 'Martes', 'Miyerkules', 'Huwebes', 'Biyernes', 'Sabado'],
}

const WEEKDAYS_SHORT: Record<Lang, string[]> = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  fil: ['Lin', 'Lun', 'Mar', 'Miy', 'Huw', 'Biy', 'Sab'],
}

export function monthShort(date: Date, lang: Lang): string {
  return MONTHS[lang][date.getMonth()]
}

/**
 * "3:05 PM". Numeric and 12-hour in both languages: a Filipino reader uses
 * AM/PM rather than a 24-hour clock, and there is nothing to translate in a
 * clock time — so both languages share one formatter rather than two that could
 * drift apart.
 */
export function clockTime(date: Date): string {
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const hour = date.getHours()
  const suffix = hour < 12 ? 'AM' : 'PM'
  const display = hour % 12 === 0 ? 12 : hour % 12
  return `${display}:${minutes} ${suffix}`
}

export function weekdayLong(date: Date, lang: Lang): string {
  return WEEKDAYS_LONG[lang][date.getDay()]
}

export function weekdayShort(date: Date, lang: Lang): string {
  return WEEKDAYS_SHORT[lang][date.getDay()]
}

/** "Sep 15" / "Set 15" — the ledger's own short form. */
export function dayMonth(date: Date, lang: Lang): string {
  return `${monthShort(date, lang)} ${date.getDate()}`
}

/** "Sep 15, 2026" / "Set 15, 2026" — receipts and renewal dates. */
export function dayMonthYear(date: Date, lang: Lang): string {
  return `${dayMonth(date, lang)}, ${date.getFullYear()}`
}

/**
 * Inline copy for the I/O modules — microphone, speech engine, audio capture.
 *
 * Those modules are already impure (they touch devices and networks), so they
 * read the current language themselves rather than having it threaded through
 * every call site merely to build an error message that is usually never seen.
 * Pass the English first, because English is the default reading.
 */
export function say(en: string, fil: string): string {
  return current === 'fil' ? fil : en
}

// --- Screen copy -----------------------------------------------------------

/**
 * Every string the interface itself renders. Keys are namespaced by screen so a
 * translator can work one area at a time, and the flat type below means a typo
 * in `t('...')` fails the typecheck instead of rendering a raw key.
 */
export const UI = {
  // --- Shell --------------------------------------------------------------
  'app.tagline': {
    en: 'See where the money really goes.',
    fil: 'Hindi lang benta ang binibilang.',
  },
  'app.settings': { en: 'Settings', fil: 'Mga setting' },
  'app.close': { en: 'Close', fil: 'Isara' },
  'app.language': { en: 'Language', fil: 'Wika' },
  'app.languageHint': {
    en: 'English is the default. Switch to Tagalog and the whole app follows — including the words the engine writes.',
    fil: 'English ang default. Pagbalik sa Tagalog, kasama ang buong app — pati ang mga salitang isinusulat ng engine.',
  },
  'app.languageSaved': { en: 'Saved on this device.', fil: 'Naka-save sa device na ito.' },
  'app.transactions': { en: '{n} transactions', fil: '{n} transaksyon' },
  'app.voids': { en: '{n} void', fil: '{n} void' },
  'app.storedLocally': {
    en: 'Saved on this device — no internet needed.',
    fil: 'Naka-save sa device, hindi kailangan ng internet.',
  },
  'app.demoData': { en: 'Demo data', fil: 'Demo data' },
  'app.clearAll': { en: 'Erase everything', fil: 'Burahin lahat' },
  'app.demoOnly': { en: 'Demo only — pick a plan', fil: 'Demo lamang — pumili ng plano' },
  'app.simulatedPayments': {
    en: 'Every payment here is simulated — no real money is involved.',
    fil: 'Simulado ang lahat ng bayad — wala itong kinalaman sa totoong pera.',
  },
  'app.managePlan': { en: 'Manage', fil: 'Pamahalaan' },
  'app.upgrade': { en: 'Upgrade', fil: 'I-upgrade' },
  'app.open': { en: 'Open', fil: 'Buksan' },
  'app.offlineVoice': { en: 'Offline voice', fil: 'Offline na boses' },
  'app.offlineVoiceInstalled': { en: 'Installed · {mb}MB', fil: 'Naka-install · {mb}MB' },
  'app.offlineVoiceMissing': {
    en: 'No model yet — not offline',
    fil: 'Walang modelo — hindi pa offline',
  },

  // --- Tabs ---------------------------------------------------------------
  'tab.twin': { en: 'Twin', fil: 'Twin' },
  'tab.ledger': { en: 'Ledger', fil: 'Tala' },
  'tab.voice': { en: 'Voice', fil: 'Boses' },
  'tab.ask': { en: 'Ask', fil: 'Tanong' },
  'tab.score': { en: 'Score', fil: 'Score' },

  // --- Dashboard ----------------------------------------------------------
  'dash.heroLabel': { en: 'Real profit today', fil: 'Tunay na Kita Ngayon' },
  'dash.deltaUnknown': { en: 'Sales vs yesterday: —', fil: 'Benta vs kahapon: —' },
  'dash.delta': { en: 'Sales {sign}{pct}% vs yesterday', fil: 'Benta {sign}{pct}% vs kahapon' },
  'dash.revenue': { en: 'Sales', fil: 'Benta' },
  'dash.expenses': { en: 'Expenses', fil: 'Gastos' },
  'dash.cash': { en: 'Cash', fil: 'Cash' },
  'dash.scoreTitle': { en: 'Sipat Score', fil: 'Sipat Score' },
  'dash.scoreEmpty': {
    en: 'Not enough data yet for a full reading.',
    fil: 'Kulang pa ang datos para sa buong pagsusuri.',
  },
  'dash.weekTitle': { en: 'This week', fil: 'Linggong Ito' },
  'dash.days7': { en: '7 days', fil: '7 araw' },
  'dash.profit': { en: 'Profit', fil: 'Kita' },
  'dash.margin': { en: 'Margin', fil: 'Margin' },
  'dash.capitalTitle': { en: 'Where is my capital?', fil: 'Nasaan ang Puhunan Ko?' },
  'dash.today': { en: 'today', fil: 'ngayon' },
  'dash.capitalCenter': { en: 'Capital', fil: 'Puhunan' },
  'dash.provenanceTitle': { en: 'Where did the money go?', fil: 'Saan Napunta ang Pera Mo?' },
  'dash.provenanceBody': {
    en: 'This is not the same as the chart above: here it is where the money came from and where it was spent since you started — not where it sits right now. Money you took out or spent is no longer a "location" of capital.',
    fil: 'Iba ito sa itaas: pinagmulan at pinag-gastusan mula nang magsimula, hindi kung nasaan ngayon. Kinuhang pera at gastos ay hindi na "lokasyon" ng puhunan.',
  },
  'dash.sources': { en: 'Came from', fil: 'Pinagmulan' },
  'dash.uses': { en: 'Went to', fil: 'Napuntahan' },
  'dash.twinTitle': { en: 'Business Twin', fil: 'Business Twin' },
  'dash.twinHint': {
    en: 'from every transaction',
    fil: 'mula sa lahat ng transaksyon',
  },
  'dash.matched': { en: 'balanced', fil: 'tugma' },
  'dash.mismatched': { en: 'not balanced', fil: 'may hindi tugma' },
  'dash.invariant': {
    en: 'Assets − Debt = Capital + Accumulated Profit. Always balanced — {n} transactions.',
    fil: 'Assets − Utang = Puhunan + Naipon na Kita. Palaging tugma — {n} transaksyon.',
  },
  'dash.watchTitle': { en: 'Watch out', fil: 'Bantayan' },
  'dash.statTotalAssets': { en: 'Total assets', fil: 'Kabuuang Assets' },
  'dash.statPayables': { en: 'Owed to suppliers', fil: 'Utang sa Supplier' },
  'dash.statEquity': { en: 'Capital + profit', fil: 'Puhunan + Kita' },
  'dash.statInventory': { en: 'Stock (at cost)', fil: 'Paninda (cost)' },
  'dash.statReceivables': { en: 'Owed to you', fil: 'Utang sa Iyo' },
  'dash.statSlow': { en: 'Not moving', fil: 'Mabagal Gumalaw' },

  // --- Score --------------------------------------------------------------
  'score.dimensions': { en: 'What makes up the Score', fil: 'Ano ang Bumubuo sa Score' },
  'score.weightsHint': { en: 'each weight is stated', fil: 'bawat bigat ay nakasaad' },
  'score.explanation': { en: 'Reading', fil: 'Paliwanag' },
  'score.strong': { en: 'Strong', fil: 'Malakas' },
  'score.watch': { en: 'Watch', fil: 'Bantayan' },
  'score.priority': { en: 'Do first', fil: 'Unahin' },
  'score.noStrength': { en: 'No clear strength yet.', fil: 'Wala pang malinaw na kalakasan.' },
  'score.noWatch': { en: 'Nothing needs watching.', fil: 'Walang pangunahing alalahanin.' },
  'score.noPriority': { en: 'Nothing urgent.', fil: 'Walang agarang dapat unahin.' },
  'score.insufficient': {
    en: "There isn't enough data this week yet — this reading gets sharper as the days come in.",
    fil: 'Kulang pa ang datos ngayong linggo — magiging mas tumpak ito sa paglipas ng araw.',
  },
  'score.outOf': { en: '/ 100', fil: '/ 100' },
  'score.historyTitle': { en: 'History and Trend', fil: 'Kasaysayan at Trend' },
  'score.weeks8': { en: '8 weeks', fil: '8 linggo' },
  'score.thisWeek': { en: 'This week', fil: 'Ngayong linggo' },
  'score.best': { en: 'Best week', fil: 'Pinakamataas' },
  'score.sparse': { en: 'Blank weeks', fil: 'Bakanteng linggo' },
  'score.noSales': { en: 'no sales', fil: 'walang benta' },
  'score.recomputed': {
    en: 'Every week is recomputed from the same formula — no invented baseline, no stored history. A week with no sales stays blank rather than reading as zero.',
    fil: 'Ang bawat linggo ay kinukwentang muli mula sa parehong pormula — walang iniimbentong baseline at walang na-save na kasaysayan. Ang linggong walang benta ay bakante, hindi zero.',
  },
  'score.lockedBody': {
    en: 'The current Score is free. Its history — how the business has moved over the weeks — is part of PRO, along with benchmarking against other stores when that arrives.',
    fil: 'Ang kasalukuyang score ay libre. Ang kasaysayan nito — kung paano gumalaw ang negosyo sa loob ng mga linggo — ay kasama sa PRO, kasama ng paghahambing sa ibang tindahan kapag dumating ang benchmarking.',
  },
  'score.basisTitle': { en: 'What it is based on', fil: 'Pinagbatayan' },
  'score.basisSales': { en: 'Sales', fil: 'Benta' },
  'score.basisMargin': { en: 'Net margin', fil: 'Net margin' },
  'score.basisInventory': { en: 'In inventory', fil: 'Nasa paninda' },
  'score.basisReceivables': { en: 'Owed to you', fil: 'Utang sa iyo' },
  'score.deterministic': {
    en: 'Every mark comes from a stated formula — not from AI. The same ledger always produces the same Score.',
    fil: 'Ang bawat marka ay galing sa nakasaad na pormula — hindi mula sa AI. Ang parehong ledger ay laging magbibigay ng parehong score.',
  },

  // --- Ask ----------------------------------------------------------------
  'ask.title': { en: 'Ask My Negosyo', fil: 'Ask My Negosyo' },
  'ask.noLlm': { en: 'no LLM, no internet', fil: 'walang LLM, walang internet' },
  'ask.intro': {
    en: 'Answers come from your real records. The numbers are deterministic — they are not guessed by AI.',
    fil: 'Sinasagot mula sa iyong tunay na records. Deterministik ang mga numero — hindi ito hinuhula ng AI.',
  },
  'ask.placeholder': { en: 'Ask something about the business…', fil: 'Itanong ang tungkol sa negosyo…' },
  'ask.ask': { en: 'Ask', fil: 'Tanong' },
  'ask.free': {
    en: 'Free and unlimited — this runs on your device.',
    fil: 'Libre at walang limitasyon — tumatakbo ito sa device mo.',
  },
  'ask.startTitle': { en: 'Start here', fil: 'Simulan Dito' },
  'ask.startHint': { en: 'pick one', fil: 'pumili ng isa' },
  'ask.startFooter': {
    en: 'Every answer comes with evidence from your ledger. It is free and unlimited — no internet needed.',
    fil: 'Bawat sagot ay may kasamang ebidensya mula sa iyong ledger. Libre ito at walang limitasyon — hindi kailangan ng internet.',
  },
  'ask.aiTitle': { en: 'AI Explanation', fil: 'AI na Paliwanag' },
  'ask.aiLockedBody': {
    en: 'The numbers are already computed on your device, and that is free. The AI explanation — the part that says why this happened — is the only piece of the product with a cost per use.',
    fil: 'Ang mga numero ay kinakalkula na sa device mo, at libre iyon. Ang AI na paliwanag — ang nagsasabi kung bakit ganito ang nangyari — ang tanging bahagi ng produkto na may bayad kada gamit.',
  },
  'ask.aiRemaining': { en: '{n} left', fil: '{n} natitira' },
  'ask.aiExhausted': {
    en: 'You have used all {n} questions this month. You are not charged automatically — it resets next month, and every deterministic answer keeps working.',
    fil: 'Naubos na ang {n} tanong ngayong buwan. Hindi ka awtomatikong sisingilin — mag-reset ito sa susunod na buwan, at patuloy na gumagana ang lahat ng deterministik na sagot.',
  },
  'ask.seePlans': { en: 'See the plans', fil: 'Tingnan ang mga plano' },
  'ask.explainWithAi': { en: 'Explain with AI', fil: 'Ipaliwanag gamit ang AI' },
  'ask.aiWouldSend': {
    en: 'This is the only thing that would be sent to an AI: the headline and the numbers from your ledger.',
    fil: 'Ito lang ang ipapadala sa AI: ang headline at ang mga numerong galing sa ledger mo.',
  },
  'ask.aiNotWired': {
    en: 'The LLM is not wired up in this prototype — showing you the real payload is more honest than faking a paragraph. It is also why AI can never invent a number: the only thing it is ever handed is numbers the deterministic engine already produced.',
    fil: 'Hindi pa naka-wire ang LLM sa prototype na ito — ipinapakita namin ang totoong payload sa halip na magkunwaring sagot. Ito ang dahilan kung bakit hindi kailanman makakapag-imbento ng numero ang AI: numero lang ang binibigay namin dito, at galing lahat sa deterministik na engine.',
  },
  'ask.aiExplainPrompt': {
    en: 'The AI would explain the answer above using only the numbers in your ledger.',
    fil: 'Ipapaliwanag ng AI ang sagot sa itaas gamit lang ang mga numerong nasa ledger mo.',
  },
  'ask.evidence': { en: 'Evidence', fil: 'Ebidensya' },
  'ask.actions': { en: 'What you could do', fil: 'Maaaring gawin' },

  // --- Ask: starter questions --------------------------------------------
  //
  // These are shown as things the owner can *tap*, so they are copy rather than
  // data — and the parser understands both languages, so an English tap is
  // answered in English.
  'askEx.profit': { en: 'How much did I earn this week?', fil: 'Magkano kinita ko ngayong linggo?' },
  'askEx.profitLabel': { en: 'Earned this week', fil: 'Kita ngayong linggo' },
  'askEx.capitalWhere': { en: 'Where is my capital?', fil: 'Nasaan ang puhunan ko?' },
  'askEx.capitalWhereLabel': { en: 'Where is my capital', fil: 'Nasaan ang puhunan' },
  'askEx.provenance': { en: 'Where did my money go?', fil: 'Saan napunta ang pera ko?' },
  'askEx.provenanceLabel': { en: 'Where the money went', fil: 'Saan napunta ang pera' },
  'askEx.topProduct': { en: 'What is my strongest item?', fil: 'Ano ang pinakamalakas kong paninda?' },
  'askEx.topProductLabel': { en: 'Strongest item', fil: 'Pinakamalakas na paninda' },
  'askEx.slow': { en: 'What is not moving?', fil: 'Ano ang hindi gumagalaw na paninda?' },
  'askEx.slowLabel': { en: 'Not moving', fil: 'Hindi gumagalaw' },
  'askEx.biggestUtang': { en: 'Who owes me the most?', fil: 'Sino ang may pinakamalaking utang?' },
  'askEx.biggestUtangLabel': { en: 'Biggest utang', fil: 'Pinakamalaking utang' },
  'askEx.profitChange': { en: 'Why did my profit drop?', fil: 'Bakit bumaba ang kita ko?' },
  'askEx.profitChangeLabel': { en: 'Why profit dropped', fil: 'Bakit bumaba ang kita' },
  'askEx.score': { en: 'How is my business doing?', fil: 'Kumusta ang negosyo ko?' },
  'askEx.scoreLabel': { en: 'How the business is doing', fil: 'Kumusta ang negosyo' },

  // --- Record -------------------------------------------------------------
  'record.mode.cash_sale': { en: 'Sale', fil: 'Benta' },
  'record.mode.credit_sale': { en: 'Utang', fil: 'Utang' },
  'record.mode.expense': { en: 'Expense', fil: 'Gastos' },
  'record.mode.purchase': { en: 'Purchase', fil: 'Bili' },
  'record.mode.payment_received': { en: 'Payment', fil: 'Bayad' },
  'record.mode.capital_injection': { en: 'Capital', fil: 'Puhunan' },
  'record.mode.owner_withdrawal': { en: 'Take out', fil: 'Kuha' },
  'record.flash.needItems': {
    en: 'Add an item, a quantity, and a price.',
    fil: 'Maglagay ng paninda, dami, at presyo.',
  },
  'record.flash.needAmount': { en: 'Enter an amount.', fil: 'Maglagay ng halaga.' },
  'record.flash.needCustomer': { en: 'Pick a customer.', fil: 'Pumili ng customer.' },
  'record.field.item': { en: 'Item', fil: 'Paninda' },
  'record.field.qty': { en: 'Quantity', fil: 'Dami' },
  'record.field.unitCost': { en: 'Cost each', fil: 'Puhunan bawat isa' },
  'record.field.unitPrice': { en: 'Price each', fil: 'Presyo bawat isa' },
  'record.field.customer': { en: 'Customer', fil: 'Customer' },
  'record.field.amount': { en: 'Amount (₱)', fil: 'Halaga (₱)' },
  'record.field.notNeeded': { en: 'not needed', fil: 'Hindi kailangan' },
  'record.select': { en: 'Choose…', fil: 'Pumili…' },
  'record.walkIn': { en: 'Walk-in', fil: 'Walk-in' },
  'record.recentTitle': { en: 'Recently recorded', fil: 'Huling Naitala' },
  'record.kind.sale': { en: 'Sale', fil: 'Benta' },
  'record.kind.credit': { en: 'Utang', fil: 'Utang' },
  'record.kind.expense': { en: 'Expense', fil: 'Gastos' },
  'record.kind.purchase': { en: 'Purchase', fil: 'Bili' },
  'record.kind.payment': { en: 'Payment', fil: 'Bayad' },
  'record.kind.capital': { en: 'Capital', fil: 'Puhunan' },
  'record.kind.withdrawal': { en: 'Taken out', fil: 'Kinuha' },
  'record.kind.fixedAsset': { en: 'Equipment', fil: 'Kagamitan' },
  'record.kind.supplierPayment': { en: 'Supplier payment', fil: 'Bayad sa supplier' },
  'record.kind.stockAdjustment': { en: 'Stock adjustment', fil: 'Stock adjustment' },
  'record.kind.other': { en: 'Transaction', fil: 'Transaksyon' },
  'record.voiceBadge': { en: 'Voice', fil: 'Boses' },
  'record.addItem': { en: '+ Add an item', fil: '+ Magdagdag ng paninda' },
  'record.remove': { en: 'Remove', fil: 'Alisin' },
  'record.supplierCredit': {
    en: 'Owed to the supplier (not paid yet)',
    fil: 'Utang sa supplier (hindi pa bayad)',
  },
  'record.creditLater': { en: 'On credit first (not paid yet)', fil: 'Utang muna (hindi pa bayad)' },
  'record.submit': { en: 'Record it', fil: 'I-record' },
  'record.emptyLedger': {
    en: 'Nothing recorded yet. Start with a sale.',
    fil: 'Wala pang naitala. Magsimula sa Benta.',
  },
  'record.voidAria': { en: 'Void {what}', fil: 'I-void ang {what}' },
  'record.flash.purchaseCredit': {
    en: 'Recorded: {amount} purchase, owed to the supplier.',
    fil: 'Naitala: {amount} na bili, utang sa supplier.',
  },
  'record.flash.purchase': { en: 'Recorded: {amount} purchase.', fil: 'Naitala: {amount} na bili.' },
  'record.flash.credit': {
    en: 'Recorded: {amount} of utang. This is not cash.',
    fil: 'Naitala: {amount} na utang. Hindi ito cash.',
  },
  'record.flash.sale': { en: 'Recorded: {amount} sale.', fil: 'Naitala: {amount} na benta.' },
  'record.flash.expense': {
    en: 'Recorded: {amount} expense.',
    fil: 'Naitala: {amount} na gastos.',
  },
  'record.flash.payment': {
    en: 'Recorded: {amount} payment.',
    fil: 'Naitala: {amount} na bayad.',
  },
  'record.flash.capital': {
    en: 'Recorded: {amount} of capital.',
    fil: 'Naitala: {amount} na puhunan.',
  },
  'record.flash.withdrawal': {
    en: 'Recorded: {amount} taken out.',
    fil: 'Naitala: {amount} na kinuha.',
  },
  'record.row.sale': { en: 'Sale — {n} items', fil: 'Benta — {n} paninda' },
  'record.row.credit': { en: 'Utang — {name}', fil: 'Utang — {name}' },
  'record.row.purchase': { en: 'Purchase — {n} items', fil: 'Bili — {n} paninda' },
  'record.row.stockAdjustment': {
    en: 'Stock adjustment — {qty}',
    fil: 'Stock adjustment — {qty}',
  },

  // --- Voice --------------------------------------------------------------
  'voice.title': { en: 'Sipat Voice', fil: 'Sipat Voice' },
  'voice.error.noItems': {
    en: 'No known items recognised. Try different words.',
    fil: 'Walang nakilalang paninda. Subukan ang ibang salita.',
  },
  'voice.error.noEngine': { en: 'That engine is not available.', fil: 'Hindi available ang engine na ito.' },
  'voice.error.nothingHeard': {
    en: 'The mic stopped without hearing any words. Try again, closer to the phone.',
    fil: 'Tumigil ang mic na walang narinig na salita. Subukan muli, ilapit sa phone.',
  },
  'voice.switchOffline': {
    en: 'Use the offline engine instead',
    fil: 'Gamitin na lang ang offline engine',
  },
  'voice.lockedBody': {
    en: 'Voice is part of PRO. Typing below keeps working, and nothing you have already recorded changes — it all stays on your device.',
    fil: 'Ang boses ay kasama sa PRO. Patuloy na gumagana ang pag-i-type sa ibaba, at hindi nagbabago ang anumang naitala mo — nasa device mo pa rin lahat ng ito.',
  },
  'voice.stopListening': { en: 'Stop listening', fil: 'Itigil ang pakikinig' },
  'voice.startListening': { en: 'Start listening', fil: 'Magsimulang makinig' },
  'voice.status.transcribing': {
    en: 'Transcribing on device… this can take a few seconds',
    fil: 'Isinasalin sa device… maaaring tumagal ng ilang segundo',
  },
  'voice.status.listening': { en: 'Listening…', fil: 'Nakikinig…' },
  'voice.status.prompt': {
    en: 'Press and say the transaction',
    fil: 'Pindutin at sabihin ang transaksyon',
  },
  'voice.offlineTitle': { en: 'Voice Without Internet', fil: 'Boses Kahit Walang Internet' },
  'voice.typeTitle': { en: 'Type What Was Said', fil: 'I-type ang Sinabi' },
  'voice.typeHint': {
    en: 'works without a microphone',
    fil: 'gumagana kahit walang mikropono',
  },
  'voice.placeholder': {
    en: 'E.g. Sipat, I sold ten Cokes and five Lucky Me',
    fil: 'Hal. Sipat, nakabenta ako ng sampung Coke mismo at limang Lucky Me',
  },
  'voice.draftTitle': { en: 'Draft — confirm it', fil: 'Draft — Kumpirmahin' },
  'voice.draftUnposted': { en: 'Not recorded yet', fil: 'Hindi pa naitala' },
  'voice.field.customerUtang': { en: 'Customer (utang)', fil: 'Customer (utang)' },
  'voice.engineLabel': { en: 'ASR engine', fil: 'ASR engine' },
  'voice.engineUnavailable': { en: '— unavailable', fil: '— hindi available' },
  'voice.offlineWorks': { en: 'Working offline', fil: 'Gumagana offline' },
  'voice.offlineIntro': {
    en: 'The browser engine needs internet — it sends your voice to Google. If you download the model (≈47MB including the runtime), your phone understands what you say with no signal. It is free, and it runs on your device.',
    fil: 'Ang browser engine ay kailangan ng internet — ipinapadala nito ang boses sa Google. Kung mag-download ka ng modelo (≈47MB kasama ang runtime), maiintindihan ng phone mo ang sinasabi mo kahit walang signal. Libre ito, at tumatakbo sa device mo.',
  },
  'voice.downloadModel': {
    en: 'Download the offline model',
    fil: 'I-download ang offline na modelo',
  },
  'voice.makeDraft': { en: 'Turn into a draft', fil: 'Gawing draft' },
  'voice.confirmIntro': {
    en: 'The item name can be accepted automatically. The quantity and price cannot — confirm the numbers before recording.',
    fil: 'Ang pangalan ng paninda ay maaaring awtomatikong tanggapin. Ang dami at presyo ay hindi — kumpirmahin ang mga numero bago itala.',
  },
  'voice.total': { en: 'Total', fil: 'Kabuuan' },
  'voice.cancel': { en: 'Cancel', fil: 'Kansel' },
  'voice.confirmAndRecord': { en: 'Confirm and record', fil: 'Kumpirmahin at itala' },
  'voice.posted.utang': {
    en: 'Recorded: {amount} of utang. This is not cash.',
    fil: 'Naitala: {amount} na utang. Hindi ito cash.',
  },
  'voice.posted.purchase': { en: 'Recorded: {amount} purchase.', fil: 'Naitala: {amount} na bili.' },
  'voice.posted.sale': { en: 'Recorded: {amount} sale.', fil: 'Naitala: {amount} na benta.' },
  'voice.hintPerKilo': { en: 'per kilo', fil: 'sa kilo' },

  // --- Offline --------------------------------------------------------------
  'offline.statusTitle': { en: 'Status', fil: 'Kalagayan' },
  'offline.hintConnected': { en: 'connected', fil: 'may koneksyon' },
  'offline.hintNotConnected': { en: 'no connection', fil: 'walang koneksyon' },
  'offline.connected': { en: 'Connected to the internet', fil: 'Naka-konekta sa internet' },
  'offline.disconnected': {
    en: 'Offline — the ledger still works',
    fil: 'Offline — gumagana pa rin ang tala',
  },
  'offline.shellCached': {
    en: 'App cached (service worker)',
    fil: 'Naka-cache na app (service worker)',
  },
  'offline.cachedYes': { en: 'Yes — it will work offline', fil: 'Oo — kokopyahin ito offline' },
  'offline.cachedNo': { en: 'Not yet', fil: 'Hindi pa' },
  'offline.installedAsApp': { en: 'Installed as an app', fil: 'Naka-install bilang app' },
  'offline.yes': { en: 'Yes', fil: 'Oo' },
  'offline.inBrowser': { en: 'No (in the browser)', fil: 'Hindi (nasa browser)' },
  'offline.micForModel': {
    en: 'Microphone for the offline model',
    fil: 'Mikropono para sa offline na modelo',
  },
  'offline.supported': { en: 'Supported', fil: 'Suportado' },
  'offline.notSupported': { en: 'Not supported', fil: 'Hindi suportado' },
  'offline.storageUsed': { en: 'Storage used', fil: 'Storage na ginagamit' },
  'offline.devHintLead': {
    en: 'If offline is not working:',
    fil: 'Kung hindi gumagana ang offline:',
  },
  'offline.devHintIf': { en: 'if', fil: 'kung' },
  'offline.devHintMid': {
    en: 'is what is running, there is no service worker yet — it only exists in a production build. Try',
    fil: 'ang tumatakbo, wala pang service worker — nasa production build lang ito. Subukan ang',
  },
  'offline.devHintOr': { en: ', or run', fil: ', o buksan ang' },
  'offline.devHintTail': {
    en: '. Offline voice works in both — it does not need a service worker to run.',
    fil: '. Ang offline na boses ay gumagana sa pareho — hindi ito kailangan ng service worker para tumakbo.',
  },
  'offline.worksTitle': { en: 'Works Offline', fil: 'Gumagana Offline' },
  'offline.worksHint': { en: 'no internet', fil: 'walang internet' },
  'offline.worksBody': {
    en: 'All of this runs on your device, which is why it is free — and why losing signal never changes it.',
    fil: 'Tumatakbo lahat ng ito sa device mo, kaya libre — at kaya hindi ito kailanman nababago ng kawalan ng signal.',
  },
  'offline.needsTitle': { en: 'Does Not Work Offline', fil: 'Hindi Gumagana Offline' },
  'offline.needsHint': { en: 'needs a server', fil: 'kailangan ng server' },
  'offline.needsBody': {
    en: 'None of this is lost — the ledger is saved on your device and is sent once the connection comes back.',
    fil: 'Hindi ito nawawala nang tuluyan — naka-save ang tala sa device mo, at ipapadala kapag bumalik ang koneksyon.',
  },
  'offline.voiceModelTitle': { en: 'Voice Without Internet — Model', fil: 'Boses Offline — Modelo' },
  'offline.onceHint': { en: 'one time only', fil: 'isang beses lang' },
  'offline.modelIntro': {
    en: 'The browser engine needs internet because it sends your voice to Google. If you download this model instead, your phone understands what you say with no signal at all. It is free — it runs on your device, not on ours.',
    fil: 'Ang browser engine ay kailangan ng internet dahil ipinapadala nito ang boses sa server ng Google. Kung i-download mo ang modelong ito, maiintindihan ng phone mo ang sinasabi mo kahit walang signal. Libre ito — tumatakbo sa device mo, hindi sa amin.',
  },
  'offline.freePill': { en: 'FREE', fil: 'LIBRE' },
  'offline.cannotShip': { en: 'Cannot be shipped', fil: 'Hindi maaaring i-ship' },
  'offline.installedPill': { en: 'Installed', fil: 'Naka-install' },
  'offline.licensePrefix': { en: 'Licence:', fil: 'Lisensya:' },
  'offline.sizeNote': {
    en: '≈{mb}MB model + ≈{runtime}MB runtime on first use. The exact size is shown once it is installed.',
    fil: '≈{mb}MB na modelo + ≈{runtime}MB na runtime sa unang paggamit. Ang eksaktong sukat ay ipinapakita pagkatapos ma-install.',
  },
  'offline.warming': { en: 'Preparing the model…', fil: 'Inihahanda ang modelo…' },
  'offline.starting': { en: 'Starting the download…', fil: 'Sinisimulan ang download…' },
  'offline.downloadedOf': { en: '{done} of {total}', fil: '{done} ng {total}' },
  'offline.keepOpen': {
    en: 'Do not close the screen until it finishes.',
    fil: 'Huwag isara ang screen hanggang matapos.',
  },
  'offline.worksNow': { en: 'Working offline now', fil: 'Gumagana na offline' },
  'offline.remove': { en: 'Remove', fil: 'Alisin' },
  'offline.download': { en: 'Download for offline (~{mb}MB)', fil: 'I-download para sa offline (~{mb}MB)' },
  'offline.needInternetFirst': {
    en: 'Internet is needed for the first download. It only happens once.',
    fil: 'Kailangan ng internet para sa unang pag-download. Isang beses lang ito.',
  },
  'offline.noAudioSupport': {
    en: 'This browser does not support audio recording.',
    fil: 'Hindi sinusuportahan ng browser na ito ang pag-record ng audio.',
  },
  'offline.downloadFailed': {
    en: 'The model download failed. Check the connection and try again.',
    fil: 'Hindi na-download ang modelo. Suriin ang koneksyon at subukan muli.',
  },
  'offline.installedOn': {
    en: 'Installed on {date} · {mb} saved on your device.',
    fil: 'Naka-install noong {date} · {mb} na naka-save sa device mo.',
  },

  // --- Plan / billing --------------------------------------------------------
  'plan.currentTitle': { en: 'Current plan', fil: 'Kasalukuyang Plano' },
  'plan.simulatedHint': { en: 'simulated', fil: 'simulado' },
  'plan.cancelledUntil': {
    en: 'Cancelled. It stays active until {date}, then goes back to FREE.',
    fil: 'Kanselado. Gagana pa hanggang {date}, tapos babalik sa FREE.',
  },
  'plan.nextCharge': { en: 'Next charge: {date}.', fil: 'Susunod na bayad: {date}.' },
  'plan.expired': {
    en: 'Your subscription has expired. Everything paid-for has gone back to FREE — your records have not been lost.',
    fil: 'Nag-expire na ang subscription mo. Bumalik sa FREE ang lahat ng bayad na feature — hindi nawala ang tala mo.',
  },
  'plan.resume': { en: 'Resume subscription', fil: 'Ituloy ang subscription' },
  'plan.cancel': {
    en: 'Cancel (at the end of the month)',
    fil: 'Kansel (sa katapusan ng buwan)',
  },
  'plan.simulatedLead': { en: 'SIMULATED.', fil: 'SIMULADO.' },
  'plan.simulatedBody': {
    en: 'This is a prototype — no real charge, no gateway, and no card or wallet sent anywhere. The plan is saved on your device only.',
    fil: 'Prototype lamang ito — walang totoong bayad, walang gateway, at walang card o wallet na ipinapadala kahit saan. Naka-save ang plano sa device mo lang.',
  },
  'plan.badgeBest': { en: 'Best value', fil: 'Pinakasulit' },
  'plan.badgeTop': { en: 'Top tier', fil: 'Pinakamataas' },
  'plan.badgeCurrent': { en: 'Current', fil: 'Kasalukuyan' },
  'plan.institutionalHint': { en: 'B2B2C', fil: 'B2B2C' },
  'plan.contact': { en: 'Get in touch', fil: 'Makipag-ugnayan' },
  'plan.receiptsTitle': { en: 'Receipts', fil: 'Mga Resibo' },
  'plan.whyPriceTitle': { en: 'Why the price is what it is', fil: 'Bakit ganito ang presyo' },
  'plan.whyPriceBody': {
    en: 'Everything that runs on your phone is free — including voice and the offline model, because there is no server of ours behind them. You only pay for what runs on our servers: AI explanation, cloud backup, history, forecasting, and benchmarking.',
    fil: 'Libre ang lahat ng tumatakbo sa phone mo — kasama ang boses at ang offline na modelo, dahil wala kaming binabayarang server para dito. Ang binabayaran mo lang ay ang tumatakbo sa server namin: AI na paliwanag, cloud backup, kasaysayan, previsyon, at benchmarking.',
  },
  'plan.whyPriceFoot': {
    en: 'Which is why cancelling cannot leave you holding a paid feature — you are paying for a service, not for a file.',
    fil: 'Kaya hindi ka makakakuha ng naka-save na bayad na feature kahit mag-kansel ka — serbisyo ang binabayaran, hindi file.',
  },
  'plan.aiMeterNote': {
    en: 'Only the AI explanation costs us per use. Capped at {n} questions a month — you are never silently billed.',
    fil: 'Ang AI na Paliwanag lang ang may bayad na kada gamit. Limitado sa {n} tanong bawat buwan — hindi ka tahimik na sisingilin.',
  },
  'plan.aiMeterLabel': { en: 'AI explanation', fil: 'AI na Paliwanag' },
  'plan.upgradeTo': { en: 'Upgrade to {tier}', fil: 'I-upgrade sa {tier}' },
  'plan.backToTier': { en: 'Back to {tier}', fil: 'Bumalik sa {tier}' },
  'plan.checkoutTitle': { en: 'Simulated checkout', fil: 'Simulated checkout' },
  'plan.testNumber': { en: '{label} — test number', fil: '{label} — test na numero' },
  'plan.checkoutWarning': {
    en: 'No real payment will happen. Do not enter real card or wallet details.',
    fil: 'Walang totoong bayad na mangyayari. Huwag maglagay ng tunay na card o wallet details.',
  },
  'plan.paySimulated': { en: 'Pay (simulated)', fil: 'Bayaran (simulated)' },
  'plan.confirming': { en: 'Confirming the payment…', fil: 'Kinukumpirma ang bayad…' },
  'plan.noRealNetwork': { en: 'Simulated — no real network.', fil: 'Simulated — walang tunay na network.' },
  'plan.nowActive': { en: '{tier} is now active', fil: 'Aktibo na ang {tier}' },
  'plan.reference': { en: 'Reference', fil: 'Reference' },
  'plan.date': { en: 'Date', fil: 'Petsa' },
  'plan.receiptSimulated': {
    en: 'This is a simulated receipt — not valid for reimbursement or for the BIR.',
    fil: 'Resibo ito ng simulation — hindi valid para sa reimbursement o BIR.',
  },
  'plan.done': { en: 'Done', fil: 'Tapos' },

  // --- Pat, the owl -------------------------------------------------------
  // Pat's own words are never written here: its sentence is always a
  // warning, priority or strength the engine already produced and translated.
  // These keys are only its name, its mood (for screen readers) and the one
  // honest fallback for a ledger with too little history to read.
  'pat.name': { en: 'Pat', fil: 'Pat' },
  'pat.moodSteady': { en: 'watching the books', fil: 'nagmamatyag sa libro' },
  'pat.moodPleased': { en: 'happy with the numbers', fil: 'natutuwa sa numero' },
  'pat.moodConcerned': { en: 'worried', fil: 'nag-aalala' },
  'pat.moodListening': { en: 'listening', fil: 'nakikinig' },
  'pat.moodThinking': { en: 'working', fil: 'nag-iisip' },
  'pat.says': { en: 'Pat', fil: 'Pat' },
  'pat.tipFallback': {
    en: 'Keep recording sales — once there are a few days in the ledger I can read the pattern.',
    fil: 'Ituloy mo lang ang pagtala — kapag may ilang araw na sa libro, makikita ko na ang takbo.',
  },
  'pat.tipClose': { en: 'Got it', fil: 'Sige' },

  // --- Welcome (first run, once) -----------------------------------------
  // Three slides, and each one is a claim the product can actually keep. The
  // order is deliberate: what it does for you, what it shows you that nothing
  // else does, and what it costs you (nothing, and your data stays put).
  'welcome.skip': { en: 'Skip', fil: 'Laktawan' },
  'welcome.next': { en: 'Next', fil: 'Susunod' },
  'welcome.start': { en: 'Open the ledger', fil: 'Buksan ang libro' },
  'welcome.step': { en: 'Step {n} of {total}', fil: 'Hakbang {n} ng {total}' },
  'welcome.languageLabel': { en: 'Language', fil: 'Wika' },
  'welcome.offlineVoice': { en: 'Offline voice', fil: 'Boses offline' },
  'welcome.tourAgain': { en: 'Show the intro again', fil: 'Ipakita ulit ang intro' },
  'welcome.demoNote': {
    en: 'This is a seeded demo ledger — 233 transactions you can poke at.',
    fil: 'Seed na demo ledger ito — 233 transaksyon na puwede mong galawin.',
  },

  'welcome.speak.eyebrow': { en: 'Voice', fil: 'Boses' },
  // The spoken phrase stays Taglish in both languages: it is what an owner
  // actually says, and pretending an English reader would say "five Cokes, cash"
  // would be inventing a different product. Only the label around it translates.
  'welcome.speak.uttered': { en: '“limang Coke, bayad cash”', fil: '“limang Coke, bayad cash”' },
  'welcome.speak.parsed': { en: 'Recorded as', fil: 'Natala bilang' },
  'welcome.speak.tagline': { en: 'Just say the sale.', fil: 'Sabihin lang ang benta.' },
  'welcome.speak.body': {
    en: 'Speak Taglish — “limang Coke, bayad cash” — and the ledger writes itself: sale, utang, bayad, gastos. The offline model does it with no signal at all.',
    fil: 'Magsalita sa Taglish — “limang Coke, bayad cash” — at kusang natatala: benta, utang, bayad, gastos. Kaya itong gawin ng phone mo kahit walang signal.',
  },

  'welcome.see.eyebrow': { en: 'Sipat', fil: 'Sipat' },
  'welcome.see.tagline': {
    en: 'Not just sales — where the money went.',
    fil: 'Hindi lang benta — nasaan napunta ang pera.',
  },
  'welcome.see.body': {
    en: 'Real profit after cost and utang, where your capital actually sits, and a Sipat Score you can take apart metric by metric. Every number is arithmetic on your own records, never a guess.',
    fil: 'Tunay na kita pagkatapos ng puhunan at utang, nasaan talaga nakalagay ang puhunan mo, at Sipat Score na mabubusisi mo sukatan bawat sukatan. Aritmetika lahat sa sarili mong rekord — walang hinula.',
  },

  'welcome.yours.eyebrow': { en: 'Yours', fil: 'Sa iyo' },
  'welcome.yours.tagline': {
    en: 'Free, and it runs on your phone.',
    fil: 'Libre, at tumatakbo sa phone mo.',
  },
  'welcome.yours.body': {
    en: 'Nothing you record is sent to us — the ledger, the score and the offline voice model all live on the device. Only the server-side extras (AI explanation, backup, forecasting) are paid, and they can be cancelled without taking a feature away.',
    fil: 'Walang ipinapadala sa amin ang itinatala mo — ang libro, ang score, at ang offline na boses ay nasa device. Ang mga server-side na dagdag lang (AI na paliwanag, backup, previsyon) ang may bayad, at puwede mong kanselahin nang walang nawawalang feature.',
  },

  // --- Shared -------------------------------------------------------------
  'shared.simulated': { en: 'Simulated', fil: 'Simulado' },
  'shared.brandSimulated': { en: 'Simulated', fil: 'Simulado' },
  'shared.seePlans': { en: 'See the plans', fil: 'Tingnan ang mga plano' },
} as const satisfies Record<string, Entry>

export type UIStr = keyof typeof UI
