import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * `.env.example` is the file a new machine is set up from, and the one file
 * nothing type-checks. A variable that is read but not documented does not fail
 * a build: it silently reads as empty, and the symptom shows up later as a
 * wrong canonical URL or a video build that cannot find ffmpeg.
 *
 * So the documentation is asserted against the code instead of trusted. The
 * check is one-directional and deliberate: every variable the repo READS must be
 * documented. A documented variable that nothing reads is allowed — that is how
 * an optional override for a tool nobody has run yet stays discoverable.
 *
 * The scan reads paths, not values. There is nothing secret in this repository
 * to leak (no server, no gateway, no AI service), and this test would still pass
 * if there were: it compares names only.
 */

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

/** Where the app and the repo tooling read from, and which example file covers them. */
const AREAS = [
  {
    dirs: ['src', 'tools'],
    files: ['index.html', 'vite.config.ts'],
    example: '.env.example',
  },
  {
    dirs: ['marketing'],
    files: [],
    example: 'marketing/.env.example',
  },
]

/**
 * Names the platform injects, which no developer sets in a file. Listing them
 * here is the point: it is the whole set of variables that may be read without
 * being documented, so anything new that reads one has to be added on purpose.
 */
const PLATFORM = new Set([
  'NODE_ENV',
  'VERCEL',
  'VERCEL_URL',
  'VERCEL_ENV',
  'VERCEL_PROJECT_PRODUCTION_URL',
  'CI',
])

const SKIP_DIRS = new Set(['node_modules', 'dist', 'dev-dist', '.git', '.freebuff', 'assets'])

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path, found)
    else found.push(path)
  }
  return found
}

/** Every `import.meta.env.X` and `process.env.X` name in a file. */
function readsIn(path: string): string[] {
  const text = readFileSync(path, 'utf8')
  const names: string[] = []
  for (const match of text.matchAll(/(?:import\.meta\.env|process\.env)\.([A-Z][A-Z0-9_]*)/g)) {
    names.push(match[1])
  }
  // `process.env['NAME']` is the same read with different punctuation.
  for (const match of text.matchAll(/(?:import\.meta\.env|process\.env)\[['"]([A-Z][A-Z0-9_]*)['"]\]/g)) {
    names.push(match[1])
  }
  return names
}

/** Documented keys, including the ones that are commented out on purpose. */
function documentedKeys(examplePath: string): Set<string> {
  const text = readFileSync(examplePath, 'utf8')
  const keys = new Set<string>()
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*#?\s*([A-Z][A-Z0-9_]*)=/)
    if (match) keys.add(match[1])
  }
  return keys
}

describe('every environment variable is documented', () => {
  for (const area of AREAS) {
    it(`${area.example} covers everything read under ${area.dirs.join(', ')}`, () => {
      const files = [
        ...area.dirs.flatMap((dir) => walk(join(ROOT, dir))),
        ...area.files.map((file) => join(ROOT, file)),
      ].filter((path) => /\.(ts|tsx|mjs|js|html)$/.test(path) && !path.endsWith('.test.ts'))

      expect(files.length, `expected to scan files in ${area.dirs.join(', ')}`).toBeGreaterThan(3)

      const documented = documentedKeys(join(ROOT, area.example))
      const missing = new Set<string>()
      for (const file of files) {
        for (const name of readsIn(file)) {
          if (PLATFORM.has(name)) continue
          if (!documented.has(name)) missing.add(`${name} (read by ${relative(ROOT, file)})`)
        }
      }

      expect([...missing]).toEqual([])
    })
  }

  it('documents the two origins the project actually needs', () => {
    // A specific assertion on top of the general one: these two are the ones a
    // deploy gets wrong, and they are read from two different files.
    expect(documentedKeys(join(ROOT, '.env.example')).has('VITE_SITE_URL')).toBe(true)
    expect(documentedKeys(join(ROOT, 'marketing/.env.example')).has('SITE_URL')).toBe(true)
    expect(documentedKeys(join(ROOT, 'marketing/.env.example')).has('APP_URL')).toBe(true)
  })

  it('keeps every documented variable explained, not just named', () => {
    // Each key needs a comment above it in the same file: a bare list of names
    // is how "VITE_SITE_URL=" ends up empty for a year.
    for (const example of ['.env.example', 'marketing/.env.example']) {
      const lines = readFileSync(join(ROOT, example), 'utf8').split('\n')
      lines.forEach((line, index) => {
        if (!/^\s*#?\s*[A-Z][A-Z0-9_]*=/.test(line)) return
        const above = lines
          .slice(Math.max(0, index - 14), index)
          .join('\n')
        expect(above, `${example}: no explanation above line ${index + 1}`).toMatch(/#\s*\S/)
      })
    }
  })
})
