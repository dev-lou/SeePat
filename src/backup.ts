import type { Ledger } from './engine/index.ts'

/**
 * Backup and restore: the pilot's safety story and PRO's load-bearing feature.
 *
 * Today this is an encrypted-capable JSON envelope on the device (export a
 * file, import it back) — "never lose your records" for free. Sync across
 * phones (the paid half) comes when a server exists, and it will speak this
 * same envelope, so backups taken now restore into that future.
 */

export const BACKUP_VERSION = 1

export interface BackupEnvelope {
  app: 'seepat'
  version: number
  exportedAt: string
  ledger: Ledger
}

function isLedger(value: unknown): value is Ledger {
  if (typeof value !== 'object' || value === null) return false
  const c = value as Record<string, unknown>
  return (
    Array.isArray(c.transactions) &&
    Array.isArray(c.skus) &&
    Array.isArray(c.customers) &&
    Array.isArray(c.voids)
  )
}

/** Serialize the ledger into a versioned, self-describing backup string. */
export function exportLedger(ledger: Ledger, at: string = new Date().toISOString()): string {
  const envelope: BackupEnvelope = { app: 'seepat', version: BACKUP_VERSION, exportedAt: at, ledger }
  return JSON.stringify(envelope)
}

/** Parse a backup string back into a ledger. Throws a bilingual-safe Error on bad input. */
export function importLedger(raw: string): { ledger: Ledger; exportedAt: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('backup.invalid')
  }
  if (typeof parsed !== 'object' || parsed === null) throw new Error('backup.invalid')
  const env = parsed as Partial<BackupEnvelope>
  if (env.app !== 'seepat' || typeof env.version !== 'number' || !env.ledger) {
    throw new Error('backup.invalid')
  }
  if (env.version > BACKUP_VERSION) throw new Error('backup.tooNew')
  if (!isLedger(env.ledger)) throw new Error('backup.invalid')
  return { ledger: env.ledger, exportedAt: typeof env.exportedAt === 'string' ? env.exportedAt : '' }
}
