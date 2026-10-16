/**
 * The brand master, and the two crops every surface is built from.
 *
 *   import { brandMaster } from './brand-master.mjs'
 *   const { lockupBuf, markBuf, box, markShare, markAspect } = await brandMaster()
 *
 * `new_logo.png` at the repository root is the official artwork — the owl, the
 * SeePat wordmark and the tagline, stacked on transparency. It is the only brand
 * file that is hand-made; everything else in the project is a crop, a recolour or
 * a composition of it, so an icon can never drift from the logo.
 *
 * THE TWO CROPS, and the difference is not cosmetic:
 *
 *   THE LOCKUP is the whole thing, trimmed of its transparent margin. It is what
 *   the app renders (`public/seepat-logo.png`) and what the social card is built
 *   around. It is the right asset for a splash, a card and a social preview.
 *
 *   THE MARK is the owl on its own. It is what anything small needs — a 16px
 *   favicon, a home-screen tile — because lettering disintegrates into noise well
 *   before the owl does, and it is also what the marketing site's header carries,
 *   next to the wordmark set as live text. It is a crop of the official artwork,
 *   not a second logo.
 *
 * Why the band is *found* rather than hardcoded: the mark is the first stacked
 * band of ink and the wordmark is what follows it, and the boundary between them
 * is measured out of the image by probing a small rasterisation of it. A
 * re-export of the master with different spacing therefore still produces the
 * right crop, where a hard-coded pixel box would silently start slicing the owl
 * in half. The check that comes with it fails loudly if the artwork's layout
 * changes by more than the band could reasonably account for.
 *
 * Requires the `sharp` devDependency (it is not shipped to the client).
 */

import { join } from 'node:path'

let sharp
try {
  sharp = (await import('sharp')).default
} catch {
  console.error('sharp is not installed. Run: npm install --save-dev sharp')
  process.exitCode = 1
  throw new Error('missing sharp')
}

/** The master, as the tools address it: relative to the repository root. */
export const MASTER = join(process.cwd(), 'new_logo.png')

/**
 * PNG settings shared by every derived output: small is a feature here, not a
 * detail, because the rasters this feeds are paid for on prepaid data plans.
 */
export const PNG = { compressionLevel: 9, effort: 10 }

const MIN_MASTER = 512
const PROBE_W = 512
const INK = 8

/**
 * Load the master, trim its transparent margin, and cut the two crops out of it.
 *
 * @returns {Promise<{
 *   masterPath: string, masterWidth: number, masterHeight: number,
 *   lockupBuf: Buffer, lockupWidth: number, lockupHeight: number,
 *   markBuf: Buffer, markWidth: number, markHeight: number,
 *   box: { left: number, top: number, width: number, height: number },
 *   markShare: number, markAspect: number,
 * }>}
 */
export async function brandMaster() {
  const master = await sharp(MASTER).metadata()
  if ((master.width ?? 0) < MIN_MASTER) {
    throw new Error(`new_logo.png is ${master.width}px — the master must be at least ${MIN_MASTER}px wide`)
  }

  // Trim the transparent margin once, and measure everything from the trimmed
  // box: the master ships with a lot of air, and every pixel of it would
  // otherwise be charged to the offline precache and to the header layout.
  const trimmed = await sharp(MASTER).trim({ threshold: 1 }).png().toBuffer({ resolveWithObject: true })
  const lockupBuf = trimmed.data
  const lockupWidth = trimmed.info.width
  const lockupHeight = trimmed.info.height

  const probe = await sharp(lockupBuf)
    .resize({ width: PROBE_W, fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { width: pw, height: ph, channels } = probe.info
  const alphaAt = (x, y) => probe.data[(y * pw + x) * channels + 3]

  const inked = Array.from({ length: ph }, (_, y) => {
    for (let x = 0; x < pw; x += 1) if (alphaAt(x, y) > INK) return true
    return false
  })

  const firstInk = inked.indexOf(true)
  if (firstInk < 0) throw new Error('new_logo.png appears to be empty')
  let lastInk = firstInk
  while (lastInk + 1 < ph && inked[lastInk + 1]) lastInk += 1

  const markShare = (lastInk - firstInk + 1) / ph
  if (markShare < 0.2 || markShare > 0.85) {
    throw new Error(
      `the mark band is ${(markShare * 100).toFixed(1)}% of the lockup — the artwork's layout changed, check the crop`,
    )
  }

  // The mark's own horizontal extent, so the crop is centred on the owl rather
  // than on the lockup's full width.
  let minX = pw
  let maxX = -1
  for (let y = firstInk; y <= lastInk; y += 1) {
    for (let x = 0; x < pw; x += 1) {
      if (alphaAt(x, y) > INK) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
      }
    }
  }

  const sx = lockupWidth / pw
  const sy = lockupHeight / ph
  const pad = Math.round(lockupHeight * 0.012)
  const box = {
    left: Math.max(0, Math.floor(minX * sx) - pad),
    top: Math.max(0, Math.floor(firstInk * sy) - pad),
    width: Math.ceil((maxX - minX + 1) * sx) + pad * 2,
    height: Math.ceil((lastInk - firstInk + 1) * sy) + pad * 2,
  }
  // Never read past the edge: extract() throws rather than clamping.
  box.width = Math.min(box.width, lockupWidth - box.left)
  box.height = Math.min(box.height, lockupHeight - box.top)

  const markBuf = await sharp(lockupBuf).extract(box).png(PNG).toBuffer()
  const mark = await sharp(markBuf).metadata()

  return {
    masterPath: MASTER,
    masterWidth: master.width ?? 0,
    masterHeight: master.height ?? 0,
    lockupBuf,
    lockupWidth,
    lockupHeight,
    markBuf,
    markWidth: mark.width ?? 1,
    markHeight: mark.height ?? 1,
    box,
    markShare,
    markAspect: (mark.width ?? 1) / (mark.height ?? 1),
  }
}
