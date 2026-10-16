#!/usr/bin/env node
/**
 * Verify offline voice end to end, inside the real app.
 *
 * Why this exists: `tools/bench-asr.mjs` measures the model and the silence gate,
 * but it hands the pipeline float samples directly. Everything between the
 * microphone and those samples — `MediaRecorder` capturing a live stream,
 * `decodeAudioData`, the resample to 16 kHz mono, the software gain, and the
 * engine's decision to transcribe at all — is covered by no unit test, and it is
 * exactly the path an owner means when they say "I talk to the phone and it cannot
 * hear me".
 *
 * So this drives the shipped app in a real browser with Chrome's fake audio device
 * fed a real Tagalog recording, taps the actual microphone button, and waits for
 * words to appear on the Voice screen. Nothing is stubbed except the microphone
 * hardware.
 *
 * The browser profile is deliberately shared with the bench
 * (`%TEMP%/seepat-bench-profile`): the model weights are already in its Cache
 * Storage, so a verification run does not re-download 76MB.
 *
 * Usage:
 *   node tools/verify-offline-voice.mjs [--base http://localhost:5173/] [--clip <wav>] [--expect word,word]
 *
 * Exits 0 only if a transcript containing an expected word was produced. The
 * transcript is printed either way, because "the app produced these words" is the
 * evidence, not the exit code.
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}

const BASE = arg('base', 'http://localhost:5173/')
const CLIP = resolve(arg('clip', join(tmpdir(), 'asr-bench', 'clips', 'fil-1.wav')))
const EXPECT = arg('expect', 'buhay,pamilya,labas,hebreo,nangyari,tao,araw')
  .split(',')
  .map((w) => w.trim().toLowerCase())
  .filter(Boolean)
const PROFILE = arg('profile', join(tmpdir(), 'seepat-bench-profile'))
const PORT = Number(arg('port', '9346'))

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Kill the browser that this run started, and nothing else.
 *
 * Two things are needed, and the obvious one is not enough:
 *
 * 1. Edge re-executes itself on Windows (`--edge-skip-compat-layer-relaunch`
 *    appears in the real browser's command line), so **the PID we spawned is often
 *    not the browser**. Killing that PID leaves the actual browser running —
 *    measured as eight orphaned `msedge.exe` processes holding the shared profile
 *    and the DevTools port, after which the *next* launch silently hands off to the
 *    stale instance instead of opening a port of its own, and the run fails with
 *    "DevTools endpoint never came up".
 * 2. The renderer, GPU and crashpad children outlive a parent-only kill.
 *
 * So the spawned tree is taken down first (which handles the simple case), and then
 * any Edge process holding *this run's profile path* is stopped. Matching on the
 * profile is what makes this safe: it is a temp directory unique to these scripts,
 * so the user's own browser can never be in scope.
 */
function killBrowser(child, profile) {
  if (process.platform !== 'win32') {
    try {
      child?.kill('SIGKILL')
    } catch {
      /* already gone */
    }
    return
  }

  if (child?.pid) {
    try {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } catch {
      /* already gone */
    }
  }

  const safeProfile = profile.replace(/'/g, "''")
  try {
    spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${safeProfile}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
      ],
      { stdio: 'ignore' },
    )
  } catch {
    /* nothing of ours is running */
  }
}

