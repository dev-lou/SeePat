# SeePat — marketing site

Two static pages, in two languages, with no framework and no runtime dependency.
This folder is self-contained on purpose: copy it anywhere, run one command, and
it deploys. Nothing here imports the app, and nothing in the app imports it.

```
en   /            index.html
fil  /fil         fil.html       (hreflang tl-PH — see "Why tl, not fil" below)
      /404        404.html
```

## Running it

```bash
cd marketing
npm run build     # stamp the origin into dist/ (the only build step)
npm run smoke     # check the built site: links, JSON-LD, hreflang, sitemap
npm run serve     # serve dist/ at http://localhost:4173
npm run dev       # build, then serve
```

There is nothing to install. `npm run build` is one file — `tools/stamp.mjs` —
and it exists for a single reason: a canonical tag, an hreflang alternate, an
`og:url` and every sitemap entry have to be **absolute**, and a folder of files
cannot know the domain it will be served from. So the source carries tokens
(`%SITE_URL%`) and the build substitutes them.

## Environment

Four variables, all stamped at build time. Locally they live in `.env` (copy
`.env.example`); on Vercel they live in the project's settings.

| Variable | Required | What it does |
|---|---|---|
| `SITE_URL` | yes, in a deliberate deploy | The origin, no trailing slash. Every canonical, hreflang, `og:url` and sitemap entry is built from it. |
| `APP_URL` | no | Reserved for the day the app has a linkable address. Unused right now: SeePat ships as an APK through Google Play, so the CTAs are coming-soon badges with no `href` and nothing points here. Defaults to `SITE_URL`. |
| `CONTACT_EMAIL` | no | Printed in the footer and in the Organization structured data. When it is empty the footer **omits the line entirely** rather than showing an empty label. |
| `GOOGLE_SITE_VERIFICATION` | no | Search Console's HTML-tag token. When empty, no meta tag is written at all. |

On a Vercel build with no `SITE_URL` set, the build resolves the origin from
`VERCEL_PROJECT_PRODUCTION_URL`; with neither, it **fails** rather than deploying
a page whose canonical tags point at `localhost`. Locally it falls back to
`http://localhost:4173` with a warning, which is correct for a local page and
cannot be deployed by accident.

## Deploying on Vercel

**Option A — from the repository (this is the one that keeps working).**

