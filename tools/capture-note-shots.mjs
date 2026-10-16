#!/usr/bin/env node
/**
 * Capture the three prototype screenshots used in the PSC XI concept note.
 *
 * Why a DevTools-protocol script instead of a plain `--screenshot` run: the app
 * is a single-page shell with no router, so the Voice, Ask and Offline screens
 * are only reachable by clicking. This drives a real headless Edge over CDP —
 * with Node's built-in WebSocket, so nothing is installed — reproduces the exact
 * state each shot needs (the spoken draft, the capital answer, the offline card)
 * and clips the screenshot to that card, because a full-page grab of a fixed
 * viewport app is 90% chrome.
 *
 * Usage:  node tools/capture-note-shots.mjs [baseUrl] [outDir]
 */

import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.argv[2] ?? 'http://localhost:5173/'
const OUT = process.argv[3] ?? 'docs/note-screenshots'
const PORT = 9333
const PAD = 8

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function findEdge() {
  const { existsSync } = await import('node:fs')
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

async function main() {
  mkdirSync(OUT, { recursive: true })
  const edge = await findEdge()
  const profile = mkdtempSync(join(tmpdir(), 'seepat-shots-'))
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
      '--window-size=430,932',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  const cdp = connect(await cdpTarget(PORT))
  await cdp.ready
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  // Skip the first-run welcome deck: it is designed to be seen once, and the
  // note needs the product, not the tour.
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: "localStorage.setItem('seepat.welcome.v1','1');",
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

  const waitFor = async (expression, label, timeoutMs = 15000) => {
    const started = Date.now()
    for (;;) {
      if (await evaluate(expression)) return
      if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${label}`)
      await sleep(150)
    }
  }

  await cdp.send('Page.navigate', { url: BASE })
  await waitFor("!!document.querySelector('nav')", 'the app shell')
  await sleep(600)

  const setViewport = (height) =>
    cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height,
      deviceScaleFactor: 2,
      mobile: true,
    })

  /**
   * Bring a card into view, size the viewport so it fully fits, and clip the
   * screenshot to it. The card hook is the app's own `rounded-card` class.
   */
  const shoot = async (name, cardMatch) => {
    const match = JSON.stringify(cardMatch)
    const find = `[...document.querySelector('main').querySelectorAll('div.rounded-card')].find((c) => c.textContent.trim().startsWith(${match}))`
    const height = await evaluate(`(() => { const c = ${find}; return c ? Math.round(c.getBoundingClientRect().height) : 0 })()`)
    if (!height) throw new Error(`${name}: card not found for ${cardMatch}`)
    await setViewport(Math.min(2600, Math.max(1000, height + 360)))
    await evaluate(`(() => { const c = ${find}; c.scrollIntoView({ block: 'center' }); return true })()`)
    await sleep(350)
    const box = await evaluate(
      `(() => { const r = ${find}.getBoundingClientRect(); return { top: r.top, height: r.height } })()`,
    )
    if (box.top < 0 || box.top + box.height > 2600) throw new Error(`${name}: card not fully on screen`)
    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      clip: {
        x: 0,
        y: Math.max(0, Math.round(box.top) - PAD),
        width: 390,
        height: Math.round(box.height) + PAD * 2,
        scale: 2,
      },
    })
    const path = join(OUT, `${name}.png`)
    writeFileSync(path, Buffer.from(shot.data, 'base64'))
    console.log(`wrote ${path} (${390}×${Math.round(box.height) + PAD * 2} css px @2x)`)
  }

  const clickTab = async (label) => {
    const ok = await evaluate(
      `(() => { const b = [...document.querySelectorAll('nav button')].find((x) => x.getAttribute('aria-label') === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true })()`,
    )
    if (!ok) throw new Error(`tab ${label} not found`)
    await sleep(500)
  }

  // 1 — Voice: speak a sale, check the draft, confirm.
  await clickTab('Voice')
  await waitFor("document.body.textContent.includes('Type What Was Said')", 'the voice screen')
  const clickedSample = await evaluate(
    `(() => { const b = [...document.querySelectorAll('main button')].find((x) => x.textContent.trim().startsWith('Sipat, nakabenta ako ng sampung Coke')); if (!b) return false; b.click(); return true })()`,
  )
  if (!clickedSample) throw new Error('sample utterance button not found')
  await waitFor("document.body.textContent.includes('Draft — confirm it')", 'the confirmation draft')
  await shoot('voice', 'Draft — confirm it')

  // 2 — Ask: the owner's own words, answered from the ledger.
  await clickTab('Ask')
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
    `(() => { const b = [...document.querySelectorAll('main button')].find((x) => x.textContent.trim() === 'Ask'); if (!b) return false; b.click(); return true })()`,
  )
  if (!asked) throw new Error('ask button not found')
  await waitFor("document.body.textContent.includes('is your total capital right now')", 'the capital answer')
  await shoot('capital', 'Nasaan ang puhunan ko?')

  // 3 — Offline: what still works with no signal.
  await evaluate("(() => { const b = document.querySelector('button[aria-label=\"Settings\"]'); b.click(); return true })()")
  await sleep(400)
  await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /offline/i.test(x.textContent)); b.click(); return true })()`)
  await waitFor("document.body.textContent.includes('Works Offline')", 'the offline screen')
  await shoot('offline', 'Works Offline')

  cdp.close()
  proc.kill()
  await sleep(300)
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch {
    /* Edge may still hold the profile; the OS temp cleaner will take it */
  }
  console.log('done')
}

main().catch((err) => {
  console.error(`capture failed: ${err.message}`)
  process.exitCode = 1
})
