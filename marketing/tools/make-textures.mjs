#!/usr/bin/env node
/**
 * Regenerates the three SVG textures the site is composed from.
 *
 *   node marketing/tools/make-textures.mjs
 *
 * Both files were originally written by hand and left in the repository with no
 * generator, which is a debt: the wave in particular is 48 sampled points, and
 * "edit the amplitude" became "retype a path". These are the recipes.
 *
 * `--check` compares what would be written against what is on disk and exits 1
 * on any difference, so a hand-edit that never made it back into the recipe
 * cannot go unnoticed.
 *
 * THE WAVE (`wave-mask.svg`)
 *   A one-period cosine, 240 wide and 40 tall, sampled every 5px, used as a
 *   `mask-image` under the navy hero. Seamlessness is the whole requirement: the
 *   tile has to repeat at any viewport width without a visible join, so the
 *   curve starts and ends at the same height (28) with the same slope — which is
 *   exactly what a cosine sampled over one full period gives you. The first and
 *   last samples meet, so the two ends of the tile agree.
 *
 *   y(x) = MID + AMP * cos(PI * x / (W / 2))
 *
 *   It is a mask rather than a shape: white is "keep the navy", and whatever band
 *   sits underneath shows through the troughs.
 *
 * THE GRAIN (`grain.svg`)
 *   `feTurbulence` with `stitchTiles="stitch"`, desaturated, and its alpha scaled
 *   to 0.075 — texture you notice only when it is taken away. Tiled at 220px in
 *   CSS. Written verbatim here because it is a four-line SVG with nothing to
 *   compute, and keeping every texture in one recipe is the point.
 *
 * THE EMPHASIS STROKE (`swipe-mask.svg`)
 *   The rule drawn under the word a sentence turns on. It was a plain rounded
 *   bar, which is the one thing a hand never draws: a straight line of even
 *   weight reads as a border, not as a mark someone made. So it is a SWIPE —
 *   thicker through the middle, tapering to points at both ends, drifting across
 *   a shallow wave, with the whole stroke tilted by a couple of units so it is
 *   not sitting level with the page grid.
 *
 *   It is the hero's wave in miniature: the same curve family, at the scale of a
 *   single word, which is why the two edges on the page agree about what a curve
 *   looks like here.
 *
 *   Thickness is a function of x, so the taper is symmetric and smooth:
 *
 *     centre(x)  = MID - TILT * (x/W - 0.5) - AMP * sin(2*PI*x/W)
 *     half(x)    = (THIN + (THICK - THIN) * sin(PI*x/W)^0.7) / 2
 *
 *   Drawn as one filled band (top edge out, bottom edge back) rather than as a
 *   stroked path, because a stroke's width cannot vary along its length and a
 *   varying width is the entire point. Stretched with `preserveAspectRatio="none"`
 *   in CSS, so a 4-letter word and a 10-letter phrase both get a swipe whose
 *   taper stays at the ends; only the wave gets lazier, which is what a longer
 *   hand movement does anyway.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const W = 240
const H = 40
const AMP = 8
const MID = 20
const STEP = 5

/** One period of a cosine, as an SVG path, sampled left-to-right. */
function wavePath() {
  const y = (x) => MID + AMP * Math.cos((Math.PI * x) / (W / 2))
  const points = []
  for (let x = W; x >= 0; x -= STEP) {
    points.push(`L${x.toFixed(2)},${y(x).toFixed(2)}`)
  }
  // Down the right edge, then the samples back to the left, then close along the
  // top. The inside of the curve is the navy; the outside is the band below.
  return `M0,0 H${W} V${y(W).toFixed(2)} ${points.join(' ')} Z`
}

const wave = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
  <path fill="#fff" d="${wavePath()}"/>
</svg>
`

/* ─── The emphasis stroke ─── */
const SWIPE_W = 200
const SWIPE_H = 44
/**
 * Centreline, amplitude of the wave, tilt, and the two ends of the taper.
 *
 * These are not free numbers: the ink must stay inside the 0..H box at every x,
 * or the swipe gets clipped flat at its widest point. The bound is
 * `MID ± (TILT/2 + AMP) ± THICK/2`, which here is 1.5 .. 42.5 of 44 — so the
 * amplitude can go to about 9 before the curve starts cutting its own ends off.
 * At 7 the wave is unmistakable and still clear of the edge; at 5, which is where
 * this started, it read as a slightly sagging straight line, which is not a thing
 * a hand draws either.
 */
const SWIPE_MID = 22
const SWIPE_AMP = 7
const SWIPE_TILT = 3
const SWIPE_THICK = 22
const SWIPE_THIN = 1.5

function swipePath() {
  const n = (v) => v.toFixed(2)
  const centre = (x) => SWIPE_MID - SWIPE_TILT * (x / SWIPE_W - 0.5) - SWIPE_AMP * Math.sin((2 * Math.PI * x) / SWIPE_W)
  const half = (x) => (SWIPE_THIN + (SWIPE_THICK - SWIPE_THIN) * Math.pow(Math.sin((Math.PI * x) / SWIPE_W), 0.7)) / 2

  const top = []
  const bottom = []
  for (let x = 0; x <= SWIPE_W; x += 4) {
    top.push(`${n(x)},${n(centre(x) - half(x))}`)
    bottom.push(`${n(x)},${n(centre(x) + half(x))}`)
  }
  // Out along the top edge, back along the bottom one, then close: the ends are
  // the two points where the taper reaches zero, so they need no caps.
  return `M${top.join(' L')} L${bottom.reverse().join(' L')} Z`
}

const swipe = `<svg xmlns="http://www.w3.org/2000/svg" width="${SWIPE_W}" height="${SWIPE_H}" viewBox="0 0 ${SWIPE_W} ${SWIPE_H}" preserveAspectRatio="none">
  <path fill="#fff" d="${swipePath()}"/>
</svg>
`

const grain = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220" viewBox="0 0 220 220">
  <!-- Fine grain, tiled. stitched turbulence so the tile has no seam, alpha
       scaled down to a whisper: this is texture, not noise. -->
  <filter id="g" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" stitchTiles="stitch" result="n"/>
    <feColorMatrix type="saturate" values="0"/>
    <feComponentTransfer><feFuncA type="linear" slope="0.075"/></feComponentTransfer>
  </filter>
  <rect width="220" height="220" filter="url(#g)"/>
</svg>
`

const ROOT = new URL('../assets/', import.meta.url)
const files = [
  ['wave-mask.svg', wave],
  ['grain.svg', grain],
  ['swipe-mask.svg', swipe],
]

const check = process.argv.includes('--check')
let drifted = 0

for (const [name, contents] of files) {
  const path = fileURLToPath(new URL(name, ROOT))
  if (check) {
    const onDisk = readFileSync(path, 'utf8')
    if (onDisk !== contents) {
      console.log(`drifted: ${name} — on disk differs from this recipe`)
      drifted += 1
    }
    continue
  }
  writeFileSync(path, contents)
  console.log(`wrote ${name} (${contents.length} bytes)`)
}

if (check) {
  console.log(
    drifted === 0
      ? 'textures match this recipe'
      : `${drifted} texture(s) differ from this recipe — re-run without --check if the change was intended`,
  )
  process.exitCode = drifted === 0 ? 0 : 1
}
