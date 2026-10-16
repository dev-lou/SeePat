#!/usr/bin/env node
/**
 * A static file server, in about eighty lines, with no dependencies.
 *
 * Why not `vite preview` or `npx serve`: this folder has no framework and no
 * toolchain, and the point of the site is that it can be opened from a folder.
 * A dependency here would be the only one in the project, and it would exist to
 * do something Node's own `http` module already does.
 *
 * It is deliberately strict about the handful of things that matter when
 * checking a page before deploying it:
 *
 *  - the content type is served for webp, woff2, xml and txt (a wrong type on a
 *    font silently breaks the page, and a wrong type on the sitemap gets it
 *    rejected by a crawler);
 *  - `/fil` resolves to `fil.html`, the same way Vercel's `cleanUrls` does,
 *    so the local server and the deployed site agree about URLs;
 *  - a missing path returns 404 with `404.html`, not a directory listing;
 *  - path traversal is refused rather than followed.
 *
 * Usage:  node tools/serve.mjs [dir] [port]
 */

import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'

const DIR = resolve(process.argv[2] ?? 'dist')
const PORT = Number(process.argv[3] ?? 4173)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
}

const send = (res, status, file, headers = {}) => {
  res.writeHead(status, {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
    ...headers,
  })
  createReadStream(file).pipe(res)
}

const server = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed')
    return
  }

  const url = new URL(req.url ?? '/', 'http://localhost')
  const decoded = decodeURIComponent(url.pathname)
  // A normalised path that still climbs out of the served directory is an
  // attack, not a route.
  const target = resolve(join(DIR, normalize(decoded)))
  if (target !== DIR && !target.startsWith(DIR + sep)) {
    res.writeHead(403).end('Forbidden')
    return
  }

  const candidates = decoded.endsWith('/')
    ? [join(target, 'index.html')]
    : [target, `${target}.html`, join(target, 'index.html')]

  const file = candidates.find((c) => existsSync(c) && statSync(c).isFile())
  if (file) {
    send(res, 200, file)
    return
  }

  const notFound = join(DIR, '404.html')
  if (existsSync(notFound)) send(res, 404, notFound)
  else res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found')
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`serving ${DIR} at http://localhost:${PORT}/`)
})
