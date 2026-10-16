#!/usr/bin/env node
/**
 * The owl mark, on transparency, for the marketing site's header.
 *
 *   node tools/make-brand-mark.mjs        # from the repository root
 *   reads  new_logo.png                   # the one hand-made brand file
 *   writes marketing/assets/brand/mark.png
 *
 * WHY THE SITE NEEDS ITS OWN CROP. The header used to carry `lockup.png` — the
 * owl, the wordmark and the tagline — squeezed into a 40px box, with "SeePat" and
 * "Ang Financial Copilot ng Negosyo" set as live text beside it. At that size the
 * lockup's own lettering was an illegible smudge of itself, and the header said
 * the name twice: once as a picture of the words, once as words. The owl alone is
 * what belongs there — it is the mark a reader recognises, the name is text, and
 * text that is text can be selected, translated, read aloud and indexed.
 *
 * Same master, same crop as the app's square icons (`tools/make-assets.mjs`), both
 * cut by `tools/brand-master.mjs`: the site's mark cannot drift from the favicon,
 * and re-running either tool after a brand change keeps the two identical.
 *
 * SIZE. The header draws it at 2.5rem; this is generated at 256px wide, which is
 * a 6x screen for that box — headroom for a taller header without paying for the
 * master's 1026px. Quantised to a palette the way the app's own logo is: the
 * artwork is navy, gold and white with soft edges, so it is indistinguishable at
 * the size it is displayed at and a fraction of the bytes. That matters here:
 * this file is on the critical path of the first paint, fetched by every visitor
 * on the page's cold load, on phones that are paying for the data.
 */

import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

import { brandMaster, PNG } from './brand-master.mjs'

const OUT = join(process.cwd(), 'marketing', 'assets', 'brand', 'mark.png')

/** Drawn at 2.5rem; 256px is a 6x screen for that box, and more than enough. */
const WIDTH = 256

const { markBuf, markWidth, markHeight, markAspect } = await brandMaster()

const sharp = (await import('sharp')).default
const mark = await sharp(markBuf)
  .resize({ width: WIDTH, withoutEnlargement: true })
  .png({ ...PNG, palette: true, quality: 92, dither: 0.5 })
  .toBuffer()

const output = await sharp(mark).metadata()

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, mark)

console.log(`wrote ${relative(process.cwd(), OUT)}`)
console.log(
  `  ${output.width}x${output.height}  ${(statSync(OUT).size / 1024).toFixed(1)} kB ` +
    `(from the master's ${markWidth}x${markHeight} crop, aspect ${markAspect.toFixed(2)})`,
)
console.log(`  <img src="/assets/brand/mark.png" width="${output.width}" height="${output.height}" alt="" />`)
