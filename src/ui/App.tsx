import { useEffect, useState } from 'react'
import { Dashboard } from './Dashboard.tsx'
import { RecordScreen } from './Record.tsx'
import { VoiceScreen } from './Voice.tsx'
import { AskScreen } from './Ask.tsx'
import { ScoreView } from './ScoreView.tsx'
import { PlanScreen } from './Plan.tsx'
import { OfflineScreen } from './Offline.tsx'
import { Button, Chip, SimulatedNote } from './components.tsx'
import { useNegosyo } from '../store.ts'
import { TIERS, formatPlanPrice, tierById, useEntitlement } from '../billing.ts'
import type { TierId } from '../billing.ts'
import { useVoiceModel } from '../asr-offline.ts'
import { LANGS, pick, useLang, useSetLang, useT } from '../i18n/index.ts'
import type { UIStr } from '../i18n/index.ts'
import { Welcome } from './Welcome.tsx'
import { clearWelcomeSeen, shouldShowWelcome, welcomeSeenVersion } from '../onboarding.ts'
import { finishBoot } from '../boot.ts'

type Tab = 'twin' | 'tala' | 'boses' | 'tanong' | 'score' | 'plan' | 'offline'

// Tab ids stay as they are (they are keys, not copy); only the label is looked up.
const TABS: { id: Tab; labelKey: UIStr; icon: string }[] = [
  { id: 'twin', labelKey: 'tab.twin', icon: 'M3 13h4v8H3zM10 3h4v18h-4zM17 9h4v12h-4z' },
  { id: 'tala', labelKey: 'tab.ledger', icon: 'M5 3h14v18H5zM8 8h8M8 12h8M8 16h5' },
  { id: 'boses', labelKey: 'tab.voice', icon: 'M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z' },
  { id: 'tanong', labelKey: 'tab.ask', icon: 'M4 4h16v12H8l-4 4z' },
  { id: 'score', labelKey: 'tab.score', icon: 'M12 3l2.6 5.6 6.1.8-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.4l6.1-.8z' },
]

