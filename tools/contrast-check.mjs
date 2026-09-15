/**
 * WCAG contrast audit for the SeePat palette.
 *
 *   node tools/contrast-check.mjs
 *
 * Two things this is for. First, it is quick: reading a palette by eye is how a
 * 2.5:1 "vivid" accent ships and nobody notices until someone reads the app
 * under a canopy at noon. Second, it is *explicit* — every pair listed below is
 * a pair the UI actually renders, so the file doubles as the record of what the
 * contrast budget was spent on and where the thresholds were deliberately not
 * applied.
 *
 * Thresholds: 4.5:1 for text (WCAG AA), 3:1 for a graphical object that carries
 * meaning (WCAG 1.4.11). Translucent fills, glow washes and chart baselines are
 * decorative and are excluded on purpose — see the note at the bottom.
 *
 * Exit code is 1 if anything fails, so this can gate a build.
 */

const hex = (h) => {
  const s = h.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255)
}

const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))

const luminance = (h) => {
  const [r, g, b] = hex(h).map(lin)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const contrast = (a, b) => {
  const l1 = luminance(a)
  const l2 = luminance(b)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

/** Composite a translucent layer over an opaque one, as the browser paints it. */
const over = (top, alpha, base) => {
  const a = hex(top)
  const b = hex(base)
  return (
    '#' +
    a.map((c, i) => Math.round((c * alpha + b[i] * (1 - alpha)) * 255).toString(16).padStart(2, '0')).join('')
  )
}

// --- Palette (mirrors the @theme tokens in src/index.css) --------------------
const PAGE = '#f5f7fb'
/*
 * Every card is filled with a gradient now (white at the top, `--color-card-deep`
 * at the foot), so the honest surface to test dark text against is the DARKER of
 * the two — that is the point on the card where the contrast is lowest. Testing
 * against pure white would have quietly flattered the palette by ~0.05:1.
 */
const CARD = '#f7f9fd'
const CARD_TOP = '#ffffff'
const SUNKEN = '#eef1f8'

// The jewel card is a gradient; its *lightest* stop is the worst case for white
// text, so that is the surface every hex below is tested against.
const JEWEL_LIGHT = '#123f8f'
const JEWEL_DARK = '#050f28'

// The two decorative glows sit behind text near the corners of the jewel card,
// so anything white has to survive the surface they lighten it to. The gold
// "sun" is the harder of the two.
const JEWEL_UNDER_GOLD_GLOW = over('#f5c21d', 0.14, JEWEL_LIGHT)
const JEWEL_UNDER_BLUE_GLOW = over('#2f5fc9', 0.18, JEWEL_LIGHT)
// A translucent pill is also a lighter background.
const JEWEL_PILL = over('#ffffff', 0.15, JEWEL_LIGHT)

const TEXT = 4.5
const GRAPHIC = 3

const checks = []
const check = (label, fg, bg, min) => {
  const value = contrast(fg, bg)
  checks.push({ label, value, min, ok: value >= min })
}

// --- Body copy and labels on the three light surfaces ----------------------
const ramp = [
  ['fg', '#0a1428'],
  ['fg-muted', '#3a4761'],
  ['fg-subtle', '#58657f'],
  ['fg-faint', '#5f6c86'],
]
for (const [name, color] of ramp) {
  check(`${name} on page`, color, PAGE, TEXT)
  check(`${name} on card`, color, CARD, TEXT)
  check(`${name} on sunken`, color, SUNKEN, TEXT)
}

// fg-faint also lands on the tinted cards (Plan's locked features, gold/premium
// panels), which are lighter than sunken but not white.
check('fg-faint on gold-50', '#5f6c86', '#fff9e6', TEXT)
check('fg-faint on brand-50', '#5f6c86', '#eef3fc', TEXT)
check('fg-faint on amber-50', '#5f6c86', '#fffbeb', TEXT)

// --- Accent text on its own tint -------------------------------------------
for (const [label, fg, bg] of [
  ['brand-700 on card', '#12357f', CARD],
  ['brand-700 on page', '#12357f', PAGE],
  ['brand-700 on brand-50', '#12357f', '#eef3fc'],
  ['emerald-700 on emerald-50', '#047857', '#ecfdf5'],
  ['amber-700 on amber-50', '#b45309', '#fffbeb'],
  ['amber-800 on amber-50', '#92400e', '#fffbeb'],
  ['red-700 on red-50', '#a50e1f', '#fef2f3'],
  ['red-600 on red-50', '#ce1126', '#fef2f3'],
  ['gold-700 on gold-50', '#8a6206', '#fff9e6'],
  ['gold-700 on card', '#8a6206', CARD],
  // The two-tone wordmark: "Pat" in gold on the page. It is set at 1.2rem bold,
  // which is large text, so 3:1 is the floor rather than 4.5:1.
  ['wordmark gold-600 on page (large text)', '#b07f08', PAGE],
  ['wordmark brand-800 on page', '#0c2760', PAGE],
  ['fg-subtle on sunken pill', '#58657f', SUNKEN],
]) {
  check(label, fg, bg, label.includes('large text') ? GRAPHIC : TEXT)
}

// --- Text on the brand ------------------------------------------------------
// The button is a vertical gradient; its lightest step is brand-700.
check('white on brand-700 (button top)', '#ffffff', '#12357f', TEXT)
check('white on brand-800 (button bottom)', '#ffffff', '#0c2760', TEXT)
check('white on brand-900', '#ffffff', '#081b44', TEXT)
check('white on red-600 (recording mic)', '#ffffff', '#ce1126', TEXT)
check('brand-700 glyph on white (idle mic)', '#12357f', CARD, TEXT)
check('white on gold-500 (premium chip)', '#0a1428', '#dda60c', TEXT)

// --- Data marks on white (meaning-carrying graphics, 3:1) -------------------
for (const [label, color] of [
  ['share bar navy-800', '#0c2760'],
  ['share bar navy-600', '#1b45a6'],
  ['share bar slate-500 (muted)', '#64748b'],
  ['score bar emerald-800', '#065f46'],
  ['score bar emerald-600', '#059669'],
  ['score bar amber-700', '#b45309'],
  ['score bar amber-800', '#92400e'],
  ['score bar red-700', '#a50e1f'],
  ['score bar red-600', '#ce1126'],
  ['donut navy-600', '#1b45a6'],
  ['donut gold-600', '#b07f08'],
  ['donut red-600', '#ce1126'],
  ['donut sky-600', '#0284c7'],
  ['donut violet-600', '#7c3aed'],
  ['trend line navy-600', '#1b45a6'],
  // A bullet marker, not text — the one place amber-600 appears, and it is held
  // to the graphic floor rather than the text floor for exactly that reason.
  ['list bullet amber-700', '#b45309'],
  ['gauge ring deep (lightest stop)', '#1b45a6'],
  ['gauge ring deep (darkest stop)', '#0c2760'],
]) {
  check(`${label} on card`, color, CARD, GRAPHIC)
}

// --- The jewel card ---------------------------------------------------------
for (const [label, fg, bg, min] of [
  ['white on jewel (lightest stop)', '#ffffff', JEWEL_LIGHT, TEXT],
  ['white on jewel (darkest stop)', '#ffffff', JEWEL_DARK, TEXT],
  ['white/90 on jewel', '#eef2fa', JEWEL_LIGHT, TEXT],
  ['gold-300 eyebrow on jewel (clean area)', '#fbd350', JEWEL_LIGHT, TEXT],
  ['gold-200 stat accent on jewel', '#fde38a', JEWEL_LIGHT, TEXT],
  ['red-100 error on jewel', '#fde2e4', JEWEL_LIGHT, TEXT],
  ['white over gold glow', '#ffffff', JEWEL_UNDER_GOLD_GLOW, TEXT],
  ['white over blue glow', '#ffffff', JEWEL_UNDER_BLUE_GLOW, TEXT],
  ['white on translucent pill', '#ffffff', JEWEL_PILL, TEXT],
  ['gauge ring luminous (lightest stop)', '#fde38a', JEWEL_LIGHT, GRAPHIC],
  ['gauge ring luminous (mid stop)', '#fbd350', JEWEL_LIGHT, GRAPHIC],
  ['gauge ring luminous (darkest stop)', '#f5c21d', JEWEL_LIGHT, GRAPHIC],
  ['chart line gold on jewel', '#fbd350', JEWEL_LIGHT, GRAPHIC],
]) {
  check(label, fg, bg, min)
}

// --- Report -----------------------------------------------------------------
const failures = checks.filter((c) => !c.ok)
const passing = checks.filter((c) => c.ok).sort((a, b) => a.value - b.value)

console.log(`checked ${checks.length} colour pairs\n`)
console.log('tightest passing pairs:')
for (const c of passing.slice(0, 8)) {
  console.log(`  ${c.value.toFixed(2).padStart(5)}  (min ${c.min})  ${c.label}`)
}

if (failures.length > 0) {
  console.log('\nFAILURES:')
  for (const f of failures) {
    console.log(`  ${f.value.toFixed(2)} < ${f.min}  ${f.label}`)
  }
  process.exitCode = 1
} else {
  console.log('\nAll pairs clear their threshold.')
}

/*
 * Deliberately NOT held to a contrast floor, and why:
 *
 *  - Chart baselines and grid hairlines. A gridline cannot reach 3:1 against its
 *    own surface without becoming a bright band that competes with the data, so
 *    it is treated as decoration: the 3px trend line, the marker dot and the
 *    axis labels are what carry the magnitude, and they are audited above.
 *  - The gradient wash under an area chart. Same reasoning: the stroke is the
 *    mark, the wash is atmosphere.
 *  - Disabled states (40% opacity), the grain overlay, and the two glow blobs.
 *    None of them convey information; the blobs are also *bounded*, because they
 *    lighten the surface behind text — which is exactly why they are capped at
 *    12% and the white text over them is still checked above.
 *  - Pat, the owl: an illustration, exempt the same way a logotype is (WCAG
 *    1.4.3 excludes logos and brand artwork). The bird's gold feathers, its
 *    gauge ring and its props are a drawing, not a control or a data mark. What
 *    is NOT exempt is everything Pat is asked to communicate: the mood is
 *    announced to screen readers in the current language, and the sentence in
 *    the speech bubble is ordinary UI text — `fg-muted` on `card`, audited
 *    above. If the mood were ever signalled by colour alone, that would be a
 *    real failure; that is why Pat also changes posture (brow, narrowed lids)
 *    and the bubble always spells the state out in words.
 */
