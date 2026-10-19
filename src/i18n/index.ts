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
    en: 'Switch to Tagalog and the whole app follows — the screens and the sentences the app writes for you.',
    fil: 'Kung Tagalog ang pipiliin mo, kasama ang buong app — pati ang mga pangungusap na isinusulat nito para sa iyo.',
  },
  'app.languageSaved': { en: 'Saved on this device.', fil: 'Naka-save sa device na ito.' },
  'app.textSize': { en: 'Text size', fil: 'Laki ng titik' },
  'app.textSizeHint': {
    en: 'Makes every word in the app bigger — the numbers, the buttons, everything. Saved on this device.',
    fil: 'Pinapalaki ang lahat ng salita sa app — pati numero at button. Naka-save sa device mo.',
  },
  'app.textSizeNormal': { en: 'Normal', fil: 'Normal' },
  'app.textSizeBig': { en: 'Big', fil: 'Malaki' },
  'app.textSizeBigger': { en: 'Biggest', fil: 'Pinakamalaki' },
  'app.transactions': { en: '{n} transactions', fil: '{n} transaksyon' },
  'app.voids': { en: '{n} void', fil: '{n} void' },
  'app.storedLocally': {
    en: 'Saved on this device — no internet needed.',
    fil: 'Naka-save sa device, hindi kailangan ng internet.',
  },
  'app.demoData': { en: 'Demo data', fil: 'Demo data' },
  // "Demo data" replaces the whole book, exactly as "Erase everything" does, so
  // it gets the same gate: the count in the body is the thing being replaced.
  'app.demoTitle': { en: 'Load the demo data?', fil: 'Gamitin ang demo data?' },
  'app.demoBody': {
    en: 'This replaces the {n} records on this phone with the sample shop. Anything you recorded yourself is replaced too.',
    fil: 'Papalitan nito ang {n} rekord sa phone na ito ng sample na tindahan. Mapapalitan din ang mga naitala mo mismo.',
  },
  'app.demoConfirm': { en: 'Yes, load the demo', fil: 'Oo, gamitin ang demo' },
  'app.demoLoaded': { en: 'Demo data loaded.', fil: 'Naka-load ang demo data.' },
  'app.clearAll': { en: 'Erase everything', fil: 'Burahin lahat' },
  // The erase gate. Both strings name the figure that is about to be lost: an
  // owner deciding whether to tap this needs to know it is 236 records, not
  // "all data". The body points at the backup file because there is no undo for
  // a phone that is handed to someone else, or a browser that is cleared.
  'app.clearAllTitle': { en: 'Erase everything?', fil: 'Burahin lahat?' },
  'app.clearAllBody': {
    en: 'This deletes the {n} records saved on this phone — the sales, the utang, the stock, all of it. It cannot be brought back, so save a backup file first if you are not sure.',
    fil: 'Buburahin nito ang {n} rekord na naka-save sa phone na ito — ang benta, ang utang, ang paninda, lahat. Hindi na ito maibabalik, kaya mag-save muna ng backup file kung hindi ka sigurado.',
  },
  'app.clearAllConfirm': { en: 'Yes, erase everything', fil: 'Oo, burahin lahat' },
  'app.clearAllCancel': { en: 'Keep my records', fil: 'Itago ang rekord ko' },
  'app.cleared': { en: 'Erased {n} records.', fil: 'Nabura ang {n} rekord.' },
  'app.clearUndone': {
    en: 'Your records are back.',
    fil: 'Bumalik ang rekord mo.',
  },
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
    en: 'Not downloaded yet — needs internet',
    fil: 'Hindi pa naka-download — kailangan pa ng internet',
  },
  // The owner's own book, two screens. Names are the shop's words, not ours:
  // "paninda" is what is on the shelf, "lista ng utang" is what is in the
  // notebook under the counter.
  'app.speak': { en: 'SeePat speaks', fil: 'Nagsasalita si SeePat' },
  'app.speakNote': {
    en: "A question you ask out loud gets an answer you can hear. It uses your phone's own voice — free, and nothing is sent anywhere.",
    fil: 'Ang tanong na sinabi mo nang malakas ay sinasagot ng boses na maririnig mo. Boses ng phone mo mismo ang gamit — libre, at walang ipinapadala kahit saan.',
  },
  'app.speakOn': { en: 'On', fil: 'Bukas' },
  'app.speakOff': { en: 'Off', fil: 'Sarado' },
  'app.myItems': { en: 'My items', fil: 'Mga paninda ko' },
  'app.utangList': { en: 'Utang list', fil: 'Listahan ng utang' },

  // --- Tabs ---------------------------------------------------------------
  //
  // Labels are what an owner hunts for, so they name the thing rather than the
  // concept behind it: "Twin" is the product's own word for the money overview,
  // and nobody looking for their kita taps a word they have never used.
  'tab.twin': { en: 'Money', fil: 'Pera' },
  // Tala in both languages: "Ledger" is bookkeeping English, and nobody
  // looking for today's benta taps a word they have never used.
  'tab.ledger': { en: 'Tala', fil: 'Tala' },
  'tab.voice': { en: 'Voice', fil: 'Boses' },
  'tab.ask': { en: 'Ask', fil: 'Tanong' },
  'tab.score': { en: 'Score', fil: 'Score' },
  // The centre key of the dock: a plus that blooms into the three fastest
  // actions rather than a fifth destination.
  'dock.quick': { en: 'Quick actions', fil: 'Mabilisang kilos' },
  'dock.more': { en: 'More', fil: 'Iba pa' },
  'dock.askHint': { en: 'Ask about your numbers', fil: 'Magtanong tungkol sa numero mo' },

  // --- Dashboard ----------------------------------------------------------
  'dash.heroLabel': { en: 'Real profit today', fil: 'Tunay na Kita Ngayon' },
  'dash.deltaUnknown': { en: 'Sales compared with yesterday: —', fil: 'Benta kumpara kahapon: —' },
  'dash.delta': { en: 'Sales {sign}{pct}% vs yesterday', fil: 'Benta {sign}{pct}% kumpara kahapon' },
  'dash.heroExplain': {
    en: 'Already minus what you paid for the goods, and minus today\u2019s expenses.',
    fil: 'Nabawas na dito ang puhunan ng paninda at ang gastos ngayong araw.',
  },
  'dash.revenue': { en: 'Sales', fil: 'Benta' },
  'dash.expenses': { en: 'Expenses', fil: 'Gastos' },
  'dash.cash': { en: 'Cash in the box', fil: 'Cash sa kahon' },
  'dash.wallet': { en: '{amount} in GCash/Maya', fil: '{amount} sa GCash/Maya' },
  'dash.scoreTitle': { en: 'Sipat Score', fil: 'Sipat Score' },
  'dash.scoreEmpty': {
    en: 'Not enough data yet for a full reading.',
    fil: 'Kulang pa ang datos para sa buong pagsusuri.',
  },
  'dash.weekTitle': { en: 'This week', fil: 'Linggong Ito' },
  'dash.days7': { en: '7 days', fil: '7 araw' },
  'dash.profit': { en: 'Profit', fil: 'Kita' },
  'dash.margin': { en: 'Kept from sales', fil: 'Natira sa benta' },
  'dash.marginSub': { en: 'of every ₱100 sold', fil: 'sa bawat ₱100 na benta' },
  'dash.capitalTitle': { en: 'Where is my capital?', fil: 'Nasaan ang Puhunan Ko?' },
  'dash.today': { en: 'today', fil: 'ngayon' },
  'dash.capitalCenter': { en: 'Capital', fil: 'Puhunan' },
  'dash.provenanceTitle': { en: 'Where did the money go?', fil: 'Saan Napunta ang Pera Mo?' },
  'dash.provenanceBody': {
    en: 'The chart above shows where your money is right now. This one shows where it came from and where it went since you started. Money you already spent or took out is not sitting anywhere any more.',
    fil: 'Ang nasa itaas ay kung nasaan ang pera mo ngayon. Ito naman ang pinanggalingan at pinagpuntahan ng pera mula nang magsimula ka. Ang nagastos o kinuha mo na ay wala nang kinaroroonan.',
  },
  'dash.sources': { en: 'Came from', fil: 'Pinagmulan' },
  'dash.uses': { en: 'Went to', fil: 'Napuntahan' },
  'dash.twinTitle': { en: 'What the business owns and owes', fil: 'Ang pag-aari at utang ng negosyo' },
  'dash.twinHint': {
    en: 'worked out from every record',
    fil: 'kinukwenta mula sa lahat ng naitala',
  },
  'dash.matched': { en: 'it all adds up', fil: 'tugma lahat' },
  'dash.mismatched': { en: 'something does not add up', fil: 'may hindi tugma' },
  'dash.invariant': {
    en: 'Everything you own − everything you owe = the money you put in + what you have earned. It always adds up — {n} records.',
    fil: 'Lahat ng pag-aari − lahat ng utang = puhunan mo + kinita mo. Laging tugma — {n} na naitala.',
  },
  'dash.watchTitle': { en: 'Watch out', fil: 'Bantayan' },
  'dash.statTotalAssets': { en: 'What you own', fil: 'Pag-aari mo' },
  'dash.statPayables': { en: 'Owed to suppliers', fil: 'Utang sa Supplier' },
  'dash.statEquity': { en: 'Your money + earnings', fil: 'Puhunan + kinita' },
  'dash.statInventory': { en: 'Stock (what you paid)', fil: 'Paninda (bayad mo)' },
  'dash.statReceivables': { en: 'Owed to you', fil: 'Utang sa Iyo' },
  'dash.statSlow': { en: 'Not moving', fil: 'Mabagal Gumalaw' },
  // --- Dashboard: progressive disclosure -----------------------------------
  // One panel at a time instead of a wall: the view switch, the dismissible
  // banner, and the first-run checklist. Copy stays Tagalog-first like the rest
  // of the dash table; product terms (Load More, transaction) stay in English
  // where the ecosystem uses them.
  'dash.view.today': { en: 'Today', fil: 'Ngayon' },
  'dash.view.week': { en: '7 days', fil: '7 araw' },
  'dash.view.capital': { en: 'Capital', fil: 'Puhunan' },
  'dash.view.label': { en: 'What to look at', fil: 'Ano ang titingnan' },
  'dash.banner.dismiss': { en: 'Dismiss warnings', fil: 'Isara ang mga babala' },
  'dash.banner.more': { en: '+{n} more in the details below', fil: '+{n} pa sa detalye sa ibaba' },
  'dash.checklist.title': { en: 'Get started', fil: 'Magsimula' },
  'dash.checklist.sale': { en: 'Record your first sale', fil: 'Itala ang unang benta' },
  'dash.checklist.voice': { en: 'Try saying a sale out loud', fil: 'Subukang sabihin ang benta' },
  'dash.checklist.score': { en: 'Open your Score', fil: 'Buksan ang Score mo' },
  'dash.checklist.dismiss': { en: 'Hide the guide', fil: 'Itago ang gabay' },
  // Utang is a sale that already happened, so it is counted in Sales and in
  // profit — what it is not is cash. This line is the whole explanation, and it
  // appears only when there is something to explain.
  'dash.utangLine': {
    en: '{amount} of today’s sales is utang — counted in your profit, but not cash yet.',
    fil: '{amount} ng benta ngayong araw ay utang — kasama sa kita, pero hindi pa cash.',
  },
  'dash.collectCta': { en: 'See who owes you', fil: 'Tingnan kung sino ang may utang' },
  'dash.seeWeek': { en: 'See the full week', fil: 'Tingnan ang buong linggo' },
  'dash.seeCapital': { en: 'See where the capital sits', fil: 'Tingnan kung nasaan ang puhunan' },
  // --- Record: grouped entry + history filters -----------------------------
  'record.moreModes': { en: 'More', fil: 'Iba pa' },
  'record.hideModes': { en: 'Less', fil: 'Itago' },
  'record.filter.label': { en: 'History', fil: 'Kasaysayan' },
  'record.filter.today': { en: 'Today', fil: 'Ngayon' },
  'record.filter.week': { en: '7 days', fil: '7 araw' },
  'record.filter.all': { en: 'All', fil: 'Lahat' },
  'record.filter.in': { en: 'Money in', fil: 'Papasok' },
  'record.filter.out': { en: 'Money out', fil: 'Palabas' },
  'record.filter.search': { en: 'Search sales, utang, payments…', fil: 'Hanapin ang benta, utang, bayad…' },
  'record.filter.clear': { en: 'Clear', fil: 'Linisin' },
  'record.loadMore': { en: 'Load more', fil: 'Magpakita pa' },
  'record.showing': { en: '{n} of {total}', fil: '{n} sa {total}' },
  'record.emptyFilteredTitle': { en: 'Nothing matches', fil: 'Walang tumugma' },
  'record.emptyFilteredBody': {
    en: 'Try a different day, direction, or word — or record it now.',
    fil: 'Subukan ang ibang araw, direksyon, o salita — o itala ito ngayon.',
  },
  'record.detail.title': { en: 'Details', fil: 'Detalye' },
  'record.detail.status': { en: 'Status', fil: 'Kalagayan' },
  'record.detail.posted': { en: 'Recorded', fil: 'Naitala' },
  'record.detail.voided': { en: 'Voided', fil: 'Na-void' },
  // Kept off the row and named for who it is actually for: an owner checking a
  // sale wants the goods, not a number that only a support call needs.
  'record.detail.support': { en: 'Reference (for support)', fil: 'Reference (para sa support)' },
  'record.detail.ref': { en: 'Reference', fil: 'Reference' },
  'record.quickTitle': { en: 'Quick record', fil: 'Mabilisang tala' },
  'record.quickHint': { en: 'the items you sell most', fil: 'pinakamadalas mong tinda' },
  'record.utangNeedName': {
    en: 'Who took it on utang? A name is what makes it collectable.',
    fil: 'Sino ang umutang? Ang pangalan ang dahilan kaya makokolekta ito.',
  },
  'record.detail.each': { en: '{amount} each', fil: '{amount} bawat isa' },
  'record.detail.total': { en: 'Total', fil: 'Kabuuan' },

  // --- Score --------------------------------------------------------------
  'score.dimensions': { en: 'What makes up the Score', fil: 'Ano ang Bumubuo sa Score' },
  'score.weightsHint': { en: 'how much each one counts', fil: 'gaano kabigat ang bawat isa' },
  'score.explanation': { en: 'Reading', fil: 'Paliwanag' },
  'score.strong': { en: 'Strong', fil: 'Malakas' },
  'score.watch': { en: 'Watch', fil: 'Bantayan' },
  'score.priority': { en: 'Do first', fil: 'Unahin' },
  // --- Score: progressive disclosure ---------------------------------------
  // The page used to render every dimension fully open plus the full reading:
  // a report before an answer. Now one focus sentence leads, dimensions are
  // compact color-coded rows that open on tap, and the reading waits collapsed.
  'score.whyThis': { en: 'Why this mark', fil: 'Bakit ganito ang marka' },
  'score.moreBelow': { en: '+{n} more in the reading below', fil: '+{n} pa sa paliwanag sa ibaba' },
  'score.noStrength': { en: 'No clear strength yet.', fil: 'Wala pang malinaw na kalakasan.' },
  'score.noWatch': { en: 'Nothing needs watching.', fil: 'Walang pangunahing alalahanin.' },
  'score.noPriority': { en: 'Nothing urgent.', fil: 'Walang agarang dapat unahin.' },
  'score.insufficient': {
    en: "There isn't enough data this week yet — this reading gets sharper as the days come in.",
    fil: 'Kulang pa ang datos ngayong linggo — magiging mas tumpak ito sa paglipas ng araw.',
  },
  'score.outOf': { en: '/ 100', fil: '/ 100' },
  'score.counts': { en: 'counts {pct}%', fil: 'bigat {pct}%' },
  'score.historyTitle': { en: 'History and Trend', fil: 'Kasaysayan at Trend' },
  'score.weeks8': { en: '8 weeks', fil: '8 linggo' },
  'score.thisWeek': { en: 'This week', fil: 'Ngayong linggo' },
  'score.best': { en: 'Best week', fil: 'Pinakamataas' },
  'score.sparse': { en: 'Blank weeks', fil: 'Bakanteng linggo' },
  'score.noSales': { en: 'no sales', fil: 'walang benta' },
  'score.recomputed': {
    en: 'Every week is worked out again from the same fixed rules and your own records. A week with no sales stays blank instead of showing zero.',
    fil: 'Ang bawat linggo ay kinukwenta muli mula sa parehong panuntunan at sa rekord mo. Ang linggong walang benta ay bakante, hindi zero.',
  },
  'score.basisTitle': { en: 'What it is based on', fil: 'Pinagbatayan' },
  'score.basisSales': { en: 'Sales', fil: 'Benta' },
  'score.basisMargin': { en: 'Kept from sales', fil: 'Natira sa benta' },
  'score.basisInventory': { en: 'In stock right now', fil: 'Nasa paninda ngayon' },
  'score.basisReceivables': { en: 'Owed to you', fil: 'Utang sa iyo' },
  'score.deterministic': {
    en: 'Every mark is worked out from rules you can see — nothing here is guessed by AI. The same records always give the same Score.',
    fil: 'Ang bawat marka ay kinukwenta mula sa panuntunang nakikita mo — walang hula ng AI dito. Ang parehong rekord ay laging parehong Score.',
  },

  // --- Ask ----------------------------------------------------------------
  'ask.title': { en: 'Ask My Negosyo', fil: 'Ask My Negosyo' },
  'ask.noLlm': { en: 'no AI needed, no internet needed', fil: 'hindi kailangan ng AI, hindi kailangan ng internet' },
  'ask.intro': {
    en: 'Every answer is counted from your own records. Nothing here is guessed.',
    fil: 'Ang bawat sagot ay binibilang mula sa sarili mong rekord. Walang hinuhula dito.',
  },
  'ask.placeholder': { en: 'Ask something about the business…', fil: 'Itanong ang tungkol sa negosyo…' },
  'ask.ask': { en: 'Ask', fil: 'Tanong' },
  'ask.free': {
    en: 'Free and with no limit — it runs on your phone.',
    fil: 'Libre at walang limitasyon — tumatakbo ito sa phone mo.',
  },
  'ask.startTitle': { en: 'Start here', fil: 'Simulan Dito' },
  'ask.startHint': { en: 'pick one', fil: 'pumili ng isa' },
  'ask.startFooter': {
    en: 'Every answer comes with the figures it was counted from. Free, with no limit, and it needs no internet.',
    fil: 'Bawat sagot ay may kasamang numero na pinagbatayan. Libre, walang limitasyon, at hindi kailangan ng internet.',
  },
  'ask.aiTitle': { en: 'AI explanation', fil: 'Paliwanag ng AI' },
  'ask.aiLockedBody': {
    en: 'The numbers are already worked out on your phone, and that part is free. The AI explanation — the part that says why this happened — is the only thing in the app that costs us money each time you use it.',
    fil: 'Ang mga numero ay kinukwenta na sa phone mo, at libre iyon. Ang AI na paliwanag — ang nagsasabi kung bakit ganito ang nangyari — ang tanging bahagi ng app na may gastos sa amin tuwing gagamitin mo.',
  },
  'ask.aiRemaining': { en: '{n} left', fil: '{n} natitira' },
  'ask.aiExhausted': {
    en: 'You have used all {n} questions this month. Nothing is charged automatically — the count resets next month, and every answer that comes from your own records keeps working.',
    fil: 'Naubos na ang {n} tanong ngayong buwan. Walang awtomatikong sisingilin — mag-reset ito sa susunod na buwan, at patuloy na gumagana ang lahat ng sagot na galing sa rekord mo.',
  },
  'ask.seePlans': { en: 'See the plans', fil: 'Tingnan ang mga plano' },
  'ask.explainWithAi': { en: 'Explain this in words', fil: 'Ipaliwanag ito sa salita' },
  'ask.aiWouldSend': {
    en: 'This is everything that would be sent to an AI: the short answer, and the numbers it was counted from.',
    fil: 'Ito lang ang ipapadala sa AI: ang maikling sagot, at ang mga numerong pinagbatayan nito.',
  },
  'ask.aiNotWired': {
    en: 'No AI is connected in this demo yet. We would rather show you exactly what would be sent than write a paragraph and call it AI. It is also why an AI could never invent a number here: all it would ever be given is numbers the app has already worked out from your records.',
    fil: 'Wala pang AI na naka-konekta sa demo na ito. Mas gusto naming ipakita ang eksaktong ipapadala kaysa sumulat ng talata at tawagin itong AI. Ito rin ang dahilan kung bakit hindi makakaimbento ng numero ang AI dito: numero lang ang ibibigay namin dito, at galing lahat sa rekord mo.',
  },
  'ask.aiExplainPrompt': {
    en: 'The AI would explain the answer above using only the numbers from your records.',
    fil: 'Ipapaliwanag ng AI ang sagot sa itaas gamit lang ang mga numerong nasa rekord mo.',
  },
  'ask.evidence': { en: 'Evidence', fil: 'Ebidensya' },
  'ask.actions': { en: 'What you could do', fil: 'Maaaring gawin' },

  // --- Ask: by voice, and answered out loud --------------------------------
  //
  // The two halves of the same loop, so they are named the same way: `ask.voice*`
  // is the owner speaking, `ask.speak*` is SeePat answering.
  'ask.voiceAsk': { en: 'Ask by voice', fil: 'Itanong sa boses' },
  'ask.voiceListening': { en: 'Listening — tap to stop', fil: 'Nakikinig — pindutin para itigil' },
  'ask.voiceTranscribing': { en: 'Writing it down…', fil: 'Isinusulat…' },
  'ask.voiceHint': {
    en: 'Say it the way you would say it to a person — “How much did I earn this week?”',
    fil: 'Sabihin ito sa paraang sasabihin mo sa tao — “Magkano ang kita ko ngayong linggo?”',
  },
  'ask.voiceNoEngine': {
    en: 'This browser cannot listen to speech. Type the question — the answer is the same.',
    fil: 'Hindi nakikinig sa pagsasalita ang browser na ito. I-type ang tanong — pareho ang sagot.',
  },
  'ask.askedOutLoud': { en: 'You asked out loud', fil: 'Itinanong mo nang malakas' },
  'ask.speak': { en: 'Hear the answer', fil: 'Pakinggan ang sagot' },
  'ask.speakStop': { en: 'Stop reading', fil: 'Itigil ang pagbasa' },
  'ask.speaking': { en: 'SeePat is reading it…', fil: 'Binabasa ni SeePat…' },
  'ask.speakAuto': { en: 'SeePat reads answers', fil: 'Binabasa ni SeePat ang sagot' },
  'ask.speakAccented': {
    en: 'This phone has no Tagalog voice, so the answer is read in an English voice.',
    fil: 'Walang boses Tagalog ang phone na ito, kaya binabasa ang sagot sa boses na English.',
  },
  'ask.speakNoVoice': {
    en: 'This phone has no voice for reading answers out loud. Everything is written on the screen.',
    fil: 'Walang boses na pambasa ng sagot sa phone na ito. Nasa screen ang lahat.',
  },
  'ask.didYouMean': { en: 'Did you mean one of these?', fil: 'Ito ba ang ibig mong sabihin?' },

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
  'record.field.channel': { en: 'Where did the money go in?', fil: 'Saan pumasok ang pera?' },
  'record.channel.cash': { en: 'Cash in the box', fil: 'Cash sa kahon' },
  'record.channel.gcash': { en: 'GCash', fil: 'GCash' },
  'record.channel.maya': { en: 'Maya', fil: 'Maya' },
  'record.channel.bank': { en: 'Bank transfer', fil: 'Bank transfer' },
  'record.channelNote': {
    en: 'This sale is counted as money you already have, but not as cash in the box — so your drawer count at the end of the day still comes out right.',
    fil: 'Bilang perang nasa iyo na ang bentang ito, pero hindi bilang cash sa kahon — para tumama pa rin ang bilang ng kahon mo sa gabi.',
  },
  // The one sentence that keeps business capital and household money apart.
  // A withdrawal is a *use of capital*, not a cost of trading: entered as
  // "gastos" it would make a profitable week look like a losing one, and the
  // owner would have no way to see that she was paying herself, not the shop.
  'record.withdrawalNote': {
    en: 'This is money you took home for yourself — not a business expense. It comes out of your capital, so it never makes your profit look smaller than it is.',
    fil: 'Ito ang perang inuwi mo para sa sarili mo — hindi gastos ng negosyo. Kabawas ito sa puhunan mo, kaya hindi nito pinapaliit ang kita mo.',
  },
  'record.field.unitPrice': { en: 'Price each', fil: 'Presyo bawat isa' },
  // For anything sold by weight the price is per kilo, and the label says so:
  // "Price each" on a sack of rice is what invited a per-gram price, and a
  // per-gram price is a thousand-fold mistake.
  'record.field.pricePerKilo': { en: 'Price per kilo', fil: 'Presyo kada kilo' },
  'record.field.costPerKilo': { en: 'Cost per kilo', fil: 'Puhunan kada kilo' },
  'record.priceRecording': {
    en: 'Will be recorded as {amount} per kilo.',
    fil: 'Itatala bilang {amount} kada kilo.',
  },
  'record.field.customer': { en: 'Customer', fil: 'Customer' },
  'record.field.amount': { en: 'Amount (₱)', fil: 'Halaga (₱)' },
  'record.field.notNeeded': { en: 'not needed', fil: 'Hindi kailangan' },
  'record.select': { en: 'Choose…', fil: 'Pumili…' },
  'record.walkIn': { en: 'Walk-in', fil: 'Walk-in' },
  'record.recentTitle': { en: 'Your records', fil: 'Mga naitala mo' },
  'record.kind.sale': { en: 'Sale', fil: 'Benta' },
  'record.kind.credit': { en: 'Utang', fil: 'Utang' },
  'record.kind.expense': { en: 'Expense', fil: 'Gastos' },
  'record.kind.purchase': { en: 'Purchase', fil: 'Bili' },
  'record.kind.payment': { en: 'Payment', fil: 'Bayad' },
  'record.kind.capital': { en: 'Capital', fil: 'Puhunan' },
  'record.kind.withdrawal': { en: 'Taken out', fil: 'Kinuha' },
  'record.kind.fixedAsset': { en: 'Equipment', fil: 'Kagamitan' },
  'record.kind.supplierPayment': { en: 'Paid the supplier', fil: 'Bayad sa supplier' },
  'record.kind.stockAdjustment': { en: 'Stock correction', fil: 'Pagwawasto ng paninda' },
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
  'record.voidAria': { en: 'Delete {what}', fil: 'Burahin ang {what}' },
  'record.deleteTitle': { en: 'Delete this record?', fil: 'Burahin ang rekord na ito?' },
  'record.deleteBody': {
    en: 'It will be removed from your records. You can still undo right after.',
    fil: 'Maaalis ito sa rekord mo. Puwede mo pa itong i-undo pagkatapos.',
  },
  'record.deleteConfirm': { en: 'Delete', fil: 'Burahin' },
  'record.deleteCancel': { en: 'Keep it', fil: 'Huwag burahin' },
  'record.deleted': { en: 'Record deleted.', fil: 'Nabura ang rekord.' },
  'record.deleteUndone': { en: 'Record restored.', fil: 'Naibalik ang rekord.' },
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
  // "{n} pieces", not "{n} items": a single sale used to read "1 items", and
  // there is no plural machinery in the table — a unit that does not change
  // shape removes the question instead of adding a rule. `{n}` is the total
  // quantity, so the number and the word always agree.
  // A row that names the goods. "Sale — 4 pieces" was true and useless: an
  // owner scrolling their own ledger could not tell a Coke run from a rice run
  // without opening every row, and searching for "coke" matched nothing. The
  // count phrasing below survives as the fallback for the one case where the
  // item genuinely cannot be named — a record whose SKU is not in the book.
  'record.row.item': { en: '{n} × {item}', fil: '{n} × {item}' },
  'record.row.itemWeighed': { en: '{item} — {qty} {unit}', fil: '{item} — {qty} {unit}' },
  'record.row.items': { en: '{item} +{n} more', fil: '{item} +{n} pa' },
  'record.row.sale': { en: 'Sale — {n} pieces', fil: 'Benta — {n} piraso' },
  // For fractional quantities (rice, sugar, anything sold by weight) there is no
  // "pieces" count that would be true, so the row says what it is and the amount
  // beside it carries the figure.
  'record.row.saleLoose': { en: 'Sale — by weight', fil: 'Benta — binili sa timbang' },
  'record.row.credit': { en: 'Utang — {name}', fil: 'Utang — {name}' },
  'record.row.payment': { en: 'Paid by {name}', fil: 'Bayad ni {name}' },
  'record.row.purchase': { en: 'Purchase — {n} pieces', fil: 'Bili — {n} piraso' },
  'record.row.purchaseLoose': { en: 'Purchase — by weight', fil: 'Bili — sa timbang' },
  'record.row.stockAdjustment': {
    en: 'Stock correction — {qty}',
    fil: 'Pagwawasto ng paninda — {qty}',
  },

  // --- My items -----------------------------------------------------------
  // The screen that turned the app from a demo into a shop's book: before it,
  // a record could only be written against the ten seeded products.
  'items.title': { en: 'My items', fil: 'Mga paninda ko' },
  'items.hint': { en: 'the things you sell', fil: 'ang mga tinda mo' },
  'items.intro': {
    en: 'These are the products you sell. Add your own and the ledger, the voice and the Score all work with them — the price is remembered from your last sale, so you only type it once.',
    fil: 'Ito ang mga paninda mo. Magdagdag ka ng sarili mo at gagana sa kanila ang tala, ang boses at ang Score — natatandaan ang presyo mula sa huling benta mo, kaya minsan mo lang itong isusulat.',
  },
  'items.add': { en: '+ Add an item', fil: '+ Magdagdag ng paninda' },
  'items.addTitle': { en: 'Add an item', fil: 'Magdagdag ng paninda' },
  'items.editTitle': { en: 'Edit item', fil: 'Baguhin ang paninda' },
  'items.namePlaceholder': { en: 'E.g. Coke Mismo', fil: 'Hal. Coke Mismo' },
  'items.fieldName': { en: 'Item name', fil: 'Pangalan ng paninda' },
  'items.fieldUnit': { en: 'Sold by', fil: 'Ibinebenta sa' },
  'items.unit.pc': { en: 'Piece', fil: 'Piraso' },
  'items.unit.pack': { en: 'Pack', fil: 'Pakete' },
  'items.unit.bottle': { en: 'Bottle', fil: 'Bote' },
  'items.unit.sachet': { en: 'Sachet', fil: 'Sachet' },
  'items.unit.kg': { en: 'Kilo', fil: 'Kilo' },
  'items.unit.tray': { en: 'Tray', fil: 'Tray' },
  'items.save': { en: 'Save item', fil: 'I-save ang paninda' },
  'items.count': { en: '{n} items', fil: '{n} paninda' },
  'items.search': { en: 'Search your items…', fil: 'Hanapin ang paninda mo…' },
  'items.lastPrice': { en: 'last sold at {amount}', fil: 'huling benta sa {amount}' },
  'items.noPrice': { en: 'no sale yet', fil: 'wala pang benta' },
  'items.emptyTitle': { en: 'No items yet', fil: 'Wala pang paninda' },
  'items.emptyBody': {
    en: 'Add the products on your shelf — even just the ten you sell most. Then recording a sale is two taps.',
    fil: 'Idagdag ang mga nasa shelf mo — kahit ang sampung pinakamadalas mong tinda lang. Kapag mayroon na, dalawang pindot na lang ang pagtala ng benta.',
  },
  'items.notFound': { en: 'Nothing matches that name.', fil: 'Walang tumugmang pangalan.' },
  'items.added': { en: 'Added {name}.', fil: 'Naidagdag ang {name}.' },
  'items.updated': { en: 'Item updated.', fil: 'Na-update ang paninda.' },
  'items.removed': { en: 'Item deleted.', fil: 'Nabura ang paninda.' },
  'items.needName': { en: 'Type the name of the item.', fil: 'Isulat ang pangalan ng paninda.' },
  'items.taken': {
    en: 'You already have an item called that. Open it and change it instead.',
    fil: 'May paninda ka nang ganiyan ang pangalan. Buksan na lang iyon at baguhin.',
  },
  'items.edit': { en: 'Edit', fil: 'Baguhin' },
  'items.deleteTitle': { en: 'Delete this item?', fil: 'Burahin ang paninda na ito?' },
  'items.deleteBody': {
    en: 'It stops appearing when you record, and it leaves this list. Records you already made keep their name and their amount.',
    fil: 'Hindi na ito lalabas kapag nagtala ka, at mawawala sa listahang ito. Ang mga naitala mo na ay may pangalan at halaga pa rin.',
  },
  'items.deleteConfirm': { en: 'Delete', fil: 'Burahin' },
  'items.deleteCancel': { en: 'Keep it', fil: 'Huwag burahin' },
  'items.manage': { en: 'My items', fil: 'Mga paninda ko' },

  // --- Utang (who owes you) ------------------------------------------------
  'utang.title': { en: 'Utang list', fil: 'Listahan ng utang' },
  'utang.hint': { en: 'who owes you', fil: 'sino ang may utang' },
  'utang.semanticsTitle': { en: 'What utang means here', fil: 'Ano ang ibig sabihin ng utang dito' },
  'utang.semanticsBody': {
    en: 'Utang is a sale that already happened — the goods left your shelf — so it is counted in Sales and in your profit. What it is not is cash, and that is why it also shows as owed to you. Collect it and the cash arrives.',
    fil: 'Ang utang ay bentang nangyari na — umalis na ang paninda sa shelf mo — kaya kasama ito sa Benta at sa kita. Ang hindi ito ay cash, at iyon ang dahilan kung bakit nasa utang sa iyo rin ito nakalagay. Kapag nakolekta, darating ang cash.',
  },
  'utang.total': { en: 'Owed to you', fil: 'Utang sa iyo' },
  'utang.people': { en: '{n} people', fil: '{n} tao' },
  'utang.none': { en: 'Nobody owes you right now.', fil: 'Walang may utang sa iyo ngayon.' },
  'utang.noneBody': {
    en: 'When a customer takes goods and pays later, their balance appears here — with their name on it, so it can be collected.',
    fil: 'Kapag may customer na kumuha ng paninda at mamaya pa magbabayad, lalabas dito ang balanse niya — may pangalan, para makolekta.',
  },
  'utang.today': { en: 'today', fil: 'ngayon' },
  'utang.days': { en: '{n} days', fil: '{n} araw' },
  'utang.oldest': { en: 'oldest unpaid: {n} days', fil: 'pinakamatagal: {n} araw' },
  'utang.neverPaid': { en: 'never paid anything yet', fil: 'wala pang nababayaran' },
  'utang.pay': { en: 'Payment', fil: 'Bayad' },
  'utang.payTitle': { en: 'Payment from {name}', fil: 'Bayad ni {name}' },
  'utang.payField': { en: 'Amount received (₱)', fil: 'Halagang natanggap (₱)' },
  'utang.payFull': { en: 'Full {amount}', fil: 'Buong {amount}' },
  'utang.payConfirm': { en: 'Record the payment', fil: 'Itala ang bayad' },
  'utang.paid': { en: 'Recorded: {amount} from {name}.', fil: 'Naitala: {amount} mula kay {name}.' },
  'utang.payNeedAmount': { en: 'Type the amount received.', fil: 'Isulat ang halagang natanggap.' },
  'utang.remind': { en: 'Remind', fil: 'Paalala' },
  'utang.remindTitle': { en: 'Reminder you can send', fil: 'Paalalang puwede mong ipadala' },
  'utang.remindHint': {
    en: 'Send it as a message, then mark the payment here once it is paid.',
    fil: 'Ipadala ito bilang mensahe, tapos itala ang bayad dito kapag nagbayad na.',
  },
  'utang.remindBody': {
    en: 'Good day {name}! ₱{amount} pa po ang utang ninyo sa tindahan. Salamat po!',
    fil: 'Magandang araw {name}! ₱{amount} pa po ang utang ninyo sa tindahan. Salamat po!',
  },
  'utang.remindShare': { en: 'Send it', fil: 'Ipadala' },
  'utang.remindCopy': { en: 'Copy the message', fil: 'Kopyahin ang mensahe' },
  'utang.remindCopied': {
    en: 'Message copied — paste it in your chat.',
    fil: 'Nakopya ang mensahe — i-paste sa chat mo.',
  },
  'utang.newCustomer': { en: '+ New customer', fil: '+ Bagong customer' },
  'utang.customerField': { en: 'Customer’s name', fil: 'Pangalan ng customer' },
  'utang.customerPlaceholder': { en: 'E.g. Aling Nena', fil: 'Hal. Aling Nena' },
  'utang.customerSave': { en: 'Save customer', fil: 'I-save ang customer' },
  'utang.customerAdded': { en: 'Added {name}.', fil: 'Naidagdag si {name}.' },
  'utang.customerSaved': { en: 'Customer updated.', fil: 'Na-update ang customer.' },
  'utang.customerNeedName': { en: 'Type the customer’s name.', fil: 'Isulat ang pangalan ng customer.' },
  'utang.customerTaken': {
    en: 'That name is already on the list. Open it instead.',
    fil: 'Nasa listahan na ang pangalang iyan. Buksan na lang iyon.',
  },
  'utang.customerDelete': { en: 'Remove from the list', fil: 'Alisin sa listahan' },
  'utang.customerOwing': {
    en: 'They still owe {amount}. Collect it before removing them.',
    fil: 'May utang pa silang {amount}. Kolektahin muna bago alisin.',
  },
  'utang.walkInName': { en: 'Walk-in', fil: 'Walk-in' },
  'utang.openLedger': { en: 'See the records', fil: 'Tingnan ang mga naitala' },
  'utang.statement': {
    en: 'The whole list — send it or print it',
    fil: 'Buong listahan — ipadala o i-print',
  },
  'utang.statementHint': {
    en: 'Send it to whoever collects for you, or print it and tick each name off as it is paid.',
    fil: 'Ipadala sa mangongolekta, o i-print at tsekan ang bawat pangalan kapag nagbayad na.',
  },
  'utang.statementTitle': { en: 'Utang list — {shop}', fil: 'Listahan ng Utang — {shop}' },
  'utang.statementAsOf': { en: 'As of', fil: 'Hanggang' },
  'utang.statementTotal': { en: 'Still unpaid', fil: 'Hindi pa nababayaran' },
  'utang.statementCount': {
    en: '{n} customers with utang',
    fil: '{n} customer ang may utang',
  },
  'utang.statementNoShop': { en: 'My store', fil: 'Aking tindahan' },
  'utang.statementSigned': { en: 'From {shop}', fil: 'Mula sa {shop}' },
  'utang.statementNote': {
    en: 'This is the shop’s own record of utang. It is not a BIR official receipt.',
    fil: 'Sariling tala ito ng tindahan sa utang. Hindi ito official receipt ng BIR.',
  },
  'utang.statementColName': { en: 'Customer', fil: 'Customer' },
  'utang.statementColAmount': { en: 'Amount owed', fil: 'Halagang utang' },
  'utang.statementShopField': {
    en: 'Shop name (it appears at the top of the list)',
    fil: 'Pangalan ng tindahan (lalabas sa itaas ng listahan)',
  },
  'utang.statementShopPlaceholder': { en: 'E.g. Nena Store', fil: 'Hal. Nena Store' },
  'utang.statementShare': { en: 'Send the list', fil: 'Ipadala ang listahan' },
  'utang.statementPrint': { en: 'Print', fil: 'I-print' },
  'utang.statementPrintHint': {
    en: 'Choose “Save as PDF” in the print dialog if you want to keep a copy.',
    fil: 'Piliin ang "Save as PDF" sa print dialog kung gusto mong may kopya ka.',
  },

  // --- Voice --------------------------------------------------------------
  'voice.title': { en: 'Sipat Voice', fil: 'Sipat Voice' },
  'voice.error.noItems': {
    en: 'No known items recognised. Try different words.',
    fil: 'Walang nakilalang paninda. Subukan ang ibang salita.',
  },
  'voice.error.noEngine': {
    en: 'That voice is not available on this phone.',
    fil: 'Hindi available ang boses na iyon sa phone na ito.',
  },
  'voice.error.nothingHeard': {
    en: 'The mic stopped without hearing any words. Try again, closer to the phone.',
    fil: 'Tumigil ang mic na walang narinig na salita. Subukan muli, ilapit sa phone.',
  },
  'voice.switchOffline': {
    en: 'Use the offline voice instead',
    fil: 'Gamitin na lang ang boses na offline',
  },
  'voice.lockedBody': {
    en: 'Voice is part of PRO. Typing below keeps working, and nothing you have already recorded changes — it all stays on your phone.',
    fil: 'Ang boses ay kasama sa PRO. Patuloy na gumagana ang pag-i-type sa ibaba, at hindi nagbabago ang anumang naitala mo — nasa device mo pa rin lahat ng ito.',
  },
  'voice.stopListening': { en: 'Stop listening', fil: 'Itigil ang pakikinig' },
  'voice.startListening': { en: 'Start listening', fil: 'Magsimulang makinig' },
  'voice.status.transcribing': {
    en: 'Writing down what you said… this can take a few seconds',
    fil: 'Isinusulat ang sinabi mo… maaaring tumagal ng ilang segundo',
  },
  'voice.status.listening': { en: 'Listening…', fil: 'Nakikinig…' },
  'voice.status.prompt': {
    en: 'Press and say the transaction',
    fil: 'Pindutin at sabihin ang transaksyon',
  },
  'voice.offlineTitle': { en: 'Voice Without Internet', fil: 'Boses Kahit Walang Internet' },
  'voice.typeTitle': { en: 'Type What You Said', fil: 'I-type ang Sinabi Mo' },
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
  // The draft now arrives as a sheet, because a confirmation that scrolls is a
  // confirmation that gets skimmed. Its own copy:
  'voice.draftSheetTitle': { en: 'Confirm the record', fil: 'Kumpirmahin ang tala' },
  'voice.draftSheetHint': {
    en: 'Nothing is saved until you tap the button at the bottom.',
    fil: 'Walang nai-save hanggang pindutin mo ang button sa ibaba.',
  },
  'voice.fieldKind': { en: 'What kind of record', fil: 'Anong uri ng tala' },
  'voice.kindUtang': { en: 'Utang (not cash yet)', fil: 'Utang (hindi pa cash)' },
  'voice.page': { en: 'Items {n} of {total}', fil: 'Paninda {n} ng {total}' },
  'voice.pagePrev': { en: 'Previous', fil: 'Nauna' },
  'voice.pageNext': { en: 'Next', fil: 'Susunod' },
  'voice.unresolved': { en: 'Not understood: {what}', fil: 'Hindi naintindihan: {what}' },
  'voice.noLines': {
    en: 'Nothing was recognised. Fix the words, then try again.',
    fil: 'Walang nakilala. Ayusin ang mga salita, tapos subukan muli.',
  },
  'voice.utangNeedsName': {
    en: 'Who took it on utang? A name is what makes it collectable.',
    fil: 'Sino ang umutang? Ang pangalan ang dahilan kaya makokolekta ito.',
  },
  'voice.field.customerUtang': { en: 'Customer (utang)', fil: 'Customer (utang)' },
  'voice.engineLabel': { en: 'Listening with', fil: 'Nakikinig gamit ang' },
  'voice.engineUnavailable': { en: '— unavailable', fil: '— hindi available' },
  'voice.offlineWorks': { en: 'Working offline', fil: 'Gumagana offline' },
  'voice.offlineIntro': {
    // `{mb}` rather than a hardcoded figure: this string used to promise 47MB
    // while the catalogue said 42MB, and a download size is not a number to keep
    // in two places.
    en: 'The voice you are using now needs the internet — it sends what you say to Google to be written down. Download the offline voice instead (about {mb}MB, once) and your phone understands you with no signal at all. It is free, and it runs on your phone.',
    fil: 'Ang ginagamit mong boses ngayon ay kailangan ng internet — ipinapadala nito ang sinasabi mo sa Google para isulat. Kung i-download mo ang boses na offline (mga {mb}MB, isang beses lang), maiintindihan ng phone mo ang sinasabi mo kahit walang signal. Libre ito, at tumatakbo sa phone mo.',
  },
  'voice.downloadModel': {
    en: 'Download the offline voice',
    fil: 'I-download ang boses na offline',
  },
  'voice.makeDraft': { en: 'Turn into a draft', fil: 'Gawing draft' },
  'voice.samples': { en: 'Try one', fil: 'Subukan ang isa' },
  'voice.confirmIntro': {
    en: 'Check the amount and the price before you save it — a misheard number is the one thing that can go wrong here.',
    fil: 'Suriin ang dami at presyo bago itala — ang numero na hindi tama ang narinig ang tanging puwedeng magkamali dito.',
  },
  'voice.appendHint': {
    en: 'More items to add? Tap the mic again and keep talking — the new items join this draft instead of replacing it.',
    fil: 'May idagdag pa? Pindutin ulit ang mic at magsalita pa — sasama ang mga bagong paninda sa draft na ito sa halip na palitan ito.',
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
  'voice.addLine': { en: '+ Add item the mic missed', fil: '+ Idagdag ang panindang hindi narinig' },
  'voice.removeLine': { en: 'Remove line', fil: 'Alisin ang linya' },
  'voice.needAll': { en: 'Every line needs an item, a quantity, and a price.', fil: 'Bawat linya ay kailangan ng paninda, dami, at presyo.' },

  // --- Receipt (Resibo-to-Draft) --------------------------------------------
  'tab.receipt': { en: 'Receipt', fil: 'Resibo' },
  'receipt.captureTitle': { en: 'Scan a supplier receipt', fil: 'I-scan ang resibo ng supplier' },
  'receipt.step1Hint': { en: 'photo → draft → confirm', fil: 'larawan → draft → kumpirma' },
  'receipt.captureBody': {
    en: 'Take a photo of the receipt. The app drafts the purchase — you check it before anything is recorded.',
    fil: 'Kuhanan ng larawan ang resibo. Gagawa ang app ng draft ng bili — suriin mo muna bago may maitala.',
  },
  'receipt.engineMock': { en: 'Sample OCR', fil: 'Sample OCR' },
  'receipt.engineTesseract': { en: 'Offline OCR', fil: 'Offline OCR' },
  'receipt.engineNote': {
    en: 'Downloads once with internet, then works with no signal. First scan may take ~10–20s on a cheap phone.',
    fil: 'Isang beses lang i-download na may internet, tapos gumagana kahit walang signal. Ang unang scan ay ~10–20s sa murang phone.',
  },
  'receipt.takePhoto': { en: 'Take a photo', fil: 'Kuhanan ng larawan' },
  'receipt.trySample': { en: 'Try a sample', fil: 'Subukan ang sample' },
  'receipt.working': { en: 'Reading…', fil: 'Binabasa…' },
  'receipt.reviewTitle': { en: 'Check the draft', fil: 'Suriin ang draft' },
  'receipt.supplier': { en: 'Supplier', fil: 'Supplier' },
  'receipt.supplierPh': { en: 'e.g. Puregold Dingle', fil: 'hal. Puregold Dingle' },
  'receipt.qty': { en: 'Qty', fil: 'Dami' },
  'receipt.costEach': { en: 'Cost each', fil: 'Puhunan bawat isa' },
  'receipt.costKilo': { en: 'Cost per kilo', fil: 'Puhunan kada kilo' },
  'receipt.lineTotal': { en: 'Total', fil: 'Kabuuan' },
  'receipt.match': { en: 'Match to item', fil: 'Itugma sa paninda' },
  'receipt.newItem': { en: 'New item', fil: 'Bagong paninda' },
  'receipt.newItemOpt': { en: 'New item…', fil: 'Bagong paninda…' },
  'receipt.createNew': { en: 'Create “{name}” on confirm', fil: 'Gawin ang “{name}” pag kinumpirma' },
  'receipt.flagNew': { en: 'new item?', fil: 'bagong paninda?' },
  'receipt.flagPrice': { en: 'check price', fil: 'i-check ang presyo' },
  'receipt.flagCheck': { en: 'please check', fil: 'pakisuri' },
  'receipt.removeLine': { en: 'Remove line', fil: 'Alisin ang linya' },
  'receipt.addLine': { en: '+ Add item the camera missed', fil: '+ Idagdag ang panindang hindi nakita' },
  'receipt.cameraTitle': { en: 'Take a photo of the receipt', fil: 'Kuhanan ng larawan ang resibo' },
  'receipt.cameraCapture': { en: 'Capture', fil: 'Kunan' },
  'receipt.cameraSwitch': { en: 'Switch camera (front / back)', fil: 'Palitan ang camera (harap / likod)' },
  'receipt.cameraRetake': { en: 'Retake', fil: 'Ulitin' },
  'receipt.cameraUse': { en: '✓ Use this photo', fil: '✓ Gamitin ang larawang ito' },
  'receipt.cameraCancel': { en: 'Cancel', fil: 'Kansel' },
  'receipt.cameraDenied': { en: 'Camera is blocked — allow it, or choose a photo from your files instead.', fil: 'Naka-block ang camera — payagan ito, o pumili na lang ng larawan mula sa files.' },
  'receipt.cameraChooseFile': { en: 'Choose a photo from files instead', fil: 'Pumili ng larawan mula sa files' },
  'receipt.kiloNote': { en: 'Qty is in kilos here; it is stored in grams.', fil: 'Kilo ang dami dito; gramo ang itinatala.' },
  'receipt.totalsMismatch': { en: 'Lines add to {amount} but the receipt says {total} — please check.', fil: 'Ang mga linya ay {amount} pero ang resibo ay {total} — pakisuri.' },
  'receipt.needAll': { en: 'Every line needs an item, a quantity, and a price.', fil: 'Bawat linya ay kailangan ng paninda, dami, at presyo.' },
  'receipt.confirm': { en: 'Confirm and record · {amount}', fil: 'Kumpirmahin at itala · {amount}' },
  'receipt.noText': { en: 'No text found in this photo — point the camera at the receipt and retake it.', fil: 'Walang tekstong nakita sa larawang ito — itutok ang camera sa resibo at kuhanan muli.' },
  'receipt.discard': { en: 'Discard draft', fil: 'Itapon ang draft' },
  'receipt.recentTitle': { en: 'Scanned', fil: 'Nai-scan na' },

  // --- Offline --------------------------------------------------------------
  'offline.statusTitle': { en: 'Status', fil: 'Kalagayan' },
  'offline.hintConnected': { en: 'connected', fil: 'may koneksyon' },
  'offline.hintNotConnected': { en: 'no connection', fil: 'walang koneksyon' },
  'offline.connected': { en: 'Connected to the internet', fil: 'Naka-konekta sa internet' },
  'offline.disconnected': {
    en: 'Offline — you can still record sales',
    fil: 'Offline — puwede ka pa ring magtala ng benta',
  },
  'offline.shellCached': {
    en: 'Can be opened with no internet',
    fil: 'Kayang buksan kahit walang internet',
  },
  'offline.cachedYes': { en: 'Yes, once it is saved', fil: 'Oo, kapag naka-save na' },
  'offline.cachedNo': { en: 'Not yet — open it once with internet', fil: 'Hindi pa — buksan minsan na may internet' },
  'offline.installedAsApp': { en: 'Installed as an app', fil: 'Naka-install bilang app' },
  'offline.yes': { en: 'Yes', fil: 'Oo' },
  'offline.inBrowser': { en: 'No (in the browser)', fil: 'Hindi (nasa browser)' },
  'offline.micForModel': {
    en: 'Microphone for the offline voice',
    fil: 'Mikropono para sa boses na offline',
  },
  'offline.supported': { en: 'Works here', fil: 'Gumagana dito' },
  'offline.notSupported': { en: 'Does not work here', fil: 'Hindi gumagana dito' },
  'offline.storageUsed': { en: 'Space used on your phone', fil: 'Espasyong ginagamit sa phone mo' },
  'offline.storageAlmostNothing': { en: 'Almost nothing yet', fil: 'Halos wala pa' },
  'offline.worksTitle': { en: 'Works With No Internet', fil: 'Gumagana Kahit Walang Internet' },
  'offline.worksHint': { en: 'no internet needed', fil: 'hindi kailangan ng internet' },
  'offline.worksBody': {
    en: 'All of this runs on your phone, which is why it is free — and why losing signal never changes it.',
    fil: 'Tumatakbo lahat ng ito sa phone mo, kaya libre — at kaya hindi ito nababago ng kawalan ng signal.',
  },
  'offline.needsTitle': { en: 'Needs Internet', fil: 'Kailangan ng Internet' },
  'offline.needsHint': { en: 'these need a connection', fil: 'kailangan ng koneksyon' },
  'offline.needsBody': {
    en: 'Nothing is lost when the signal drops — everything is saved on your phone and goes out when the connection comes back.',
    fil: 'Walang nawawala kapag nawalan ng signal — naka-save lahat sa phone mo at ipapadala kapag bumalik ang koneksyon.',
  },
  'offline.voiceModelTitle': { en: 'Voice With No Internet', fil: 'Boses Kahit Walang Internet' },
  'offline.onceHint': { en: 'one time only', fil: 'isang beses lang' },
  'offline.modelIntro': {
    en: 'The voice you use now needs the internet, because it sends what you say to Google. Download this one instead and your phone understands you with no signal at all. It is free, and it runs on your phone — never on ours.',
    fil: 'Ang ginagamit mong boses ngayon ay kailangan ng internet, dahil ipinapadala nito ang sinasabi mo sa Google. I-download mo ito at maiintindihan ng phone mo ang sinasabi mo kahit walang signal. Libre ito, at tumatakbo sa phone mo — hindi sa amin.',
  },
  'offline.freePill': { en: 'FREE', fil: 'LIBRE' },
  'offline.cannotShip': { en: 'Cannot be shipped', fil: 'Hindi maaaring i-ship' },
  'offline.installedPill': { en: 'Installed', fil: 'Naka-install' },
  'offline.licensePrefix': { en: 'Licence:', fil: 'Lisensya:' },
  'offline.sizeNote': {
    en: 'About {mb}MB to download, once, with everything it needs included. The exact size is shown once it is installed.',
    fil: 'Mga {mb}MB na download, isang beses lang, kasama na lahat ng kailangan nito. Ang eksaktong sukat ay makikita kapag naka-install na.',
  },
  'offline.warming': { en: 'Getting the voice ready…', fil: 'Inihahanda ang boses…' },
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
    en: 'The download did not finish. Check your internet, then try again.',
    fil: 'Hindi natapos ang pag-download. Suriin ang internet mo, tapos subukan muli.',
  },
  'offline.installedOn': {
    en: 'Installed on {date} · {mb} saved on your phone.',
    fil: 'Naka-install noong {date} · {mb} na naka-save sa phone mo.',
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
  'plan.simulatedBody': {
    en: 'This is a demo, so no real payment happens and no card or wallet number leaves your phone. The plan is saved on this device only.',
    fil: 'Demo lamang ito, kaya walang totoong bayad na nangyayari at walang card o wallet number na lumalabas sa phone mo. Naka-save ang plano sa device na ito lang.',
  },
  'plan.badgeBest': { en: 'Best value', fil: 'Pinakasulit' },
  'plan.badgeCurrent': { en: 'Current', fil: 'Kasalukuyan' },
  'plan.institutionalHint': { en: 'For institutions', fil: 'Para sa mga institusyon' },
  'plan.contact': { en: 'Get in touch', fil: 'Makipag-ugnayan' },
  'plan.receiptsTitle': { en: 'Receipts', fil: 'Mga Resibo' },
  'plan.whyPriceTitle': { en: 'Why the price is what it is', fil: 'Bakit ganito ang presyo' },
  'plan.whyPriceBody': {
    en: 'Everything that runs on your phone is free — the voice, the offline voice, the whole ledger, and the Score with its week-by-week history — because none of it needs anything from us. You pay only for the two parts that need an internet service of ours: the AI explanation, and a safe copy of your records that survives a lost phone.',
    fil: 'Libre ang lahat ng tumatakbo sa phone mo — ang boses, ang boses na offline, ang buong tala, at ang Score kasama ang kasaysayan nito linggo-linggo — dahil wala sa kanilang kailangan ng serbisyo namin. Ang binabayaran mo lang ay ang dalawang bahaging kailangan ng serbisyong pang-internet namin: ang paliwanag ng AI, at ang safe na kopya ng rekord mo na hindi mawawala kahit mapalitan ang phone.',
  },
  'plan.whyPriceFoot': {
    en: 'That is why cancelling never leaves you holding a paid feature: you are paying for a service, not for a file.',
    fil: 'Kaya kahit mag-kansel ka, walang bayad na feature na natitira sa iyo na hindi na gumagana: serbisyo ang binabayaran, hindi file.',
  },
  'plan.aiMeterNote': {
    en: 'The AI explanation is the only part that costs us every time it runs. It is capped at {n} questions a month, and you are never billed without knowing.',
    fil: 'Ang paliwanag ng AI lang ang may gastos sa amin tuwing gagamitin. Limitado sa {n} tanong bawat buwan, at hindi ka sisingilin nang hindi mo alam.',
  },
  'plan.aiMeterLabel': { en: 'AI explanation', fil: 'Paliwanag ng AI' },
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
  'plan.annualNote': { en: 'or {amount}/year', fil: 'o {amount}/taon' },
  'plan.perYear': { en: '/year', fil: '/taon' },
  'plan.billingPeriod': { en: 'Billing period', fil: 'Panahon ng bayad' },
  'plan.monthly': { en: 'Monthly', fil: 'Buwanan' },
  'plan.annual': { en: 'Yearly', fil: 'Taunan' },
  'plan.periodToggle': { en: 'Billing', fil: 'Bayad' },
  'plan.saveAnnual': { en: 'Save {amount}', fil: 'Tipid {amount}' },
  'plan.freeStamp': { en: 'Libre · habang-buhay', fil: 'Libre · habang-buhay' },
  'plan.proStamp': { en: 'Pinakasulit', fil: 'Pinakasulit' },
  'plan.topFeatures': { en: "What you'll use daily", fil: 'Gagamitin mo araw-araw' },
  'plan.allFeatures': { en: "What's included", fil: 'Kasama dito' },
  'plan.showMore': { en: 'Show all ({n})', fil: 'Ipakita lahat ({n})' },
  'plan.showLess': { en: 'Show less', fil: 'Itago' },
  'plan.freeFor': { en: 'For starting out', fil: 'Para sa nagsisimula' },
  'plan.proFor': { en: 'For steady stores', fil: 'Para sa tuloy-tuloy na tindahan' },
  'plan.proPays': {
    en: 'PRO pays for itself if one tip saves you ₱4 a day.',
    fil: 'Sulit ang PRO kung isang tip ay nakakatipid ng ₱4 kada araw.',
  },
  'dash.profitToday': { en: 'Real profit today', fil: 'Tunay na kita ngayon' },
  'dash.greetMorning': { en: 'Good morning!', fil: 'Magandang umaga!' },
  'dash.greetAfternoon': { en: 'Good afternoon!', fil: 'Magandang hapon!' },
  'dash.greetEvening': { en: 'Good evening!', fil: 'Magandang gabi!' },
  'app.settingsAccount': { en: 'Account', fil: 'Account' },
  'app.settingsShop': { en: 'Tindahan', fil: 'Tindahan' },
  'app.settingsVoice': { en: 'Boses', fil: 'Boses' },
  'app.settingsApp': { en: 'App', fil: 'App' },
  'app.settingsData': { en: 'Data on this phone', fil: 'Data sa phone na ito' },
  'plan.cohortTitle': { en: 'For cooperatives and LGUs', fil: 'Para sa kooperatiba at LGU' },
  'plan.cohortBody': {
    en: 'One licence for many stores: an opt-in, aggregate view of how a cohort records, earns and completes — never any store\u2019s raw ledger.',
    fil: 'Isang lisensya para sa maraming tindahan: opt-in na pinagsamang tanaw kung paano nagtatala, kumikita at nakukumpleto ang grupo — hindi kailanman ang hilaw na libro ng isang tindahan.',
  },
  'backup.title': { en: 'Your records, kept safe', fil: 'Ang rekord mo, ligtas' },
  'backup.hint': { en: 'on this phone', fil: 'sa phone na ito' },
  'backup.body': {
    en: 'Save a copy of everything you recorded as one file, and bring it back any time. Nothing leaves your phone.',
    fil: 'Mag-save ng kopya ng lahat ng naitala mo bilang isang file, at ibalik ito kahit kailan. Walang umaalis sa phone mo.',
  },
  'backup.export': { en: 'Save a backup file', fil: 'Mag-save ng backup file' },
  'backup.import': { en: 'Bring back a backup', fil: 'Ibalik ang backup' },
  'backup.restored': { en: 'Backup restored.', fil: 'Naibalik ang backup.' },
  // Bringing a file back REPLACES the books, so it is asked about first and
  // undoable after. Naming both counts is the whole point: "replaces what is on
  // this phone (236 records) with what is in that file (18 records)" is a
  // sentence an owner can catch a wrong file with.
  'backup.replaceTitle': { en: 'Bring this backup back?', fil: 'Ibalik ang backup na ito?' },
  'backup.replaceBody': {
    en: 'This file holds {file} records. Bringing it back replaces the {now} records on this phone. You can undo it right after.',
    fil: 'May {file} rekord ang file na ito. Kapag ibinalik ito, mapapalitan ang {now} rekord na nasa phone na ito. Puwede mong i-undo pagkatapos.',
  },
  'backup.replaceConfirm': { en: 'Bring it back', fil: 'Ibalik ito' },
  'backup.replaceCancel': { en: 'Keep what is on this phone', fil: 'Itago ang nasa phone' },
  'backup.undo': { en: 'Undo', fil: 'I-undo' },
  'backup.invalid': { en: 'That file is not a SeePat backup.', fil: 'Hindi SeePat backup ang file na iyan.' },
  'backup.tooNew': {
    en: 'That backup comes from a newer SeePat. Update first, then restore.',
    fil: 'Galing sa mas bagong SeePat ang backup na iyan. Mag-update muna, tapos ibalik.',
  },
  'dash.bestTitle': { en: 'Best sellers', fil: 'Pinakamalakas na paninda' },
  'dash.bestHint': { en: 'This week', fil: 'Ngayong linggo' },
  'dash.bestEmpty': {
    en: 'No sales recorded yet in this window.',
    fil: 'Wala pang naitalang benta sa panahong ito.',
  },
  'dash.bestQty': { en: '{n} {unit} sold', fil: '{n} {unit} nabenta' },
  'restock.title': { en: 'Buy again soon', fil: 'Bilhin muli malapit na' },
  'restock.empty': { en: 'Nothing is running out this week.', fil: 'Walang mauubos ngayong linggo.' },
  'restock.days': { en: '{n} days left', fil: '{n} araw na lang' },
  'restock.out': { en: 'out of stock', fil: 'ubos na' },
  'report.print': { en: 'Print the week', fil: 'I-print ang linggo' },

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
  'welcome.start': { en: 'Show me my money', fil: 'Ipakita ang pera ko' },
  'welcome.step': { en: 'Step {n} of {total}', fil: 'Hakbang {n} ng {total}' },
  'welcome.languageLabel': { en: 'Language', fil: 'Wika' },
  'welcome.offlineVoice': { en: 'Offline voice', fil: 'Boses offline' },
  'welcome.tourAgain': { en: 'Show the intro again', fil: 'Ipakita ulit ang intro' },
  'welcome.demoNote': {
    en: 'These are sample records to try — about 233 of them, and not one of them is real money.',
    fil: 'Mga sample na rekord ito na puwede mong subukan — mga 233, at wala ni isa sa kanilang totoong pera.',
  },

  'welcome.speak.eyebrow': { en: 'Voice', fil: 'Boses' },
  // The spoken phrase stays Taglish in both languages: it is what an owner
  // actually says, and pretending an English reader would say "five Cokes, cash"
  // would be inventing a different product. Only the label around it translates.
  'welcome.speak.uttered': { en: '“limang Coke, bayad cash”', fil: '“limang Coke, bayad cash”' },
  'welcome.speak.parsed': { en: 'Recorded as', fil: 'Natala bilang' },
  'welcome.speak.tagline': { en: 'Just say the sale.', fil: 'Sabihin lang ang benta.' },
  'welcome.speak.body': {
    en: 'Speak Taglish — “limang Coke, bayad cash” — and the record writes itself: benta, utang, bayad, gastos. The offline voice does it with no signal at all.',
    fil: 'Magsalita sa Taglish — “limang Coke, bayad cash” — at kusang natatala: benta, utang, bayad, gastos. Kaya itong gawin ng boses na offline kahit walang signal.',
  },

  'welcome.see.eyebrow': { en: 'Sipat', fil: 'Sipat' },
  'welcome.see.tagline': {
    en: 'Not just sales — where the money went.',
    fil: 'Hindi lang benta — nasaan napunta ang pera.',
  },
  'welcome.see.body': {
    en: 'What you really earned after paying for stock and utang, where your money is sitting right now, and a Sipat Score you can open up piece by piece. Every number is counted from your own records — none of it is a guess.',
    fil: 'Ang tunay na kinita mo pagkatapos bayaran ang paninda at utang, kung nasaan ang pera mo ngayon, at Sipat Score na mabubuksan mo piraso-piraso. Kinukwenta lahat mula sa rekord mo — walang hinula.',
  },

  'welcome.yours.eyebrow': { en: 'Yours', fil: 'Sa iyo' },
  'welcome.yours.tagline': {
    en: 'Free, and it runs on your phone.',
    fil: 'Libre, at tumatakbo sa phone mo.',
  },
  'welcome.yours.body': {
    en: 'Nothing you record is sent to us — your records, the Score and the offline voice all live on the phone. Only the extras that need the internet cost money, and you can cancel them without losing anything you already use.',
    fil: 'Walang ipinapadala sa amin ang itinatala mo — ang rekord mo, ang Score, at ang boses na offline ay nasa phone. Ang mga dagdag na kailangan ng internet lang ang may bayad, at puwede mong kanselahin nang walang nawawalang gamit.',
  },

  // --- Shared -------------------------------------------------------------
  'shared.simulated': { en: 'Simulated', fil: 'Simulado' },
  'shared.brandSimulated': { en: 'Simulated', fil: 'Simulado' },
  'shared.seePlans': { en: 'See the plans', fil: 'Tingnan ang mga plano' },
} as const satisfies Record<string, Entry>

export type UIStr = keyof typeof UI
