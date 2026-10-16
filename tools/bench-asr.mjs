#!/usr/bin/env node
/**
 * Benchmark the offline recognizer against real, transcribed speech.
 *
 * Why this exists: the app ships `onnx-community/whisper-base` and its own source
 * comments say the model is "weak on Taglish". That claim was never measured, and
 * neither was the other candidate explanation for an owner saying "I talk to the
 * phone and it does not hear me" — a fixed 0.02 RMS gate in `src/audio.ts` that
 * was calibrated on a loud desktop microphone.
 *
 * So this script does three things a claim cannot:
 *
 *   1. Serves a directory of WAV clips over HTTP with CORS, so the page can fetch
 *      audio that is not part of the app's `public/` folder.
 *   2. Drives a real headless Edge over CDP — the same approach as
 *      `tools/capture-note-shots.mjs`, no browser automation dependency — into
 *      `tools/bench/asr-bench.html`, which runs the app's own pipeline options.
 *   3. Scores word error rate in Node against the reference transcripts and writes
 *      the numbers to JSON, so the report can quote measurements rather than
 *      recollections.
 *
 * Expected base URL: a running dev server (`npm run dev`) that serves the project
 * root, because the bench page imports `@huggingface/transformers` and the app's
 * own `src/audio.ts` as modules.
 *
 * Usage:
 *   node tools/bench-asr.mjs --clips <dir|clips.json> [options]
 *
 *   --clips      directory of WAVs plus a clips.json manifest, or the JSON itself
 *   --models     comma-separated Hub repos (default: the app's current model)
 *   --langs      comma-separated: tl,en,auto (default: tl,en,auto)
 *   --variants   comma-separated: raw,quiet,quiet-normalized (default: raw)
 *   --limit      use only the first N clips (default: all)
 *   --base       dev server base URL (default: http://localhost:5173/)
 *   --out        results JSON path (default: tools/bench/results-<timestamp>.json)
 *   --port       CDP port (default: 9345)
 *   --serve-port static audio port (default: 8931)
 */

import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { aggregate } from './bench-score.mjs'

const args = process.argv.slice(2)
function arg(name, fallback) {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}

// Default to the OS temp directory rather than `/tmp`: Node on Windows resolves
// the latter to `C:\tmp`, while a Git Bash shell treats it as `%TEMP%`.
const CLIPS_ARG = arg('clips', join(tmpdir(), 'asr-bench'))
const MODELS = arg('models', 'onnx-community/whisper-base')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean)
const LANGS = arg('langs', 'tl,en,auto')
  .split(',')
  .map((l) => l.trim())
  .filter(Boolean)
