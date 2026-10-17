/**
 * Brand asset generation.
 *
 *   node tools/make-assets.mjs
 *
 * One master, one command. `new_logo.png` at the repo root is the official
 * artwork — the owl, the SeePat lockup and the tagline, stacked on
 * transparency — and every raster the platform needs is derived from it here.
 * Nothing is hand-exported, so an icon can never drift from the logo, and
 * re-running this after a brand change regenerates the whole set.
 *
 * The master's two crops — the owl MARK, which everything square is built from,
 * and the whole LOCKUP — are cut in `tools/brand-master.mjs`, which this file
 * shares with the tools that derive the marketing site's rasters. That module
 * documents what each crop is for, and why the band between them is found in the
 * image rather than hardcoded.
 *
 * Why the icons exist at all — this is the part that broke install:
 *
 *   Chrome will not offer "Install app" unless the manifest declares a PNG icon
 *   of at least 144px. An SVG entry is fine for a favicon and is ignored by the
 *   installability check, so a manifest whose only icon is an SVG looks correct
 *   in devtools and silently never installs. Hence: 192 and 512 PNG, plus a
 *   separate *maskable* 512, because Android masks the icon to a shape — a
 *   rounded-tile icon declared as maskable gets its corners shaved, and the
 *   artwork ends up clipped. The maskable variant therefore carries its own
 *   safe-zone padding.
 *
 * Requires the `sharp` devDependency (it is not shipped to the client).
 */

import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { brandMaster, PNG } from './brand-master.mjs'

// `brand-master.mjs` has already reported a missing sharp in plain words by the
// time this line runs; here it is only needed, not diagnosed.
const sharp = (await import('sharp')).default

const ROOT = process.cwd()
const PUBLIC = join(ROOT, 'public')
mkdirSync(PUBLIC, { recursive: true })

/** The app's own canvas — what the boot splash, the theme colour and the icons sit on. */
const CANVAS = '#f2f2f5'
const GOLD = '#f5c21d'
const NAVY = '#1b45a6'

const report = []
function write(name, buffer) {
  const path = join(PUBLIC, name)
  writeFileSync(path, buffer)
  report.push({ name, kb: (statSync(path).size / 1024).toFixed(1) })
}

/** PNG settings, shared with the brand module — one place, one recipe. */
const png = PNG

/* ------------------------------------------------------------ the two crops -- */

const {
  masterPath,
  masterWidth,
  masterHeight,
  lockupBuf,
  lockupWidth: LOCKUP_W,
  lockupHeight: LOCKUP_H,
  markBuf,
  box,
  markShare,
  markAspect,
} = await brandMaster()

/* ------------------------------------------------------------------- icons -- */

/**
 * A square icon: the mark, centred on a canvas tile.
 *
 * `radius` is a fraction of the edge, so one call produces the tab icon and the
 * home-screen icon at the same proportion. `bleed` skips the rounding entirely
 * for the maskable and iOS variants, which the platform rounds itself — a
 * rounded tile underneath its own mask is how corners get shaved twice.
 */
