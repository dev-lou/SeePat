import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The marketing site is four text files, two pages and a folder of images — the
 * one part of this repository that no toolchain checks. Nothing type-checks
 * HTML, and every failure mode here is silent:
 *
 *  - an image path that does not exist renders as a broken box on a deployed
 *    page and nowhere else;
 *  - FAQ copy that drifts from its JSON-LD turns into a structured-data
 *    violation, because Google requires the marked-up answer to be visible;
 *  - a canonical or hreflang URL that disagrees between the two languages makes
 *    the pair compete for the same query, or drops one of them entirely.
 *
 * So the files are read back and asserted, the same way src/shell.test.ts reads
 * index.html and tools/contrast-check.mjs reads the palette. The source files
 * still carry %SITE_URL% tokens: that is why the assertions below are written
 * against the tokens and the shapes, not against a rendered domain.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SITE = join(ROOT, 'marketing')

const PAGES = {
  en: readFileSync(join(SITE, 'index.html'), 'utf8'),
  fil: readFileSync(join(SITE, 'fil.html'), 'utf8'),
  notFound: readFileSync(join(SITE, '404.html'), 'utf8'),
} as const

/**
 * The file without its own explanatory comments. Needed before asserting that
 * something is absent: the head of each page documents that there is no rating
 * markup, and that sentence contains the very word being searched for.
 */
const withoutComments = (html: string): string => html.replace(/<!--[\s\S]*?-->/g, ' ')

/** Everything a reader would see: comments and tags stripped, entities aside. */
const visibleText = (html: string): string =>
  html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&ldquo;/g, '“')
    .replace(/\s+/g, ' ')

const attr = (html: string, pattern: RegExp): string[] =>
  [...html.matchAll(pattern)].map((match) => match[1])

/** `/assets/x.webp` → marketing/assets/x.webp, the way the host resolves it. */
function resolvePath(urlPath: string): string | null {
  const clean = urlPath.split('#')[0].split('?')[0]
  if (!clean.startsWith('/')) return null
  if (clean === '/') return join(SITE, 'index.html')
  const direct = join(SITE, clean)
  if (existsSync(direct) && !clean.endsWith('/')) return direct
  if (existsSync(`${direct}.html`)) return `${direct}.html`
  if (existsSync(join(direct, 'index.html'))) return join(direct, 'index.html')
  return null
}

const jsonLd = (html: string): { '@graph': { '@type': string }[] } => {
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
  if (!match) throw new Error('no JSON-LD found')
  return JSON.parse(match[1])
}

const nodeOf = (html: string, type: string): Record<string, unknown> =>
  jsonLd(html)['@graph'].find((node) => node['@type'] === type) as Record<string, unknown>

