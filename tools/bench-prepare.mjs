#!/usr/bin/env node
/**
 * Assemble the ASR benchmark clips from the FLEURS `fil_ph` development set.
 *
 * The bench itself (`tools/bench-asr.mjs`) needs a directory of WAVs plus a
 * `clips.json` of references. This script produces both, so the numbers in
 * `OFFLINE_ASR_RESEARCH.md` can be reproduced instead of trusted.
 *
 * The archive is 366MB and extracts to ~436MB, so it never goes in the repo: a
 * handful of ~5s clips and their transcripts are all that has to survive to make
 * the measurement repeatable.
 *
 * Step 1 — fetch (into a temp directory, not the repo):
 *
 *   curl -sSfL -o "$TMP/fil_dev.tsv" \
 *     https://huggingface.co/datasets/google/fleurs/resolve/main/data/fil_ph/dev.tsv
 *   curl -sSfL -o "$TMP/fil_dev_audio.tar.gz" \
 *     https://huggingface.co/datasets/google/fleurs/resolve/main/data/fil_ph/audio/dev.tar.gz
 *   curl -sSfL -o "$TMP/jfk.wav" \
 *     https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/samples/jfk.wav
 *   mkdir -p "$TMP/wav" && tar -xzf "$TMP/fil_dev_audio.tar.gz" -C "$TMP/wav"
 *
 * Step 2 — pick clips:
 *
 *   node tools/bench-prepare.mjs "$TMP"
 *
 * FLEURS is CC BY 4.0 (Google). The English control is the JFK sample from
 * whisper.cpp; convenient because its transcript is published, but its own reuse
 * terms are not stated by that repository, so it is a smoke test rather than a
 * redistributable asset.
 *
 * NOTE on the `curl` archives: a dropped connection truncates them silently
 * (observed once, at 251MB of 366MB), and a truncated tar.gz extracts a partial
 * set. Re-run with `curl -C -` to resume, and check the member count is 419
 * before trusting an extraction.
 */

import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(process.argv[2] ?? process.cwd())
const OUT = join(ROOT, 'clips')

/** Duration in seconds, from the WAV header — the manifest does not carry it. */
function wavSeconds(path) {
  const buf = readFileSync(path)
  const channels = buf.readUInt16LE(22)
  const sampleRate = buf.readUInt32LE(24)
  const bits = buf.readUInt16LE(34)
  // Walk the chunk list rather than assuming a canonical 44-byte header.
  let offset = 12
  let dataBytes = Math.max(0, buf.length - 44)
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    if (id === 'data') {
      dataBytes = size
      break
    }
    offset += 8 + size + (size % 2)
  }
  return dataBytes / (sampleRate * channels * (bits / 8))
}

const tsv = readFileSync(join(ROOT, 'fil_dev.tsv'), 'utf8').trim().split('\n')
const refs = new Map()
for (const line of tsv) {
  const parts = line.split('\t')
  // Column 2 is the file name; column 4 is the lowercased, punctuation-free
  // transcript — the reference that matches how WER normalizes Whisper's output.
  refs.set(parts[1], parts[3])
}

const wavDir = join(ROOT, 'wav', 'dev')
const files = readdirSync(wavDir).filter((f) => f.endsWith('.wav'))
const all = files.map((file) => {
  const path = join(wavDir, file)
  return { file, path, ref: refs.get(file) ?? '', seconds: wavSeconds(path) }
})

/*
 * Sentence-length recordings. The FLEURS development set is mostly 15-20s
 * readings (median 16.0s measured), which is far longer than anything this
 * product records — a sari-sari sale is one sentence — and long enough that a
 * single slow clip would dominate the run. The window is therefore about the
 * utterance the app actually handles.
 */
const candidates = all.filter((c) => c.ref && c.seconds >= 2.0 && c.seconds <= 9.0)

/*
 * One clip per reference. The development set repeats some sentences, and
 * scoring the same sentence twice would let one easy sentence dominate the corpus
 * average.
 */
const seen = new Set()
const chosen = []
for (const candidate of candidates.sort((a, b) => a.seconds - b.seconds)) {
  const key = candidate.ref.trim()
  const words = key.split(/\s+/).length
  if (seen.has(key)) continue
  if (words < 4 || words > 14) continue
  seen.add(key)
  chosen.push(candidate)
  if (chosen.length === 4) break
}

mkdirSync(OUT, { recursive: true })
const clips = []
chosen.forEach((clip, index) => {
  const id = `fil-${index + 1}`
  copyFileSync(clip.path, join(OUT, `${id}.wav`))
  clips.push({ id, file: `${id}.wav`, ref: clip.ref, seconds: Number(clip.seconds.toFixed(2)) })
})

// English control: real human speech, 16 kHz mono, with a published transcript.
const jfk = join(ROOT, 'jfk.wav')
copyFileSync(jfk, join(OUT, 'en-jfk.wav'))
clips.push({
  id: 'en-jfk',
  file: 'en-jfk.wav',
  ref: 'and so my fellow americans ask not what your country can do for you ask what you can do for your country',
  seconds: Number(wavSeconds(jfk).toFixed(2)),
})

writeFileSync(join(OUT, 'clips.json'), JSON.stringify({ clips }, null, 2))
console.log(`candidates in window: ${candidates.length} of ${files.length}`)
for (const clip of clips) console.log(`${clip.id}\t${clip.seconds}s\t${clip.ref}`)
