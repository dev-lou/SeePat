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
| `APP_URL` | no | Where the app lives, when that is a different origin. Every "open the app" button points here. Defaults to `SITE_URL`. |
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

The six screenshots per language are the **real app**, captured at the real
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

The app's lockup (`assets/brand/lockup.png`) and its social card
(`assets/brand/og-cover.png`) are generated by the app's own asset pipeline
(`node tools/make-assets.mjs` at the repository root) from the single brand
master. Copy them across after re-running it; do not hand-edit them here.

## Why `tl`, not `fil`

The app calls this language `fil` internally. Search does not: Google's
localized-versions guidance asks for an **ISO 639-1** language subtag, and
Filipino has no two-letter code — `tl` (Tagalog) is the one Google documents. So
the page declares `lang="tl"` and `hreflang="tl-PH"`, which are both valid, and
the visible label still says *Filipino*, because that is what the owner calls it.
Changing these two values to `fil-PH` is defensible in HTML and risky in search.

## What is deliberately absent

- **JavaScript.** Not one line, in either page or in the 404. The FAQ uses
  `<details>`, the language switch is two links, and the reveals are CSS. That is
  why there is no interaction delay to measure and nothing that can move the page
  after it paints.
- **Cookies and analytics.** Nothing to consent to, nothing to declare. If you
  add an analytics script, it belongs in the `<head>` of both pages, and the
  budget in `npm run smoke` is what will notice.
- **A rating.** No `aggregateRating` and no reviews are marked up anywhere,
  because the product has no published ratings; inventing them is how a rich
  result turns into a manual action. `src/marketing.test.ts` enforces this.
- **A pricing claim that isn't live.** PRO's rows carry a "not yet live" tag, and
  the price section says in plain words that the server does not exist yet.

## Fonts

Sora and Plus Jakarta Sans, latin subset, copied from the same `@fontsource`
packages the app uses — the SIL Open Font License texts sit next to the files.
Both are self-hosted: no third-party font host, no extra DNS lookup or TLS
handshake on a phone that is paying for data.