export function App() {
  const negosyo = useNegosyo()
  const billing = useEntitlement()
  const voiceModel = useVoiceModel()
  const t = useT()
  const lang = useLang()
  const setLang = useSetLang()
  const [tab, setTab] = useState<Tab>('twin')
  const [menuOpen, setMenuOpen] = useState(false)
  // Read once, at mount: the deck is a first-run gate, not a reactive value, so
  // a re-render must never be able to pull it back over the interface.
  const [welcome, setWelcome] = useState(() => shouldShowWelcome(welcomeSeenVersion()))

  // The splash has painted since the first byte (index.html); this is the app
  // saying it has rendered and the display face is settled, so the handoff is a
  // dissolve into the real interface rather than a blank gap behind a logo.
  useEffect(() => {
    finishBoot()
  }, [])

  // Tiers climb plain ink → gold → navy: FREE is ordinary type, PRO is the gold
  // material, and NEGOSYO takes the brand navy itself.
  const tierInk =
    billing.tier === 'pro'
      ? 'text-gold-700'
      : billing.tier === 'negosyo'
        ? 'text-brand-700'
        : 'text-fg-subtle'

  const goToPlan = () => {
    setTab('plan')
    setMenuOpen(false)
  }

  const goToOffline = () => {
    setTab('offline')
    setMenuOpen(false)
  }

  function setDemoTier(tier: TierId) {
    if (tier === 'free') billing.downgrade()
    else billing.purchase(tier, 'gcash')
  }

  return (
    <div className="relative mx-auto flex h-full max-w-md flex-col">
      {/* The drafting surface under everything: a micro dot grid that dissolves
          by mid-page. Behind the content (z-index -1), never inside a card. */}
      <div className="canvas-grid" aria-hidden />
      <header className="safe-top z-20 border-b border-line/80 bg-page/75 px-4 pb-3 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center">
            <div className="min-w-0">
              {/* The official wordmark lockup, not type we set ourselves. It is
                  one image so the sunburst and the letterforms can never drift
                  from the brand — and it is imported through the bundler rather
                  than dropped in /public so Vite hashes it and the service
                  worker precaches it; a header logo that breaks offline would
                  contradict the whole offline claim. */}
              <img src="/seepat-wordmark.png" alt="SeePat" className="h-8 w-auto" />
              <div className="mt-1.5 truncate text-[0.62rem] font-medium text-fg-faint">
                {t('app.tagline')}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={goToPlan} className="shrink-0 active:scale-95">
              <span className={`badge ${tierInk}`}>{tierById(billing.tier).short}</span>
            </button>
            <button
              type="button"
              aria-label={t('app.settings')}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
              className={`flex h-9 w-9 items-center justify-center rounded-xl border transition-all duration-200 active:scale-95 ${
                menuOpen
                  ? 'border-brand-800 bg-brand-800 text-white shadow-pop'
                  : 'border-line bg-card text-fg-muted shadow-e1'
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-[1.05rem] w-[1.05rem]"
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
      </header>

      <main className="no-scrollbar flex-1 overflow-y-auto px-4 pt-4 pb-32">
        {/* Keyed by tab so the staggered entrance replays on every screen change. */}
        <div key={tab} className="enter">
          {tab === 'twin' ? (
            <Dashboard negosyo={negosyo} onOpenScore={() => setTab('score')} />
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
          {tab === 'offline' ? <OfflineScreen goToPlan={goToPlan} /> : null}
        </div>
      </main>

      {/* Floating dock. The active tab morphs into a labelled emerald pill rather
          than parking an underline under an icon — the label only appears where
          it is needed, so five destinations fit without crowding. */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 px-3 pb-3">
        <ul className="mx-auto flex max-w-md items-center justify-between gap-1 rounded-full border border-line/70 bg-card/80 p-1.5 shadow-dock backdrop-blur-2xl">
          {TABS.map((item) => {
            const active = tab === item.id
            return (
              <li key={item.id} className={active ? 'flex-1' : ''}>
                <button
                  type="button"
                  onClick={() => setTab(item.id)}
                  aria-current={active ? 'page' : undefined}
                  /* The label only renders for the active tab, so an inactive icon
                     would otherwise reach the accessibility tree unnamed. */
                  aria-label={t(item.labelKey)}
                  className={`flex w-full items-center justify-center gap-1.5 rounded-full py-2.5 transition-all duration-300 ${
                    active
                      ? 'bg-gradient-to-b from-brand-700 to-brand-900 px-3.5 text-white shadow-pop'
                      : 'px-3 text-fg-faint hover:text-fg-muted'
                  }`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-[1.15rem] w-[1.15rem] shrink-0"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d={item.icon} />
                  </svg>
                  {active ? (
                    <span className="text-[0.7rem] font-bold whitespace-nowrap">
                      {t(item.labelKey)}
                    </span>
                  ) : null}
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
            <div className="safe-bottom relative max-h-[78vh] overflow-y-auto rounded-sheet border border-line bg-page p-4 shadow-e3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="headline text-[1.02rem] text-fg">{t('app.settings')}</h2>
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-sunken text-fg-muted active:scale-95"
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

              <div className="space-y-2.5">
                <button
                  type="button"
                  onClick={goToPlan}
                  className="flex w-full items-center justify-between gap-3 rounded-2xl border border-line bg-card px-3.5 py-3 text-left shadow-e1 transition active:bg-sunken"
                >
                  <span>
                    <span className="block text-[0.8rem] font-semibold text-fg">
                      {tierById(billing.tier).name}
                    </span>
                    <span className="num block text-[0.68rem] text-fg-faint">
                      {formatPlanPrice(tierById(billing.tier).priceCentavos)}{' '}
                      {pick(lang, tierById(billing.tier).period)}
                    </span>
                  </span>
                  <span className="shrink-0 text-[0.7rem] font-bold text-brand-700">
                    {billing.tier === 'free' ? t('app.upgrade') : t('app.managePlan')}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={goToOffline}
                  className="flex w-full items-center justify-between gap-3 rounded-2xl border border-line bg-card px-3.5 py-3 text-left shadow-e1 transition active:bg-sunken"
                >
                  <span>
                    <span className="block text-[0.8rem] font-semibold text-fg">
                      {t('app.offlineVoice')}
                    </span>
                    <span className="num block text-[0.68rem] text-fg-faint">
                      {voiceModel.installed
                        ? t('app.offlineVoiceInstalled', { mb: voiceModel.megabytes })
                        : t('app.offlineVoiceMissing')}
                    </span>
                  </span>
                  <span className="shrink-0 text-[0.7rem] font-bold text-brand-700">
                    {t('app.open')}
                  </span>
                </button>

                {/* Language sits with the other device-level settings rather than
                    buried in a submenu: it is the first thing an English-reading
                    reviewer wants to find, and the first thing an owner might
                    switch back. */}
                <div className="rounded-2xl border border-line bg-card px-3.5 py-3 shadow-e1">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[0.8rem] font-semibold text-fg">
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
                            className={`rounded-full px-3 py-1.5 text-[0.7rem] font-bold transition-all duration-200 ${
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
                  <p className="mt-2 text-[0.66rem] leading-relaxed text-fg-faint">
                    {t('app.languageHint')}
                  </p>
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
                  <span className="text-[0.8rem] font-semibold text-fg">
                    {t('welcome.tourAgain')}
                  </span>
                  <span aria-hidden className="shrink-0 text-[0.8rem] text-fg-faint">
                    ↻
                  </span>
                </button>

                <div className="rounded-2xl border border-line bg-card px-3.5 py-3 shadow-e1">
                  <p className="text-[0.68rem] leading-relaxed text-fg-subtle">
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
  )
}

/*
 * The old hand-drawn mark (a navy tile with the sun and an eye) used to live
 * here. It is gone: the official wordmark carries the brand in the header now,
 * and the square tile survives only as the home-screen icon in public/icon.svg,
 * where a 3.78:1 lockup would be the wrong shape anyway.
 */
