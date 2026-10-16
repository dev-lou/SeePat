import { useEffect, useState } from 'react'
import { Dashboard } from './Dashboard.tsx'
import { RecordScreen } from './Record.tsx'
import { VoiceScreen } from './Voice.tsx'
import { AskScreen } from './Ask.tsx'
import { ScoreView } from './ScoreView.tsx'
import { PlanScreen } from './Plan.tsx'
import { OfflineScreen } from './Offline.tsx'
import { Button, Chip, SimulatedNote } from './components.tsx'
import { ToastProvider } from './Toast.tsx'
import { useNegosyo } from '../store.ts'
import { TIERS, formatPlanPrice, tierById, useEntitlement } from '../billing.ts'
import type { TierId } from '../billing.ts'
import { useVoiceModel } from '../asr-offline.ts'
import { LANGS, pick, useLang, useSetLang, useT } from '../i18n/index.ts'
import type { UIStr } from '../i18n/index.ts'
import { Welcome } from './Welcome.tsx'
import { clearWelcomeSeen, shouldShowWelcome, welcomeSeenVersion } from '../onboarding.ts'
import { finishBoot } from '../boot.ts'
import { useReadingSize, useSetReadingSize } from '../reading.ts'
import type { ReadingSize } from '../reading.ts'

type Tab = 'twin' | 'tala' | 'boses' | 'tanong' | 'score' | 'plan' | 'offline'

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
}

export function App() {
  const negosyo = useNegosyo()
  const billing = useEntitlement()
  const voiceModel = useVoiceModel()
  const t = useT()
  const lang = useLang()
  const setLang = useSetLang()
  const reading = useReadingSize()
  const setReading = useSetReadingSize()
  const [tab, setTab] = useState<Tab>('twin')
  const [menuOpen, setMenuOpen] = useState(false)
  const [welcome, setWelcome] = useState(() => shouldShowWelcome(welcomeSeenVersion()))

  // The splash has painted since the first byte (index.html); this is the app
  // saying it has rendered and the display face is settled, so the handoff is a
  // dissolve into the real interface rather than a blank gap behind a logo.
  useEffect(() => {
    finishBoot()
  }, [])



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

  function setDemoTier(tier: TierId) {
    if (tier === 'free') billing.downgrade()
    else billing.purchase(tier, 'gcash')
  }

  return (
    <ToastProvider>
      <div className="relative mx-auto flex h-full max-w-md flex-col">
      {/* The drafting surface under everything: a micro dot grid that dissolves
          by mid-page. Behind the content (z-index -1), never inside a card. */}
      <div className="canvas-grid" aria-hidden />
      {/*
       * The header: the mark, then the line that says what the app is for, then
       * a hairline. It is translucent and blurred rather than solid, so content
       * sliding under it stays visible and the app reads as one moving surface.
       */}
      <header className="safe-top z-20 bg-page/65 px-4 pt-1 pb-2.5 backdrop-blur-xl">
        {/* The lockup is the official artwork, never type we set ourselves: one
            image, so the owl and the letterforms cannot drift from the brand. */}
        {/* Brand row: the plan chip left, the lockup centred, settings right —
            the mark alone, big and haloed, with no tagline under it. The page
            eyebrow below the header already says where you are, so a second
            line of words here is noise the header does not need. */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          {/* Left: Prominent large brand logo */}
          <div className="flex items-center justify-start">
            <button
              type="button"
              onClick={() => setTab('twin')}
              className="flex shrink-0 items-center active:scale-95 transition-transform"
              aria-label="SeePat"
            >
              <img
                src="/new_logo.png"
                alt="SeePat"
                className="h-[56px] w-[56px] object-contain drop-shadow-xs"
              />
            </button>
          </div>

          {/* Center: Page name, plain — the dot was decoration, not information. */}
          <div className="flex items-center justify-center text-center">
            <h1 className="text-[1.05rem] font-extrabold uppercase tracking-wider text-fg">
              {t(PAGE_LABEL[tab])}
            </h1>
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
            <button
              type="button"
              aria-label={t('app.settings')}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
              className={`flex h-10 w-10 items-center justify-center rounded-full border transition-all duration-200 active:translate-y-px ${
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
            </button>
          </div>
        </div>
        <div className="rule-set mt-2.5" aria-hidden />
      </header>

      <main className="no-scrollbar flex-1 overflow-y-auto px-0 pt-0 pb-32">
        {/* Keyed by tab so the staggered entrance replays on every screen change. */}
        <div key={tab} className="enter">
          {tab === 'twin' ? (
            <Dashboard negosyo={negosyo} onOpenScore={() => setTab('score')} onGo={setTab} />
          ) : null}
          {tab === 'tala' ? <RecordScreen negosyo={negosyo} /> : null}
          {tab === 'boses' ? (
            <VoiceScreen
              negosyo={negosyo}
              billing={billing}
              onUpgrade={goToPlan}
              onOpenOffline={goToOffline}
            />
          ) : null}
          {tab === 'tanong' ? (
            <AskScreen negosyo={negosyo} billing={billing} onUpgrade={goToPlan} />
          ) : null}
          {tab === 'score' ? (
            <ScoreView negosyo={negosyo} billing={billing} onUpgrade={goToPlan} />
          ) : null}
          {tab === 'plan' ? <PlanScreen billing={billing} /> : null}
          {tab === 'offline' ? <OfflineScreen negosyo={negosyo} goToPlan={goToPlan} /> : null}
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

                {/* Language sits with the other device-level settings rather than
                    buried in a submenu: it is the first thing an English-reading
                    reviewer wants to find, and the first thing an owner might
                    switch back. */}
                <div className="rounded-2xl border border-line bg-card px-3.5 py-3 shadow-e1">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[0.9375rem] font-semibold text-fg">
                      {t('app.language')}
                    </span>
                    <div
                      role="group"
                      aria-label={t('app.language')}
                      className="flex shrink-0 gap-1 rounded-full bg-sunken p-1"
                    >
                      {LANGS.map((option) => {
                        const selected = lang === option.id
                        return (
                          <button
                            key={option.id}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => setLang(option.id)}
                            className={`min-h-10 rounded-full px-3.5 text-[0.875rem] font-bold transition-all duration-200 ${
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
                    className="mt-2.5 flex gap-1.5 rounded-2xl bg-sunken p-1.5"
                  >
                    {READING_OPTIONS.map((option) => {
                      const selected = reading === option.id
                      return (
                        <button
                          key={option.id}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => setReading(option.id)}
                          className={`min-h-11 flex-1 rounded-xl text-[0.875rem] font-bold transition-all duration-200 ${
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
                  <div className="mt-2.5 flex gap-2">
                    <Button variant="ghost" className="flex-1" onClick={negosyo.resetToDemo}>
                      {t('app.demoData')}
                    </Button>
                    <Button variant="danger" className="flex-1" onClick={negosyo.clearAll}>
                      {t('app.clearAll')}
                    </Button>
                  </div>
                </div>

                <div className="rounded-2xl border border-dashed border-line-strong bg-card/50 p-3.5">
                  <p className="eyebrow text-fg-faint">{t('app.demoOnly')}</p>
                  <div className="mt-2.5 flex gap-2">
                    {TIERS.map((tier) => (
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
    </ToastProvider>
  )
}

/*
 * The old hand-drawn mark (a navy tile with the sun and an eye) used to live
 * here. It is gone: the official wordmark carries the brand in the header now,
 * and the square tile survives only as the home-screen icon in public/icon.svg,
 * where a 3.78:1 lockup would be the wrong shape anyway.
 */
