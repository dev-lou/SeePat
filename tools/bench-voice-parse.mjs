/**
 * How accurate is a spoken Taglish sale, measured rather than asserted.
 *
 * The PSC XI screening committee named exactly one technical risk: *"converting
 * Taglish speech into accurate transactions remains the main technical
 * challenge."* The concept note answers that risk with an architecture —
 * constrained vocabulary, numbers never auto-post, drafts confirmed by the owner
 * — but a design is not a measurement, and this is the measurement.
 *
 * **What this measures.** The step from *transcript* to *transaction*: given the
 * words a recogniser would hand us, does the parser produce the sale the owner
 * meant? That step is fully deterministic and needs no audio, so it can be run
 * in a loop over a fixed phrase set on any machine, in CI, forever.
 *
 * **What this does not measure.** The acoustic step — how often the browser or
 * the on-device model hears "dalawang" correctly in a noisy tindahan. That needs
 * recorded audio from real stores, and the harness for it is `tools/bench-asr.mjs`
 * with the phrase list here as its script. Stating which half is measured is the
 * point; the note must not claim the second half from the first.
 *
 * Run with:  node --experimental-strip-types tools/bench-voice-parse.mjs
 * Writes:    voice-accuracy-results.csv  (one row per phrase, for the deck)
 */

import { writeFileSync } from 'node:fs'
import { seedLedger } from '../src/engine/demo.ts'
import { parseSpoken } from '../src/engine/voice.ts'

const NOW = new Date(2026, 8, 20, 18, 0, 0)
const ledger = seedLedger(NOW)

/**
 * The phrase set.
 *
 * Written as owners actually speak — code-switched mid-sentence, with the number
 * before or after the item, with English words mixed in — because a parser that
 * only handles textbook Filipino is not a parser for this market. Every phrase
 * here was heard or adapted from how a sari-sari owner talks about a sale.
 *
 * `qty` is the quantity in the engine's own unit: pieces, and **grams** for
 * anything weighed (rice is stored in grams and sold by the kilo).
 */
