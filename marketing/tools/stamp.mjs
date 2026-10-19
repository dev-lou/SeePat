#!/usr/bin/env node
/**
 * The whole build: copy the site into `dist/`, substituting the values that
 * cannot be known when the file is written.
 *
 * WHY THIS EXISTS. A canonical tag, an hreflang alternate, an `og:url` and
 * every line of a sitemap must be absolute — a relative one is either ignored or
 * resolved against whatever host happens to be serving the copy. But the source
 * files are read from a folder that does not know where it will live, and the
 * answer differs for localhost, a Vercel preview and the custom domain. So the
 * source carries tokens, and this step is the only thing that knows the origin.
 *
 * It is deliberately not a bundler: no dependency, one pass, source in, `dist/`
 * out, and the output is inspectable by hand at any time (`npm run serve`).
 *
 * TOKENS
 *   %SITE_URL%                  this site's origin, no trailing slash  *   %APP_URL%                   reserved: where the app will live if it ever has a URL (defaults to SITE_URL). Currently unused — the app ships as an APK, so no page links here.
 *   %CONTACT_EMAIL%             contact address (see the optional block below)
 *   %GOOGLE_SITE_VERIFICATION%  Search Console token
 *   %YEAR%                      current year, for the copyright line
 *
 * OPTIONAL BLOCKS
 *   <!--if:CONTACT_EMAIL--> … <!--endif-->
 * Everything between the markers — including the markers — is removed when that
 * variable is empty, so the footer can honestly omit a line rather than print an
 * empty label. When the variable has a value, only the markers are dropped.
 *
 * WHY IT REFUSES TO GUESS. On Vercel it resolves the origin from the project's
 * own production URL, because a build that guessed wrong would deploy canonical
 * tags pointing at somebody else's domain — the failure mode is invisible from
 * the site itself and shows up weeks later in Search Console. Locally it falls
 * back to localhost with a warning, which is correct for a local page and
 * impossible to deploy by accident.
 *
 * Usage:  npm run build            (reads .env, then the process environment)
 *         node tools/stamp.mjs --out dist
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import process from 'node:process'

const ROOT = resolve(import.meta.dirname, '..')
const argOut = process.argv.indexOf('--out')
const OUT = resolve(ROOT, argOut > -1 ? process.argv[argOut + 1] : 'dist')

/** Text files that carry tokens. Everything else is copied byte for byte. */
const STAMPED = new Set(['.html', '.xml', '.txt'])
/** Directories that are never part of the deploy. */
const SKIP = new Set(['dist', 'node_modules', 'tools'])
/**
 * Files that describe the project rather than being part of the page. Vercel
 * reads `vercel.json` and `package.json` from the project root, so copying them
 * into the output would only publish a build recipe. The font licences are
 * deliberately NOT here: a licence belongs beside the thing it licenses, and
 * they ship with the woff2 files.
 */
const NOT_CONTENT = /[\\/](\.gitignore|\.env(\..*)?|package\.json|vercel\.json|package-lock\.json)$|\.md$/i

/**
 * A dotenv reader, because Node has none and the alternative is a dependency.
 * Only the shape this project uses: `KEY=value`, `#` comments, optional quotes.
 * `.env` is loaded when present; the process environment always wins, which is
 * what makes Vercel's variables authoritative in a Vercel build.
 */
function readEnvFile(file) {
  if (!existsSync(file)) return {}
  const out = {}
  for (const rawLine of readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

const fromFiles = readEnvFile(join(ROOT, '.env'))
const env = (name) => (process.env[name] ?? '').trim() || (fromFiles[name] ?? '').trim()

const stripTrailingSlash = (url) => url.replace(/\/+$/, '')

function resolveSiteUrl() {
  const explicit = env('SITE_URL')
  if (explicit) return { url: stripTrailingSlash(explicit), source: 'SITE_URL' }

  // Set by Vercel for every deployment; the production one is the domain the
  // page is indexed under.
  const vercel = env('VERCEL_PROJECT_PRODUCTION_URL') || env('VERCEL_URL')
  if (vercel) return { url: `https://${stripTrailingSlash(vercel.replace(/^https?:\/\//, ''))}`, source: 'Vercel' }

  if (env('VERCEL')) {
    console.error(
      'stamp: this is a Vercel build but no origin could be resolved.\n' +
        'Set SITE_URL (or deploy once so VERCEL_PROJECT_PRODUCTION_URL exists) —\n' +
        'a canonical tag pointing at localhost would be indexed as the real page.',
    )
    process.exit(1)
  }

  console.warn(
    'stamp: SITE_URL is not set — using http://localhost:4173 for the canonical\n' +
      '       and hreflang URLs. That is right for a local page and wrong for a\n' +
      '       deployed one: set SITE_URL before you publish.',
  )
  return { url: 'http://localhost:4173', source: 'localhost fallback' }
}

const { url: site, source } = resolveSiteUrl()
const app = stripTrailingSlash(env('APP_URL')) || site
const email = env('CONTACT_EMAIL')

const VALUES = {
  SITE_URL: site,
  APP_URL: app,
  CONTACT_EMAIL: email,
  GOOGLE_SITE_VERIFICATION: env('GOOGLE_SITE_VERIFICATION'),
  YEAR: String(new Date().getFullYear()),
}

/** Drop optional blocks whose variable is empty; unwrap the rest. */
function applyOptionalBlocks(text) {
  return text.replace(
    /[ \t]*<!--if:([A-Z_]+)-->([\s\S]*?)<!--endif-->[ \t]*\n?/g,
    (match, name, body) => {
      if (!(name in VALUES)) throw new Error(`unknown optional block: ${name}`)
      return VALUES[name] === '' ? '' : body
    },
  )
}

function stamp(text, file) {
  let out = applyOptionalBlocks(text)
  out = out.replace(/%([A-Z_]+)%/g, (match, name) => {
    if (!(name in VALUES)) throw new Error(`${relative(ROOT, file)}: unknown token ${match}`)
    return VALUES[name]
  })
  if (/%(SITE_URL|APP_URL|CONTACT_EMAIL|YEAR)%/.test(out)) {
    throw new Error(`${relative(ROOT, file)}: a token survived substitution`)
  }
  return out
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path, files)
    else files.push(path)
  }
  return files
}

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

let stamped = 0
let copied = 0
for (const file of walk(ROOT)) {
  if (NOT_CONTENT.test(file)) continue
  const target = join(OUT, relative(ROOT, file))
  mkdirSync(dirname(target), { recursive: true })
  if (STAMPED.has(extname(file))) {
    writeFileSync(target, stamp(readFileSync(file, 'utf8'), file))
    stamped += 1
  } else {
    cpSync(file, target)
    copied += 1
  }
}

console.log(
  `stamped ${stamped} file${stamped === 1 ? '' : 's'} into ${relative(ROOT, OUT)} ` +
    `(+${copied} copied)\n  site: ${site}  (from ${source})\n  app:  ${app}\n  contact: ${email || '— not set'}`,
)
