#!/usr/bin/env node
/**
 * Derive the lockup used on the site's dark surfaces (the closing band), from the
 * brand master.
 *
 * The problem: the master is drawn for a light surface. Its dark ink is a deep
 * blue (#002451-ish) and its owl body is the same ink, so dropped onto a navy
 * band the owl body and the wordmark's "See" both disappear, and the mark reads
 * as "Pat" beside a pair of eyes.
 *
 * WHAT IT DOES — four rules, in order, and nothing else is touched:
 *
 *   1. GOLD  -> untouched. The owl's wing, its beak, the spark and the "Pat" keep
 *      the brand's own gold. Gold on this navy measures 11.1:1, so the colour that
 *      needed no help gets none.
 *
 *   2. THE OWL'S DARK INK -> the brand's blue. It is a drawing of a blue owl, so
 *      on a navy band the body is set in the lightest blue that still reads as
 *      the brand: brand-400 #6b7bff, measured at 5.13:1 on the band.
 *
 *   3. THE WORDMARK'S DARK INK -> the artwork's cream. "See" is a word, and a word
 *      has to be legible before it is anything else; the cream is the highlight
 *      colour the artwork already uses elsewhere, so the mark stays two tones
 *      rather than gaining a third (#f4f5fa on the navy: 16.76:1).
 *
 *   4. LIGHT PIXELS stay untouched — and they are what keeps the owl an owl. The
 *      pupils are NOT a separate tone in the master: they are the same dark blue
 *      as the body, which is why they recolour with it and still read, sitting as
 *      they do inside a white eye. That is also how the master reads on a light
 *      surface, so nothing is lost — but it does mean the eyes are protected by
 *      the eye WHITES, not by the pupils. Anything between gold and ink (a
 *      handful of edge blends) is left alone as well.
 *
 * HOW RULES 2 AND 3 CAN BE TOLD APART. Both are the same dark blue in the master
 * — measured: 80 tones, red pinned at 0, green 31-36, blue 73-82 — so colour
 * cannot separate the owl from the word. Position can, and cleanly: the two are
 * drawn with an empty band between them. The gap is FOUND, not hardcoded, by
 * looking for the widest run of rows in the middle of the artwork that contains
 * no dark ink at all. On the current master it lands around 62% of the height.
 * Re-draw the master with the owl lower and this follows it, which is the whole
 * reason it is measured.
 *
 * Usage:  node tools/make-lockup-on-dark.mjs
 *         (reads marketing/assets/brand/lockup.png, writes lockup-on-dark.png)
 */

import { readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'

const SRC = 'marketing/assets/brand/lockup.png'
const OUT = 'marketing/assets/brand/lockup-on-dark.png'

/** The artwork's own highlight colour — the cream in the owl's eye whites. */
const CREAM = { r: 244, g: 245, b: 250 }

/** The brand's blue, at the lightest step that still reads as the brand on navy. */
const OWL_BLUE = { r: 107, g: 123, b: 255 } // brand-400 #6b7bff

/** Navy is measured as blue-dominance, not as darkness: see the header note. */
const NAVY_BLUE_LEAD = 30
const NAVY_MAX_LIGHTNESS = 150

const image = sharp(SRC).ensureAlpha()
const { data, info } = await image.raw().toBuffer({ resolveWithObject: true })
const { width, height, channels } = info

const pixels = (x, y) => {
  const i = (y * width + x) * channels
  return [data[i], data[i + 1], data[i + 2], data[i + 3]]
}

const isGoldPixel = (r, g, b) => r > 130 && r - b > 60 && g > 70
const isDarkInk = (r, g, b, a) => {
  if (a < 8) return false
  const lightness = (Math.max(r, g, b) + Math.min(r, g, b)) / 2
  return !isGoldPixel(r, g, b) && b - r > NAVY_BLUE_LEAD && lightness < NAVY_MAX_LIGHTNESS
}

/*
 * Find the empty band between the owl and the wordmark: the widest run of rows,
 * searched only in the middle of the artwork, with no dark ink in it.
 */
function findOwlWordmarkGap() {
  const first = Math.floor(height * 0.35)
  const last = Math.floor(height * 0.85)
  let best = { start: 0, length: 0 }
  let runStart = null

  for (let y = first; y <= last; y += 1) {
    let inked = false
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixels(x, y)
      if (isDarkInk(r, g, b, a)) {
        inked = true
        break
      }
    }
    if (inked) {
      if (runStart !== null) {
        const length = y - runStart
        if (length > best.length) best = { start: runStart, length }
        runStart = null
      }
    } else if (runStart === null) {
      runStart = y
    }
  }
  if (runStart !== null) {
    const length = last - runStart
    if (length > best.length) best = { start: runStart, length }
  }
  if (best.length < 2) {
    throw new Error('no empty band found between the owl and the wordmark; re-check the master')
  }
  // The split sits in the middle of the gap, so neither drawing is clipped.
  return best.start + Math.floor(best.length / 2)
}

const splitRow = findOwlWordmarkGap()

const counts = { owlBlue: 0, wordmarkCream: 0, goldKept: 0, light: 0, blends: 0, clear: 0 }

for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const i = (y * width + x) * channels
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const a = data[i + 3]

    if (a < 8) {
      counts.clear += 1
      continue
    }

    if (isGoldPixel(r, g, b)) {
      counts.goldKept += 1
      continue
    }
    if (isDarkInk(r, g, b, a)) {
      // Above the gap is the owl; below it is the word and its tagline. Same ink,
      // two jobs — see the header note.
      const into = y < splitRow ? OWL_BLUE : CREAM
      data[i] = into.r
      data[i + 1] = into.g
      data[i + 2] = into.b
      if (y < splitRow) counts.owlBlue += 1
      else counts.wordmarkCream += 1
      continue
    }

    const lightness = (Math.max(r, g, b) + Math.min(r, g, b)) / 2
    if (lightness > 190) counts.light += 1
    else counts.blends += 1
  }
}

const buffer = await sharp(data, { raw: { width, height, channels } })
  .png({ compressionLevel: 9 })
  .toBuffer()
writeFileSync(OUT, buffer)

const total = width * height
const pct = (n) => `${((n / total) * 100).toFixed(1)}%`
console.log(`wrote ${OUT}  ${width}×${height}  ${(buffer.length / 1024).toFixed(0)} KB`)
console.log(`  owl/wordmark split at row ${splitRow} of ${height} (${((splitRow / height) * 100).toFixed(0)}%)`)
console.log(
  `  owl ink -> brand blue ${pct(counts.owlBlue)} · wordmark ink -> cream ${pct(
    counts.wordmarkCream,
  )} · gold kept ${pct(counts.goldKept)} · eye whites kept ${pct(counts.light)} · edge blends kept ${pct(
    counts.blends,
  )} · transparent ${pct(counts.clear)}`,
)
console.log(`  source ${(readFileSync(SRC).length / 1024).toFixed(0)} KB`)
