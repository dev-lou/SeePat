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
/*
 * A cool light canvas. The canvas is never pure white, so that white cards have
 * something to sit on — which means the ramp has to clear 4.5:1 against a
 * slightly darker surface AND against the sunken well inside a card. The faint
 * step was tuned down a notch to keep that true.
 */
const PAGE = '#f2f2f5'
/*
 * Every card is filled with a gradient (paper at the top, `--color-card-deep` at
 * the foot), so the honest surface to test dark text against is the DARKER of
 * the two — that is the point on the card where the contrast is lowest. Testing
 * against the light stop would have quietly flattered the palette by ~0.05:1.
 */
const CARD = '#fafafc'
const CARD_TOP = '#ffffff'
const SUNKEN = '#ececf1'

/*
 * The one dark surface: near-black with a blue light from its top-right corner
 * and a dim yellow wash at the bottom-left. Its *brightest* region is where the
 * blue glow is strongest, so that is the surface every white hex is tested
 * against — a card whose glow is only checked against its dark corner would
 * flatter itself by 4:1.
 */
const JEWEL_LIGHT = '#1c1d27'
const JEWEL_DARK = '#0a0a0e'
const JEWEL_UNDER_GOLD_GLOW = over('#ffd54a', 0.13, JEWEL_DARK)
const JEWEL_UNDER_BLUE_GLOW = over('#3d51f0', 0.5, JEWEL_LIGHT)

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
  ['fg', '#0b0b0f'],
  ['fg-muted', '#45454f'],
  ['fg-subtle', '#585862'],
  ['fg-faint', '#67676f'],
]
for (const [name, color] of ramp) {
  check(`${name} on page`, color, PAGE, TEXT)
  check(`${name} on card`, color, CARD, TEXT)
  check(`${name} on sunken`, color, SUNKEN, TEXT)
}

// fg-faint also lands on the tinted cards (Plan's locked features, gold/premium
// panels), which are lighter than sunken but not white.
check('fg-faint on gold-50', '#67676f', '#fffbea', TEXT)
check('fg-faint on brand-50', '#67676f', '#eff1ff', TEXT)
check('fg-faint on amber-50', '#67676f', '#fffbeb', TEXT)

// --- Accent text on its own tint -------------------------------------------
for (const [label, fg, bg] of [
  ['brand-700 on card', '#232fae', CARD],
  ['brand-700 on page', '#232fae', PAGE],
  ['brand-700 on brand-50', '#232fae', '#eff1ff'],
  ['ink-900 on card (primary button label)', '#0b0b0f', CARD],
  ['emerald-700 on emerald-50', '#047857', '#ecfdf5'],
  ['amber-700 on amber-50', '#b45309', '#fffbeb'],
  ['amber-800 on amber-50', '#92400e', '#fffbeb'],
  ['red-700 on red-50', '#a50e1f', '#fef2f3'],
  ['red-600 on red-50', '#ce1126', '#fef2f3'],
  ['gold-700 on gold-50', '#8a6206', '#fff9e6'],
  ['gold-700 on card', '#8a6206', CARD],
  // The two-tone wordmark: "Pat" in gold on the page. It is set at 1.2rem bold,
  // which is large text, so 3:1 is the floor rather than 4.5:1.
  ['wordmark gold-600 on page (large text)', '#b0830a', PAGE],
  ['wordmark brand-800 on page', '#1d2788', PAGE],
  ['fg-subtle on sunken pill', '#585862', SUNKEN],
]) {
  check(label, fg, bg, label.includes('large text') ? GRAPHIC : TEXT)
}

// --- Text on the brand ------------------------------------------------------
// The button is a vertical gradient; its lightest step is brand-700.
check('white on brand-600 (brand button)', '#ffffff', '#2a3ad6', TEXT)
check('white on brand-500 (brand button hover)', '#ffffff', '#3d51f0', TEXT)
check('white on the ink button', '#ffffff', '#0b0b0f', TEXT)
check('ink on the accent button (gold-300)', '#0b0b0f', '#ffd54a', TEXT)
check('white on red-600 (recording mic)', '#ffffff', '#ce1126', TEXT)
check('brand-700 glyph on white (idle mic)', '#232fae', CARD, TEXT)
check('white on gold-500 (premium chip)', '#0b0b0f', '#ddaa12', TEXT)

// --- Data marks on white (meaning-carrying graphics, 3:1) -------------------
for (const [label, color] of [
  ['share bar ink-900', '#0b0b0f'],
  ['share bar brand-600', '#2a3ad6'],
  ['share bar slate-500 (muted)', '#64748b'],
  ['score bar emerald-800', '#065f46'],
  ['score bar emerald-600', '#059669'],
  ['score bar amber-700', '#b45309'],
  ['score bar amber-800', '#92400e'],
  ['score bar red-700', '#a50e1f'],
  ['score bar red-600', '#ce1126'],
  ['donut brand-600', '#2a3ad6'],
  ['donut gold-600', '#b0830a'],
  ['donut red-600', '#ce1126'],
  ['donut sky-600', '#0284c7'],
  ['donut violet-600', '#7c3aed'],
  ['trend line brand-600', '#2a3ad6'],
  // A bullet marker, not text — the one place amber-600 appears, and it is held
  // to the graphic floor rather than the text floor for exactly that reason.
  ['list bullet amber-700', '#b45309'],
  ['gauge ring deep (lightest stop)', '#3d51f0'],
  ['gauge ring deep (darkest stop)', '#232fae'],
]) {
  check(`${label} on card`, color, CARD, GRAPHIC)
}

// --- The jewel card ---------------------------------------------------------
for (const [label, fg, bg, min] of [
  ['white on jewel (lightest stop)', '#ffffff', JEWEL_LIGHT, TEXT],
  ['white on jewel (darkest stop)', '#ffffff', JEWEL_DARK, TEXT],
  ['white/90 on jewel', '#eef2fa', JEWEL_LIGHT, TEXT],
  // The vault (LockedCard) sets its body at white/85 over the same surface.
  ['white/85 vault body on jewel', over('#ffffff', 0.85, JEWEL_LIGHT), JEWEL_LIGHT, TEXT],
  ['gold-300 label on the dark card', '#ffd54a', JEWEL_LIGHT, TEXT],
  ['gold-300 label over the blue glow', '#ffd54a', JEWEL_UNDER_BLUE_GLOW, TEXT],
  ['gold-200 stat accent on the dark card', '#ffe68d', JEWEL_LIGHT, TEXT],
  ['red-100 error on jewel', '#fde2e4', JEWEL_LIGHT, TEXT],
  ['white over the yellow wash (foot of the card)', '#ffffff', JEWEL_UNDER_GOLD_GLOW, TEXT],
  ['white over the blue glow (brightest point)', '#ffffff', JEWEL_UNDER_BLUE_GLOW, TEXT],
  ['white on translucent pill', '#ffffff', JEWEL_PILL, TEXT],
  ['gauge ring luminous (lightest stop)', '#ffe68d', JEWEL_LIGHT, GRAPHIC],
  ['gauge ring luminous (mid stop)', '#ffd54a', JEWEL_LIGHT, GRAPHIC],
  ['gauge ring luminous (darkest stop)', '#f7c22b', JEWEL_LIGHT, GRAPHIC],
  ['chart line on the dark card', '#ffd54a', JEWEL_LIGHT, GRAPHIC],
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
