import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The shell's contract, asserted against the real file.
 *
 * `index.html` is the one file in this project that TypeScript cannot police: it
 * is hand-written, it ships the first thing a user ever sees, and every value in
 * it is load-bearing in a way that fails silently. A splash held for the wrong
 * duration still looks fine; an og:image pointing at a file that was never
 * generated still validates as HTML. So the numbers and the asset references are
 * read back out of the file and checked here, the same way the palette is.
 *
 * What this deliberately does NOT check is the manifest and the icons, because
 * those only exist after `vite build` (they are generated into dist/) and the
 * generator is `vite-plugin-pwa`. Those are verified against the built output —
 * see the note in vite.config.ts.
 */

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

const num = (name: string): number => {
  const match = html.match(new RegExp(`var ${name} = [^\\n]*?(\\d+)\\s*$`, 'm'))
  if (!match) throw new Error(`${name} not found in index.html`)
  return Number(match[1])
}

describe('the boot splash', () => {
  it('holds for two seconds, and only 0.8s when motion is reduced', () => {
    const line = html.match(/var MIN_MS = [^\n]*/)
    expect(line, 'MIN_MS must stay in index.html').toBeTruthy()
    expect(line?.[0]).toContain('prefers-reduced-motion')
    expect(line?.[0]).toContain('800')
    expect(line?.[0]).toContain('2000')
  })

  it('keeps the fail-open deadline above the hold', () => {
    // If the fallback fired first it would cut off the splash on exactly the slow
    // devices the floor exists for — the bug would only show up on a bad phone.
    expect(num('FALLBACK_MS')).toBeGreaterThan(num('MIN_MS'))
  })

  it('renders the official wordmark, not type we set ourselves', () => {
    expect(html).toContain('src="/seepat-wordmark.png"')
    // The old hand-set "See"/"Pat" spans must not come back: the brand's
    // letterforms belong to the artwork.
    expect(html).not.toContain('class="boot-word"')
  })

  it('gives the sheen something to travel across', () => {
    // The highlight is blended with `overlay` so it lifts the navy and gold ink
    // and leaves the canvas alone. On a plain background it would be invisible,
    // which is the whole reason this is a blend mode and not a gradient.
    expect(html).toContain('boot-sheen')
    expect(html).toContain('mix-blend-mode: overlay')
  })

  it('removes itself even if the app never boots', () => {
    expect(html).toContain('__seepatBoot')
    expect(html).toContain('setTimeout(remove, FALLBACK_MS)')
    // And with JavaScript off entirely, the splash is hidden rather than stuck.
    expect(html).toMatch(/<noscript>[\s\S]*#boot[\s\S]*display: none/)
  })
})

describe('the social card', () => {
  it('points at the generated image from both tag families', () => {
    expect(html).toMatch(/property="og:image" content="[^"]*\/og-image\.png"/)
    expect(html).toMatch(/name="twitter:image" content="[^"]*\/og-image\.png"/)
    expect(html).toContain('twitter:card')
    expect(html).toContain('summary_large_image')
  })

  it('is absolute when deployed, because crawlers will not resolve a relative one', () => {
    // %VITE_SITE_URL% is Vite's HTML env substitution: empty in the repo, so the
    // tags fall back to root-relative paths, and a real origin at deploy time
    // makes them absolute.
    expect(html).toContain('%VITE_SITE_URL%/og-image.png')
    expect(html).toContain('%VITE_SITE_URL%/')
  })

  it('declares the card size, so clients can lay it out before fetching', () => {
    expect(html).toContain('property="og:image:width" content="1200"')
    expect(html).toContain('property="og:image:height" content="630"')
  })

  it('gives iOS a raster icon, because it will not accept the SVG', () => {
    expect(html).toMatch(/rel="apple-touch-icon" href="\/apple-touch-icon\.png"/)
  })
})