1. Import the repository at [vercel.com/new](https://vercel.com/new).
2. **Root Directory → `marketing`.** This is the setting that matters: it is what
   makes `vercel.json` apply and what keeps the app's tooling out of the build.
3. Framework Preset: **Other**. Build Command: `npm run build` (read from
   `vercel.json`, leave it alone). Output Directory: `dist`.
4. Environment Variables → add `SITE_URL` = the domain you will serve this from,
   e.g. `https://seepat.ph`. Deploy one preview first, look at it, then add the
   domain and deploy to production.
5. Settings → Domains → add the domain, and point DNS at Vercel.

**Option B — from this folder alone.** If you copy `marketing/` into its own
repository, this still works with no changes:

```bash
cd marketing
npx vercel --prod        # answers are read from vercel.json
```

Two things worth knowing about the deploy, because both are load-bearing:

- **`cleanUrls` is on**, so `/fil.html` redirects to `/fil`. That is why the
  canonical for the Filipino page is `SITE_URL/fil` and not `/fil/` — a canonical
  that names a URL the host redirects away from is a canonical against itself.
- **Nothing is fingerprinted.** The asset cache is one day with
  `stale-while-revalidate`, not a year: a stale hero screenshot is a worse bug
  than one extra request. The fonts are the exception and are cached hard.

## After the first deploy (30 minutes that decide whether anyone finds it)

1. **Google Search Console** → add the domain as a property, verify with the
   HTML tag, paste the token into `GOOGLE_SITE_VERIFICATION`, redeploy.
2. **Submit the sitemap**: `https://your-domain/sitemap.xml`. `robots.txt`
   already points at it.
3. **Check the card**, don't assume it: paste the URL into a social-card
   validator (Facebook's Sharing Debugger, or `opengraph.xyz`) and confirm the
   image, title and description appear. This is the step people skip, and it is
   the one that shows a broken image on every share.
4. **Run the numbers**: [PageSpeed Insights](https://pagespeed.web.dev/) on the
   deployed URL, on mobile. The budget this page was built to is in
   `npm run smoke` — under 250 KB for the first screen, no JavaScript, no layout
   shift. If a number is worse than that on the real domain, something was added.

## Screenshots

The seven screenshots per language are the **real app**, captured at the real
390×844 viewport at 2×, then converted to WebP. They are regenerated from the
repository root, which is where the app lives:

```bash
npm run dev                                   # the app, on :5173
node tools/capture-marketing-shots.mjs http://localhost:5173/ marketing/assets/shots en
node tools/capture-marketing-shots.mjs http://localhost:5173/ marketing/assets/shots fil
```

The app seeds a deterministic 21-day ledger on first run, so the figures in the
shots are the same every time, in both languages. The capture sets the app's own
language key before the first paint, which is why the Filipino page can show
Filipino screens rather than English ones with a translation over the top — and
`src/marketing.test.ts` fails the build if the two sets are ever mixed up.

Every brand raster here is a crop of the same master (`new_logo.png` at the
repository root). The lockup (`assets/brand/lockup.png`) and the social card
(`assets/brand/og-cover.png`) come straight out of the app's own asset pipeline —
copy them across after re-running it. The mark (`assets/brand/mark.png`) is the owl
on its own:

```bash
node tools/make-assets.mjs        # then copy lockup.png and og-cover.png across
node tools/make-brand-mark.mjs    # the header's owl, 256px, 20KB
```

**The header carries the mark, not the lockup**, and that is a correction rather
than a preference: at 2.5rem the lockup's wordmark renders as a smudge of itself,
and the header was saying *SeePat* twice — once as a picture of the words and once
as words, in a 40px box next to the name it was drawing. The owl is the part a
reader recognises at that size; the name is text, which means it can also be
selected, translated, read aloud and indexed. Both crops are cut by
`tools/brand-master.mjs`, which the icon pipeline shares, so the site's mark cannot
drift from the app's favicon. Nothing here is hand-edited.

The third raster, `assets/brand/lockup-on-dark.png`, is the one generated
**for this site** — it exists because the lockup's "See" is set in the brand's navy
and disappears on a navy band:

```bash
node tools/make-lockup-on-dark.mjs    # from the repository root
```

It adapts the mark to a navy band with four rules: the gold is left **as gold** (wing,
beak, spark, "Pat" — gold on this navy is 11.1:1, so it needed no help), the owl's
body becomes the brand's blue `#6b7bff` (5.13:1), and the wordmark's ink becomes the
artwork's cream ("See" has to be readable before it is anything else; 16.8:1).

Telling the owl from the wordmark is the interesting part: in the master they are
the **same** dark blue — 80 tones, red pinned at 0 — so colour cannot separate them.
Position can, and the tool *finds* the empty band between them rather than hardcoding
a row, so a re-drawn master does not silently start clipping the owl's feet.

The pupils are the same ink as the body too, so they recolour with it; what keeps
the owl looking at you is the untouched white of the eye around them. Re-run after
any change to the master — it is idempotent, so an unchanged master gives an
unchanged file.

## Why `tl`, not `fil`

The app calls this language `fil` internally. Search does not: Google's
localized-versions guidance asks for an **ISO 639-1** language subtag, and
Filipino has no two-letter code — `tl` (Tagalog) is the one Google documents. So
the page declares `lang="tl"` and `hreflang="tl-PH"`, which are both valid, and
the visible label still says *Filipino*, because that is what the owner calls it.
Changing these two values to `fil-PH` is defensible in HTML and risky in search.

## What is deliberately absent

- **JavaScript, except one script.** Nothing is loaded: no bundle, no framework,
  no `<script src>` anywhere, in either page or the 404. The FAQ uses `<details>`,
  the language switch is two links, and the reveals are CSS. The single exception
  is 700 bytes of inline script at the end of each landing page that marks the
  section you are reading in the navigation — and it is enhancement, not
  dependency: with it blocked, the nav is still five working anchors. There is
  still no interaction delay to measure and nothing that can move the page after
  it paints.
- **Cookies and analytics.** Nothing to consent to, nothing to declare. If you
  add an analytics script, it belongs in the `<head>` of both pages, and the
  budget in `npm run smoke` is what will notice.
- **A rating.** No `aggregateRating` and no reviews are marked up anywhere,
  because the product has no published ratings; inventing them is how a rich
  result turns into a manual action. `src/marketing.test.ts` enforces this.
- **A pricing claim that isn't live.** PRO's rows carry a "not yet live" tag, and
  the price section says in plain words that the server does not exist yet.

## How the page is composed

Two materials alternate down the page, because one material all the way down is what a page looks
like when nobody decided anything:

| | |
|---|---|
| **Canvas** | `.band` and the hero — a cool near-white, with a 24px dot grid and the grain tile over it |
| **Ledger paper** | `.ledger` — the warm sheet (`#fbfaf7`) with faint ruled lines, for the sections that are about records |
| **Ink** | `.band--dark` and the hero — navy, with a white dot grid and one gold wash |

The textures are three SVGs in `assets/`, and **all three have a recipe**:

```bash
node marketing/tools/make-textures.mjs            # regenerate
node marketing/tools/make-textures.mjs --check    # fail if disk has drifted from the recipe
```

- `grain.svg` — `feTurbulence` with `stitchTiles="stitch"`, desaturated, alpha 0.075. Texture you
  notice only when it is taken away.
- `wave-mask.svg` — one full period of a cosine, 240×40, sampled every 5px, used as a CSS
  `mask-image`. Seamlessness is the requirement: the curve starts and ends at the same height *and*
  the same slope, so the tile repeats at any viewport width without a join.
- `swipe-mask.svg` — the emphasis stroke under the word a sentence turns on. A tapered, tilted
  swipe whose centreline drifts across a shallow wave: thicker through the middle, tapering to
  points at both ends. It is drawn as a filled band rather than a stroked path, because a stroke
  cannot vary its width and a varying width is the point. Stretched to the word's width in CSS, so
  the taper always lands on the ends.

**One soft edge, on purpose.** The wave under the hero is the only curved boundary on the page. It
replaced a sawtooth that read as a torn receipt — a paper joke in a product about money. The strip is
painted *paper* and the navy rides on a masked pseudo-element over it, so the troughs show the band
below rather than the canvas behind the strip, which is what left a 1px grey seam along the wave.

**The emphasis stroke.** At most one per section, on the word that sentence turns on: gold for the
claim, blue for the mechanism. Punctuation goes *inside* the emphasised span — an `inline-block` is a
line-break opportunity, and a trailing period outside one gets orphaned onto the next line. The
stroke is a drawn swipe, not a bar: a straight line of even weight reads as a border, which is a box,
which is the opposite of an emphasis.

**The emphasised word keeps the headline's colour**, and that was decided against the obvious
alternative. Setting the word in the stroke's own colour makes the headline two-tone — a gold phrase
with a gold rule under it stops being a sentence with a mark on one word and becomes a logo — and it
collides with the ground: the same gold would need a different value on paper than on navy, so the
trick would say two different things on two different bands. The stroke is the accent; the word is
still the sentence.

**The hero's height is bought with padding, and only underneath.** Padding cannot push copy below
the fold, whereas bigger type or a taller phone both can, and the bottom is where extra air costs
nothing: the same amount added at the top moved the pills from 25px above the fold to 11px on a
390×844 phone, which is one shorter device away from clipping them.

**The navigation marks where you are** with 2px of the brand's navy — the blue the language switch
already fills its current pill with, so the header has exactly one way of saying "you are here". It
started as the emphasis gold, on the theory that the mark meaning *this is the word that matters*
could double as *this is the section you are in*; the colour was the mistake, not the idea. Against
the near-white header gold measures 1.88:1 over a band and 1.47:1 where it sits over the navy hero,
under the 3:1 floor for a mark that carries meaning, which is why the underline read as a faint
yellow smear. Navy measures 11.07:1, and 8.64:1 at its worst point. The gold keeps the job it was
good at — one stroke under the word a claim turns on, where it is punctuation rather than a
location. The rule is set by the single inline script, and the observer deliberately marks on entry
and never on exit: comparing intersection *ratios* looks reasonable and lags a whole section behind,
because a tall section only ever fills a thin band by a few percent.

**Contrast is checked here too.** `npm run check:contrast` at the repository root reads this folder's
tokens out of `assets/site.css` and audits the pairs the pages render — which is how a 2.60:1 line of
pricing copy was caught, and how the capital chart's bar fills were found sitting at 1.7:1 and 2.9:1
against their own track.

## Fonts

Archivo (display) and Plus Jakarta Sans (body), latin subset, copied out of the
`@fontsource` packages the project already depends on — the SIL Open Font License
texts sit next to the files. Both are self-hosted: no third-party font host, no
extra DNS lookup or TLS handshake on a phone that is paying for data.

```bash
cp node_modules/@fontsource-variable/archivo/files/archivo-latin-wght-normal.woff2 \
   marketing/assets/fonts/archivo-latin.woff2
cp node_modules/@fontsource-variable/archivo/LICENSE marketing/assets/fonts/LICENSE-Archivo.txt
cp node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2 \
   marketing/assets/fonts/plus-jakarta.latin.woff2
cp node_modules/@fontsource-variable/plus-jakarta-sans/LICENSE marketing/assets/fonts/LICENSE-PlusJakartaSans.txt
```

Archivo is the one place the site deliberately does **not** use the app's type.
The display face has one job — a headline that gets believed in the second before
someone scrolls — and a tight heavy grotesque does it where Sora's softer
geometric forms read as product UI. Body copy goes back to the app's own face,
because that is where familiarity beats personality. The split is two files,
35KB + 27KB, preloaded in each page's `<head>`.