async function icon({ size, scale, radius, pad = 0 }) {
  const art = await sharp(markBuf)
    .resize({
      width: Math.round(size * scale) - pad * 2,
      height: Math.round(size * scale) - pad * 2,
      fit: 'inside',
    })
    .png(png)
    .toBuffer()

  const r = radius > 0 ? Math.round(size * radius) : 0
  const tile = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="${CANVAS}" />
</svg>`

  return sharp(Buffer.from(tile))
    .composite([{ input: art, gravity: 'center' }])
    .png(png)
    .toBuffer()
}

/**
 * An .ico wrapping a PNG.
 *
 * Kept because it is the one path nothing else can cover: browsers and feed
 * readers that ask for `/favicon.ico` without reading the document's `<link>`
 * get a real icon instead of a 404, and the format allows a PNG payload
 * verbatim, so the same bytes are written twice rather than a second rasteriser
 * being involved. The header is 6 bytes plus one 16-byte directory entry.
 */
function ico(pngBuffer, size) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // 1 = icon
  header.writeUInt16LE(1, 4) // one image
  const entry = Buffer.alloc(16)
  entry.writeUInt8(size >= 256 ? 0 : size, 0)
  entry.writeUInt8(size >= 256 ? 0 : size, 1)
  entry.writeUInt8(0, 2) // no palette
  entry.writeUInt8(0, 3) // reserved
  entry.writeUInt16LE(1, 4) // colour planes
  entry.writeUInt16LE(32, 6) // bits per pixel
  entry.writeUInt32LE(pngBuffer.length, 8)
  entry.writeUInt32LE(header.length + entry.length, 12)
  return Buffer.concat([header, entry, pngBuffer])
}

// The tab. 16px is why the mark is the crop: at that size the lockup's lettering
// is a grey smear, and a favicon that reads as a smudge is worse than a plain
// one that reads as the owl.
write('favicon-16.png', await icon({ size: 16, scale: 0.9, radius: 0.2 }))
write('favicon-32.png', await icon({ size: 32, scale: 0.86, radius: 0.2 }))
write('favicon-48.png', await icon({ size: 48, scale: 0.84, radius: 0.2 }))
write('favicon.ico', ico(readFileSync(join(PUBLIC, 'favicon-32.png')), 32))

// The home screen. `any` is a rounded tile; `maskable` is full-bleed with the
// artwork inside the safe zone (~60% of the square survives a circle crop).
write('pwa-192.png', await icon({ size: 192, scale: 0.78, radius: 0.22 }))
write('pwa-512.png', await icon({ size: 512, scale: 0.78, radius: 0.22 }))
write('pwa-maskable-512.png', await icon({ size: 512, scale: 0.6, radius: 0 }))

// iOS ignores the manifest, applies its own mask, and fills transparency with
// black — so this one is opaque and un-rounded, with the art a touch larger.
write('apple-touch-icon.png', await icon({ size: 180, scale: 0.72, radius: 0 }))

/* --------------------------------------------------------------- the lockup -- */

/**
 * The app's own logo, served as `/seepat-logo.png`.
 *
 * Sized at 512px wide because that is the most any surface asks for: the boot
 * splash draws it at `min(48vw, 168px)` and the header at 56px, and 512 covers
 * a 3x screen with room to spare. Quantised to a palette — the artwork is navy,
 * gold and white with soft edges, so 256 colours with dithering is
 * indistinguishable at the sizes it is displayed at and roughly a twentieth of
 * the master's bytes. That matters more than usual here: this file is in the
 * offline precache, so its bytes are paid once per install on a prepaid plan.
 */
const lockup = await sharp(lockupBuf)
  .resize({ width: 512, withoutEnlargement: true })
  .png({ ...png, palette: true, quality: 92, dither: 0.5 })
  .toBuffer()
write('seepat-logo.png', lockup)

/**
 * The owl alone, served as `/seepat-mark.png`, for the app's header.
 *
 * The header used to draw the whole lockup in a 56px box, which squeezed the
 * wordmark and the tagline inside the artwork down to a grey smudge beside the
 * page title. The owl is the part a thumb and an eye recognise; the name is
 * already live text in the tab bar, the splash and the manifest, so nothing is
 * lost by cropping to the mark here. Same master and same crop as the favicons
 * and the marketing site's header, so the two can never drift.
 *
 * 128px for a 56px box is a 2.3x screen, and the palette quantisation halves
 * the bytes on a file that sits in the offline precache.
 */
const mark = await sharp(markBuf)
  .resize({ width: 128, withoutEnlargement: true })
  .png({ ...png, palette: true, quality: 92, dither: 0.5 })
  .toBuffer()
write('seepat-mark.png', mark)

/* -------------------------------------------------------------- social card -- */

/**
 * 1200x630, the ratio every platform crops predictably. Deliberately almost no
 * typesetting: text in a generated raster would need the display font available
 * to the rasteriser, and a fallback face on the brand card is worse than no
 * words at all — `og:title` and `og:description` carry the sentence. What is
 * here is the lockup on the app's canvas with its two light sources, so the card
 * is unmistakably this product. The lockup is navy ink, which is why the card is
 * light: the same image on navy would lose the word.
 */
const cardH = 360
const cardW = Math.round(cardH * (LOCKUP_W / LOCKUP_H))
const lockupData = `data:image/png;base64,${lockup.toString('base64')}`
const og = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630">
  <defs>
    <linearGradient id="rule" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${NAVY}" />
      <stop offset="100%" stop-color="#dda60c" />
    </linearGradient>
    <radialGradient id="gold" cx="0.86" cy="0.04" r="0.7">
      <stop offset="0%" stop-color="${GOLD}" stop-opacity="0.34" />
      <stop offset="100%" stop-color="${GOLD}" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="navy" cx="0.06" cy="0.02" r="0.75">
      <stop offset="0%" stop-color="${NAVY}" stop-opacity="0.26" />
      <stop offset="100%" stop-color="${NAVY}" stop-opacity="0" />
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="${CANVAS}" />
  <rect width="1200" height="630" fill="url(#navy)" />
  <rect width="1200" height="630" fill="url(#gold)" />
  <image xlink:href="${lockupData}" x="${(1200 - cardW) / 2}" y="${(630 - cardH) / 2 - 14}" width="${cardW}" height="${cardH}" preserveAspectRatio="xMidYMid meet" />
  <rect x="470" y="${(630 - cardH) / 2 + cardH + 34}" width="260" height="5" rx="2.5" fill="url(#rule)" />
</svg>`

write(
  'og-image.png',
  await sharp(Buffer.from(og))
    .resize(1200, 630)
    // Quantised too, and it is excluded from the precache below: a social card
    // is fetched by crawlers, never by the app, so it must not cost an install
    // anything.
    .png({ ...png, palette: true, quality: 90, dither: 0.6 })
    .toBuffer(),
)

/* ------------------------------------------------------------------ report -- */

const art = await sharp(lockup).metadata()
console.log(
  `master:  ${masterPath.replace(`${ROOT}\\`, '').replace(`${ROOT}/`, '')} ${masterWidth}x${masterHeight}`,
)
console.log(`trimmed: ${LOCKUP_W}x${LOCKUP_H}`)
console.log(`mark:    ${box.width}x${box.height} (${(markShare * 100).toFixed(0)}% of the lockup height, aspect ${markAspect.toFixed(2)})`)
console.log(`lockup:  ${art.width}x${art.height}`)
console.log('generated:')
for (const { name, kb } of report) console.log(`  ${name.padEnd(24)} ${kb.padStart(6)} kB`)
const total = report.reduce((sum, r) => sum + Number(r.kb), 0)
console.log(`  ${'total'.padEnd(24)} ${total.toFixed(1).padStart(6)} kB`)
