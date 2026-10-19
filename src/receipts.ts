import { useCallback, useEffect, useState } from 'react'

/**
 * Receipt photo vault — IndexedDB, not localStorage.
 *
 * Blobs (JPEG photos) don't belong in localStorage: a dozen 1MB photos blows
 * the 5MB quota and evicts the ledger. IndexedDB holds blobs + draft JSON;
 * the ledger itself stays where it is. Photos are kept permanently so a
 * confirmed purchase stays auditable (and re-parseable when the parser
 * improves). Status machine: draft → confirmed | discarded.
 */

export type ReceiptStatus = 'draft' | 'confirmed' | 'discarded'

export interface ReceiptRecord {
  id: string
  createdAt: string
  photo: Blob
  ocrText: string
  ocrConfidence: number
  ocrEngine: string
  supplierGuess: string
  status: ReceiptStatus
  txnId?: string
}

const DB_NAME = 'seepat.receipts.v1'
const STORE = 'receipts'
const DB_VERSION = 1

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('No IndexedDB on this device.'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed.'))
  })
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const store = t.objectStore(STORE)
        let value: T | undefined
        try {
          const req = run(store)
          req.onsuccess = () => {
            value = req.result
          }
          req.onerror = () => reject(req.error ?? new Error('Receipt store failed.'))
        } catch (error) {
          reject(error)
          return
        }
        t.oncomplete = () => {
          db.close()
          resolve(value as T)
        }
        t.onerror = () => {
          db.close()
          reject(t.error ?? new Error('Receipt store failed.'))
        }
      }),
  )
}

export function newReceiptId(): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `rc-${Date.now().toString(36)}-${rand}`
}

export async function saveReceipt(record: ReceiptRecord): Promise<void> {
  await tx('readwrite', (store) => store.put(record))
}

export async function listReceipts(limit = 20): Promise<ReceiptRecord[]> {
  const all = await tx<ReceiptRecord[]>('readonly', (store) => store.getAll() as IDBRequest<ReceiptRecord[]>)
  return [...(all ?? [])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit)
}

export async function markReceipt(id: string, status: ReceiptStatus, txnId?: string): Promise<void> {
  const rec = await tx<ReceiptRecord | undefined>('readonly', (store) => store.get(id) as IDBRequest<ReceiptRecord | undefined>)
  if (!rec) return
  await tx('readwrite', (store) => store.put({ ...rec, status, txnId: txnId ?? rec.txnId }))
}

/** Recent scans for the “Nai-scan na” strip. Empty (not throwing) when IDB is unavailable, e.g. tests. */
export function useReceipts(refreshKey: number): { receipts: ReceiptRecord[] } {
  const [receipts, setReceipts] = useState<ReceiptRecord[]>([])
  useEffect(() => {
    let live = true
    listReceipts()
      .then((rows) => {
        if (live) setReceipts(rows)
      })
      .catch(() => {
        if (live) setReceipts([])
      })
    return () => {
      live = false
    }
  }, [refreshKey])
  const refresh = useCallback(() => {
    listReceipts()
      .then(setReceipts)
      .catch(() => setReceipts([]))
  }, [])
  void refresh
  return { receipts }
}
