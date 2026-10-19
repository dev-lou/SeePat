import { useEffect, useRef, useState } from 'react'
import type { TouchEvent as ReactTouchEvent } from 'react'
import { Dashboard } from './Dashboard.tsx'
import { RecordScreen } from './Record.tsx'
import { VoiceScreen } from './Voice.tsx'
import { AskScreen } from './Ask.tsx'
import { ScoreView } from './ScoreView.tsx'
import { PlanScreen } from './Plan.tsx'
import { OfflineScreen } from './Offline.tsx'
import { ItemsScreen } from './Items.tsx'
import { UtangScreen } from './Utang.tsx'
import { SupplierScreen } from './Supplier.tsx'
import { ReceiptScreen } from './Receipt.tsx'
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
import { readPersisted, writePersisted } from '../storage.ts'
import { finishBoot } from '../boot.ts'
import { useReadingSize, useSetReadingSize } from '../reading.ts'
import type { ReadingSize } from '../reading.ts'
import { setSpeakEnabled, useSpeakEnabled } from './useSpeech.ts'

type Tab = 'twin' | 'tala' | 'boses' | 'tanong' | 'score' | 'plan' | 'offline' | 'items' | 'utang' | 'supplier' | 'resibo'

const PRO_NUDGE = { key: 'seepat.pro.nudge.v1' }