async function findEdge() {
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
  if (tried > 60) throw new Error('DevTools endpoint never came up')
  await sleep(250)
  return cdpTarget(port, tried + 1)
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  const pending = new Map()
  const handlers = new Map()
  let nextId = 1
  const ready = new Promise((ok, fail) => {
    ws.addEventListener('open', () => ok())
    ws.addEventListener('error', (e) => fail(new Error(`WebSocket error: ${e.message ?? 'unknown'}`)))
  })
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data ?? '')})`))
      else resolve(msg.result)
      return
    }
    if (msg.method) for (const handler of handlers.get(msg.method) ?? []) handler(msg.params ?? {})
  })
  return {
    ready,
    on(method, handler) {
      const list = handlers.get(method) ?? []
      list.push(handler)
      handlers.set(method, list)
    },
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
  if (!existsSync(CLIP)) {
    throw new Error(`no clip at ${CLIP} — run tools/bench-prepare.mjs first (see its header)`)
  }
  console.log(`clip:    ${CLIP}`)
  console.log(`expect:  one of ${EXPECT.join(', ')}`)

  const edge = await findEdge()
  mkdirSync(PROFILE, { recursive: true })
  const browser = spawn(
    edge,
    [
      '--headless=new',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      // The microphone, faked: a real recording instead of silence, and no
      // permission bubble standing between the run and the app.
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${CLIP}`,
      '--autoplay-policy=no-user-gesture-required',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${PROFILE}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  let cdp = null
  try {
    cdp = connect(await cdpTarget(PORT))
    await cdp.ready
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Log.enable')

    const diagnostics = []
    cdp.on('Runtime.consoleAPICalled', (params) => {
      const text = (params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ')
      if (/error|fail|warn|voice|model/i.test(text)) diagnostics.push(`console: ${text.slice(0, 240)}`)
    })
    cdp.on('Log.entryAdded', (params) => {
      const text = `${params.entry?.level ?? ''}: ${params.entry?.text ?? ''}`
      if (/voice|model|audio|wasm|onnx/i.test(text)) diagnostics.push(text.slice(0, 240))
    })

    /*
     * Seeded before the app's first byte of JavaScript runs, because both of
     * these are read once at module init: the welcome deck is a first-run gate,
     * and the installed-model record is what makes the offline engine report
     * itself available at all.
     */
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        localStorage.setItem('seepat.welcome.v1', '1');
        localStorage.setItem('seepat.voice.model.v1', JSON.stringify({
          key: 'whisper-base',
          repo: 'onnx-community/whisper-base',
          installedAt: new Date().toISOString(),
          bytes: 76 * 1024 * 1024,
        }));
      `,
    })

    await cdp.send('Page.navigate', { url: BASE })

    const evaluate = async (expression) => {
      const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })
      if (exceptionDetails) {
        // `text` alone is just "Uncaught" — the description carries the actual
        // message, which is the difference between a diagnosable failure and
        // another benchmark run spent guessing.
        const detail =
          exceptionDetails.exception?.description ??
          exceptionDetails.text ??
          'page exception'
        throw new Error(`page exception: ${detail}`)
      }
      return result.value
    }

    const waitFor = async (expression, label, timeoutMs = 30_000) => {
      const started = Date.now()
      for (;;) {
        if (await evaluate(expression)) return true
        if (Date.now() - started > timeoutMs) {
          console.error(`timed out waiting for ${label}`)
          return false
        }
        await sleep(200)
      }
    }

    // Helpers that address the UI the way an owner does: by the words on screen.
    // Trimmed before matching: a nav button's textContent carries the whitespace
    // and newlines of its icon markup, so an anchored pattern never matched it.
    const clickByText = (pattern) =>
      `(() => {
        const buttons = [...document.querySelectorAll('button')];
        const hit = buttons.find((b) => ${pattern}.test((b.textContent || '').trim()));
        if (!hit) return false;
        hit.click();
        return true;
      })()`

    const clickByAria = (pattern) =>
      `(() => {
        const buttons = [...document.querySelectorAll('button')];
        const hit = buttons.find((b) => ${pattern}.test(b.getAttribute('aria-label') || ''));
        if (!hit) return false;
        hit.click();
        return true;
      })()`

    const screenText = `document.body.innerText.replace(/\\s+/g, ' ').trim()`

    if (!(await waitFor('!!document.querySelector("main")', 'the app shell'))) throw new Error('app never rendered')

    // What the shell actually offers, so a selector failure is diagnosable from
    // the run's own output rather than from a screenshot.
    const shellButtons = await evaluate(`(() => {
      return [...document.querySelectorAll('button')]
        .map((b) => ({ text: (b.textContent || '').trim().slice(0, 40), aria: b.getAttribute('aria-label') || '' }))
        .filter((b) => b.text || b.aria);
    })()`)
    console.log(`shell buttons: ${JSON.stringify(shellButtons.slice(0, 20))}`)

    /*
     * The tab bar labels its buttons with `aria-label`, not text — the visible
     * mark is an icon — so the tab is addressed the way a screen reader would
     * address it. Both spellings of the localized label are accepted.
     */
    if (!(await waitFor(clickByAria('/^(Boses|Voice)$/'), 'the Voice tab'))) {
      throw new Error(`could not find the Voice tab. Screen: ${(await evaluate(screenText)).slice(0, 400)}`)
    }

    // The offline engine, by name — the app defaults to browser recognition, and
    // the browser engine cannot work in headless Edge.
    if (!(await waitFor(clickByText('/Offline \\(Whisper Base\\)/'), 'the offline engine chip'))) {
      throw new Error(`offline engine chip not found. Screen: ${(await evaluate(screenText)).slice(0, 400)}`)
    }

    const engineState = await evaluate(`(() => {
      const chips = [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim()).filter(Boolean);
      return chips.slice(0, 10);
    })()`)
    console.log(`chips on screen: ${JSON.stringify(engineState)}`)

    if (!(await waitFor(clickByAria('/listening|makinig/i'), 'the microphone button'))) {
      throw new Error(`microphone button not found. Screen: ${(await evaluate(screenText)).slice(0, 600)}`)
    }
    console.log('mic opened; speaking into the fake device for 7s…')
    await sleep(7000)

    // Stopping the microphone is what closes the take — the fake device loops the
    // clip forever, so the silence-based endpointing would never fire.
    const stopped = await evaluate(clickByAria('/listening|makinig/i'))
    console.log(`mic stop requested: ${stopped}`)

    /*
     * On-device recognition takes seconds, and the shipped note says so. The
     * fingerprint of success is a quoted transcript on the screen: the Voice
     * screen renders it as “…” and every capture-source string in the app is
     * Tagalog, so an opening curly quote is the marker.
     */
    const appeared = await waitFor(
      // A quoted transcript on screen, or one of the engine's own messages. Both
      // outcomes get printed; only one of them is a pass.
      `/(["\u201c]).{8,}(["\u201d])|Walang narinig|No words were heard|did not load|could not start/i.test(document.body.innerText)`,
      'the transcript or an error',
      150_000,
    )

    await sleep(1500)
    const finalText = await evaluate(screenText)
    console.log(`\n=== Voice screen after the take ===\n${finalText.slice(0, 1200)}`)

    const lower = finalText.toLowerCase()
    const hit = EXPECT.find((word) => lower.includes(word))
    const errored = /walang narinig|no words were heard/i.test(finalText)

    console.log(`\nappeared: ${appeared}`)
    console.log(`expected-word hit: ${hit ?? 'none'}`)
    if (hit) {
      console.log('PASS — the app captured the microphone, ran the on-device model, and produced the expected words.')
      return
    }

    console.error('\n--- diagnostics ---')
    for (const line of diagnostics.slice(-30)) console.error(line)
    throw new Error(
      errored
        ? 'the app refused the take ("no words were heard") — the capture path is still refusing audio it should accept'
        : 'no expected word appeared in the transcript',
    )
  } finally {
    try {
      cdp?.close()
    } catch {
      /* already closed */
    }
    killBrowser(browser, PROFILE)
    await sleep(300)
  }
}

main().catch((error) => {
  console.error(`\nverify failed: ${error.message}`)
  process.exit(1)
})
