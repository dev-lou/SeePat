/**
 * The splash handoff.
 *
 * The splash itself is static HTML in `index.html` (see the comment there): it
 * has to paint on the first byte, which a React-rendered splash cannot do. This
 * module is the other half — the app's side of the contract.
 *
 * Two rules make it honest rather than decorative:
 *
 *  1. **It is not an artificial delay.** `finish()` is called from a real
 *     lifecycle point — the first committed frame of the app, with the interface
 *     fonts settled — so on a warm service-worker load the splash is gone almost
 *     immediately, and on a cold load it stays exactly as long as there was
 *     genuinely nothing to show.
 *  2. **It fails open.** If this module never runs, the inline script's fallback
 *     timer removes the splash anyway. A crash in the app can cost you the app;
 *     it must never cost you a screen you cannot leave.
 */

export interface BootHandle {
  start: number
  minMs: number
  finish: () => void
}

declare global {
  interface Window {
    __seepatBoot?: BootHandle
  }
}

/**
 * How long the splash should still hold, given when it appeared. Pure so the
 * timing can be tested without a DOM, and so the rule is readable: never less
 * than the floor (a splash that flashes reads as a glitch), never more than the
 * cap (a splash that lingers reads as a hang).
 */
export function bootHoldMs(
  startedAt: number,
  now: number,
  minMs: number,
  capMs = 2500,
): number {
  const elapsed = now - startedAt
  const remaining = Math.max(0, minMs - elapsed)
  return Math.min(remaining, Math.max(0, capMs - elapsed))
}

/**
 * Dismiss the splash once the app has actually rendered and the type is settled.
 *
 * Fonts matter here specifically: the first screen an owner sees is made of
 * numbers set in Sora, and handing over before the display face is ready means
 * watching the entire interface reflow a beat after arriving. `document.fonts.ready`
 * is the only signal that says "the type you are about to show is the type they
 * will see".
 */
export function finishBoot(): void {
  const boot = typeof window === 'undefined' ? undefined : window.__seepatBoot
  if (!boot) return

  const hold = () => boot.finish()

  if (typeof document !== 'undefined' && document.fonts?.ready) {
    // A font that never resolves must not hold the splash: the fallback timer in
    // index.html is the backstop, and `Promise.race` just makes it sooner.
    void Promise.race([
      document.fonts.ready,
      new Promise((resolve) => setTimeout(resolve, 1200)),
    ]).then(hold)
    return
  }

  hold()
}