const PHRASES = [
  // --- the ordinary sale, in the shapes it is actually said -----------------
  { phrase: 'nakabenta ako ng dalawang coke', kind: 'cash_sale', items: [['coke', 2]] },
  { phrase: 'benta ng tatlong skyflakes', kind: 'cash_sale', items: [['skyflakes', 3]] },
  { phrase: 'sold five kopiko', kind: 'cash_sale', items: [['kopiko', 5]] },
  { phrase: 'nakabenta ako ng sampung itlog', kind: 'cash_sale', items: [['itlog', 10]] },
  { phrase: 'nagbenta ako ng apat na sardinas', kind: 'cash_sale', items: [['sardinas', 4]] },
  { phrase: 'sipat, nakabenta ako ng anim na lucky me', kind: 'cash_sale', items: [['lucky', 6]] },
  { phrase: 'benta ng isang tinapay', kind: 'cash_sale', items: [['tinapay', 1]] },
  { phrase: 'nakabenta ako ng pitong shampoo sachet', kind: 'cash_sale', items: [['shampoo', 7]] },

  // --- two items in one breath ----------------------------------------------
  { phrase: 'nakabenta ako ng dalawang coke at tatlong skyflakes', kind: 'cash_sale', items: [['coke', 2], ['skyflakes', 3]] },
  { phrase: 'benta ng apat na itlog at dalawang mantika', kind: 'cash_sale', items: [['itlog', 4], ['mantika', 2]] },
  { phrase: 'sold three kopiko and one tinapay', kind: 'cash_sale', items: [['kopiko', 3], ['tinapay', 1]] },

  // --- rice by weight: the case where a wrong unit multiplies by 1000 -------
  { phrase: 'nakabenta ako ng dalawang kilo bigas', kind: 'cash_sale', items: [['bigas', 2000]] },
  { phrase: 'benta ng isang kilo bigas', kind: 'cash_sale', items: [['bigas', 1000]] },
  { phrase: 'bigas, kalahating kilo', kind: 'cash_sale', items: [['bigas', 500]] },
  { phrase: 'nakabenta ako ng tatlong kilo rice', kind: 'cash_sale', items: [['bigas', 3000]] },

  // --- utang: a sale on credit, which is still a sale ------------------------
  { phrase: 'umutang si nena ng dalawang lucky me', kind: 'credit_sale', items: [['lucky', 2]], customer: 'aling_nena' },
  { phrase: 'utang ni tonyo apat na sardinas', kind: 'credit_sale', items: [['sardinas', 4]], customer: 'mang_tonyo' },
  { phrase: 'nakautang si ben ng isang kilo bigas', kind: 'credit_sale', items: [['bigas', 1000]], customer: 'kuya_ben' },
  { phrase: 'umutang si rosa ng tatlong itlog', kind: 'credit_sale', items: [['itlog', 3]], customer: 'ate_rosa' },

  // --- buying stock, not selling it ------------------------------------------
  { phrase: 'bumili ako ng sampung skyflakes', kind: 'purchase', items: [['skyflakes', 10]] },
  { phrase: 'nagrestock ako ng dalawampung itlog', kind: 'purchase', items: [['itlog', 20]] },
  { phrase: 'order ng limang kilo bigas', kind: 'purchase', items: [['bigas', 5000]] },

  // --- an expense with no item in it, which must not invent a line -----------
  { phrase: 'gastos ko sa kuryente ngayon', kind: 'expense', items: [] },

  // --- the hard ones, kept in the set on purpose -----------------------------
  { phrase: 'nakabenta ako ng coke', kind: 'cash_sale', items: [['coke', 1]] },
  { phrase: 'benta ng dalawang itlog at isang kilo bigas at tatlong coke', kind: 'cash_sale', items: [['itlog', 2], ['bigas', 1000], ['coke', 3]] },
  { phrase: 'nakabenta ako ng bente pesos na bigas', kind: 'cash_sale', items: [['bigas', null]] },

  // --- the edges, added after the first run scored 26/26 ---------------------
  //
  // A set the parser was built against will always score well, and a bench that
  // reports 100% is worth exactly nothing. These are the shapes most likely to
  // break it: a quantity that must NOT be borrowed across a conjunction, digits
  // instead of words, an item named by a multi-word alias, and the item-before-
  // quantity order in both a sale and an utang.
  { phrase: 'coke at dalawang skyflakes', kind: 'cash_sale', items: [['coke', 1], ['skyflakes', 2]] },
  { phrase: 'nakabenta ako ng dalawang coke at isang kilo bigas', kind: 'cash_sale', items: [['coke', 2], ['bigas', 1000]] },
  { phrase: 'nakabenta ako ng tatlong tinapay at kalahating kilo bigas', kind: 'cash_sale', items: [['tinapay', 3], ['bigas', 500]] },
  { phrase: 'nakabenta ng 3 coke', kind: 'cash_sale', items: [['coke', 3]] },
  { phrase: 'benta ng dalawang pancit canton', kind: 'cash_sale', items: [['lucky', 2]] },
  { phrase: 'nagbenta ako ng kalahating kilo bigas', kind: 'cash_sale', items: [['bigas', 500]] },
  { phrase: 'umutang si nena ng bigas dalawang kilo', kind: 'credit_sale', items: [['bigas', 2000]], customer: 'aling_nena' },
  { phrase: 'sipat, umutang si mang tonyo ng limang sardinas at dalawang coke', kind: 'credit_sale', items: [['sardinas', 5], ['coke', 2]], customer: 'mang_tonyo' },
  { phrase: 'gastos sa tubig ngayon', kind: 'expense', items: [] },
  { phrase: 'benta ng dalawang skyflakes, bayad na', kind: 'cash_sale', items: [['skyflakes', 2]] },
]

/**
 * Compare a parsed draft against what the owner meant.
 *
 * Two counts per phrase, because they fail differently:
 * - **the right items**, at all — a missing or invented line;
 * - **the right quantities** — the item was heard, the number was not.
 * The second is the dangerous one: a misheard item is obvious on the confirmation
 * screen, a misheard quantity silently corrupts every number downstream, which
 * is precisely why numbers never auto-post.
 */
