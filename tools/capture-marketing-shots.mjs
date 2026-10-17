#!/usr/bin/env node
/**
 * Capture the phone screenshots the marketing page shows.
 *
 * These are the real app, at the real 390×844 phone viewport, at 2× — not
 * mockups and not the video frames (those are 380px wide, which is soft the
 * moment a hero renders them on a retina screen). The app seeds itself with a
 * deterministic 21-day ledger on first run, so the figures in these shots are
 * reproducible: the same command against a fresh profile produces the same
 * numbers, in both languages.
 *
 * Run it once per language — the two pages are separate documents and a Filipino
 * landing page illustrated with English screens is a promise the page does not
 * keep. The language is set through the app's own storage key before the first
 * paint, so what is captured is genuinely the app in that language, not a
 * translation pasted over an English screen.
 *
 * Driven over the DevTools protocol with Node's built-in WebSocket, the same way
 * tools/capture-note-shots.mjs does it, so nothing has to be installed. The
 * difference is what is captured: that tool clips a single card for a concept
 * note; this one takes the whole viewport, because a marketing hero wants the
 * screen as the owner sees it — header, dock and all.
 *
 * Every step asserts the screen it expects before it shoots, using that
 * language's own copy. A stale label therefore fails the run loudly instead of
 * quietly writing a screenshot of the wrong screen.
 *
 * Usage:  node tools/capture-marketing-shots.mjs [baseUrl] [outDir] [en|fil]
 *         (the dev server must already be running: npm run dev)
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'

const BASE = process.argv[2] ?? 'http://localhost:5173/'
const OUT = process.argv[3] ?? 'marketing/assets/shots'
const LANG = process.argv[4] ?? 'en'
const PORT = 9334
const WIDTH = 390
const HEIGHT = 844
const SCALE = 2

if (LANG !== 'en' && LANG !== 'fil') throw new Error(`unknown language: ${LANG}`)

/**
 * The copy each step waits for, per language. Keys mirror the i18n keys they
 * come from so a copy change is a one-line fix in one place:
 * tab.twin, tab.ledger, tab.voice, tab.ask, tab.score, dash.cash, ask.ask,
 * the capital answer in engine/narrator.ts, voice.typeTitle,
 * voice.draftSheetTitle, score.dimensions, and the Sale hint on the ledger
 * write side (Cash / GCash).
 */
const MARKERS = {
  en: {
    tabMoney: 'Money',
    tabLedger: 'Tala',
    tabVoice: 'Voice',
    tabAsk: 'Ask',
    more: 'Quick actions',
    tabScore: 'Score',
    money: 'Cash in the box',
    askButton: 'Ask',
    askAnswer: 'is your total capital right now',
    voice: 'Type What You Said',
    draft: 'Confirm the record',
    score: 'What makes up the Score',
    ledger: 'Cash / GCash',
  },
  fil: {
    tabMoney: 'Pera',
    tabLedger: 'Tala',
    tabVoice: 'Boses',
    tabAsk: 'Tanong',
    more: 'Mabilisang kilos',
    tabScore: 'Score',
    money: 'Cash sa kahon',
    askButton: 'Tanong',
    askAnswer: 'ang kabuuang puhunan mo ngayon',
    voice: 'I-type ang Sinabi Mo',
    draft: 'Kumpirmahin ang tala',
    score: 'Ano ang Bumubuo sa Score',
    ledger: 'Cash / GCash',
  },
}[LANG]

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function findEdge() {
  const found = EDGE_CANDIDATES.find((p) => existsSync(p))
  if (!found) throw new Error('Microsoft Edge not found in the usual locations')
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
  if (tried > 40) throw new Error('DevTools endpoint never came up')
  await sleep(250)
  return cdpTarget(port, tried + 1)
}

