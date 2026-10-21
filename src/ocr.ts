/**
 * OCR abstraction — one interface, two engines, honest offline behavior.
 *
 * - `mock` always works: returns canned text for the sample receipt. This is
 *   what the review UI is built and demoed against, so the human-in-the-loop
 *   ships before any model weight does.
 * - `tesseract` lazily loads `tesseract.js` (dynamic import, never bundled
 *   into the first paint). Weights + WASM must be cached while online first;
 *   with no signal and no cache it fails with a message the owner can act on.
 *
 * Browser PWAs cannot call ML Kit / Gemini Nano directly (Android-native
 * APIs) and Cloud Vision needs connectivity + a backend proxy — so neither is
 * a path here. If a cloud retry is ever added, it lives behind this same
 * interface as an explicit opt-in, never the default.
 */

export type OcrEngineId = 'mock' | 'tesseract'
export type OcrStatus = 'idle' | 'loading' | 'ready' | 'working' | 'error'

export interface OcrResult {
  text: string
  /** Mean confidence 0..1 when the engine reports one; mock reports 0.9. */
  confidence: number
  engine: OcrEngineId
}

let tesseractWorker: { recognize: (img: string | File | Blob) => Promise<{ data: { text: string; confidence: number } }> } | null = null
let tesseractLoading: Promise<unknown> | null = null

async function loadTesseract(): Promise<NonNullable<typeof tesseractWorker>> {
  if (tesseractWorker) return tesseractWorker
  if (!tesseractLoading) {
    tesseractLoading = (async () => {
      // Dynamic import keeps ~1MB of WASM glue out of the initial bundle.
      // Installed as a real dependency so it works offline via the app shell
      // precache + browser HTTP cache — never a CDN fetch at scan time.
      const mod = await import('tesseract.js')
      const worker = await mod.createWorker('eng')
      tesseractWorker = worker as unknown as NonNullable<typeof tesseractWorker>
    })()
  }
  await tesseractLoading
  if (!tesseractWorker) throw new Error('OCR engine did not start.')
  return tesseractWorker
}

/** True once the Tesseract worker (WASM + English weights) is loaded and cached. */
export function isOcrReady(): boolean {
  return tesseractWorker !== null
}

/**
 * Warm the real OCR engine in the background: download WASM + weights while
 * online so the first *real* scan doesn't pay the cost in front of the owner.
 * Swallows failures (offline on first open just stays unready) — the scan
 * path reports the actionable error instead. Returns true when ready.
 */
export async function warmOcrEngine(): Promise<boolean> {
  try {
    await loadTesseract()
    return true
  } catch {
    return false
  }
}

/** Canned text for “Subukan ang sample” — identical shape to a real scan. */
export const MOCK_RECEIPT_TEXT = [
  'PUREGOLD DINGLE',
  'LUCKY ME PANCIT 2 x 12.00 24.00',
  'COKE MISMO 3 @ 15.00 45.00',
  'TOTAL 69.00',
].join('\n')

/**
 * Pixel contrast for OCR: spreads mid-tones so faint thermal print separates
 * from the paper. Pure, so the curve is unit-tested rather than eyeballed.
 */
export function contrastStretch(value: number): number {
  const stretched = (value - 128) * 1.4 + 128
  if (stretched <= 0) return 0
  if (stretched >= 255) return 255
  return Math.round(stretched)
}

/**
 * Straighten the photo for the reader before Tesseract ever sees it.
 *
 * Two real-world problems, both fixed here rather than in the engine: thermal
 * text is small (images narrower than ~1800px are upscaled, capped at 2.5× to
 * bound memory on a cheap phone), and color carries no information on a
 * receipt — glare and warm store light tint the paper without changing a
 * single letter, so the photo is grayscaled with contrast. Returns the input
 * untouched outside a DOM (tests) or on any failure: an unprocessed photo
 * still reads, just worse.
 */
export async function preprocessForOcr(image: Blob): Promise<Blob> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return image
  try {
    const bitmap = await createImageBitmap(image)
    const scale = Math.min(2.5, Math.max(1, 1800 / bitmap.width))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) {
      bitmap.close?.()
      return image
    }
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close?.()
    const data = ctx.getImageData(0, 0, width, height)
    const px = data.data
    for (let i = 0; i + 2 < px.length; i += 4) {
      const gray = contrastStretch(0.299 * (px[i] ?? 0) + 0.587 * (px[i + 1] ?? 0) + 0.114 * (px[i + 2] ?? 0))
      px[i] = gray
      px[i + 1] = gray
      px[i + 2] = gray
    }
    ctx.putImageData(data, 0, 0)
    const out: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
    return out ?? image
  } catch {
    return image
  }
}

export async function runOcr(image: Blob | string, engine: OcrEngineId): Promise<OcrResult> {
  if (engine === 'mock') {
    await new Promise((r) => setTimeout(r, 350))
    return { text: MOCK_RECEIPT_TEXT, confidence: 0.9, engine }
  }
  try {
    const worker = await loadTesseract()
    const photo = typeof image === 'string' ? image : await preprocessForOcr(image)
    const { data } = await worker.recognize(photo as Blob)
    return { text: data.text?.trim() ?? '', confidence: (data.confidence ?? 50) / 100, engine }
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error)
    if (/failed to fetch|network|cdn|import/i.test(raw)) {
      throw new Error(
        'Hindi ma-download ang OCR engine — kailangan ng internet sa unang gamit. Naka-save na ito pagkatapos.',
      )
    }
    throw error instanceof Error ? error : new Error(String(error))
  }
}

/**
 * Downscale a camera photo before OCR/storage. A 12MP photo is ~4MB and
 * stalls both Tesseract and IndexedDB on a cheap phone; 2000px on the long
 * edge keeps thermal text legible while cutting memory ~4×.
 */
export async function downscaleImage(file: Blob, maxEdge = 2000, quality = 0.82): Promise<Blob> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    if (scale >= 1) {
      bitmap.close?.()
      return file
    }
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close?.()
      return file
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    const out: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    return out ?? file
  } catch {
    return file
  }
}

export function explainOcrError(error: unknown, lang: 'en' | 'fil' = 'fil'): string {
  const raw = error instanceof Error ? error.message : String(error)
  if (raw.startsWith('Hindi')) {
    return lang === 'en'
      ? 'The OCR engine could not be downloaded — internet is needed the first time. It is saved after that.'
      : raw
  }
  const short = raw.slice(0, 140)
  return lang === 'en'
    ? `Could not read the receipt: ${short} — try retaking it more clearly.`
    : `Hindi nabasa ang resibo: ${short} — subukang kuhanan muli nang mas malinaw, o i-type na lang.`
}
