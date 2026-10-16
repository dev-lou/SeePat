/**
 * Scoring for the offline-ASR benchmark.
 *
 * Split out of `bench-asr.mjs` so `bench-report.mjs` can import it: importing the
 * runner itself would execute its CLI entry point and try to launch a browser.
 *
 * Word error rate is the honest metric here rather than a similarity score,
 * because the product reads *words* off the transcript — an item name and a
 * number — and a sentence that scores 80% similar can still have the number
 * wrong, which is the one error this app is built to never commit silently.
 */

/**
 * Normalization strips punctuation, case, and diacritic-free spacing only.
 *
 * Whisper punctuates and capitalizes; the FLEURS reference does not. Scoring
 * those differences would measure formatting rather than recognition. Nothing is
 * removed that could change which word was said.
 */
export function normalize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Word-level Levenshtein distance, with the operation counts kept. */
export function wordErrorRate(reference, hypothesis) {
  const ref = normalize(reference).split(' ').filter(Boolean)
  const hyp = normalize(hypothesis).split(' ').filter(Boolean)
  if (ref.length === 0) {
    return { wer: hyp.length === 0 ? 0 : 1, ref: 0, hyp: hyp.length, substitutions: 0, deletions: 0, insertions: 0 }
  }

  // Rolling two-row edit distance.
  let prev = Array.from({ length: hyp.length + 1 }, (_, j) => ({ cost: j, s: 0, d: 0, i: j }))
  for (let i = 1; i <= ref.length; i += 1) {
    const row = [{ cost: i, s: 0, d: i, i: 0 }]
    for (let j = 1; j <= hyp.length; j += 1) {
      const same = ref[i - 1] === hyp[j - 1]
      const sub = prev[j - 1].cost + (same ? 0 : 1)
      const del = prev[j].cost + 1
      const ins = row[j - 1].cost + 1
      const best = Math.min(sub, del, ins)
      if (best === sub) row[j] = { cost: sub, s: prev[j - 1].s + (same ? 0 : 1), d: prev[j - 1].d, i: prev[j - 1].i }
      else if (best === del) row[j] = { cost: del, s: prev[j].s, d: prev[j].d + 1, i: prev[j].i }
      else row[j] = { cost: ins, s: row[j - 1].s, d: row[j - 1].d, i: row[j - 1].i + 1 }
    }
    prev = row
  }

  const final = prev[hyp.length]
  return {
    wer: final.cost / ref.length,
    ref: ref.length,
    hyp: hyp.length,
    substitutions: final.s,
    deletions: final.d,
    insertions: final.i,
  }
}

/**
 * Group raw runs into one row per (model, language, variant).
 *
 * Corpus WER is computed from summed edit operations rather than by averaging
 * per-clip rates: an average of rates would let a 4-word clip count as much as a
 * 14-word one, and in a benchmark this small that is the difference between a
 * number and a coincidence.
 */
export function aggregate(results) {
  const groups = new Map()
  for (const row of results) {
    const key = `${row.model}|${row.lang}|${row.variant}`
    if (!groups.has(key)) groups.set(key, { model: row.model, lang: row.lang, variant: row.variant, rows: [] })
    groups.get(key).rows.push(row)
  }

  return [...groups.values()].map((group) => {
    let errors = 0
    let words = 0
    const perClip = []
    for (const row of group.rows) {
      const score = wordErrorRate(row.ref, row.text)
      errors += score.substitutions + score.deletions + score.insertions
      words += score.ref
      perClip.push({
        clip: row.clip,
        wer: Number(score.wer.toFixed(3)),
        ms: row.ms,
        gateMs: row.gateMs,
        rms: row.rms,
        text: row.text,
      })
    }
    const meanMs = group.rows.reduce((sum, r) => sum + r.ms, 0) / group.rows.length
    return {
      model: group.model,
      lang: group.lang,
      variant: group.variant,
      clips: group.rows.length,
      corpusWer: words > 0 ? Number((errors / words).toFixed(4)) : null,
      errors,
      words,
      meanMs: Math.round(meanMs),
      perClip,
    }
  })
}