describe('the marketing pages ship almost no JavaScript', () => {
  for (const [name, html] of Object.entries(PAGES)) {
    it(`${name}: no external scripts and no inline handlers`, () => {
      // The performance story is that there is nothing to load and nothing to
      // hydrate: no INP to measure, no framework that can shift a layout after
      // paint. One `<script src>` added in a hurry would end that quietly, which
      // is what this catches.
      expect(html).not.toMatch(/<script\s+src=/i)
      expect(html).not.toMatch(/\son(click|load|error|submit|change)=/i)
      expect(html).not.toMatch(/javascript:/i)
    })
  }

  it('the one inline script is small, and only about the nav', () => {
    // Each landing page carries exactly one hand-written script: it marks the
    // section you are reading in the navigation. It is allowed to exist because
    // it is 700 bytes and a request is what these pages are built to avoid — so
    // it is also capped here, and held to the one job. A second script, a
    // `fetch`, storage, or anything that runs before paint turns "a page with a
    // nicety" back into "an app with a marketing page".
    for (const [name, html] of Object.entries({ en: PAGES.en, fil: PAGES.fil })) {
      const inline = [
        ...html.matchAll(/<script(?![^>]*application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/g),
      ].map((match) => match[1])

      expect(inline.length, `${name}: inline script count`).toBe(1)
      const js = inline[0]
      // Raw source, indentation and one comment included — ~1.3KB as written, so
      // the cap is a tripwire for a bundle arriving here, not a byte budget.
      expect(js.length, `${name}: inline script size`).toBeLessThan(1600)
      expect(js, `${name}: marks the current section`).toContain('aria-current')
      expect(js).toContain('IntersectionObserver')
      expect(js, `${name}: the script must not fetch or evaluate anything`).not.toMatch(
        /fetch\(|XMLHttpRequest|eval\(|new Function|localStorage|sessionStorage|document\.write/,
      )
    }
  })

  it('the nav still works as plain links with the script blocked', () => {
    // Progressive enhancement, asserted rather than assumed: if the script never
    // runs, every nav target must still exist as a real anchor on the page.
    for (const [name, html] of Object.entries({ en: PAGES.en, fil: PAGES.fil })) {
      const targets = attr(html, /class="site-nav"[^>]*>([\s\S]*?)<\/nav>/g)
      const hrefs = attr(targets[0] ?? '', /href="(#[^"]+)"/g)
      expect(hrefs.length, `${name}: nav links`).toBeGreaterThanOrEqual(4)
      for (const href of hrefs) {
        expect(html, `${name}: nav points at a section that is not there`).toContain(
          `id="${href.slice(1)}"`,
        )
      }
    }
  })

  it('404: is a page a crawler is told to forget', () => {
    expect(PAGES.notFound).toContain('content="noindex, follow"')
    expect(PAGES.notFound).not.toContain('rel="canonical"')
    // Bilingual on purpose: the server picked this file, so the visitor's
    // language is the one thing not known.
    expect(PAGES.notFound).toMatch(/lang="tl"/)
  })
})

describe('every reference resolves', () => {
  for (const [name, html] of Object.entries(PAGES)) {
    it(`${name}: every src and href points at a file that exists`, () => {
      const refs = [
        ...attr(html, /(?:src|href)="(\/[^"]*)"/g),
        ...attr(html, /(?:src|href)="(%SITE_URL%[^"]*)"/g).map((url) =>
          url.replace('%SITE_URL%', ''),
        ),
      ].filter((ref) => !ref.endsWith('/') || ref === '/')

      const missing = refs.filter((ref) => resolvePath(ref) === null)
      expect(missing).toEqual([])
    })
  }

  it('resolves every asset the stylesheet asks for', () => {
    // The pages' own references are covered above; the stylesheet's are invisible
    // to that test, and this is where all three textures are named — the grain,
    // the hero's wave and the emphasis stroke's mask. A mistyped url() fails
    // SILENTLY here: the band still paints, just without its texture, and nothing
    // in the browser, the build or the smoke script says a word about it.
    const css = readFileSync(join(SITE, 'assets', 'site.css'), 'utf8')
    const urls = [...css.matchAll(/url\('(\/assets\/[^']+)'\)/g)].map((match) => match[1])

    expect(urls.length, 'no url() references found — did the stylesheet move?').toBeGreaterThan(2)
    expect(urls.filter((url) => resolvePath(url) === null)).toEqual([])

    // The SVGs are named here so they cannot be swapped for a hand-made file that
    // quietly diverges from the tool that is supposed to regenerate them. Fonts
    // are exempt: they are copied from packages, not drawn by a recipe.
    // Deduped: several rules share a texture — every band that is paper, for
    // instance — so the same URL legitimately appears more than once.
    const textures = [...new Set(urls.filter((url) => url.endsWith('.svg')))].sort()
    expect(textures).toEqual([
      '/assets/grain.svg',
      '/assets/swipe-mask.svg',
      '/assets/wave-mask.svg',
    ])
    for (const texture of textures) {
      expect(texture, 'a texture with no recipe in tools/make-textures.mjs').toMatch(
        /^\/assets\/(grain|wave-mask|swipe-mask)\.svg$/,
      )
    }
  })

  it('points at the generated social card and declares its size', () => {
    for (const html of [PAGES.en, PAGES.fil]) {
      const image = html.match(/property="og:image" content="([^"]+)"/)?.[1]
      expect(image).toBe('%SITE_URL%/assets/brand/og-cover.png')
      expect(resolvePath('/assets/brand/og-cover.png')).not.toBeNull()
      expect(html).toContain('property="og:image:width" content="1200"')
      expect(html).toContain('property="og:image:height" content="630"')
      expect(html).toContain('name="twitter:card" content="summary_large_image"')
      expect(html).toMatch(/name="twitter:image" content="[^"]*og-cover\.png"/)
    }
  })

  it('reserves space for every image, so nothing shifts after paint', () => {
    for (const [name, html] of Object.entries(PAGES)) {
      const images = [...html.matchAll(/<img\b[^>]*>/g)].map((match) => match[0])
      expect(images.length, `${name} has no images`).toBeGreaterThan(0)
      for (const image of images) {
        expect(image, `${name}: an <img> without width/height`).toMatch(/\bwidth="\d+"/)
        expect(image, `${name}: an <img> without width/height`).toMatch(/\bheight="\d+"/)
        expect(image, `${name}: an <img> without alt`).toMatch(/\balt="[^"]*"/)
        // The lockup is a brand raster generated elsewhere; the screenshots are
        // this project's own captures and have no excuse for shipping as PNG.
        if (image.includes('/shots/')) {
          expect(image, `${name}: a screenshot that is not webp`).toMatch(/\.webp"/)
        }
      }
    }
  })
})

