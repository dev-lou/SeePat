#!/usr/bin/env node
/**
 * Generate the promo narration with Kokoro-82M, locally and for free.
 *
 * Why not the Windows voice this replaces: Microsoft Zira is the old SAPI voice
 * and sounds like it. Kokoro is a small neural TTS that runs on CPU, needs no
 * account and no network key, and is Apache-2.0, so its output can be used in a
 * submitted pitch. The model weights download once, then the whole thing works
 * offline.
 *
 * Like the SAPI script, the pace is fitted per line by measurement rather than by
 * arithmetic: synthesize, measure, and speed up only as much as the shot window
 * requires, so the delivery stays as natural as the timing allows. Kokoro's speed
 * parameter is a cleaner control than SAPI's rate steps were.
 *
 * Usage:  node tools/make-narration-kokoro.mjs [outDir]
 *         KOKORO_VOICE=af_bella node tools/make-narration-kokoro.mjs
 *
 * Voices worth trying: af_heart (default), af_bella, af_nicole, am_michael,
 * bm_george (British male). Listed by Kokoro in order of quality.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUT = process.argv[2] ?? 'docs/video/voice'
const VOICE = process.env.KOKORO_VOICE ?? 'af_heart'
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX'
const MAX_SPEED = 1.3
const MIN_SPEED = 0.9

const spec = JSON.parse(readFileSync('docs/video/narration.json', 'utf8'))
mkdirSync(OUT, { recursive: true })

console.log(`loading ${MODEL} (dtype q8, cpu) ...`)
const { KokoroTTS } = await import('kokoro-js')
const tts = await KokoroTTS.from_pretrained(MODEL, { dtype: 'q8', device: 'cpu' })
console.log(`ready; voice ${VOICE}`)

let apiLogged = false

/** Write RawAudio to a wav file, tolerating the couple of shapes it may take. */
function writeWav(audio, path) {
  if (!apiLogged) {
    const proto = Object.getPrototypeOf(audio)
    console.log(`  raw audio api: ${Object.getOwnPropertyNames(proto).join(', ')}`)
    console.log(`  sampling rate: ${audio.sampling_rate}`)
    apiLogged = true
  }
  if (typeof audio.toWav === 'function') {
    writeFileSync(path, Buffer.from(audio.toWav()))
    return
  }
  if (typeof audio.save === 'function') {
    audio.save(path)
    return
  }
  throw new Error('no toWav() or save() on the audio object')
}

for (const line of spec.lines) {
  const target = Math.max(0.6, line.max - 0.15)
  let speed = 1.0
  let chosen = null

  for (let attempt = 0; attempt < 4; attempt++) {
    const audio = await tts.generate(line.text, { voice: VOICE, speed })
    const seconds = audio.audio.length / audio.sampling_rate
    if (seconds <= target || attempt === 3 || speed >= MAX_SPEED) {
      chosen = { audio, seconds, speed }
      break
    }
    // Scale the speed by exactly how much too long it was, then retry.
    speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed * (seconds / target)))
  }

  const path = join(OUT, `line-${String(line.id).padStart(2, '0')}.wav`)
  writeWav(chosen.audio, path)
  const fits = chosen.seconds <= line.max ? 'fits' : 'OVER'
  console.log(
    `line-${String(line.id).padStart(2, '0')}  speed ${chosen.speed.toFixed(2)}  ` +
      `${chosen.seconds.toFixed(2)}s of ${line.max}s  ${fits}`,
  )
}

console.log(`done -> ${OUT}`)
