#!/usr/bin/env node
/**
 * Record the SeePat demo video.
 *
 * Why not the Preview panel's recorder: that browser draws a Freebuff badge over
 * the page, which would be baked into a video that is going to a government
 * panel. So this drives its own clean Edge over CDP — no overlay, no extensions,
 * no first-run UI — and captures real frames with `Page.startScreencast`.
 *
 * Why the frame timestamps matter: a screencast pushes a frame only when the page
 * repaints, so the output is variable frame rate. The frames are therefore written
 * to disk with the CDP timestamp that produced them, and the durations are handed
 * to ffmpeg through a concat list, which preserves the real pacing instead of
 * pretending every frame is 1/30 s apart.
 *
 * A fresh profile is seeded by the app itself (`store.ts` falls back to
 * `seedLedger`), so the demo opens on a populated store with no setup.
 *
 * Usage:  node tools/record-demo.mjs [outDir] [--smoke] [baseUrl]
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The browser is a child process, so if this script throws the browser would
 * survive it -- and a surviving browser keeps the shell's pipe open, which hangs
 * the terminal command that launched it instead of failing. Every exit path
 * therefore kills what was started.
 */
const CHILDREN = new Set()
let ACTIVE_CDP = null
/** Frames withheld during screen changes; reported in take.json as evidence. */
let heldFrames = 0

/**
 * Close the DevTools socket too, not just the browser.
 *
 * An open WebSocket keeps Node's event loop alive, so a run that failed left the
 * process (and the shell command that started it) hanging instead of reporting the
 * error -- which is exactly what happened twice before this was wired up.
 */
function shutdown() {
  for (const child of CHILDREN) {
    try {
      child.kill()
    } catch {
      /* already gone */
    }
  }
  CHILDREN.clear()
  if (ACTIVE_CDP) {
    try {
      ACTIVE_CDP.close()
    } catch {
      /* already closed */
    }
    ACTIVE_CDP = null
  }
}
process.on('exit', shutdown)
process.on('SIGINT', () => {
  shutdown()
  process.exit(130)
})
process.on('uncaughtException', (err) => {
  console.error(`record failed: ${err.message}`)
  shutdown()
  process.exit(1)
})

const args = process.argv.slice(2)
const SMOKE = args.includes('--smoke')
/**
 * Splash mode films the app's own loading screen instead of the demo.
 *
 * The boot overlay hides itself as soon as the app mounts, so the app's
 * JavaScript is blocked for this run: the overlay then stays up and its CSS
 * animation -- lockup, sheen, progress bar -- can be captured for real, which is
 * a better bookend than any card drawn with drawtext.
 */
const SPLASH = args.includes('--splash')
/**
 * Howto mode films the chapter card that opens the demo.
 *
 * It is injected into the running app rather than drawn with drawtext, and it
 * carries its own inline CSS so it cannot drift with the app's stylesheet: the
 * card is a fixed overlay, animated in step by step, and the screencast films that
 * animation. The step list comes from narration.json, which is also what labels
 * the step chips in the edit, so the agenda and the film cannot disagree.
 */
const HOWTO = args.includes('--howto')
const positional = args.filter((a) => !a.startsWith('--'))
const OUT = positional[0] ?? (SPLASH ? 'docs/video/splash' : 'docs/video/raw')
const BASE = positional[1] ?? 'http://localhost:5173/'
const PORT = 9344

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function findEdge() {
  const found = EDGE_CANDIDATES.find((p) => existsSync(p))
  if (!found) throw new Error('Microsoft Edge not found')
  return found
}

