/**
 * localStorage persistence, with a one-time migration for renamed keys.
 *
 * The product was renamed from TimbangAI to SeePat. Renaming a storage key is
 * not free: the ledger, the subscription entitlement, and the record that says a
 * voice model is already installed all live under the previous prefix.
 * Dropping them would hand an owner back an empty store and make them re-download
 * the model — a rebrand should not cost the user anything.
 *
 * So reads fall back to the legacy key once and write forward; writes always go
 * to the new key. Both names are kept side by side here rather than scattered
 * through the stores, so the next rename is a change to the callers only.
 */

export interface StorageKeys {
  key: string
  /** The same slot under the previous product name. */
  legacyKey?: string
}

export function readPersisted({ key, legacyKey }: StorageKeys): string | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const current = localStorage.getItem(key)
    if (current !== null) return current
    if (!legacyKey) return null

    const legacy = localStorage.getItem(legacyKey)
    if (legacy === null) return null

    // Adopt it under the new name so the fallback is walked only once.
    localStorage.setItem(key, legacy)
    return legacy
  } catch {
    return null
  }
}

export function writePersisted({ key }: StorageKeys, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage full or blocked (private mode). The session still works in memory.
  }
}

export function removePersisted({ key, legacyKey }: StorageKeys): void {
  try {
    localStorage.removeItem(key)
    if (legacyKey) localStorage.removeItem(legacyKey)
  } catch {
    // Nothing to remove, or storage is not ours to clear.
  }
}