describe('the two pages are a pair, not two pages', () => {
  it('declares the same alternates in both, absolutely', () => {
    for (const [name, html] of Object.entries({ en: PAGES.en, fil: PAGES.fil })) {
      const alternates = attr(html, /<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)
      // Read as pairs, because Google requires each language to list itself AND
      // the other one; a missing return link makes the annotation ignorable.
      const pairs = [...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)].map(
        (match) => `${match[1]}=${match[2]}`,
      )
      expect(pairs, `${name}: hreflang set`).toEqual([
        'en-PH=%SITE_URL%/',
        // `tl-PH`, not `fil-PH`: Google's localized-versions guidance asks for an
        // ISO 639-1 language subtag, and Filipino has no two-letter code.
        'tl-PH=%SITE_URL%/fil',
        'x-default=%SITE_URL%/',
      ])
      expect(alternates.length).toBe(3)
    }
  })

  it('canonicalises each page to itself, never to its sibling', () => {
    expect(PAGES.en).toContain('<link rel="canonical" href="%SITE_URL%/" />')
    expect(PAGES.fil).toContain('<link rel="canonical" href="%SITE_URL%/fil" />')
    // The mistake this guards is the common one: pointing both languages at the
    // English URL, which de-indexes the Filipino page.
    expect(PAGES.fil).not.toContain('rel="canonical" href="%SITE_URL%/"')
  })

  it('declares its own language, and the language it offers next door', () => {
    expect(PAGES.en).toMatch(/<html lang="en">/)
    expect(PAGES.fil).toMatch(/<html lang="tl">/)
    expect(PAGES.en).toMatch(/hreflang="tl-PH" lang="tl"/)
    expect(PAGES.fil).toMatch(/hreflang="en-PH" lang="en"/)
  })

  it('shows each language its own screenshots', () => {
    // A Filipino landing page illustrated with English screens is a promise the
    // page does not keep — and the two sets are generated side by side, so this
    // is exactly the kind of mix-up an edit makes easy.
    expect(attr(PAGES.en, /src="(\/assets\/shots\/[^"]+)"/g)).toEqual([
      '/assets/shots/en-money.webp',
      '/assets/shots/en-ask.webp',
      '/assets/shots/en-voice.webp',
      '/assets/shots/en-voice-draft.webp',
      '/assets/shots/en-ledger.webp',
      '/assets/shots/en-score.webp',
    ])
    expect(attr(PAGES.fil, /src="(\/assets\/shots\/[^"]+)"/g)).toEqual([
      '/assets/shots/fil-money.webp',
      '/assets/shots/fil-ask.webp',
      '/assets/shots/fil-voice.webp',
      '/assets/shots/fil-voice-draft.webp',
      '/assets/shots/fil-ledger.webp',
      '/assets/shots/fil-score.webp',
    ])
    for (const shot of [...attr(PAGES.en, /src="(\/assets\/shots\/[^"]+)"/g)]) {
      expect(resolvePath(shot), `${shot} is referenced but not captured`).not.toBeNull()
    }
  })
})