/** Local calendar day — the nudge sleeps until tomorrow, not for 24 hours. */
function nudgeDay(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

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
// The dock holds three peers plus the mic: Money, Tala, mic, Score. Ask lives
// in the floating speed-dial instead — it is powerful but not daily, and four
// destinations plus the mic is already all a small phone can hold. `tanong`
// stays a full Tab (the screen still exists); it is just not a dock item.
const TABS: { id: Tab; labelKey: UIStr; icon: string }[] = [
  { id: 'twin', labelKey: 'tab.twin', icon: 'M3 13h4v8H3zM10 3h4v18h-4zM17 9h4v12h-4z' },
  { id: 'tala', labelKey: 'tab.ledger', icon: 'M5 3h14v18H5zM8 8h8M8 12h8M8 16h5' },
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
  supplier: 'app.supplierDebts',
  resibo: 'tab.receipt',
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
  // The floating speed-dial above the dock: Utang, Items, Ask. Closed whenever
  // a destination is chosen, so it can never cover the screen it just opened.
  const [moreOpen, setMoreOpen] = useState(false)
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



  // Header plan chip: two solid medallions, not two tints. FREE is a paper
  // pill with a live emerald dot; PRO is the same near-black + gold as the
  // PRO story card, so the header and the offer read as one product. The old
  // amber wash read as a warning state, not a plan worth paying for.
  const tierConfig = {
    free: {
      badge: 'border-emerald-600/30 bg-emerald-50 text-emerald-900 shadow-xs',
      dot: 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]',
    },
    pro: {
      badge:
        'plan-chip-pro border-gold-300/50 bg-[#0c1445] text-gold-300 shadow-[0_6px_16px_-6px_rgba(8,16,50,0.6)]',
      dot: 'bg-gold-300 shadow-[0_0_6px_rgba(255,213,74,0.9)]',
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

  // Swipe between the dock's screens like a native tab bar: Money ↔ Tala ↔
  // Voice ↔ Score, the same left-to-right order the dock shows. Secondary
  // screens (Ask, Items, Utang, Plan…) never swipe — a sideways move there
  // would lose a form or a list the owner opened on purpose.
  const SWIPE_TABS: Tab[] = ['twin', 'tala', 'boses', 'score']
  const swipeStart = useRef<{ x: number; y: number } | null>(null)
  function onSwipeStart(event: ReactTouchEvent<HTMLElement>) {
    const touch = event.touches[0]
    if (!touch) return
    // The screen edges belong to the OS back gesture; never steal them.
    if (touch.clientX < 16 || touch.clientX > window.innerWidth - 16) {
      swipeStart.current = null
      return
    }
    swipeStart.current = { x: touch.clientX, y: touch.clientY }
  }
  function onSwipeEnd(event: ReactTouchEvent<HTMLElement>) {
    const start = swipeStart.current
    swipeStart.current = null
    if (!start) return
    // Overlays eat the gesture: a swipe with the sheet or speed-dial open
    // dismisses nothing and navigates nowhere.
    if (menuOpen || moreOpen) return
    const order = SWIPE_TABS.indexOf(tab)
    if (order < 0) return
    const touch = event.changedTouches[0]
    if (!touch) return
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    // A deliberate horizontal flick: 70px, and twice as wide as it is tall,
    // so a scrolling thumb never changes the screen by accident.
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2) return
    const target = event.target as HTMLElement | null
    // Text fields keep their own gestures, and a swipe that starts inside a
    // horizontal scroller (filter chips) belongs to that scroller.
    if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return
    let node: HTMLElement | null = target
    while (node && node !== mainRef.current) {
      if (node.scrollWidth > node.clientWidth + 4) return
      node = node.parentElement
    }
    const next = dx < 0 ? SWIPE_TABS[order + 1] : SWIPE_TABS[order - 1]
    if (next) goToTab(next)
  }

  const goToTab = (next: Tab) => {
    // Light haptic on tab change where the device allows it: the dock is the
    // most-tapped surface in the app, and 10ms is felt, not heard.
    try {
      navigator.vibrate?.(10)
    } catch {
      /* vibrate is best-effort */
    }
    setMoreOpen(false)
    setTab(next)
  }

  // Esc closes the speed-dial like a native popover. Registered only while it
  // is open, so the rest of the app never pays for the listener.
  useEffect(() => {
    if (!moreOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [moreOpen])

  // Esc closes the settings sheet, same as the speed-dial above: a keyboard
  // or switch user gets the same way out of every overlay.
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

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
    setMoreOpen(false)
  }

  const goToUtang = () => {
    setTab('utang')
    setMenuOpen(false)
    setMoreOpen(false)
  }

  const goToSupplier = () => {
    setTab('supplier')
    setMenuOpen(false)
    setMoreOpen(false)
  }

  const goToReceipt = () => {
    setTab('resibo')
    setMenuOpen(false)
    setMoreOpen(false)
  }

  const goToAsk = () => {
    setTab('tanong')
    setMenuOpen(false)
    setMoreOpen(false)
  }

  // The daily PRO nudge: free owners see one upgrade popup per day, on the
  // Money page, dismissible with either button or the backdrop — and never
  // again that day once dismissed. PRO owners never see it at all.
  const [nudgeOpen, setNudgeOpen] = useState(false)
  useEffect(() => {
    if (tab === 'twin' && billing.tier === 'free' && readPersisted(PRO_NUDGE) !== nudgeDay()) {
      setNudgeOpen(true)
    } else {
      setNudgeOpen(false)
    }
  }, [tab, billing.tier])
  function dismissNudge() {
    writePersisted(PRO_NUDGE, nudgeDay())
    setNudgeOpen(false)
  }

  function setDemoTier(tier: TierId) {
    if (tier === 'free') billing.downgrade()
    else billing.purchase(tier, 'gcash')
  }

  // The plan chip + Settings key, shared by the full header and the Money
  // tab's slim row: one element, rendered in exactly one place at a time.
  const headerActions = (
    <div className="flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={goToPlan}
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[0.6875rem] font-black uppercase tracking-[0.08em] transition-all active:scale-95 hover:opacity-90 ${tierConfig.badge}`}
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
  )

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
       *
       * On the Money tab only the right cluster (plan chip + Settings) shows,
       * right-aligned with no title: the greeting block (date + Good morning +
       * owl bubble) already opens the screen, so a second title would say the
       * same thing twice — but the plan and settings must stay one tap away.
       */}
      {tab === 'twin' ? (
        <div className="safe-top z-20 flex justify-end px-4 pt-2">
          {headerActions}
        </div>
      ) : (
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

          {headerActions}
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
      )}

      <main
        ref={mainRef}
        className="no-scrollbar flex-1 touch-pan-y overflow-y-auto px-0 pt-0 pb-32"
        onTouchStart={onSwipeStart}
        onTouchEnd={onSwipeEnd}
      >
        {/* Keyed by tab so the staggered entrance replays on every screen change. */}
        <div key={tab} className="enter">
          {tab === 'twin' ? (
            <Dashboard
              negosyo={negosyo}
              onOpenScore={() => setTab('score')}
              onOpenUtang={goToUtang}
              onOpenSupplier={goToSupplier}
              onOpenOffline={goToOffline}
              onOpenItems={goToItems}
              onOpenReceipt={goToReceipt}
              onOpenAsk={goToAsk}
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
          {tab === 'supplier' ? (
            <SupplierScreen negosyo={negosyo} onOpenLedger={() => setTab('tala')} />
          ) : null}
          {tab === 'resibo' ? <ReceiptScreen negosyo={negosyo} /> : null}
        </div>
      </main>

      {nudgeOpen ? (
        <ConfirmDialog
          title={t('plan.nudgeTitle')}
          body={t('plan.nudgeBody')}
          confirmLabel={t('plan.nudgeCta')}
          cancelLabel={t('plan.nudgeLater')}
          tone="brand"
          onConfirm={() => {
            dismissNudge()
            goToPlan()
          }}
          onCancel={dismissNudge}
        />
      ) : null}

      {/*
       * The dock — one floating white pill with four keys in a row: Money,
       * Tala, Score, More. The mic rides separate, with a gap, to the
       * right of the pill. More is not a destination — it blooms Ask, My
       * items and the Utang list upward above the dock's right end.
       *
       * The selected destination stretches into a labelled pill (index.css,
       * `.dock-tab.is-on`) so the bar itself says where you are; on a 280px
       * phone the label is shed and the page eyebrow above the content keeps
       * naming the screen.
       */}

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {/* Transparent scrim while the speed-dial is open: a tap anywhere
            outside it dismisses, with no dimming so the owner keeps context. */}
        {moreOpen ? (
          <button
            type="button"
            aria-label={t('app.close')}
            onClick={() => setMoreOpen(false)}
            className="fixed inset-0 -z-10 cursor-default bg-transparent"
          />
        ) : null}
        <div className="relative mx-auto flex max-w-md items-end gap-2.5">
          <div className="relative min-w-0 flex-1">
          {/* The speed-dial panel: More blooms Ask, My items and the Utang
              list upward above the dock's right end. */}
          {moreOpen ? (
            <div
              role="menu"
              aria-label={t('dock.quick')}
              className="absolute right-0 bottom-[calc(100%+10px)] z-10 flex w-64 flex-col gap-1.5 rounded-3xl border border-white/80 bg-white/95 p-2 shadow-2xl backdrop-blur-2xl"
            >
              <SpeedRow
                index={0}
                icon="M4 4h16v12H8l-4 4z"
                title={t('tab.ask')}
                sub={t('dock.askHint')}
                onOpen={() => goToTab('tanong')}
                active={tab === 'tanong'}
              />
              <SpeedRow
                index={1}
                icon="M4 9l8-5 8 5v9l-8 5-8-5zM4 9l8 5 8-5M12 14v7"
                title={t('app.myItems')}
                sub={t('items.count', { n: negosyo.ledger.skus.length })}
                onOpen={goToItems}
              />
              <SpeedRow
                index={2}
                icon="M7 10h10M7 14h7M5 3h14v18H5z"
                title={t('app.utangList')}
                sub={`${t('utang.total')} · ${formatPHP(negosyo.derived.receivablesCentavos)}`}
                onOpen={goToUtang}
              />
              <SpeedRow
                index={3}
                icon="M4 7h16v10H4zM8 7V5h8v2M8 11h8"
                title={t('app.supplierDebts')}
                sub={`${t('supplier.total')} · ${formatPHP(negosyo.derived.totalLiabilitiesCentavos)}`}
                onOpen={goToSupplier}
              />
              <SpeedRow
                index={4}
                icon="M4 8h3l2-2h6l2 2h3v11H4zM12 16a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z"
                title={t('tab.receipt')}
                sub={t('receipt.captureBody')}
                onOpen={() => goToTab('resibo')}
                active={tab === 'resibo'}
              />
            </div>
          ) : null}
          <ul className="dock min-w-0 flex-1">
          {TABS.map((item) => {
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
          {/* More: the fourth dock key, not a destination — it blooms the
              speed-dial panel above. Reads selected while open, like a tab. */}
          <li className="flex flex-1 justify-center">
            <button
              type="button"
              onClick={() => {
                try {
                  navigator.vibrate?.(10)
                } catch {
                  /* vibrate is best-effort */
                }
                setMoreOpen((open) => !open)
              }}
              aria-expanded={moreOpen}
              aria-label={moreOpen ? t('app.close') : t('dock.quick')}
              title={t('dock.quick')}
              className={`dock-tab ${moreOpen ? 'is-on' : ''}`}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5 shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span className="dock-label">{t('dock.more')}</span>
            </button>
          </li>
        </ul>
          </div>
          {/* The mic rides separate, with a gap, to the right of the pill. */}
          <button
            type="button"
            onClick={() => goToTab('boses')}
            aria-current={tab === 'boses' ? 'page' : undefined}
            aria-label={t('tab.voice')}
            title={t('tab.voice')}
            className={`dock-fab mic-side ${tab === 'boses' ? 'is-active' : ''}`}
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
        </div>
      </nav>

      {/* Settings as an overlay sheet, not an inline expander: it stops the app
          from reflowing under the owner's thumb and gives destructive actions
          (Burahin lahat) the separation they deserve. */}
      {menuOpen ? (
        <div
          className="fixed inset-0 z-40 flex flex-col justify-end"
          role="dialog"
          aria-modal="true"
          aria-label={t('app.settings')}
        >
          <button
            type="button"
            aria-label={t('app.close')}
            onClick={() => setMenuOpen(false)}
            className="absolute inset-0 bg-scrim backdrop-blur-[2px]"
          />
          {/* Native sheet: full-bleed to all four phone edges — no side or
              bottom gaps. The header never scrolls; the big title lives inside
              the scroll area so it slides away and the small title up top is
              what stays. */}
          <div className="relative mx-auto flex h-[94dvh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] border-x border-t border-white/80 bg-white/95 shadow-2xl backdrop-blur-2xl">
            <div className="sheet-native-header shrink-0 border-b border-line/60 bg-white/80 px-4 pt-2 pb-2.5 backdrop-blur-xl">
              <div className="mx-auto mb-1.5 h-1 w-10 rounded-full bg-line-strong" aria-hidden />
              <div className="flex items-center justify-between gap-3">
                <span className="text-[0.9375rem] font-extrabold text-fg">{t('app.settings')}</span>
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-sunken text-fg-muted transition-transform hover:text-fg active:scale-95"
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
            </div>

            <div className="sheet-native flex-1 overflow-y-auto px-4 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
              <h2 className="headline text-[1.75rem] leading-tight font-black text-fg">
                {t('app.settings')}
              </h2>

              <div className="mt-3 space-y-5">
              <section aria-label={t('app.settingsAccount')}>
                <h3 className="eyebrow mb-1.5 text-fg-faint">{t('app.settingsAccount')}</h3>
                <div className="space-y-2.5">
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
                </div>
              </section>
              <section aria-label={t('app.settingsShop')}>
                <h3 className="eyebrow mb-1.5 text-fg-faint">{t('app.settingsShop')}</h3>
                <div className="space-y-2.5">
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
                  onClick={goToSupplier}
                  className="flex w-full items-center justify-between gap-3 rounded-2xl border border-line bg-card px-3.5 py-3 text-left shadow-e1 transition active:bg-sunken"
                >
                  <span>
                    <span className="block text-[0.9375rem] font-semibold text-fg">
                      {t('app.supplierDebts')}
                    </span>
                    <span className="num block text-[0.8125rem] text-fg-faint">
                      {t('supplier.total')} · {formatPHP(negosyo.derived.totalLiabilitiesCentavos)}
                    </span>
                  </span>
                  <span className="shrink-0 text-[0.875rem] font-bold text-brand-700">
                    {t('app.open')}
                  </span>
                </button>
                </div>
              </section>
              <section aria-label={t('app.settingsVoice')}>
                <h3 className="eyebrow mb-1.5 text-fg-faint">{t('app.settingsVoice')}</h3>
                <div className="space-y-2.5">
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

                </div>
              </section>
              <section aria-label={t('app.settingsApp')}>
                <h3 className="eyebrow mb-1.5 text-fg-faint">{t('app.settingsApp')}</h3>
                <div className="space-y-2.5">
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

                </div>
              </section>
              <section aria-label={t('app.settingsData')}>
                <h3 className="eyebrow mb-1.5 text-fg-faint">{t('app.settingsData')}</h3>
                <div className="space-y-2.5">
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
              </section>
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

/**
 * One row of the speed-dial: icon, name, and the live sub-line (the owed
 * total, the item count) that answers "did my stuff save?" before the tap.
 * Rows rise in from the bottom with a stagger (index.css, `.speed-row`),
 * nearest the + key first.
 */
function SpeedRow({
  index,
  icon,
  title,
  sub,
  onOpen,
  active = false,
}: {
  index: number
  icon: string
  title: string
  sub: string
  onOpen: () => void
  active?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onOpen}
      aria-current={active ? 'page' : undefined}
      className="speed-row flex w-full items-center gap-3 rounded-2xl border border-line bg-card px-3 py-2.5 text-left shadow-e1 transition hover:border-brand-500/40 active:scale-[0.98]"
      style={{ animationDelay: `${(2 - index) * 45}ms` }}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
          active ? 'bg-brand-800 text-white' : 'bg-sunken text-fg-muted'
        }`}
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4.5 w-4.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={icon} />
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.875rem] font-bold text-fg">{title}</span>
        <span className="num block truncate text-[0.75rem] text-fg-faint">{sub}</span>
      </span>
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4 shrink-0 text-fg-faint"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M9 6l6 6-6 6" />
      </svg>
    </button>
  )
}

/*
 * The old hand-drawn mark (a navy tile with the sun and an eye) used to live
 * here. It is gone: the official wordmark carries the brand in the header now,
 * and the square icons survive only as the generated rasters in `public/`
 * (`node tools/make-assets.mjs`), where the mark is cropped out of the lockup
 * because lettering is unreadable at 48px.
 */
