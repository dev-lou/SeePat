/**
 * Brand asset generation.
 *
 *   node tools/make-assets.mjs
 *
 * Everything the platform needs as a *raster* is derived here from two sources
 * of truth that live in the repo: the official wordmark lockup
 * (`seepat_logo.png`) and the mark (`public/icon.svg`). Nothing is hand-exported,
 * so an icon can never drift from the logo, and re-running this after a brand
 * change regenerates the whole set.
 *
 * Why the icons exist at all — this is the part that broke install:
 *
 *   Chrome will not offer "Install app" unless the manifest declares a PNG icon
 *   of at least 144px. An SVG entry is fine for the favicon and is ignored by the
 *   installability check, so a manifest whose only icon is an SVG looks correct
 *   in devtools and silently never installs. Hence: 192 and 512 PNG, plus a
 *   separate *maskable* 512, because Android masks the icon to a shape — a
 *   rounded-tile icon declared as maskable gets its corners shaved, and the
 *   artwork ends up clipped. The maskable variant therefore carries its own
 *   safe-zone padding (the art is scaled to 62% of the square).
 *
 * The wordmark is 3.78:1. It is the right asset for the splash screen and the
 * social card, and the wrong asset for a square icon, where it would render as a
 * sliver at 48px. That is why the brand has both, and why this script emits both.
 *
 * Requires the `sharp` devDependency (it is not shipped to the client).
 */

import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

let sharp
try {
  sharp = (await import('sharp')).default
} catch {
  console.error('sharp is not installed. Run: npm install --save-dev sharp')
  process.exitCode = 1
  throw new Error('missing sharp')
}

const ROOT = process.cwd()
const PUBLIC = join(ROOT, 'public')
mkdirSync(PUBLIC, { recursive: true })

const BRAND_NAVY = '#0c2760'
const CANVAS = '#f5f7fb'

const report = []
function write(name, buffer) {
  const path = join(PUBLIC, name)
  writeFileSync(path, buffer)
  report.push({ name, kb: (statSync(path).size / 1024).toFixed(1) })
}

/* ---------------------------------------------------------------- wordmark -- */

// Trim the transparent margin first: the lockup ships with a lot of air, and
// every pixel of it would otherwise be charged to the offline precache and to
// the header layout.
const wordmark = await sharp(join(ROOT, 'seepat_logo.png'))
  .trim({ threshold: 1 })
  .resize({ width: 660, withoutEnlargement: true })
  // Quantised to a palette. The lockup is navy, gold and white with soft edges,
  // so 256 colours with dithering is indistinguishable at the 150-220px it is
  // ever displayed at — and it halves the file. That matters more than usual
  // here: this image is in the offline precache, so its bytes are paid once per
  // install on a prepaid plan.
  .png({ compressionLevel: 9, effort: 10, palette: true, quality: 92, dither: 0.5 })
  .toBuffer()

write('seepat-wordmark.png', wordmark)

/* ------------------------------------------------------------------- icons -- */

const markSvg = readFileSync(join(PUBLIC, 'icon.svg'), 'utf8')

// The rounded navy tile, as declared by the source SVG — correct for `any`,
// where the platform shows the artwork as-is.
const tile = (size) =>
  sharp(Buffer.from(markSvg))
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer()

write('pwa-192.png', await tile(192))
write('pwa-512.png', await tile(512))

/**
 * The maskable variant: a full-bleed navy square with the artwork centred inside
 * the safe zone. Built by lifting the mark's gradients, rays and eye out of the
 * source SVG and re-composing them on a square background, so the icon that
 * Android crops to a circle or a squircle still shows the whole sun.
 */
const defs = markSvg.match(/<defs>[\s\S]*?<\/defs>/)?.[0]
const rays = markSvg.match(/<g fill="url\(#sun\)">[\s\S]*?<\/g>/)?.[0]
const eye = markSvg.split('<!-- The eye. -->')[1]?.replace('</svg>', '')
if (!defs || !rays || !eye) throw new Error('icon.svg structure changed — update this script')

const maskableSvg = (scale, background) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  ${defs.replace('id="tile"', 'id="tile"').replace('#1b45a6', '#1b45a6')}
  <defs>
    <radialGradient id="glow" cx="0.32" cy="0.24" r="0.9">
      <stop offset="0%" stop-color="#1b45a6" />
      <stop offset="60%" stop-color="${background}" />
      <stop offset="100%" stop-color="#050f28" />
    </radialGradient>
  </defs>
  <rect width="512" height="512" fill="url(#glow)" />
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${rays}${eye}</g>
</svg>`

write(
  'pwa-maskable-512.png',
  await sharp(Buffer.from(maskableSvg(0.62, BRAND_NAVY)))
    .resize(512, 512)
    .png({ compressionLevel: 9 })
    .toBuffer(),
)

// iOS ignores the manifest icons and wants an opaque 180px square; it applies
// its own mask, so the art is slightly larger here and there is no transparency
// (iOS fills transparent pixels with black, which is not a look).
write(
  'apple-touch-icon.png',
  await sharp(Buffer.from(maskableSvg(0.72, BRAND_NAVY)))
    .resize(180, 180)
    .flatten({ background: BRAND_NAVY })
    .png({ compressionLevel: 9 })
    .toBuffer(),
)

/* --------------------------------------------------------------- social card - */

/**
 * 1200×630, the ratio every platform crops predictably. Deliberately no
 * typesetting: text in a generated raster would need the display font available
 * to the rasteriser, and a fallback face on the brand card is worse than no
 * words at all — `og:title` and `og:description` carry the sentence. What is
 * here instead is the lockup, the app's canvas and its two light sources, so the
 * card is unmistakably this product.
 */
const wordmarkData = `data:image/png;base64,${wordmark.toString('base64')}`
const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630">
  <defs>
    <linearGradient id="rule" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#12357f" />
      <stop offset="100%" stop-color="#dda60c" />
    </linearGradient>
    <radialGradient id="gold" cx="0.86" cy="0.04" r="0.7">
      <stop offset="0%" stop-color="#f5c21d" stop-opacity="0.34" />
      <stop offset="100%" stop-color="#f5c21d" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="navy" cx="0.06" cy="0.02" r="0.75">
      <stop offset="0%" stop-color="#1b45a6" stop-opacity="0.26" />
      <stop offset="100%" stop-color="#1b45a6" stop-opacity="0" />
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="${CANVAS}" />
  <rect width="1200" height="630" fill="url(#navy)" />
  <rect width="1200" height="630" fill="url(#gold)" />
  <image xlink:href="${wordmarkData}" x="235" y="238" width="730" height="180" preserveAspectRatio="xMidYMid meet" />
  <rect x="470" y="452" width="260" height="5" rx="2.5" fill="url(#rule)" />
</svg>`

write(
  'og-image.png',
  await sharp(Buffer.from(ogSvg))
    .resize(1200, 630)
    // Quantised too, and it is excluded from the precache below: a social card
    // is fetched by crawlers, never by the app, so it must not cost an install
    // anything. 1200x630 is the ratio every platform crops predictably.
    .png({ compressionLevel: 9, effort: 10, palette: true, quality: 90, dither: 0.6 })
    .toBuffer(),
)

/* ------------------------------------------------------------------ report -- */

console.log('generated:')
for (const { name, kb } of report) console.log(`  ${name.padEnd(24)} ${kb.padStart(6)} kB`)
const total = report.reduce((sum, r) => sum + Number(r.kb), 0)
console.log(`  ${'total'.padEnd(24)} ${total.toFixed(1).padStart(6)} kB`)