describe('structured data', () => {
  for (const [name, html] of Object.entries({ en: PAGES.en, fil: PAGES.fil })) {
    it(`${name}: parses, and declares the app, the team and the FAQ`, () => {
      const graph = jsonLd(html)['@graph'].map((node) => node['@type'])
      expect(graph).toEqual(['Organization', 'WebApplication', 'FAQPage'])
    })

    it(`${name}: the app is a free web application with an honest set of offers`, () => {
      const app = nodeOf(html, 'WebApplication')
      expect(app.name).toBe('SeePat')
      expect(app.applicationCategory).toBe('BusinessApplication')
      expect(app.isAccessibleForFree).toBe(true)
      expect(app.url).toBe('%APP_URL%')
      expect(String(app.operatingSystem)).toContain('Web browser')

      const offers = app.offers as { price: string; priceCurrency: string }[]
      expect(offers.map((offer) => offer.price)).toEqual(['0', '99'])
      expect(offers.every((offer) => offer.priceCurrency === 'PHP')).toBe(true)

      // No rating markup anywhere: the product has no published ratings, and an
      // invented rating is how a rich result becomes a penalty.
      const markup = withoutComments(html)
      expect(markup).not.toContain('aggregateRating')
      expect(markup).not.toContain('"review"')
    })

    it(`${name}: every marked-up answer is on the page, word for word`, () => {
      const faq = nodeOf(html, 'FAQPage') as {
        mainEntity: { name: string; acceptedAnswer: { text: string } }[]
      }
      const summaries = attr(html, /<summary>([^<]+)<\/summary>/g)
      const text = visibleText(html)

      expect(faq.mainEntity.length).toBeGreaterThanOrEqual(5)
      expect(faq.mainEntity.map((entry) => entry.name)).toEqual(summaries)

      for (const entry of faq.mainEntity) {
        // The first sentence is enough to prove the marked-up text is the text
        // on the page; comparing the whole answer would break on an apostrophe.
        const opening = entry.acceptedAnswer.text.slice(0, 40)
        expect(text, `answer missing from the page: ${entry.name}`).toContain(opening)
      }
    })
  }
})

describe('the SEO furniture', () => {
  it('robots points at the sitemap and blocks nothing', () => {
    const robots = readFileSync(join(SITE, 'robots.txt'), 'utf8')
    expect(robots).toContain('Sitemap: %SITE_URL%/sitemap.xml')
    expect(robots).toMatch(/User-agent: \*/)
    expect(robots).toMatch(/Allow: \//)
    expect(robots).not.toMatch(/^Disallow: \/\s*$/m)
  })

  it('the sitemap lists exactly the two canonical pages, and nothing else', () => {
    const sitemap = readFileSync(join(SITE, 'sitemap.xml'), 'utf8')
    const locs = attr(sitemap, /<loc>([^<]+)<\/loc>/g)
    expect(locs).toEqual(['%SITE_URL%/', '%SITE_URL%/fil'])
    // Google ignores both, and a sitemap that claims a page changed on every
    // deploy trains the crawler to distrust the field it does read.
    expect(sitemap).not.toContain('<priority>')
    expect(sitemap).not.toContain('<changefreq>')
    expect(sitemap).not.toContain('<lastmod>')
  })

  it('keeps the titles and descriptions inside the length search shows', () => {
    for (const [name, html] of Object.entries({ en: PAGES.en, fil: PAGES.fil })) {
      const title = html.match(/<title>([^<]+)<\/title>/)?.[1] ?? ''
      // `\s+`, not a space: the head is formatted across lines, so the name and
      // the content of the description are not on the same line.
      const description = html.match(/name="description"\s+content="([^"]+)"/)?.[1] ?? ''
      // Cyrillic and CJK would break this; Latin-script Filipino does not.
      expect(title.length, `${name} title: ${title}`).toBeLessThanOrEqual(65)
      expect(title.length, `${name} title: ${title}`).toBeGreaterThan(20)
      expect(description.length, `${name} description`).toBeGreaterThanOrEqual(80)
      expect(description.length, `${name} description`).toBeLessThanOrEqual(175)
      expect(html).toContain('content="index, follow, max-image-preview:large"')
    }
  })

  it('leaves the tokens for the stamp step, and uses no others', () => {
    // tools/stamp.mjs throws on an unknown token, which is the real guard; this
    // catches a typo earlier, in the suite that runs on every `npm test`.
    const allowed = new Set([
      '%SITE_URL%',
      '%APP_URL%',
      '%CONTACT_EMAIL%',
      '%GOOGLE_SITE_VERIFICATION%',
      '%YEAR%',
    ])
    for (const [name, html] of Object.entries(PAGES)) {
      for (const match of html.matchAll(/%[A-Z_]{3,}%/g)) {
        expect(allowed.has(match[0]), `${name}: unexpected token ${match[0]}`).toBe(true)
      }
    }
  })
})