const VARIANTS = arg('variants', 'raw')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean)
const LIMIT = Number(arg('limit', '0'))
const BASE = arg('base', 'http://localhost:5173/')
const PORT = Number(arg('port', '9345'))
const SERVE_PORT = Number(arg('serve-port', '8931'))
const OUT = arg('out', `tools/bench/results-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
/*
 * The browser profile is deliberately reused between runs rather than recreated.
 * The model weights live in that profile's Cache Storage, so keeping it turns a
 * retry from a 300MB re-download into a warm start. `--fresh-profile` is the
 * escape hatch when a run has cached something broken.
 */
const PROFILE = arg('profile', join(tmpdir(), 'seepat-bench-profile'))
const FRESH_PROFILE = args.includes('--fresh-profile')

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
 *    measured at eight orphaned `msedge.exe` processes holding the profile and the
 *    DevTools port, after which the next launch hands off to that stale instance
 *    instead of opening a port, and the run dies with "DevTools endpoint never
 *    came up".
 * 2. The renderer, GPU and crashpad children outlive a parent-only kill.
 *
 * So the spawned tree is taken down first, and then any Edge process holding *this
 * run's profile path* is stopped. Matching on the profile is what makes that safe:
 * it is a temp directory unique to these scripts, so the user's own browser can
 * never be in scope.
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

/* ------------------------------------------------------------------ clips -- */

/**
 * Reads the clip manifest. Either a JSON array of `{ id, file, ref }`, or a
 * directory containing `clips.json` plus the WAVs it names.
 *
 * The manifest is separate from the audio on purpose: the FLEURS archive is a
 * 366MB tar.gz that must never be committed, but the four clips chosen out of it
 * and their references are small enough to keep the benchmark re-runnable.
 */
function readClips() {
  const manifestPath = CLIPS_ARG.endsWith('.json') ? CLIPS_ARG : join(CLIPS_ARG, 'clips.json')
  if (!existsSync(manifestPath)) throw new Error(`no clip manifest at ${manifestPath}`)
  // `dirname`, not a `lastIndexOf('/')` slice: the manifest path is built with
  // `join`, so on Windows it is backslash-separated and the slice returned -1 —
  // which silently served the current directory and 404'd every clip.
  const dir = dirname(manifestPath)
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const clips = (Array.isArray(raw) ? raw : raw.clips).map((clip) => ({
    id: clip.id,
    ref: clip.ref,
    path: join(dir, clip.file),
  }))
  return { clips: LIMIT > 0 ? clips.slice(0, LIMIT) : clips, dir }
}

/* ------------------------------------------------------------- audio server -- */

function serveAudio(dir) {
  const types = { '.wav': 'audio/wav', '.json': 'application/json' }
  const server = createServer((req, res) => {
    // Every request is logged. The first version of this script failed with a
    // bare `Failed to fetch` and no way to tell a CORS rejection from a request
    // that never arrived, which cost a whole benchmark run to find out.
    const name = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/+/, '')
    const file = resolve(dir, name)

    const allow = {
      // The page is served from the app's dev-server origin, so this fetch is
      // cross-origin by design: the bench must not need files inside `public/`.
      'access-control-allow-origin': '*',
      'access-control-allow-private-network': 'true',
      'access-control-allow-methods': 'GET,OPTIONS',
      'cache-control': 'no-store',
    }

    if (req.method === 'OPTIONS') {
      console.log(`[audio] OPTIONS /${name} → 204`)
      res.writeHead(204, allow).end()
      return
    }

    // No traversal out of the served directory.
    if (!file.startsWith(resolve(dir)) || !existsSync(file) || !statSync(file).isFile()) {
      console.log(`[audio] ${req.method} /${name} → 404 (looked for ${file})`)
      res.writeHead(404, allow).end('not found')
      return
    }

    const body = readFileSync(file)
    console.log(`[audio] ${req.method} /${name} → 200 (${body.length} bytes)`)
    res.writeHead(200, {
      ...allow,
      'content-type': types[extname(file)] ?? 'application/octet-stream',
      'content-length': body.length,
    })
    res.end(body)
  })
  return new Promise((ok, fail) => {
    server.once('error', fail)
    server.listen(SERVE_PORT, '127.0.0.1', () => ok(server))
  })
}

/* --------------------------------------------------------------------- CDP -- */

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
    // Notifications (no id): hand them to whoever subscribed.
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

/* -------------------------------------------------------------------- main -- */

async function main() {
  const { clips, dir } = readClips()
  const edge = await findEdge()
  const server = await serveAudio(dir)
  const profile = FRESH_PROFILE ? mkdtempSync(join(tmpdir(), 'seepat-bench-')) : PROFILE
  mkdirSync(profile, { recursive: true })
  console.log(`profile: ${profile} (reused between runs; model weights live here)`)

  const browser = spawn(
    edge,
    [
      '--headless=new',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      // No GPU: the app deliberately runs the WASM/q8 path, and measuring the
      // WebGPU path instead would answer a question nobody asked.
      '--disable-gpu',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
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
    await cdp.send('Network.enable')

    /*
     * Capture what the page says and what the network refuses.
     *
     * The first version of this script reported only `TypeError: Failed to
     * fetch`, which names the symptom and neither the URL nor the cause. Page
     * errors and failed requests are now collected so a failure is diagnosable
     * from the run's own output.
     */
    const diagnostics = []
    cdp.on('Runtime.consoleAPICalled', (params) => {
      const text = (params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ')
      // Unfiltered on purpose. The CORS rejection that broke the first run says
      // "blocked by CORS policy" and matched none of the words being filtered on.
      diagnostics.push(`console.${params.type ?? 'log'}: ${text.slice(0, 400)}`)
    })
    cdp.on('Network.loadingFailed', (params) => {
      diagnostics.push(
        `net-fail ${params.type ?? '?'} ${params.errorText ?? ''} blocked=${params.blockedReason ?? '-'} cors=${params.corsErrorStatus?.corsError ?? '-'}`,
      )
    })

    const url = new URL('tools/bench/asr-bench.html', BASE).toString()
    await cdp.send('Page.navigate', { url })

    const evaluate = async (expression, awaitPromise = true) => {
      const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise,
      })
      if (exceptionDetails) throw new Error(exceptionDetails.text ?? 'page exception')
      return result.value
    }

    // The page has to have parsed transformers.js and read audio.ts before it
    // publishes the API; polling for it beats a sleep guess.
    const started = Date.now()
    for (;;) {
      if (await evaluate('!!window.__BENCH', false)) break
      if (Date.now() - started > 60_000) throw new Error(`bench page never became ready at ${url}`)
      await sleep(250)
    }

    const plan = {
      models: MODELS,
      langs: LANGS,
      variants: VARIANTS,
      clips: clips.map((clip) => ({ id: clip.id, ref: clip.ref, url: `http://127.0.0.1:${SERVE_PORT}/${encodeURIComponent(clip.path.split(/[\\/]/).pop())}` })),
    }

    console.log(`running ${plan.clips.length} clips × ${MODELS.length} models × ${LANGS.length} languages × ${VARIANTS.length} variants`)
    let payload
    try {
      payload = await evaluate(`window.__BENCH.run(${JSON.stringify(plan)})`)
    } catch (error) {
      // Page errors and dropped requests are the only way to tell a broken
      // pipeline from a flaky link, so they are reported with the failure.
      console.error('\n--- page/network diagnostics ---')
      for (const line of diagnostics.slice(-40)) console.error(line)
      throw error
    }

    const summary = aggregate(payload.results)
    const report = {
      ranAt: new Date().toISOString(),
      base: BASE,
      plan: { models: MODELS, langs: LANGS, variants: VARIANTS, clips: plan.clips.map((c) => c.id) },
      userAgent: payload.userAgent,
      hardwareConcurrency: payload.hardwareConcurrency,
      modelFiles: payload.files,
      summary,
      results: payload.results,
    }

    mkdirSync(resolve(OUT, '..'), { recursive: true })
    writeFileSync(OUT, JSON.stringify(report, null, 2))
    console.log(`\nwritten: ${OUT}\n`)
    for (const row of summary) {
      const label = `${row.model.split('/').pop()} · lang=${row.lang} · ${row.variant}`.padEnd(52)
      console.log(`${label} WER ${row.corpusWer === null ? 'n/a' : (row.corpusWer * 100).toFixed(1).padStart(5)}%  (${row.clips} clips, ${row.meanMs}ms avg)`)
    }
  } finally {
    try {
      cdp?.close()
    } catch {
      /* already closed */
    }
    killBrowser(browser, profile)
    server.close()
    await sleep(300)
    // Only a throwaway profile is deleted; a reused one holds the model cache
    // that makes a re-run cheap.
    if (FRESH_PROFILE) {
      try {
        rmSync(profile, { recursive: true, force: true })
      } catch {
        /* Windows keeps a handle for a moment; the temp dir is disposable */
      }
    }
  }
}

main().catch((error) => {
  console.error(`bench failed: ${error.message}`)
  process.exit(1)
})
