import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * A record of an installed model is only true for the model the runtime actually
 * loads.
 *
 * This is the failure it guards, and it is not hypothetical: the weights moved
 * from `whisper-tiny` to `whisper-base`, and every phone that had already
 * downloaded the old one held a record saying "installed". The screen would have
 * shown "working offline", the offline engine would have reported itself
 * available — and the first transcription would have needed 76MB of weights the
 * device did not have. Offline, in a sari-sari store, that is the product failing
 * at the exact moment it was bought for.
 */

function stubStorage(seed: Record<string, string>): void {
  const store = new Map(Object.entries(seed))
  ;(
    globalThis as unknown as {
      localStorage?: unknown
    }
  ).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  }
}

afterEach(() => {
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage
  vi.resetModules()
})

/** Fresh module evaluation, because the record is read once at import time. */
async function load() {
  vi.resetModules()
  return import('./asr-offline.ts')
}

describe('an installed record is only trusted for the current model', () => {
  it('ignores a record left by a different model', async () => {
    stubStorage({
      'seepat.voice.model.v1': JSON.stringify({
        key: 'whisper-tiny',
        repo: 'Xenova/whisper-tiny',
        installedAt: '2026-09-15T00:00:00.000Z',
        bytes: 40_000_000,
      }),
    })

    const mod = await load()
    expect(mod.getInstalledVoiceModel()).toBeNull()
  })

  it('accepts the record for the model the runtime loads', async () => {
    const mod = await load()
    const key = mod.WHISPER_MODEL.key

    stubStorage({
      'seepat.voice.model.v1': JSON.stringify({
        key,
        repo: mod.WHISPER_MODEL.repo,
        installedAt: '2026-09-15T00:00:00.000Z',
        bytes: 76_000_000,
      }),
    })

    const reloaded = await load()
    expect(reloaded.getInstalledVoiceModel()?.key).toBe(key)
  })

  it('ignores a record that is not a record at all', async () => {
    stubStorage({ 'seepat.voice.model.v1': '{"nonsense": true}' })
    const mod = await load()
    expect(mod.getInstalledVoiceModel()).toBeNull()
  })

  it('ignores unparseable contents rather than throwing', async () => {
    stubStorage({ 'seepat.voice.model.v1': 'not json at all' })
    const mod = await load()
    expect(mod.getInstalledVoiceModel()).toBeNull()
  })

  it('reports nothing installed when storage is unavailable', async () => {
    const mod = await load()
    expect(mod.getInstalledVoiceModel()).toBeNull()
  })
})