/** A tiny CDP client over the built-in WebSocket. */
function connect(wsUrl) {
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
      if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data ?? '')})`))
      else resolve(msg.result)
    }
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

/*
 * A browser left running is worse than a capture that fails: it holds the
 * debugging port, so the next run talks to a dead session, and this process
 * never exits because a live child keeps Node's event loop open. Both failures
 * look like "the tool hangs", which is why cleanup is a module-level function
 * that the catch below always calls rather than a tidy sequence at the end.
 */
let cleanup = () => {}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const edge = findEdge()
  const profile = mkdtempSync(join(tmpdir(), 'seepat-marketing-'))
  const proc = spawn(
    edge,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      `--window-size=${WIDTH},${HEIGHT}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  const cdp = connect(await cdpTarget(PORT))
  cleanup = () => {
    try {
      cdp.close()
    } catch {
      /* already gone */
    }
    proc.kill()
  }
  await cdp.ready
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: SCALE,
    mobile: true,
  })
  // Light appearance, because the app follows the OS: a screenshot taken on a
  // dark-mode machine would not match a light page.
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'light' }],
  })
  // Before the first paint: skip the first-run welcome deck (the page shows the
  // product, not the tour that appears in front of it once) and set the
  // language through the app's own storage key.
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `localStorage.setItem('seepat.welcome.v1','1');localStorage.setItem('seepat.lang.v1','${LANG}');`,
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
      if (await evaluate(expression)) return
      if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${label}`)
      await sleep(150)
    }
  }

  const hasText = (text) => `document.body.textContent.includes(${JSON.stringify(text)})`

  await cdp.send('Page.navigate', { url: BASE })
  await waitFor("!!document.querySelector('nav')", 'the app shell')
  // The boot splash holds for 2s by design; capturing through it would put the
  // splash in every screenshot.
  await waitFor("!document.querySelector('#boot')", 'the splash to clear')
  await sleep(700)

  const clickTab = async (label) => {
    const ok = await evaluate(
      `(() => { const b = [...document.querySelectorAll('nav button')].find((x) => x.getAttribute('aria-label') === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true })()`,
    )
    if (!ok) throw new Error(`tab ${label} not found (is the language right?)`)
    await sleep(650)
  }

  const shot = async (name) => {
    console.log(`  capturing ${name}…`)
    await evaluate('window.scrollTo(0, 0); true')
    await sleep(320)
    const png = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      optimizeForSpeed: false,
    })
    const buffer = Buffer.from(png.data, 'base64')
    const webp = await sharp(buffer).webp({ quality: 82, effort: 5 }).toBuffer()
    const path = join(OUT, `${LANG}-${name}.webp`)
    writeFileSync(path, webp)
    const meta = await sharp(webp).metadata()
    console.log(
      `wrote ${path}  ${meta.width}×${meta.height}  ${(webp.length / 1024).toFixed(0)} KB  (was ${(buffer.length / 1024).toFixed(0)} KB png)`,
    )
  }

  console.log(`capturing in ${LANG}…`)

  // 1 — Money: the Twin, with the seeded 21-day ledger behind it.
  console.log('Money…')
  await clickTab(MARKERS.tabMoney)
  await waitFor(hasText(MARKERS.money), 'the money screen')
  await shot('money')

  // 2 — Ask: the owner's own question, answered from her own records. Ask
  // lives in the floating speed-dial now: open it, then take its row.
  console.log('Ask…')
  await clickTab(MARKERS.more)
  await evaluate(
    `(() => { const b = [...document.querySelectorAll('[role="menuitem"]')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(MARKERS.tabAsk)})); if (!b) return false; b.click(); return true })()`,
  )
  await sleep(650)
  await waitFor("!!document.querySelector('main input')", 'the ask input')
  await evaluate(`(() => {
    const input = document.querySelector('main input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Nasaan ang puhunan ko?');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`)
  await sleep(250)
  const asked = await evaluate(
    `(() => { const b = [...document.querySelectorAll('main button')].find((x) => x.textContent.trim() === ${JSON.stringify(MARKERS.askButton)}); if (!b) return false; b.click(); return true })()`,
  )
  if (!asked) throw new Error('the Ask button was not found')
  await waitFor(hasText(MARKERS.askAnswer), 'the capital answer')
  await shot('ask')

  // 3 — Voice, twice: the surface the owner speaks into, and the sheet that
  //     asks her to confirm the numbers. Both are real states of the same
  //     screen, and between them they are the product's whole voice claim:
  //     it listens, it drafts, and nothing is saved until a human agrees.
  console.log('Voice…')
  await clickTab(MARKERS.tabVoice)
  await waitFor(hasText(MARKERS.voice), 'the voice screen')
  await shot('voice')
  // `includes`, not `startsWith`: each sample is rendered with a decorative
  // opening quote inside the button, so the label does not begin the text node.
  const clickedSample = await evaluate(
    `(() => { const b = [...document.querySelectorAll('main button')].find((x) => x.textContent.includes('Sipat, nakabenta ako ng sampung Coke')); if (!b) return false; b.click(); return true })()`,
  )
  if (!clickedSample) throw new Error('the sample utterance button was not found')
  await waitFor(hasText(MARKERS.draft), 'the confirmation sheet')
  await shot('voice-draft')

  // 4 — Score: the part of the app that says what to do next.
  console.log('Score…')
  await clickTab(MARKERS.tabScore)
  await waitFor(hasText(MARKERS.score), 'the score screen')
  await shot('score')

  // 5 — Ledger: recording without typing a line item first, and the channels
  //     money actually arrives through. This is the screen the whole product
  //     hangs off, so it gets a shot of its own.
  console.log('Ledger…')
  await clickTab(MARKERS.tabLedger)
  await waitFor(hasText(MARKERS.ledger), 'the ledger screen')
  await shot('ledger')

  cleanup()
  await sleep(300)
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch {
    /* Edge may still hold the profile; the OS temp cleaner will take it */
  }
  console.log('done')
}

// The watchdog exists so a stalled step fails loudly instead of hanging a
// terminal until someone notices: nothing here should take two minutes.
const watchdog = setTimeout(() => {
  console.error('capture failed: nothing progressed for 150s — killing the browser')
  cleanup()
  process.exit(3)
}, 150_000)
watchdog.unref()

main()
  .then(() => {
    clearTimeout(watchdog)
  })
  .catch((err) => {
    clearTimeout(watchdog)
    console.error(`capture failed: ${err.message}`)
    cleanup()
    process.exitCode = 1
  })