async function cdpTarget(port, tried = 0) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`)
    const list = await res.json()
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
    if (page) return page.webSocketDebuggerUrl
  } catch {
    /* not up yet */
  }
  if (tried > 60) throw new Error('DevTools endpoint never came up')
  await sleep(250)
  return cdpTarget(port, tried + 1)
}

/** CDP client over the built-in WebSocket, with an event hook this time. */
function connect(wsUrl, onEvent) {
  const ws = new WebSocket(wsUrl)
  const pending = new Map()
  let nextId = 1
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve())
    ws.addEventListener('error', (e) => reject(new Error(`WebSocket error: ${e.message ?? 'unknown'}`)))
  })
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(`${msg.error.message}`))
      else resolve(msg.result)
      return
    }
    if (msg.method && onEvent) onEvent(msg.method, msg.params)
  })
  return {
    ready,
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = nextId++
        pending.set(id, { resolve, reject })
        ws.send(JSON.stringify({ id, method, params }))
      })
    },
    close: () => ws.close(),
  }
}

async function main() {
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })

  const edge = findEdge()
  const profile = mkdtempSync(join(tmpdir(), 'seepat-rec-'))
  const proc = spawn(
    edge,
    [
      '--headless=new',
      // Software compositing measured 12 fps here; letting headless use the GPU
      // dropped the same take to 1.8 fps, so this stays off deliberately.
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--mute-audio',
      '--force-device-scale-factor=2',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      '--window-size=540,960',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
  CHILDREN.add(proc)

  /** Frames land here as they are pushed; `t` is the CDP timestamp in seconds. */
  const frames = []
  let frameBytes = 0
  let firstSize = null
  let stopping = false
  /**
   * While a screen change is in flight, frames are acknowledged but not written.
   *
   * The app swaps screens with a staggered entrance, so the frames captured
   * mid-transition are a part-painted page. Written into the take, one of them cut
   * from a full screen to a near-empty one in the middle of the film -- measured as
   * the frame's ink collapsing from 1,014,777 dark pixels to 71,472 for a quarter of
   * a second. Dropping them instead makes the previous screen's last frame hold
   * across the change, which is both what the app looks like and what keeps the
   * concat timeline identical to the capture clock, so narration stays in sync.
   */
  let holding = false
  /** Touch points, in app coordinates: the edit draws a tap marker at each one. */
  const taps = []
  /**
   * Wall clock and frame timestamps live on different bases, so a beat timed with
   * Date.now() would drift against the video by however long the page took to
   * load. Every beat is therefore stamped with the timestamp of the last frame
   * that had arrived, which is what the edit actually shows.
   */
  let lastFrameT = null
  const firstFrameT = () => (frames.length ? frames[0].t : null)
  const videoNow = () => (lastFrameT !== null && frames.length ? lastFrameT - frames[0].t : null)

  const cdp = connect(await cdpTarget(PORT), async (method, params) => {
    if (method !== 'Page.screencastFrame') return
    // Ack immediately, or Edge stops pushing frames.
    cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {})
    if (stopping) return
    if (holding) {
      // The clock still advances: a skipped frame's time is folded into the hold.
      lastFrameT = params.metadata.timestamp
      heldFrames++
      return
    }
    const buf = Buffer.from(params.data, 'base64')
    const name = `f${String(frames.length).padStart(5, '0')}.jpg`
    writeFileSync(join(OUT, name), buf)
    frames.push({ name, t: params.metadata.timestamp })
    lastFrameT = params.metadata.timestamp
    frameBytes += buf.length
    if (!firstSize && params.metadata.deviceWidth) {
      firstSize = { w: params.metadata.deviceWidth, h: params.metadata.deviceHeight }
    }
  })
  ACTIVE_CDP = cdp
  await cdp.ready

  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  if (SPLASH) {
    // The blocker lives in the Network domain, not Page.
    await cdp.send('Network.enable')
    await cdp.send('Network.setBlockedURLs', {
      urls: ['*/src/main.tsx*', '*/src/main.ts*', '*/@vite/client*', '*/@react-refresh*'],
    })
  } else {
    // Skip the first-run welcome deck: this is the product, not the tour.
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: "localStorage.setItem('seepat.welcome.v1','1');",
    })
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 540,
    height: 960,
    deviceScaleFactor: 2,
    mobile: true,
  })

  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (exceptionDetails) throw new Error(exceptionDetails.text ?? 'page exception')
    return result.value
  }

  const waitFor = async (expression, label, timeoutMs = 20000) => {
    const started = Date.now()
    for (;;) {
      if (await evaluate(expression)) return true
      if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${label}`)
      await sleep(150)
    }
  }

  /**
   * Change tabs by position, not by label.
   *
   * The dock's order is fixed (dashboard, ledger, voice, ask, score) while its
   * labels come from the language tables, so the index is the stable handle. The
   * touch is measured from the button's own box, which is what puts a marker on
   * the dock at the moment the demo taps it.
   */
  const clickNav = (index, tapName, ready, readyLabel) =>
    screenChange(
      async () => {
        const rect = await tap(`document.querySelectorAll('nav button')[${index}]`, tapName)
        if (!rect) throw new Error(`no nav button at index ${index}`)
        await evaluate(`(() => { document.querySelectorAll('nav button')[${index}].click(); return true })()`)
      },
      { ready, label: readyLabel },
    )

  /**
   * Scroll as one in-page animation, awaited by a single CDP call.
   *
   * A screencast only pushes a frame when the page repaints, so both a loop of
   * scrollTo round-trips and a native gesture starved the capture (measured 5 fps
   * and 4 fps). Animation frames run inside the page, so the compositor repaints
   * on every rAF tick and the capture follows at display rate; the easing keeps
   * the motion looking human.
   */
  const smoothScroll = async (dy, ms) => {
    try {
      await evaluate(`new Promise((resolve) => {
        const start = window.scrollY;
        const target = start + ${Math.abs(dy)};
        const dur = ${ms};
        const t0 = performance.now();
        const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
        function step(t) {
          const k = Math.min(1, (t - t0) / dur);
          window.scrollTo(0, start + (target - start) * ease(k));
          if (k < 1) requestAnimationFrame(step); else resolve(true);
        }
        requestAnimationFrame(step);
      })`)
    } catch {
      await evaluate(`window.scrollBy(0, ${Math.abs(dy)})`)
    }
    await sleep(400)
  }

  /**
   * Marks record WHAT to look at, and when, in the app's own coordinates.
   *
   * The edit uses these to move a virtual camera: it pushes in on the card being
   * narrated and eases back out, instead of showing the whole phone screen for the
   * entire take. Rectangles come from the live layout, so the framing always
   * matches where the element really is rather than where a guess puts it.
   */
  const marks = []
  /**
   * Bring an element into view before measuring or touching it.
   *
   * A mark taken where an element happens to sit is not enough: the voice screen's
   * sample button lives below the fold, so its rectangle put the camera push-in on
   * empty space past the bottom edge, and the confirm button was off-screen
   * entirely -- its tap marker would have been drawn outside the frame. Revealing
   * first makes both the framing and the touch land on the element.
   */
  const reveal = async (selector) => {
    const moved = await evaluate(`(() => {
      const el = ${selector};
      if (!el) return false;
      const r = el.getBoundingClientRect();
      if (r.top < 8 || r.bottom > window.innerHeight - 8) {
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        return true;
      }
      return false;
    })()`)
    if (moved) await sleep(380)
    return moved
  }

  /**
   * The card an element sits in, rather than the element.
   *
   * Composing the camera on a single input or button means the push-in hits the
   * zoom ceiling and crops the card around it -- the ask screen measured 1.5x on a
   * one-line input, which cut the card's own heading off at both edges. Framing the
   * card keeps the control in its context, which is what a demo should show.
   */
  const cardAround = (selector) => `(() => {
    const el = ${selector};
    if (!el) return null;
    let n = el;
    while (n && n !== document.body) {
      const r = n.getBoundingClientRect();
      if (String(n.className).includes('rounded-card') && r.width > 300) return n;
      n = n.parentElement;
    }
    return el;
  })()`

  const mark = async (name, selector) => {
    await reveal(selector)
    const rect = await evaluate(`(() => {
      const el = ${selector};
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    })()`)
    if (!rect) {
      // A miss costs one camera move, not the whole take: the build falls back to
      // a wide shot when a mark is absent.
      console.warn(`mark "${name}": selector found nothing -- skipping`)
      return null
    }
    marks.push({ name, t: videoNow(), rect })
    return rect
  }

  /**
   * The card in the middle of the screen.
   *
   * Used where a label is not a reliable handle: the dashboard's score card has no
   * leading text of its own (its text begins with the number) and the score screen's
   * explanation card changes height with the data. Framing whatever is centred is
   * both robust and honest -- it is the card the eye is already on.
   */
  const centeredCard = `(() => {
    const cards = [...document.querySelector('main').querySelectorAll('div')].filter((d) =>
      String(d.className).includes('rounded-card') && d.getBoundingClientRect().width > 300);
    if (!cards.length) return null;
    const mid = window.innerHeight / 2;
    return cards.reduce((a, b) => {
      const da = Math.abs(a.getBoundingClientRect().top + a.getBoundingClientRect().height / 2 - mid);
      const db = Math.abs(b.getBoundingClientRect().top + b.getBoundingClientRect().height / 2 - mid);
      return db < da ? b : a;
    });
  })()`

  /**
   * Find a rounded card whose text starts with the given words.
   *
   * Case-insensitive on purpose: several labels are uppercased by CSS, so the
   * markup says "Real profit today" while the screen reads "REAL PROFIT TODAY".
   */
  const cardWithText = (text) =>
    `[...document.querySelector('main').querySelectorAll('div')].find((d) =>
        String(d.className).includes('rounded-card') &&
        d.textContent.trim().toLowerCase().startsWith(${JSON.stringify(text.toLowerCase())}))`

  /**
   * The dashboard's hero panel is not a `rounded-card`, so it is found by walking
   * up from the innermost element that carries the label.
   *
   * Two conditions, and the second one is the important one: the ancestor must
   * ALSO carry a rounded-* class. Stopping at "panel-sized" instead returned the
   * card's inner content box, which put the focus ring through the card's own
   * text rather than around its edge.
   */
  const panelWithText = (text) => `(() => {
    const root = document.querySelector('main');
    const needle = ${JSON.stringify(text.toLowerCase())};
    const hits = [...root.querySelectorAll('*')].filter((el) =>
      el.textContent.trim().toLowerCase().startsWith(needle));
    let el = hits[hits.length - 1];
    while (el && el !== root) {
      const r = el.getBoundingClientRect();
      const rounded = /rounded-/.test(String(el.className));
      if (rounded && r.width > 300 && r.height > 120) return el;
      el = el.parentElement;
    }
    return null;
  })()`

  /**
   * Force a repaint and wait until a new frame has actually arrived.
   *
   * This exists because a screencast pushes nothing while the screen is static: a
   * still screen is represented by ONE frame whose display lasts until the next
   * repaint. Timing a scene boundary off the last frame that happened to arrive
   * let a long still bleed into the following scene, so scene 5 labelled the score
   * screen. Forcing a fresh frame at each boundary makes the boundary a fact.
   */
  const syncFrame = async () => {
    const before = frames.length
    await evaluate(`(() => {
      const m = document.querySelector('main');
      if (!m) return false;
      m.style.willChange = 'transform';
      m.style.transform = 'translateZ(0)';
      requestAnimationFrame(() => { m.style.transform = ''; m.style.willChange = ''; });
      return true;
    })()`)
    await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 30 }).catch(() => {})
    const started = Date.now()
    while (frames.length <= before && Date.now() - started < 2500) await sleep(60)
    return videoNow()
  }

  /**
   * Hold a beat for `ms` while keeping the take's clock moving.
   *
   * A headless screencast only pushes a frame when the page repaints, so a static
   * screen is a single frame with a long duration. That is harmless until a whole
   * beat is static: then the scene measured zero seconds -- start and end landed on
   * the same frame -- and a zero-second clip cannot be cut. Forcing a repaint every
   * half second keeps frames arriving without altering what is on screen, since the
   * extra frames are identical to the one before them.
   */
  const beatHold = async (ms) => {
    const until = Date.now() + ms
    while (Date.now() < until) {
      await sleep(Math.min(500, Math.max(40, until - Date.now())))
      if (Date.now() < until) await syncFrame()
    }
  }

  /**
   * A beat is a labelled stretch of the timeline; narration is aligned to these.
   * `start`/`end` are seconds into the VIDEO (frame-zero based), and the wall
   * clock pair is kept only for diagnostics.
   */
  const beats = []
  let beatStart = null
  const startBeat = async (name) => {
    await syncFrame()
    beatStart = Date.now()
    beats.push({ name, start: videoNow(), end: null, wallStart: (beatStart - T0) / 1000 })
    return beats.length - 1
  }
  const endBeat = (idx) => {
    const b = beats[idx]
    b.wallEnd = (Date.now() - T0) / 1000
    b.end = videoNow() ?? b.wallEnd
    if (b.start === null) b.start = firstFrameT() !== null ? 0 : 0
  }

  /**
   * Record where the demo touches the screen, in the app's own coordinates.
   *
   * A demo has to show the touch, not only its result: the point is measured from
   * the element's own box at the instant before the click, so the edit can drop a
   * marker exactly where a finger would have landed -- and because it is recorded
   * in source coordinates it travels with the camera push-in for free.
   */
  const tap = async (selector, name) => {
    await reveal(selector)
    const pt = await evaluate(`(() => {
      const el = ${selector};
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`)
    if (!pt) {
      console.warn(`tap "${name}": selector found nothing -- no marker`)
      return null
    }
    taps.push({ name, t: videoNow() ?? 0, pt })
    return pt
  }

  /**
   * Run a screen change with the transition frames held back.
   *
   * `action` does the tapping (so the touch is stamped against the screen the user
   * is actually looking at), then waits for the next screen and lets its entrance
   * animation finish before frames resume. `syncFrame` afterwards guarantees the
   * first frame of the next scene is the settled screen rather than anything
   * mid-fade.
   */
  const screenChange = async (action, { ready, label = 'the next screen', settleMs = 1100 } = {}) => {
    holding = true
    try {
      await action()
      if (ready) await waitFor(ready, label)
    } finally {
      await sleep(settleMs)
      holding = false
      await syncFrame()
    }
  }

  const startCast = () =>
    cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 88,
      maxWidth: 1080,
      maxHeight: 1920,
      everyNthFrame: 1,
    })

  const T0 = Date.now()
  await cdp.send('Page.navigate', { url: BASE })

  if (SPLASH) {
    await waitFor("!!document.querySelector('#boot')", 'the boot splash')
    await startCast()
    const beat = await startBeat('splash')
    // Long enough to hold the wordmark, two sheen sweeps and the progress bar.
    await sleep(5600)
    endBeat(beat)
    await cdp.send('Page.stopScreencast')
    stopping = true
    await sleep(400)
    finish(frames, beats, OUT, frameBytes, firstSize, marks, taps)
    cdp.close()
    proc.kill()
    return
  }

  if (HOWTO) {
    const howtoSpec = JSON.parse(readFileSync('docs/video/narration.json', 'utf8'))
    const rows = howtoSpec.steps
      .map(
        (s, i) =>
          `<li class="anim" style="transition-delay:${(150 + i * 110).toString()}ms">` +
          `<b>${i + 1}</b><span>${s.card}</span></li>`,
      )
      .join('')
    const card = `<div id="howto" class="pre"><style>
      #howto{position:fixed;inset:0;z-index:2147483647;color:#fff;
        background:radial-gradient(120% 70% at 50% -10%, #123060 0%, #071433 45%, #050f28 100%);
        font-family:'Segoe UI',system-ui,sans-serif;padding:118px 64px 74px;box-sizing:border-box;
        display:flex;flex-direction:column}
      #howto .eyebrow{font-size:21px;font-weight:700;letter-spacing:5px;color:#dda60c}
      #howto h1{margin:20px 0 0;font-size:52px;line-height:1.06;font-weight:800;letter-spacing:-0.5px}
      #howto .sub{margin:16px 0 0;font-size:23px;color:#9fb0d0}
      #howto .rule{width:88px;height:6px;background:#dda60c;margin:34px 0 10px;border-radius:3px}
      #howto ul{list-style:none;margin:12px 0 0;padding:0}
      #howto li{display:flex;align-items:center;gap:22px;padding:20px 2px;
        border-bottom:1px solid rgba(255,255,255,.09)}
      #howto li b{flex:none;width:52px;height:52px;border-radius:999px;background:rgba(221,166,12,.16);
        border:1.5px solid rgba(221,166,12,.6);color:#dda60c;font-size:25px;
        display:flex;align-items:center;justify-content:center}
      #howto li span{font-size:26px;font-weight:600;line-height:1.25}
      #howto .foot{margin-top:auto;font-size:22px;color:#9fb0d0}
      #howto .foot b{color:#fff}
      #howto .anim{opacity:0;transform:translateY(20px);
        transition:opacity .5s ease,transform .6s cubic-bezier(.2,.8,.2,1)}
      #howto:not(.pre) .anim{opacity:1;transform:none}
    </style>
      <div class="anim"><div class="eyebrow">SEEPAT</div>
        <h1>How it works</h1><div class="sub">Seven steps, one ledger.</div></div>
      <div class="anim rule" style="transition-delay:120ms"></div>
      <ul>${rows}</ul>
      <div class="anim foot" style="transition-delay:${(150 + howtoSpec.steps.length * 110).toString()}ms">
        <b>All on the phone.</b> No signal needed, nothing leaves the device.</div>
    </div>`
    await waitFor("!!document.body", 'the page')
    await evaluate(`(() => { document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(card)}); return true })()`)
    // The cast starts before the class flip, so the animation is filmed from its
    // first frame rather than only its end state.
    await startCast()
    await sleep(300)
    await evaluate("(() => { document.getElementById('howto').classList.remove('pre'); return true })()")
    await sleep(3200)
    await cdp.send('Page.stopScreencast')
    stopping = true
    await sleep(400)
    finish(frames, beats, OUT, frameBytes, firstSize, [], [])
    cdp.close()
    proc.kill()
    return
  }

  await waitFor("!!document.querySelector('nav')", 'the app shell')
  await sleep(900)

  // Give the screencast a moment to start pushing frames before the first beat.
  await startCast()
  await sleep(1200)

  let beat = await startBeat('dashboard')
  // Let the dashboard breathe, then read it top to bottom.
  await beatHold(1200)
  await mark('profit-card', panelWithText('Real profit today'))
  await beatHold(1800)
  await smoothScroll(700, 1800)
  await beatHold(1200)
  await mark('score-ring', centeredCard)
  await beatHold(700)
  // A longer hold on the end of the scene: the second narration line over this
  // screen needs the room, and the camera gets to settle back to wide before the cut.
  await beatHold(1500)
  await endBeat(beat)

  // ---- step 2: the ledger -------------------------------------------------
  await clickNav(1, 'tap-nav-ledger', "!!document.querySelector('main select')", 'the ledger screen')
  beat = await startBeat('ledger')
  await beatHold(1200)
  // Pushed in on the entry form, because the chips that sit above it are the claim:
  // a sale, an utang, a gastos, a capital move and an owner withdrawal are all
  // first-class records, not variants of a sales note.
  await mark('ledger-form', cardWithText('Sale'))
  await beatHold(900)
  const utangChip =
    `[...document.querySelector('main').querySelectorAll('button')].find((b) => b.textContent.trim() === 'Utang')`
  await tap(utangChip, 'tap-utang')
  await evaluate(`(() => { const b = ${utangChip}; if (!b) return false; b.click(); return true })()`)
  await beatHold(1700)
  await smoothScroll(800, 1800)
  await beatHold(1100)
  await mark('ledger-recent', cardWithText('Recently recorded'))
  await beatHold(2300)
  await endBeat(beat)

  // ---- step 3: speak the sale ---------------------------------------------
  await clickNav(2, 'tap-nav-voice', "document.body.textContent.includes('Type What Was Said')", 'the voice screen')
  beat = await startBeat('voice-sale')
  await beatHold(1600)
  // The button the demo is about to press: the camera should be on it first.
  await mark(
    'sample-button',
    cardAround(`[...document.querySelectorAll('main button')].find((x) =>
        x.textContent.trim().startsWith('Sipat, nakabenta ako ng sampung Coke'))`),
  )
  await sleep(900)
  await tap(
    `[...document.querySelectorAll('main button')].find((x) =>
        x.textContent.trim().startsWith('Sipat, nakabenta ako ng sampung Coke'))`,
    'tap-sample',
  )
  const clickedSample = await evaluate(`(() => {
    const b = [...document.querySelectorAll('main button')].find((x) =>
      x.textContent.trim().startsWith('Sipat, nakabenta ako ng sampung Coke'));
    if (!b) return false; b.click(); return true;
  })()`)
  if (!clickedSample) throw new Error('sample utterance button not found')
  await waitFor("document.body.textContent.includes('Draft')", 'the confirmation draft')
  await beatHold(1200)
  await mark('draft-card', cardWithText('Draft'))
  await beatHold(2600)
  await evaluate(`(() => { const c = document.querySelector('main'); if (c) c.scrollTo(0, 260); return true })()`)
  await sleep(900)
  await tap(
    `[...document.querySelectorAll('main button')].find((x) => /confirm/i.test(x.textContent))`,
    'tap-confirm',
  )
  const confirmed = await evaluate(`(() => {
    const b = [...document.querySelectorAll('main button')].find((x) => /confirm/i.test(x.textContent));
    if (!b) return false; b.click(); return true;
  })()`)
  if (!confirmed) throw new Error('confirm button not found')
  await beatHold(2600)
  await endBeat(beat)

  if (SMOKE) {
    await cdp.send('Page.stopScreencast')
    stopping = true
    await sleep(400)
    finish(frames, beats, OUT, frameBytes, firstSize, marks, taps)
    cdp.close()
    proc.kill()
    return
  }

  // ---- step 4: ask in Taglish --------------------------------------------
  await clickNav(3, 'tap-nav-ask', "!!document.querySelector('main input')", 'the ask input')
  beat = await startBeat('ask-capital')
  await waitFor("!!document.querySelector('main input')", 'the ask input')
  await mark('ask-input', cardAround(`document.querySelector('main input')`))
  await beatHold(1500)
  await tap(`document.querySelector('main input')`, 'tap-ask-input')
  await evaluate(`(() => {
    const input = document.querySelector('main input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Nasaan ang puhunan ko?');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`)
  await sleep(1400)
  const asked = `[...document.querySelectorAll('main button')].find((x) => x.textContent.trim() === 'Ask')`
  await tap(asked, 'tap-ask')
  await evaluate(`(() => {
    const b = ${asked};
    if (!b) return false; b.click(); return true;
  })()`)
  if (!(await evaluate(`!!${asked}`))) throw new Error('ask button not found')
  await waitFor("document.body.textContent.includes('capital')", 'the capital answer')
  await sleep(1000)
  await mark('capital-answer', cardWithText('Nasaan ang puhunan ko?'))
  await beatHold(1800)
  await smoothScroll(900, 1800)
  await beatHold(1200)
  await mark('capital-breakdown', cardWithText('Nasaan ang puhunan ko?'))
  await beatHold(700)
  await endBeat(beat)

  // ---- step 5: the score --------------------------------------------------
  await clickNav(
    4,
    'tap-nav-score',
    "document.body.textContent.includes('What makes up the Score')",
    'the score screen',
  )
  beat = await startBeat('sipat-score')
  await beatHold(900)
  // The score card, not `main`: framing the whole scroll container is not a
  // camera move, it is a nudge.
  // Selector is structural, not textual: the score hero's text begins with the
  // number, so matching on the label found nothing on this screen.
  await mark(
    'score-card',
    `[...document.querySelector('main').querySelectorAll('div')]
        .find((d) => String(d.className).includes('rounded-card'))`,
  )
  await beatHold(1500)
  await smoothScroll(600, 1800)
  await beatHold(1200)
  await mark('score-why', centeredCard)
  await beatHold(1400)
  // Room for the second line about this screen, and a moment at wide before the cut.
  await beatHold(2000)
  await endBeat(beat)

  // ---- step 6: what is already on the phone --------------------------------
  await screenChange(
    async () => {
      const gear = `document.querySelectorAll('header button')[1]`
      await tap(gear, 'tap-settings')
      await evaluate(`(() => { const b = ${gear}; if (!b) return false; b.click(); return true })()`)
    },
    { ready: "!!document.querySelector('.rounded-sheet')", label: 'the settings sheet', settleMs: 800 },
  )
  beat = await startBeat('settings')
  await beatHold(900)
  const offlineRow = `[...document.querySelectorAll('.rounded-sheet button')].find((b) => /offline/i.test(b.textContent))`
  await mark('settings-row', offlineRow)
  // Long enough for a sentence about what is already on the phone.
  await beatHold(2100)
  await beatHold(1800)
  /*
   * The row is the door to the offline screen, so the touch belongs on the row and
   * this beat ends while the sheet is still up. The change itself is held back
   * rather than filmed -- that is what stopped a part-painted screen from being cut
   * into the middle of the film.
   */
  await screenChange(
    async () => {
      await tap(offlineRow, 'tap-offline-row')
      await evaluate(`(() => { const b = ${offlineRow}; if (!b) return false; b.click(); return true })()`)
      endBeat(beat)
    },
    { ready: "document.body.textContent.includes('Works Offline')", label: 'the offline screen', settleMs: 900 },
  )

  // ---- step 7: no signal, still works -------------------------------------
  beat = await startBeat('offline')
  await beatHold(1000)
  await mark('offline-card', cardWithText('Works Offline'))
  await beatHold(2900)
  await endBeat(beat)

  await cdp.send('Page.stopScreencast')
  stopping = true
  await sleep(500)

  finish(frames, beats, OUT, frameBytes, firstSize, marks, taps)
  cdp.close()
  proc.kill()
  await sleep(400)
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch {
    /* Edge may still hold the profile */
  }
}

