#!/usr/bin/env node
/**
 * Check the built site, with no test runner and no dependencies.
 *
 * This folder can be copied out of the repository on its own — that is the point
 * of it being standalone — so it cannot rely on the app's Vitest suite to tell
 * it whether a deploy is sound. `src/marketing.test.ts` in the app covers the
 * same ground in more detail; this is the version that travels with the site,
 * and the one to run before a deploy when only this folder is present.
 *
 * Run `npm run build` first: this checks `dist/`, because that is what gets
 * deployed and the only place the substituted URLs exist.
 *
 * Usage:  npm run smoke
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import process from 'node:process'

const DIR = resolve(import.meta.dirname, '..', 'dist')

const TEXT = new Set(['.html', '.xml', '.txt', '.css'])
const PAGES = ['index.html', 'fil.html', '404.html']

const failures = []
const notes = []
const fail = (message) => failures.push(message)

function walk(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path, found)
    else found.push(path)
  }
  return found
}

if (!existsSync(DIR)) {
  console.error('smoke: no dist/ — run `npm run build` first')
  process.exit(1)
}

const files = walk(DIR)

/* ── 1. Nothing left to substitute ─────────────────────────────────────────── */
for (const file of files.filter((f) => TEXT.has(extname(f)))) {
  const text = readFileSync(file, 'utf8')
  for (const match of text.matchAll(/%[A-Z_]{3,}%/g)) {
    fail(`${relative(DIR, file)}: unsubstituted token ${match[0]}`)
  }
}

/* ── 2. Every local reference lands on a file that exists ──────────────────── */
const resolveUrlPath = (urlPath) => {
  const clean = urlPath.split('#')[0].split('?')[0]
  if (clean === '/') return join(DIR, 'index.html')
  const direct = join(DIR, clean)
  for (const candidate of [direct, `${direct}.html`, join(direct, 'index.html')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

for (const page of PAGES) {
  const html = readFileSync(join(DIR, page), 'utf8')
  const refs = [...html.matchAll(/(?:src|href)="(\/[^"]*)"/g)].map((match) => match[1])
  for (const ref of refs) {
    if (resolveUrlPath(ref) === null) fail(`${page}: ${ref} does not exist in dist/`)
  }

  if (/<script\s+src=/i.test(html)) fail(`${page}: an external script was added`)
  if (/\son(click|load|error|submit)=/i.test(html)) fail(`${page}: an inline handler was added`)
}

/* ── 3. The head, as a crawler would read it ───────────────────────────────── */
const absolute = (url) => /^https?:\/\/[^/]+/.test(url)

const readMeta = (page) => {
  const html = readFileSync(join(DIR, page), 'utf8')
  const canonical = html.match(/rel="canonical" href="([^"]+)"/)?.[1] ?? null
  const alternates = [
    ...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g),
  ].map((match) => [match[1], match[2]])
  const title = html.match(/<title>([^<]+)<\/title>/)?.[1] ?? null
  const description =
    html.match(/name="description"\s+content="([^"]+)"/)?.[1] ??
    html.match(/name="description" content="([^"]+)"/)?.[1] ??
    null
  return { html, canonical, alternates, title, description }
}

const en = readMeta('index.html')
const fil = readMeta('fil.html')

for (const [page, meta] of [
  ['index.html', en],
  ['fil.html', fil],
]) {
  if (!meta.title) fail(`${page}: no <title>`)
  if (!meta.description) fail(`${page}: no meta description`)
  else if (meta.description.length > 175) {
    fail(`${page}: description is ${meta.description.length} characters, search shows about 155`)
  }
  if (!meta.canonical) fail(`${page}: no canonical`)
  else if (!absolute(meta.canonical)) fail(`${page}: canonical is not absolute: ${meta.canonical}`)

  if (meta.alternates.length !== 3) {
    fail(`${page}: expected three hreflang alternates, found ${meta.alternates.length}`)
  }
  for (const [code, url] of meta.alternates) {
    if (!absolute(url)) fail(`${page}: hreflang ${code} is not absolute: ${url}`)
  }

  // The marked-up FAQ has to be on the page. A JSON-LD answer nobody can read is
  // a structured-data violation, not a shortcut.
  const script = meta.html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
  if (!script) {
    fail(`${page}: no JSON-LD`)
    continue
  }
  let data
  try {
    data = JSON.parse(script[1])
  } catch (error) {
    fail(`${page}: JSON-LD does not parse — ${error.message}`)
    continue
  }

  const types = (data['@graph'] ?? []).map((node) => node['@type'])
  for (const wanted of ['Organization', 'WebApplication', 'FAQPage']) {
    if (!types.includes(wanted)) fail(`${page}: JSON-LD is missing ${wanted}`)
  }

  const visible = meta.html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')

  const faq = data['@graph']?.find((node) => node['@type'] === 'FAQPage')
  for (const entry of faq?.mainEntity ?? []) {
    if (!visible.includes(entry.acceptedAnswer.text.slice(0, 40))) {
      fail(`${page}: FAQ answer is marked up but not on the page: ${entry.name}`)
    }
  }
}

