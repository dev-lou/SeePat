import { useEffect, useRef, useState } from 'react'
import { Dashboard } from './Dashboard.tsx'
import { RecordScreen } from './Record.tsx'
import { VoiceScreen } from './Voice.tsx'
import { AskScreen } from './Ask.tsx'
import { ScoreView } from './ScoreView.tsx'
import { PlanScreen } from './Plan.tsx'
import { OfflineScreen } from './Offline.tsx'
import { ItemsScreen } from './Items.tsx'
import { UtangScreen } from './Utang.tsx'
import { Button, Chip, ConfirmDialog, SimulatedNote } from './components.tsx'
import { ToastProvider, useToast } from './Toast.tsx'
import { useNegosyo } from '../store.ts'
import { formatPHP } from '../engine/index.ts'
import type { Ledger } from '../engine/index.ts'
import { formatPlanPrice, tierById, useEntitlement, visibleTiers } from '../billing.ts'
import type { TierId } from '../billing.ts'
import { useVoiceModel } from '../asr-offline.ts'
import { LANGS, pick, useLang, useSetLang, useT } from '../i18n/index.ts'
import type { UIStr } from '../i18n/index.ts'
import { Welcome } from './Welcome.tsx'
import { clearWelcomeSeen, shouldShowWelcome, welcomeSeenVersion } from '../onboarding.ts'
import { finishBoot } from '../boot.ts'
import { useReadingSize, useSetReadingSize } from '../reading.ts'
import type { ReadingSize } from '../reading.ts'
import { setSpeakEnabled, useSpeakEnabled } from './useSpeech.ts'

type Tab = 'twin' | 'tala' | 'boses' | 'tanong' | 'score' | 'plan' | 'offline' | 'items' | 'utang'

/**
 * The three reading sizes, in words rather than an A/A+/A++ glyph strip: the
 * person this is for is choosing how big the *words* are, and "Malaki" is a
 * clearer label than any icon. Order is fixed (normal → biggest) so the control
 * never reorders itself under a thumb.
 */
const READING_OPTIONS: { id: ReadingSize; labelKey: UIStr }[] = [
  { id: 'normal', labelKey: 'app.textSizeNormal' },
  { id: 'big', labelKey: 'app.textSizeBig' },
  { id: 'bigger', labelKey: 'app.textSizeBigger' },
]

// Tab ids stay as they are (they are keys, not copy); only the label is looked up.
// Voice is not a dock destination: it leads the centre speed-dial instead, so
// the bar holds four peers plus the plus key — the reference layout.
const TABS: { id: Tab; labelKey: UIStr; icon: string }[] = [
  { id: 'twin', labelKey: 'tab.twin', icon: 'M3 13h4v8H3zM10 3h4v18h-4zM17 9h4v12h-4z' },
  { id: 'tala', labelKey: 'tab.ledger', icon: 'M5 3h14v18H5zM8 8h8M8 12h8M8 16h5' },
  { id: 'tanong', labelKey: 'tab.ask', icon: 'M4 4h16v12H8l-4 4z' },
  { id: 'score', labelKey: 'tab.score', icon: 'M12 3l2.6 5.6 6.1.8-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.4l6.1-.8z' },
]


// Every destination the shell can show, named for the page indicator. Plan and
// offline are not tabs, so they borrow the words their own screens already use.
const PAGE_LABEL: Record<Tab, UIStr> = {
  twin: 'tab.twin',
  tala: 'tab.ledger',
  boses: 'tab.voice',
  tanong: 'tab.ask',
  score: 'tab.score',
  plan: 'app.managePlan',
  offline: 'app.offlineVoice',
  items: 'app.myItems',
  utang: 'app.utangList',
}

/**
 * The provider is hoisted above the shell so the shell itself can raise a toast.
 *
 * The toast used to be out of reach of everything in this file — `useToast`
 * throws above its provider — which is why the two most destructive actions in
 * the app (erasing every record, and undoing that erase) had no way to report
 * themselves here. One wrapper, no other change: the shell below is the same
 * component it always was.
 */
