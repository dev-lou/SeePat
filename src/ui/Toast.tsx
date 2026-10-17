import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export type ToastTone = 'success' | 'warn' | 'error' | 'info'

export interface ToastOptions {
  title: string
  description?: string
  tone?: ToastTone
  onUndo?: () => void
  undoLabel?: string
  duration?: number
}

interface ToastContextValue {
  show: (options: ToastOptions | string) => void
  dismiss: () => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return ctx
}

interface ActiveToast extends ToastOptions {
  id: number
  exiting?: boolean
  duration: number
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<ActiveToast | null>(null)
  const [timeLeft, setTimeLeft] = useState<number>(5)
  const [isPaused, setIsPaused] = useState(false)
  const timerRef = useRef<number | null>(null)
  const intervalRef = useRef<number | null>(null)
  const exitTimerRef = useRef<number | null>(null)
  const startTimeRef = useRef<number>(0)
  const elapsedBeforePauseRef = useRef<number>(0)
  const totalDurationRef = useRef<number>(5000)
  const isPausedRef = useRef(false)
  const hasActiveToastRef = useRef(false)

  const clearExistingTimers = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }

  const dismiss = () => {
    clearExistingTimers()
    hasActiveToastRef.current = false
    setIsPaused(false)
    isPausedRef.current = false

    // Transition to exit animation state
    setCurrent((prev) => (prev ? { ...prev, exiting: true } : null))

    if (exitTimerRef.current) {
      clearTimeout(exitTimerRef.current)
    }
    exitTimerRef.current = window.setTimeout(() => {
      setCurrent(null)
      exitTimerRef.current = null
    }, 220)
  }

  const dismissRef = useRef(dismiss)
  dismissRef.current = dismiss

  const show = (options: ToastOptions | string) => {
    // Clear any exit animation in progress
    if (exitTimerRef.current) {
      clearTimeout(exitTimerRef.current)
      exitTimerRef.current = null
    }
    clearExistingTimers()
    setIsPaused(false)
    isPausedRef.current = false
    elapsedBeforePauseRef.current = 0
    hasActiveToastRef.current = true

    const opts: ToastOptions =
      typeof options === 'string'
        ? { title: options, tone: 'success' }
        : { tone: 'success', ...options }

    // Industry standard: 5000ms (5s) for actions with Undo, 3500ms (3.5s) for read-only alerts
    const totalDuration = opts.duration ?? (opts.onUndo ? 5000 : 3500)
    totalDurationRef.current = totalDuration
    startTimeRef.current = Date.now()
    setTimeLeft(Math.ceil(totalDuration / 1000))

    // Haptic vibration feedback for mobile devices
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        if (opts.tone === 'error') {
          navigator.vibrate([30, 50, 30])
        } else if (opts.tone === 'warn') {
          navigator.vibrate([25, 40])
        } else {
          navigator.vibrate([20, 35])
        }
      } catch {
        // Ignore devices where vibration is blocked
      }
    }

    const toastItem: ActiveToast = {
      ...opts,
      duration: totalDuration,
      id: Date.now(),
      exiting: false,
    }
    setCurrent(toastItem)

    // Live countdown interval (runs every 100ms; auto-dismisses when remaining reaches 0)
    intervalRef.current = window.setInterval(() => {
      if (isPausedRef.current) return
      const elapsed = Date.now() - startTimeRef.current
      const remaining = Math.max(0, totalDurationRef.current - elapsed)
      const secs = Math.ceil(remaining / 1000)
      setTimeLeft(secs)

      if (remaining <= 0) {
        dismissRef.current()
      }
    }, 100)

    // Backup safety timeout
    timerRef.current = window.setTimeout(() => {
      dismissRef.current()
    }, totalDuration)
  }

  const handlePause = () => {
    if (isPausedRef.current || !hasActiveToastRef.current) return
    isPausedRef.current = true
    setIsPaused(true)
    clearExistingTimers()
    elapsedBeforePauseRef.current = Date.now() - startTimeRef.current
  }

  const handleResume = () => {
    if (!isPausedRef.current || !hasActiveToastRef.current) return
    isPausedRef.current = false
    setIsPaused(false)
    const remaining = Math.max(500, totalDurationRef.current - elapsedBeforePauseRef.current)
    startTimeRef.current = Date.now() - elapsedBeforePauseRef.current

    intervalRef.current = window.setInterval(() => {
      if (isPausedRef.current) return
      const elapsed = Date.now() - startTimeRef.current
      const rem = Math.max(0, totalDurationRef.current - elapsed)
      const secs = Math.ceil(rem / 1000)
      setTimeLeft(secs)

      if (rem <= 0) {
        dismissRef.current()
      }
    }, 100)

    timerRef.current = window.setTimeout(() => {
      dismissRef.current()
    }, remaining)
  }

  const handleMouseEnter = () => {
    // Only pause on true mouse hover (not emulated mobile touch)
    if (typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches) {
      handlePause()
    }
  }

  const handleMouseLeave = () => {
    if (typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches) {
      handleResume()
    }
  }

  useEffect(() => {
    return () => {
      clearExistingTimers()
      if (exitTimerRef.current) {
        clearTimeout(exitTimerRef.current)
      }
    }
  }, [])

  return (
    <ToastContext.Provider value={{ show, dismiss }}>
      {children}
      {current ? (
        <div className="fixed top-3.5 inset-x-0 z-[99999] mx-auto max-w-sm px-3.5 pointer-events-none flex justify-center">
          <div
            key={current.id}
            role="status"
            aria-live="polite"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onTouchStart={handlePause}
            onTouchEnd={handleResume}
            onTouchCancel={handleResume}
            className={`pointer-events-auto group relative overflow-hidden flex items-center gap-3 rounded-full border border-white/20 bg-[#0b0b0f]/95 py-2.5 px-4.5 shadow-[0_20px_50px_-10px_rgba(0,0,0,0.65),0_0_0_1px_rgba(255,255,255,0.12)] backdrop-blur-2xl transition-all ${
              current.exiting ? 'dynamic-island-exit' : 'dynamic-island-enter'
            } ${
              current.tone === 'success'
                ? 'shadow-[0_12px_36px_-6px_rgba(16,185,129,0.35)]'
                : current.tone === 'warn'
                  ? 'shadow-[0_12px_36px_-6px_rgba(245,158,11,0.35)]'
                  : current.tone === 'error'
                    ? 'shadow-[0_12px_36px_-6px_rgba(239,68,68,0.35)]'
                    : 'shadow-[0_12px_36px_-6px_rgba(59,130,246,0.35)]'
            }`}
          >
            {/* Status Icon Disc */}
            <div
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border shadow-xs font-black text-[0.75rem] ${
                current.tone === 'success'
                  ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-400'
                  : current.tone === 'warn'
                    ? 'bg-amber-500/20 border-amber-400/50 text-amber-300'
                    : current.tone === 'error'
                      ? 'bg-red-500/20 border-red-400/50 text-red-400'
                      : 'bg-brand-500/20 border-brand-400/50 text-brand-300'
              }`}
            >
              {current.tone === 'success' ? '✓' : current.tone === 'warn' ? '!' : current.tone === 'error' ? '✕' : 'ℹ'}
            </div>

            {/* Message Body */}
            <div className="min-w-0 flex-1">
              {/* `line-clamp-2` rather than `truncate`: a validation message is
                  the one place the toast has something to say, and "Add an item,
                  a quantity, and a pri…" is not a message. Two lines fit every
                  string in the table at both reading sizes. */}
              <p className="text-[0.875rem] font-bold text-white tracking-wide line-clamp-2 drop-shadow-xs">
                {current.title}
              </p>
              {current.description ? (
                <p className="text-[0.75rem] font-medium text-white/75 line-clamp-2 mt-0.5">
                  {current.description}
                </p>
              ) : null}
            </div>

            {/* Undo Action Button with Live Seconds Countdown */}
            {current.onUndo ? (
              <button
                type="button"
                onClick={() => {
                  current.onUndo?.()
                  dismiss()
                }}
                className="shrink-0 flex min-h-11 items-center gap-1.5 rounded-full bg-white/20 hover:bg-white/30 active:scale-95 px-3.5 py-2 text-[0.75rem] font-black uppercase tracking-wider text-gold-300 backdrop-blur-md border border-white/25 shadow-xs transition-all"
              >
                <span>{current.undoLabel ?? 'Undo'}</span>
                <span aria-hidden="true" className="inline-flex items-center justify-center rounded-full bg-black/45 px-1.5 py-0.5 text-[0.6875rem] font-mono font-black text-gold-200 tabular-nums shadow-inner">
                  {timeLeft}s
                </span>
              </button>
            ) : null}

            {/* Close Button */}
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/50 hover:text-white active:scale-90 transition-all"
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>

            {/* Luminous Progress Countdown Bar */}
            <div className="absolute bottom-0 inset-x-5 h-[2px] overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full rounded-full ${
                  current.tone === 'success'
                    ? 'bg-gradient-to-r from-emerald-400 to-teal-300 shadow-[0_0_8px_rgba(52,211,153,0.9)]'
                    : current.tone === 'warn'
                      ? 'bg-gradient-to-r from-amber-400 to-yellow-300 shadow-[0_0_8px_rgba(251,191,36,0.9)]'
                      : current.tone === 'error'
                        ? 'bg-gradient-to-r from-red-400 to-rose-300 shadow-[0_0_8px_rgba(248,113,113,0.9)]'
                        : 'bg-gradient-to-r from-brand-400 to-blue-300 shadow-[0_0_8px_rgba(96,165,250,0.9)]'
                }`}
                style={{
                  animation: `toast-progress ${current.duration}ms linear forwards`,
                  animationPlayState: isPaused ? 'paused' : 'running',
                }}
              />
            </div>
          </div>
        </div>
      ) : null}
    </ToastContext.Provider>
  )
}