/* ── 4. The pair agrees about its own URLs ─────────────────────────────────── */
if (en.canonical && fil.canonical) {
  const root = en.canonical.replace(/\/$/, '')
  if (fil.canonical !== `${root}/fil`) {
    fail(`fil.html canonical should be ${root}/fil, found ${fil.canonical}`)
  }
  const enTl = en.alternates.find(([code]) => code === 'tl-PH')?.[1]
  if (enTl !== fil.canonical) {
    fail(`index.html points tl-PH at ${enTl}, but fil.html canonicalises to ${fil.canonical}`)
  }
  const filEn = fil.alternates.find(([code]) => code === 'en-PH')?.[1]
  if (filEn !== en.canonical) {
    fail(`fil.html points en-PH at ${filEn}, but index.html canonicalises to ${en.canonical}`)
  }
}

/* ── 5. robots and the sitemap ─────────────────────────────────────────────── */
const robots = readFileSync(join(DIR, 'robots.txt'), 'utf8')
const sitemapUrl = robots.match(/^Sitemap:\s*(\S+)$/m)?.[1]
if (!sitemapUrl) fail('robots.txt has no Sitemap line')
else if (!absolute(sitemapUrl)) fail(`robots.txt sitemap is not absolute: ${sitemapUrl}`)
if (/^Disallow: \/\s*$/m.test(robots)) fail('robots.txt blocks the whole site')

const sitemap = readFileSync(join(DIR, 'sitemap.xml'), 'utf8')
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])
if (locs.length !== 2) fail(`sitemap.xml lists ${locs.length} URLs, expected 2`)
if (en.canonical && !locs.includes(en.canonical)) fail('sitemap.xml does not list the English page')
if (fil.canonical && !locs.includes(fil.canonical)) fail('sitemap.xml does not list the Filipino page')
if (sitemapUrl && absolute(sitemapUrl)) {
  const declared = sitemapUrl.replace(/\/sitemap\.xml$/, '')
  if (en.canonical && !en.canonical.startsWith(declared)) {
    fail(`robots.txt points at ${sitemapUrl}, which is not under ${en.canonical}`)
  }
}

/* ── 6. What it costs to open ──────────────────────────────────────────────── */
const sizeOf = (relPath) => {
  const path = join(DIR, relPath)
  return existsSync(path) ? statSync(path).size : 0
}
const bytes = files.reduce((total, file) => total + statSync(file).size, 0)
const html = PAGES.reduce((total, page) => total + sizeOf(page), 0)
const css = sizeOf('assets/site.css')
const fonts = files
  .filter((file) => file.endsWith('.woff2'))
  .reduce((total, file) => total + statSync(file).size, 0)
const shots = files
  .filter((file) => file.includes(join('assets', 'shots')))
  .reduce((total, file) => total + statSync(file).size, 0)

const kb = (value) => `${(value / 1024).toFixed(0)} KB`
notes.push(`html ${kb(html)} · css ${kb(css)} · fonts ${kb(fonts)} · screenshots ${kb(shots)} · deploy ${kb(bytes)}`)

for (const file of files.filter((f) => f.includes(join('assets', 'shots')))) {
  const size = statSync(file).size
  if (size > 200 * 1024) notes.push(`${relative(DIR, file)} is ${kb(size)} — over the 200 KB shot budget`)
}
if (html > 120 * 1024) notes.push(`the three pages total ${kb(html)} — over the 120 KB budget`)

/* ── Report ────────────────────────────────────────────────────────────────── */
for (const note of notes) console.log(`· ${note}`)

if (failures.length) {
  console.error(`\nsmoke: ${failures.length} problem${failures.length === 1 ? '' : 's'}`)
  for (const failure of failures) console.error(`  ✗ ${failure}`)
  process.exit(1)
}

console.log(`\nsmoke: ${files.length} files, all checks passed`)
