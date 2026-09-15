/**
 * Money is stored as integer centavos (₱1 = 100 centavos) everywhere.
 * Floating-point pesos are never persisted or accumulated — this is what allows
 * the Business Twin's accounting identities to hold exactly rather than
 * approximately.
 */
export type Centavos = number

export function pesos(amount: number): Centavos {
  return Math.round(amount * 100)
}

export function toPesos(c: Centavos): number {
  return c / 100
}

const phpFormatter = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatPHP(c: Centavos): string {
  return phpFormatter.format(c / 100)
}

/** Rough peso formatter for headline numbers — ₱1.2K, ₱13.7K, ₱1.5M. */
export function formatPHPShort(c: Centavos): string {
  const p = c / 100
  const abs = Math.abs(p)
  const sign = p < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}₱${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${sign}₱${(abs / 1_000).toFixed(1)}K`
  return `${sign}₱${abs.toFixed(0)}`
}

export function formatPercent(ratio: number, digits = 1): string {
  if (!Number.isFinite(ratio)) return '—'
  return `${(ratio * 100).toFixed(digits)}%`
}

export function clamp(n: number, min = 0, max = 100): number {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

/** Division that yields 0 instead of Infinity/NaN. */
export function safeDiv(numerator: number, denominator: number): number {
  if (denominator === 0 || !Number.isFinite(denominator)) return 0
  return numerator / denominator
}

/** Linear map from a value onto a 0–100 score, clamped at both ends. */
export function scaleScore(value: number, atZero: number, atHundred: number): number {
  if (atHundred === atZero) return 0
  const t = (value - atZero) / (atHundred - atZero)
  return clamp(t * 100)
}
