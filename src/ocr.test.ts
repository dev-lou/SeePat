import { describe, expect, it } from 'vitest'
import { contrastStretch, preprocessForOcr } from './ocr.ts'

describe('contrastStretch', () => {
  it('leaves mid-grey alone and clamps the ends', () => {
    expect(contrastStretch(128)).toBe(128)
    expect(contrastStretch(0)).toBe(0)
    expect(contrastStretch(255)).toBe(255)
  })

  it('darkens darks and brightens brights', () => {
    // (100 - 128) * 1.4 + 128 ≈ 89 — faint print separates from the paper.
    expect(contrastStretch(100)).toBeLessThan(100)
    // (156 - 128) * 1.4 + 128 ≈ 167.
    expect(contrastStretch(156)).toBeGreaterThan(156)
  })
})

describe('preprocessForOcr', () => {
  it('returns the photo untouched where there is no DOM to process with', async () => {
    const blob = new Blob(['x'], { type: 'image/jpeg' })
    await expect(preprocessForOcr(blob)).resolves.toBe(blob)
  })
})
