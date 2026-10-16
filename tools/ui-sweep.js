/*
 * The phone-size sweep, as a browser script.
 *
 *   node -e "..." — no. This file is injected into a running page instead:
 *   open the app in the preview panel and evaluate
 *
 *     fetch('/tools/ui-sweep.js').then(r => r.text()).then(t => new Function(t)())
 *
 *   then, at any viewport width and reading size,
 *
 *     await window.__sweep()
 *
 * It reports, for every screen of the app, the four failures that this design
 * pass actually produced bugs from:
 *
 *   1. CLIPPED-*      something that carries text is being cut off (the old
 *                     `₱38,9…` class of bug, and the card that quietly hides its
 *                     own last row).
 *   2. FIGURE-WRAPPED a peso amount broken across two lines, which prints a
 *                     number a hundred times smaller than the real one.
 *   3. TYPE-BELOW-12PX the project's type floor, which several clamps and one
 *                     `.stamp` have silently crossed already.
 *   4. undersizedTargets  controls under 44×44, the smallest a thumb reliably
 *                     hits — checked on the tab it lands on.
 *
 * It is deliberately a browser script rather than a jsdom test: the failures it
 * looks for are all *layout* failures, and jsdom has no layout. It is the same
 * reason the contrast audit is a script and not a unit test.
 */
;(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  window.__sweep = async (opts = {}) => {
    const problems = []
    const seen = new Set()
    const cls = (el) => el.tagName + '.' + String(el.className).slice(0, 44)

    const audit = (screen) => {
      const push = (o) => {
        const key = [screen, o.kind, o.cls, o.txt].join('|')
        if (seen.has(key)) return
        seen.add(key)
        problems.push({ screen, ...o })
      }
      const vw = window.innerWidth
      const doc = document.documentElement
      if (doc.scrollWidth > vw + 1) push({ kind: 'PAGE-OVERFLOW', w: doc.scrollWidth, vw })
      const main = document.querySelector('main')
      if (main && main.scrollWidth > main.clientWidth + 1)
        push({ kind: 'MAIN-SCROLLS-X', w: main.scrollWidth, client: main.clientWidth })

      document.querySelectorAll('*').forEach((el) => {
        const cs = getComputedStyle(el)
        if (cs.display === 'none' || cs.visibility === 'hidden') return
        if (el.classList.contains('sr-only') || el.closest('.sr-only')) return
        if (el.closest('nav') || el.closest('.canvas-grid')) return
        const r = el.getBoundingClientRect()
        if (!r.width && !r.height) return
        const text = el.textContent.trim()
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
        if (/figure-xl|figure-lg/.test(String(el.className)) && el.getClientRects().length > 1)
          push({ kind: 'FIGURE-WRAPPED', cls: cls(el), txt: text.slice(0, 26) })
        if (!(own || el.children.length === 0) || !text) return
        const txt = text.slice(0, 26)
        if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible')
          push({ kind: 'CLIPPED-X', cls: cls(el), txt, hid: el.scrollWidth - el.clientWidth, ell: cs.textOverflow })
        if (cs.overflowY === 'hidden' && el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1)
          push({ kind: 'CLIPPED-Y', cls: cls(el), txt, hid: el.scrollHeight - el.clientHeight })
        if (r.right > vw + 1) push({ kind: 'OFFSCREEN-R', cls: cls(el), txt, right: Math.round(r.right) })
        if (r.left < -1) push({ kind: 'OFFSCREEN-L', cls: cls(el), txt, left: Math.round(r.left) })
      })

      let smallest = 99
      document.querySelectorAll('p, span, div, h1, h2, h3, li, button, select, input, label').forEach((el) => {
        if (!el.textContent.trim() || el.children.length) return
        const cs = getComputedStyle(el)
        if (cs.display === 'none' || cs.visibility === 'hidden') return
        const px = parseFloat(cs.fontSize)
        if (!px) return
        if (px < smallest) smallest = px
        if (px < 12 - 0.15)
          push({ kind: 'TYPE-BELOW-12PX', cls: cls(el), txt: el.textContent.trim().slice(0, 22), px: Math.round(px * 10) / 10 })
      })
      return smallest
    }

    const navBtns = [...document.querySelectorAll('nav button')]
    const screens = navBtns.map((b) => ({ btn: b, name: b.getAttribute('aria-label') || 'icon' }))
    let smallestAll = 99
    for (const step of opts.steps || ['normal', 'bigger']) {
      document.documentElement.dataset.read = step
      await sleep(170)
      for (const s of screens) {
        s.btn.click()
        await sleep(210)
        const m = audit(`${step}/${s.name}`)
        smallestAll = Math.min(smallestAll, m || 99)
      }
    }

    document.documentElement.dataset.read = opts.steps?.[0] || 'normal'
    screens[0]?.btn.click()
    await sleep(210)
    const undersizedTargets = []
    document.querySelectorAll('button, a, select, input, [role=button]').forEach((el) => {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) return
      if (r.height < 43.5 || r.width < 43.5)
        undersizedTargets.push({
          cls: cls(el),
          w: Math.round(r.width),
          h: Math.round(r.height),
          txt: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 20),
        })
    })
    return {
      vw: window.innerWidth,
      vh: window.innerHeight,
      smallestFontPx: Math.round(smallestAll * 10) / 10,
      problems,
      undersizedTargets: undersizedTargets.slice(0, 12),
    }
  }
  return 'sweep ready'
})()