export function App() {
  return (
    <ToastProvider>
      <AppShell />
    </ToastProvider>
  )
}

function AppShell() {
  const negosyo = useNegosyo()
  const toast = useToast()
  const billing = useEntitlement()
  const voiceModel = useVoiceModel()
  const t = useT()
  const lang = useLang()
  const setLang = useSetLang()
  const reading = useReadingSize()
  const setReading = useSetReadingSize()
  const speakOn = useSpeakEnabled()
  const [tab, setTab] = useState<Tab>('twin')
  const [menuOpen, setMenuOpen] = useState(false)
  // Holding the pending erase as the ledger we would restore, not a boolean:
  // the confirm and the undo are the same value, so there is no window where the
  // dialog is up and the thing it protects has already changed.
  const [pendingErase, setPendingErase] = useState<Ledger | null>(null)
  // Demo data replaces the whole book, so it is gated the same way an erase is.
  const [pendingDemo, setPendingDemo] = useState(false)
  const [welcome, setWelcome] = useState(() => shouldShowWelcome(welcomeSeenVersion()))
  const mainRef = useRef<HTMLElement | null>(null)

  // The splash has painted since the first byte (index.html); this is the app
  // saying it has rendered and the display face is settled, so the handoff is a
  // dissolve into the real interface rather than a blank gap behind a logo.
  useEffect(() => {
    finishBoot()
  }, [])

  /*
   * A new screen starts at its own top.
   *
   * The scrolling element is `main`, and it lived across every tab change, so
   * opening Items from a scrolled Plan page landed the owner halfway down the
   * item list with the "Add an item" button already above the fold — the page
   * looked cut off rather than scrolled. Resetting here is the shell's job: no
   * screen should have to know how far the previous one was read.
   */
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 })
  }, [tab])



  const tierConfig = {
    free: {
      badge: 'bg-emerald-500/10 text-emerald-800 border-emerald-500/25',
      dot: 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]',
    },
    pro: {
      badge: 'bg-amber-500/15 text-amber-800 border-amber-500/35',
      dot: 'bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.7)]',
    },
    negosyo: {
      badge: 'bg-brand-500/15 text-brand-700 border-brand-500/35',
      dot: 'bg-brand-600 shadow-[0_0_6px_rgba(42,58,214,0.7)]',
    },
  }[billing.tier]

  const goToPlan = () => {
    setTab('plan')
    setMenuOpen(false)
  }

  const goToOffline = () => {
    setTab('offline')
    setMenuOpen(false)
  }

  const goToTab = (next: Tab) => {
    setTab(next)
  }

  /*
   * The owner's own book, reached from where it is needed rather than from the
   * dock. The dock stays at four destinations plus the mic: the first thing an
   * older owner learns is the position of the tabs, and a bar that grows a sixth
   * target every time a screen is built is a bar nobody can use from memory.
   *
   * Utang is one tap from the advice that names it ("Collect first — ₱4,158
   * unpaid") and one tap from the Ledger's Utang mode; items are one tap from
   * the item picker that needs them.
   */
  const goToItems = () => {
    setTab('items')
    setMenuOpen(false)
  }

  const goToUtang = () => {
    setTab('utang')
    setMenuOpen(false)
  }

  function setDemoTier(tier: TierId) {
    if (tier === 'free') billing.downgrade()
    else billing.purchase(tier, 'gcash')
  }

  return (
    <>
      <div className="relative mx-auto flex h-full max-w-md flex-col">
      {/* The drafting surface under everything: a micro dot grid that dissolves
          by mid-page. Behind the content (z-index -1), never inside a card. */}
      <div className="canvas-grid" aria-hidden />
      {/*
       * The header: the owl and the plan, then the page's name, then a hairline.
       * It is translucent and blurred rather than solid, so content sliding
       * under it stays visible and the app reads as one moving surface.
       */}
      <header className="safe-top z-20 bg-page/65 px-4 pt-1 pb-2.5 backdrop-blur-xl">
        {/* Brand row: the owl left, the plan chip and settings right. The mark
            is the generated owl-only crop, so no wordmark is squeezed into the
            56px box and the page name below is the only title on screen. */}
        <div className="flex items-center justify-between gap-2">
          {/* Left: the owl alone. The lockup's own lettering is illegible in a
              56px box, and the page name is the only title this row needs. */}
          <div className="flex items-center justify-start">
            <button
              type="button"
              onClick={() => setTab('twin')}
              className="flex shrink-0 items-center active:scale-95 transition-transform"
              aria-label="SeePat"
            >
              <img
                src="/seepat-mark.png"
                alt=""
                width={56}
                height={56}
                className="h-14 w-14 object-contain drop-shadow-xs"
              />
            </button>
          </div>

          {/* Right: Plan indicator chip + Settings button */}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={goToPlan}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.625rem] font-black uppercase tracking-wider border shadow-xs transition-all active:scale-95 hover:opacity-90 ${tierConfig.badge}`}
              aria-label={t('app.managePlan')}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${tierConfig.dot}`} />
              <span>{tierById(billing.tier).short}</span>
            </button>
            {/*
             * Labelled, not icon-only.
             *
             * Two of the three things behind this button are the ones this
             * audience actually needs — the language and the text size — and a
             * gear or a slider glyph is not a word a 55-year-old reads as "my
             * settings". The word rides beside the glyph from 380px up and the
             * key collapses back to the icon below that, so nothing is lost on a
             * very narrow phone.
             */}
            <button
              type="button"
              aria-label={t('app.settings')}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
              className={`flex h-10 items-center justify-center gap-1.5 rounded-full border px-3 transition-all duration-200 active:translate-y-px ${
                menuOpen
                  ? 'border-brand-800 bg-brand-800 text-white shadow-pop'
                  : 'border-line-strong bg-card text-fg-muted shadow-e1 hover:text-fg'
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
                <circle cx="16" cy="7" r="2.4" />
                <circle cx="8" cy="17" r="2.4" />
              </svg>
              <span className="hidden text-[0.75rem] font-bold min-[380px]:inline">
                {t('app.settings')}
              </span>
            </button>
          </div>
        </div>

        {/*
         * The page name is its own row rather than the middle of a three-column
         * grid. At 390px the old row left roughly one short word between the owl
         * and the settings key, so "OFFLINE NA BOSES" ran straight through the
         * logo, and at the largest reading size "MONEY" did the same. A row of
         * its own gives the title the full width in either language, at any text
         * size, without truncating a page name.
         */}
        <h1 className="mt-1.5 min-w-0 text-[1.05rem] leading-tight font-extrabold uppercase tracking-wider text-fg">
          {t(PAGE_LABEL[tab])}
        </h1>
        <div className="rule-set mt-2" aria-hidden />
      </header>

      <main ref={mainRef} className="no-scrollbar flex-1 overflow-y-auto px-0 pt-0 pb-32">
        {/* Keyed by tab so the staggered entrance replays on every screen change. */}
        <div key={tab} className="enter">
          {tab === 'twin' ? (
            <Dashboard
              negosyo={negosyo}
              onOpenScore={() => setTab('score')}
              onOpenUtang={goToUtang}
              onGo={setTab}
            />
          ) : null}
          {tab === 'tala' ? (
            <RecordScreen negosyo={negosyo} onOpenItems={goToItems} onOpenUtang={goToUtang} />
          ) : null}
          {tab === 'boses' ? (
            <VoiceScreen
              negosyo={negosyo}
              billing={billing}
              onUpgrade={goToPlan}
              onOpenOffline={goToOffline}
            />
          ) : null}
          {tab === 'tanong' ? (
            <AskScreen
              negosyo={negosyo}
              billing={billing}
              onUpgrade={goToPlan}
              onOpenOffline={goToOffline}
            />
          ) : null}
          {tab === 'score' ? <ScoreView negosyo={negosyo} /> : null}
          {tab === 'plan' ? <PlanScreen billing={billing} /> : null}
          {tab === 'offline' ? <OfflineScreen negosyo={negosyo} goToPlan={goToPlan} /> : null}
          {tab === 'items' ? <ItemsScreen negosyo={negosyo} /> : null}
          {tab === 'utang' ? (
            <UtangScreen negosyo={negosyo} onOpenLedger={() => setTab('tala')} />
          ) : null}
        </div>
      </main>

      {/*
       * The dock — a floating white pill with four peer destinations and a
       * raised plus key in the middle.
       *
       * The selected destination stretches into a labelled pill (index.css,
       * `.dock-tab.is-on`) so the bar itself says where you are; on a 280px
       * phone the label is shed and the page eyebrow above the content keeps
       * naming the screen. The plus blooms the speed-dial upward — voice first,
       * because speaking a sale is how this app is meant to be used.
       */}

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 px-3 pb-3">
        <ul className="dock mx-auto max-w-md">
          {TABS.slice(0, 2).map((item) => {
            const active = tab === item.id
            return (
              <li key={item.id} className="flex flex-1 justify-center">
                <button
                  type="button"
                  onClick={() => goToTab(item.id)}
                  aria-current={active ? 'page' : undefined}
                  aria-label={t(item.labelKey)}
                  title={t(item.labelKey)}
                  className={`dock-tab ${active ? 'is-on' : ''}`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-5 w-5 shrink-0"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d={item.icon} />
                  </svg>
                  <span className="dock-label">{t(item.labelKey)}</span>
                </button>
              </li>
            )
          })}
          <li className="flex shrink-0 justify-center">
            <button
              type="button"
              onClick={() => goToTab('boses')}
              aria-current={tab === 'boses' ? 'page' : undefined}
              aria-label={t('tab.voice')}
              title={t('tab.voice')}
              className={`dock-fab ${tab === 'boses' ? 'is-active' : ''}`}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-6 w-6"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" />
              </svg>
            </button>
          </li>
          {TABS.slice(2).map((item) => {
            const active = tab === item.id
            return (
              <li key={item.id} className="flex flex-1 justify-center">
                <button
                  type="button"
                  onClick={() => goToTab(item.id)}
                  aria-current={active ? 'page' : undefined}
                  aria-label={t(item.labelKey)}
                  title={t(item.labelKey)}
                  className={`dock-tab ${active ? 'is-on' : ''}`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-5 w-5 shrink-0"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d={item.icon} />
                  </svg>
                  <span className="dock-label">{t(item.labelKey)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Settings as an overlay sheet, not an inline expander: it stops the app
          from reflowing under the owner's thumb and gives destructive actions
          (Burahin lahat) the separation they deserve. */}
      {menuOpen ? (
        <div className="fixed inset-0 z-40 flex flex-col justify-end">
          <button
            type="button"
            aria-label={t('app.close')}
            onClick={() => setMenuOpen(false)}
            className="absolute inset-0 bg-scrim backdrop-blur-[2px]"
          />
          <div className="mx-auto w-full max-w-md px-3 pb-3">
            <div className="safe-bottom relative max-h-[82vh] overflow-y-auto rounded-3xl border border-white/80 bg-white/95 backdrop-blur-2xl p-5 shadow-2xl">
              <div className="mb-4 flex items-center justify-between gap-3 border-b border-line/60 pb-3">
                <h2 className="headline text-[1.125rem] font-bold text-fg">{t('app.settings')}</h2>
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-sunken text-fg-muted hover:text-fg active:scale-95 transition-transform"
                  aria-label={t('app.close')}
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                  >
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>

              <div className="space-y-3">
                <button
                  type="button"
                  onClick={goToPlan}
                  className="flex w-full items-center justify-between gap-3 rounded-2xl border border-line/80 bg-white/70 backdrop-blur-md px-4 py-3.5 text-left shadow-xs transition active:scale-[0.99] hover:border-brand-500/40"
                >
                  <span>
                    <span className="block text-[0.9375rem] font-bold text-fg">
                      {tierById(billing.tier).name}
                    </span>
                    <span className="num block text-[0.8125rem] text-fg-faint">
                      {formatPlanPrice(tierById(billing.tier).priceCentavos)}{' '}
                      {pick(lang, tierById(billing.tier).period)}
                    </span>
                  </span>
                  <span className="shrink-0 text-[0.875rem] font-extrabold text-brand-700">
                    {billing.tier === 'free' ? t('app.upgrade') : t('app.managePlan')}
                  </span>
                </button>

                {/* The two screens that hold the owner's own book sit directly
                    under the plan row, with their counts: "41 items" is also
                    the answer to "did my items save?". */}
                <button
                  type="button"
                  onClick={goToItems}
                  className="flex w-full items-center justify-between gap-3 rounded-2xl border border-line bg-card px-3.5 py-3 text-left shadow-e1 transition active:bg-sunken"
                >
                  <span>
                    <span className="block text-[0.9375rem] font-semibold text-fg">
                      {t('app.myItems')}
                    </span>
                    <span className="num block text-[0.8125rem] text-fg-faint">
                      {t('items.count', { n: negosyo.ledger.skus.length })}
                    </span>
                  </span>
                  <span className="shrink-0 text-[0.875rem] font-bold text-brand-700">
                    {t('app.open')}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={goToUtang}
                  className="flex w-full items-center justify-between gap-3 rounded-2xl border border-line bg-card px-3.5 py-3 text-left shadow-e1 transition active:bg-sunken"
                >
                  <span>
                    <span className="block text-[0.9375rem] font-semibold text-fg">
                      {t('app.utangList')}
                    </span>
                    <span className="num block text-[0.8125rem] text-fg-faint">
                      {t('utang.total')} · {formatPHP(negosyo.derived.receivablesCentavos)}
                    </span>
                  </span>
                  <span className="shrink-0 text-[0.875rem] font-bold text-brand-700">
                    {t('app.open')}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={goToOffline}
                  className="flex w-full items-center justify-between gap-3 rounded-2xl border border-line bg-card px-3.5 py-3 text-left shadow-e1 transition active:bg-sunken"
                >
                  <span>
                    <span className="block text-[0.9375rem] font-semibold text-fg">
                      {t('app.offlineVoice')}
                    </span>
                    <span className="num block text-[0.8125rem] text-fg-faint">
                      {voiceModel.installed
                        ? t('app.offlineVoiceInstalled', { mb: voiceModel.megabytes })
                        : t('app.offlineVoiceMissing')}
                    </span>
                  </span>
                  <span className="shrink-0 text-[0.875rem] font-bold text-brand-700">
                    {t('app.open')}
                  </span>
                </button>

                {/* SeePat's own voice, right beside the language row: both are
                    device-level answers to "how does this app talk to me". */}
                <div className="rounded-2xl border border-line bg-card px-3.5 py-3 shadow-e1">
                  {/*
                   * Label above, control beneath, like the text-size row: at the
                   * largest reading size "Nagsasalita si SeePat" and a switch
                   * beside it do not both fit in a 320px sheet, and a segmented
                   * control that overflows its card is worse than a taller row.
                   * Full width also gives each option a bigger target.
                   */}
                  <span className="block text-[0.9375rem] font-semibold text-fg">
                    {t('app.speak')}
                  </span>
                  <div
                    role="group"
                    aria-label={t('app.speak')}
                    className="mt-2 flex w-full gap-1 rounded-full bg-sunken p-1"
                  >
                    {[true, false].map((value) => {
                      const selected = speakOn === value
                      return (
                        <button
                          key={value ? 'on' : 'off'}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => setSpeakEnabled(value)}
                          className={`min-h-10 flex-1 rounded-full px-2 text-[0.875rem] font-bold transition-all duration-200 ${
                            selected
                              ? 'bg-brand-800 text-white shadow-pop'
                              : 'text-fg-muted hover:text-fg'
                          }`}
                        >
                          {value ? t('app.speakOn') : t('app.speakOff')}
                        </button>
                      )
                    })}
                  </div>
                  <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-fg-faint">
                    {t('app.speakNote')}
                  </p>
                </div>

                {/* Language sits with the other device-level settings rather than
                    buried in a submenu: it is the first thing an English-reading
                    reviewer wants to find, and the first thing an owner might
                    switch back. */}
                <div className="rounded-2xl border border-line bg-card px-3.5 py-3 shadow-e1">
                  <span className="block text-[0.9375rem] font-semibold text-fg">
                    {t('app.language')}
                  </span>
                  <div
                    role="group"
                    aria-label={t('app.language')}
                    className="mt-2 flex w-full gap-1 rounded-full bg-sunken p-1"
                  >
                    {LANGS.map((option) => {
                      const selected = lang === option.id
                      return (
                        <button
                          key={option.id}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => setLang(option.id)}
                          className={`min-h-10 flex-1 rounded-full px-2 text-[0.875rem] font-bold transition-all duration-200 ${
                            selected
                              ? 'bg-brand-800 text-white shadow-pop'
                              : 'text-fg-muted hover:text-fg'
                          }`}
                        >
                          {option.native}
                        </button>
                      )
                    })}
                  </div>
                  <p className="mt-2 text-[0.8125rem] leading-relaxed text-fg-faint">
                    {t('app.languageHint')}
                  </p>
                </div>

                {/*
                 * Text size. It sits here with the device settings rather than in
                 * a submenu for the same reason the language switch does: the
                 * owner who needs it should not have to go looking, and the label
                 * is in words because "Big / Malaki" is unambiguous where an
                 * A/A+/A++ strip is not.
                 */}
                <div className="rounded-2xl border border-line bg-card px-3.5 py-3 shadow-e1">
                  <span className="block text-[0.9375rem] font-semibold text-fg">
                    {t('app.textSize')}
                  </span>
                  <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-faint">
                    {t('app.textSizeHint')}
                  </p>
                  <div
                    role="group"
                    aria-label={t('app.textSize')}
                    className="mt-2.5 flex flex-wrap gap-1.5 rounded-2xl bg-sunken p-1.5"
                  >
                    {READING_OPTIONS.map((option) => {
                      const selected = reading === option.id
                      return (
                        <button
                          key={option.id}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => setReading(option.id)}
                          className={`min-h-11 flex-1 basis-[4.5rem] rounded-xl px-1 text-[0.875rem] font-bold transition-all duration-200 ${
                            selected
                              ? 'bg-brand-800 text-white shadow-pop'
                              : 'text-fg-muted hover:text-fg'
                          }`}
                        >
                          {t(option.labelKey)}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* The intro is the only place the product explains itself, so an
                    owner who skipped it in a hurry can get it back here without
                    clearing site data. */}
                <button
                  type="button"
                  onClick={() => {
                    clearWelcomeSeen()
                    setWelcome(true)
                    setMenuOpen(false)
                  }}
                  className="surface surface-raise flex w-full items-center justify-between gap-3 rounded-2xl px-3.5 py-3 text-left"
                >
                  <span className="text-[0.9375rem] font-semibold text-fg">
                    {t('welcome.tourAgain')}
                  </span>
                  <span aria-hidden className="shrink-0 text-[0.9375rem] text-fg-faint">
                    ↻
                  </span>
                </button>

                <div className="rounded-2xl border border-line bg-card px-3.5 py-3 shadow-e1">
                  <p className="text-[0.8125rem] leading-relaxed text-fg-subtle">
                    {t('app.transactions', { n: negosyo.ledger.transactions.length })} ·{' '}
                    {t('app.voids', { n: negosyo.ledger.voids.length })}.{' '}
                    {t('app.storedLocally')}
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <Button
                      variant="ghost"
                      className="min-w-[8rem] flex-1"
                      onClick={() => setPendingDemo(true)}
                    >
                      {t('app.demoData')}
                    </Button>
                    {/* The confirm is the fix for a real defect: this button used
                        to wipe the whole ledger on a single tap — no dialog, no
                        toast, no undo — while deleting one row asked twice. */}
                    <Button
                      variant="danger"
                      className="min-w-[8rem] flex-1"
                      onClick={() => setPendingErase(negosyo.ledger)}
                    >
                      {t('app.clearAll')}
                    </Button>
                  </div>
                </div>

                <div className="rounded-2xl border border-dashed border-line-strong bg-card/50 p-3.5">
                  <p className="eyebrow text-fg-faint">{t('app.demoOnly')}</p>
                  <div className="mt-2.5 flex gap-2">
                    {/* Every plan in `TIERS` is for sale, and this picker offers
                        all of them. It once mapped a list that still contained a
                        withdrawn plan, so NEGOSYO stayed demoable after it had
                        been pulled from the pricing page. A plan can only be
                        demoed if it can be bought, and `migrateOffSale`
                        (billing.ts) handles the other half — an entitlement that
                        is still sitting on a plan nobody sells any more. */}
                    {visibleTiers().map((tier) => (
                      <Chip
                        key={tier.id}
                        active={billing.tier === tier.id}
                        onClick={() => setDemoTier(tier.id)}
                      >
                        {tier.short}
                      </Chip>
                    ))}
                  </div>
                  <div className="mt-2.5">
                    <SimulatedNote>{t('app.simulatedPayments')}</SimulatedNote>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* The first-run gate. Rendered last so it covers the shell completely, and
          dismissed only by finishing or skipping — the ledger underneath is
          already seeded, so "opening" it is instant. */}
      {welcome ? <Welcome negosyo={negosyo} onDone={() => setWelcome(false)} /> : null}
      </div>

      {pendingDemo ? (
        <ConfirmDialog
          title={t('app.demoTitle')}
          body={t('app.demoBody', { n: negosyo.ledger.transactions.length })}
          confirmLabel={t('app.demoConfirm')}
          cancelLabel={t('app.clearAllCancel')}
          onCancel={() => setPendingDemo(false)}
          onConfirm={() => {
            const previous = negosyo.ledger
            negosyo.resetToDemo()
            setPendingDemo(false)
            setMenuOpen(false)
            // Same undo as an erase: the demo is a whole-book replacement, and
            // one tap on a settings row should never be the end of the shop's
            // real records.
            toast.show({
              title: t('app.demoLoaded'),
              tone: 'success',
              undoLabel: t('backup.undo'),
              onUndo: () => {
                negosyo.restore(previous)
                toast.show({ title: t('app.clearUndone'), tone: 'info' })
              },
            })
          }}
        />
      ) : null}

      {pendingErase ? (
        <ConfirmDialog
          title={t('app.clearAllTitle')}
          body={t('app.clearAllBody', { n: pendingErase.transactions.length })}
          confirmLabel={t('app.clearAllConfirm')}
          cancelLabel={t('app.clearAllCancel')}
          onCancel={() => setPendingErase(null)}
          onConfirm={() => {
            const previous = pendingErase
            negosyo.clearAll()
            setPendingErase(null)
            setMenuOpen(false)
            // The undo restores the whole ledger object, not a re-recorded sale:
            // voids, stock and customers come back with it, so an owner who
            // tapped this by mistake loses nothing at all.
            toast.show({
              title: t('app.cleared', { n: previous.transactions.length }),
              tone: 'success',
              undoLabel: t('backup.undo'),
              onUndo: () => {
                negosyo.restore(previous)
                toast.show({ title: t('app.clearUndone'), tone: 'info' })
              },
            })
          }}
        />
      ) : null}
    </>
  )
}

/*
 * The old hand-drawn mark (a navy tile with the sun and an eye) used to live
 * here. It is gone: the official wordmark carries the brand in the header now,
 * and the square icons survive only as the generated rasters in `public/`
 * (`node tools/make-assets.mjs`), where the mark is cropped out of the lockup
 * because lettering is unreadable at 48px.
 */
