#!/usr/bin/env node
/**
 * Print a bench result JSON as per-clip tables.
 *
 * The corpus WER in `tools/bench-asr.mjs` answers "how good is this model on this
 * set". It cannot answer "does it work in English but not Tagalog", because a
 * single number averages the two languages together — and that distinction is the
 * whole question for an app that must handle both. So this prints one table per
 * (variant), with clips down the side and model × language across, plus the
 * hypothesis text next to the reference so a wrong transcript is visible rather
 * than merely scored.
 *
 * Usage: node tools/bench-report.mjs <results.json> [--text]
 */

import { readFileSync } from 'node:fs'

const file = process.argv[2]
const SHOW_TEXT = process.argv.includes('--text')
if (!file) {
  console.error('usage: node tools/bench-report.mjs <results.json> [--text]')
  process.exit(1)
}

import { wordErrorRate } from './bench-score.mjs'

const report = JSON.parse(readFileSync(file, 'utf8'))
const rows = report.results

const clipIds = [...new Set(rows.map((r) => r.clip))]
const variants = [...new Set(rows.map((r) => r.variant))]
const models = [...new Set(rows.map((r) => r.model))]
const langs = [...new Set(rows.map((r) => r.lang))]

const wer = (row) => wordErrorRate(row.ref, row.text).wer

console.log(`source: ${file}`)
console.log(`ran: ${report.ranAt} · ${report.userAgent?.slice(0, 60) ?? ''}`)
console.log(`files loaded: ${JSON.stringify(report.modelFiles)}\n`)

for (const variant of variants) {
  console.log(`--- variant: ${variant} ---`)
  const header = ['clip'.padEnd(9), ...models.flatMap((m) => langs.map((l) => `${m.split('/').pop()}/${l}`.padEnd(16)))].join('')
  console.log(header)
  for (const clip of clipIds) {
    const cells = models.flatMap((model) =>
      langs.map((lang) => {
        const row = rows.find((r) => r.clip === clip && r.model === model && r.lang === lang && r.variant === variant)
        if (!row) return ' '.repeat(16)
        if (row.error) return `ERR`.padEnd(16)
        return `${(wer(row) * 100).toFixed(1)}%`.padEnd(16)
      }),
    )
    console.log([clip.padEnd(9), ...cells].join(''))
  }

  // Latency and the app's own gate, per clip, for the first model: if a clip's
  // gate value is ~0, `src/asr-offline.ts` refuses to send it to the model at all.
  const gate = clipIds.map((clip) => {
    const row = rows.find((r) => r.clip === clip && r.variant === variant)
    return `${clip}=${row?.gateMs}ms rms=${row?.rms?.toFixed(4)} ${row?.ms}ms`
  })
  console.log(`gate/infer: ${gate.join(' | ')}\n`)
}

if (SHOW_TEXT) {
  for (const row of rows) {
    console.log(`[${row.clip} · ${row.variant} · ${row.model.split('/').pop()} · ${row.lang}]`)
    console.log(`  ref: ${row.ref}`)
    console.log(`  got: ${row.error ?? row.text}`)
  }
}
