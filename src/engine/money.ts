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

/**
 * What a price typed into the form means, and how it is stored.
 *
 * `unitPriceCentavos` on a line is the price of ONE BASE UNIT — one piece, or
 * one gram — because that is what the engine multiplies the stored quantity by.
 * A shop does not price in grams: rice is ₱72 a kilo and nobody says "seven and
 * two tenths centavos a gram". So the form asks for the price the owner knows,
 * and these two functions are the only place the two are converted.
 *
 * Getting this wrong is not a rounding error, it is a factor of a thousand: a
 * kilo item whose price was typed as ₱72 and stored as 72 centavos a gram
 * books a ₱144,000 sale for two kilos of rice. That bug was live in this app.
 *
 * The conversion is deliberately lossy in ONE direction only, and the UI shows
 * the result rather than hiding it: the base unit is a whole centavo, so a
 * per-kilo price must be rounded to the nearest 10 centavos of peso. ₱72/kg
 * becomes 7 centavos a gram, which is ₱70.00 a kilo. See `unitPriceDrifts`.
 */
const GRAMS_PER_KILO = 1000

export function pricePerBaseUnit(
  baseUnit: string,
  perDisplayUnitCentavos: Centavos,
): Centavos {
  return baseUnit === 'g'
    ? Math.round(perDisplayUnitCentavos / GRAMS_PER_KILO)
    : perDisplayUnitCentavos
}

export function pricePerDisplayUnit(baseUnit: string, perBaseUnitCentavos: Centavos): Centavos {
  return baseUnit === 'g' ? perBaseUnitCentavos * GRAMS_PER_KILO : perBaseUnitCentavos
}

/**
 * The inverse of `pricePerBaseUnit`, for quantities.
 *
 * Quantities live in the base unit — rice in grams — and are *read* in the unit
 * the owner typed, which is kilos. Any screen that shows a stored quantity
 * without this prints "52406 sold" next to one kilo of rice: a correct figure
 * that reads as a broken one, and the kind of number an owner stops trusting the
 * whole screen over.
 */
export function qtyPerDisplayUnit(baseUnit: string, baseQty: number): number {
  return baseUnit === 'g' ? baseQty / GRAMS_PER_KILO : baseQty
}

/**
 * True when a per-kilo price cannot be stored exactly.
 *
 * The UI uses this to say what will actually be recorded instead of quietly
 * charging a price the owner never typed — every other number in this app is
 * confirmed before it is saved, and a price is not the exception.
 */
export function unitPriceDrifts(
  baseUnit: string,
  perDisplayUnitCentavos: Centavos,
): boolean {
  if (baseUnit !== 'g') return false
  return pricePerDisplayUnit(baseUnit, pricePerBaseUnit(baseUnit, perDisplayUnitCentavos)) !== perDisplayUnitCentavos
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