function score(phraseCase) {
  const draft = parseSpoken(phraseCase.phrase, ledger, 'fil')
  const expected = new Map(phraseCase.items)
  const actual = new Map(draft.lines.map((line) => [line.skuId, line.qty]))

  const expectedIds = [...expected.keys()].sort()
  const actualIds = [...actual.keys()].sort()
  const itemsMatch = expectedIds.length === actualIds.length && expectedIds.every((id, i) => id === actualIds[i])

  let qtyMatch = itemsMatch
  if (itemsMatch) {
    for (const [id, qty] of expected) {
      // `null` marks a phrase whose quantity is genuinely ambiguous — the owner
      // said a price, not a count — so any quantity counts as heard.
      if (qty !== null && actual.get(id) !== qty) qtyMatch = false
    }
  }

  const kindMatch = draft.kind === phraseCase.kind
  let customerMatch = true
  if (phraseCase.customer) customerMatch = draft.customerId === phraseCase.customer

  return {
    ...phraseCase,
    actualKind: draft.kind,
    actualItems: draft.lines.map((l) => `${l.skuId}×${l.qty}`).join(' + ') || '(none)',
    kindMatch,
    itemsMatch,
    qtyMatch,
    customerMatch,
    pass: kindMatch && itemsMatch && qtyMatch && customerMatch,
    unresolved: draft.unresolved.join(' '),
  }
}

const results = PHRASES.map(score)
const n = results.length
const share = (count) => `${count}/${n} (${((count / n) * 100).toFixed(0)}%)`

const counts = {
  pass: results.filter((r) => r.pass).length,
  kind: results.filter((r) => r.kindMatch).length,
  items: results.filter((r) => r.itemsMatch).length,
  qty: results.filter((r) => r.qtyMatch).length,
  customer: results.filter((r) => r.customerMatch).length,
}
const failures = results.filter((r) => !r.pass)

const csv = [
  'phrase,expected_kind,actual_kind,expected_items,actual_items,kind_ok,items_ok,qty_ok,pass,unresolved',
  ...results.map((r) =>
    [
      `"${r.phrase}"`,
      r.kind,
      r.actualKind,
      `"${r.items.map(([id, q]) => `${id}x${q}`).join(' ')}"`,
      `"${r.actualItems}"`,
      r.kindMatch,
      r.itemsMatch,
      r.qtyMatch,
      r.pass,
      `"${r.unresolved}"`,
    ].join(','),
  ),
].join('\n')
writeFileSync('voice-accuracy-results.csv', csv + '\n', 'utf8')

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log(`Phrases: ${n}\n`)
console.log(`| Measure | Result |`)
console.log(`| --- | --- |`)
console.log(`| **Whole transaction correct** (kind + items + quantities + customer) | **${share(counts.pass)}** |`)
console.log(`| Sale type correct (benta / utang / bili / gastos) | ${share(counts.kind)} |`)
console.log(`| Items heard correctly | ${share(counts.items)} |`)
console.log(`| Quantities correct (of those with the right items) | ${share(counts.qty)} |`)
console.log(`| Customer matched, where one was named | ${share(counts.customer)} |`)

if (failures.length > 0) {
  console.log(`\n### Every failure (${failures.length})\n`)
  console.log('| Said | Expected | Got | Why |')
  console.log('| --- | --- | --- | --- |')
  for (const f of failures) {
    const why = !f.kindMatch
      ? `heard it as ${f.actualKind}`
      : !f.itemsMatch
        ? 'items did not match'
        : !f.qtyMatch
          ? 'quantity differed'
          : 'customer not matched'
    console.log(`| "${f.phrase}" | ${f.kind}: ${f.items.map(([id, q]) => `${id}×${q}`).join(' + ')} | ${f.actualKind}: ${f.actualItems} | ${why} |`)
  }
} else {
  console.log('\nNo failures.')
}

console.log('\nWrote voice-accuracy-results.csv')