function finish(frames, beats, OUT, frameBytes, firstSize, marks = [], taps = []) {
  if (frames.length < 2) throw new Error(`only ${frames.length} frames captured`)
  const t0 = frames[0].t
  const tEnd = frames[frames.length - 1].t
  const list = []
  const durations = []
  for (let i = 0; i < frames.length; i++) {
    const dur = i + 1 < frames.length ? frames[i + 1].t - frames[i].t : 0.4
    durations.push(dur)
    list.push(`file '${frames[i].name}'`, `duration ${dur.toFixed(4)}`)
  }

  /*
   * How long the loading splash occupies the head of the capture.
   *
   * The DOM can be ready before the compositor has painted, and the screencast's
   * first push is whatever surface it already had -- so the front of the take is a
   * run of byte-identical splash frames. Timing the pre-roll off the first beat
   * missed them by nearly half a second, so it is measured from the frames
   * themselves instead: identical leading frames are the static splash, and they
   * are dropped at build time.
   */
  const first = readFileSync(join(OUT, frames[0].name))
  let preRoll = 0
  let preRollSeconds = 0
  while (
    preRoll + 1 < frames.length &&
    readFileSync(join(OUT, frames[preRoll + 1].name)).equals(first)
  ) {
    preRollSeconds += durations[preRoll]
    preRoll++
  }
  if (preRoll > 0) preRollSeconds += durations[preRoll]
  // The concat demuxer needs the final file repeated to honour the last duration.
  list.push(`file '${frames[frames.length - 1].name}'`)
  writeFileSync(join(OUT, 'frames.txt'), list.join('\n') + '\n')
  writeFileSync(
    join(OUT, 'take.json'),
    JSON.stringify(
      {
        fps_estimate: frames.length / (tEnd - t0),
        duration_estimate: tEnd - t0,
        frames: frames.length,
        bytes: frameBytes,
        firstDeviceSize: firstSize,
        marks: marks.map((m) => ({
          name: m.name,
          videoTime: +(m.t ?? 0).toFixed(2),
          rect: {
            x: +m.rect.x.toFixed(1),
            y: +m.rect.y.toFixed(1),
            w: +m.rect.w.toFixed(1),
            h: +m.rect.h.toFixed(1),
          },
        })),
        taps: taps.map((t) => ({
          name: t.name,
          videoTime: +t.t.toFixed(2),
          point: { x: +t.pt.x.toFixed(1), y: +t.pt.y.toFixed(1) },
        })),
        heldFrames,
        preRollFrames: preRoll,
        preRollSeconds: +preRollSeconds.toFixed(3),
        beats: beats.map((b) => ({
          name: b.name,
          videoStart: +(b.start ?? 0).toFixed(2),
          videoEnd: +(b.end ?? 0).toFixed(2),
          wallStart: +(b.wallStart ?? 0).toFixed(2),
          wallEnd: +(b.wallEnd ?? 0).toFixed(2),
        })),
      },
      null,
      2,
    ) + '\n',
  )
  console.log(`frames: ${frames.length}  ~${(frames.length / (tEnd - t0)).toFixed(1)} fps  ` +
    `duration ~${(tEnd - t0).toFixed(1)}s  (${(frameBytes / 1048576).toFixed(1)} MB)`)
  console.log(`device size reported by screencast: ${firstSize ? `${firstSize.w}x${firstSize.h}` : 'unknown'}`)
  console.log(`loading splash to drop: ${preRoll} frame(s), ${preRollSeconds.toFixed(2)}s`)
  console.log(`screen changes held back: ${heldFrames} frame(s); taps recorded: ${taps.length}`)
  for (const b of beats)
    console.log(
      `  beat ${b.name.padEnd(14)} video ${(b.start ?? 0).toFixed(2)}s .. ${(b.end ?? 0).toFixed(2)}s` +
        `   (wall ${(b.wallStart ?? 0).toFixed(2)}s .. ${(b.wallEnd ?? 0).toFixed(2)}s)`,
    )
  console.log(`wrote ${OUT}/frames.txt and ${OUT}/take.json`)
}

main().catch((err) => {
  console.error(`record failed: ${err.message}`)
  shutdown()
  process.exit(1)
})
