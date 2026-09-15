# Concept Note Corrections — Change Log

What changed between the two existing documents (`PSCXI_Concept_Note_SeePat.docx` and
`SeePat_Final_Startup_Concept.md`) and the corrected note
(`PSCXI_Concept_Note_SeePat_CORRECTED.md` / `.docx`), and why each change was made.

Two of these are **genuine errors in the previous documents**, not stylistic preferences. Judges and
investors probe exactly these.

---

## 1. "Puhunan" meant two different things ⚠️ correctness error

**The problem.** Section 9 of the refined document ("Nasaan ang Puhunan Ko?") and Section 4 (the
Business Twin) each decompose capital, but under incompatible definitions:

| Source | Breakdown | Comment |
| --- | --- | --- |
| §9 | ₱8,500 cash + ₱13,700 paninda + ₱4,300 utang + ₱2,000 kagamitan + **₱1,500 withdrawals** = ₱30,000 | Withdrawals treated as a *location* of capital |
| §4 | ₱7,800 cash + ₱8,600 paninda + ₱2,100 utang + **₱1,500 expenses** = ₱20,000 | Expenses treated as a *location* of capital |

Both totals are credible, **which is exactly why the ambiguity survived review.** Withdrawals and
expenses are *flows* — money that has left the business. They cannot be a place where capital
currently sits.

**Why it matters.** This is the flagship differentiator, and its core identity was undefined. Worse,
the two views give *different answers*: for the §9 example, "where capital sits" is **₱28,500**, not
₱30,000 — the difference is precisely the withdrawn ₱1,500.

**The fix.** Two clearly separated views, both stated formally:

- **COMPOSITION — "Nasaan ang Puhunan Ko?"** `Cash + Paninda + Utang sa Iyo + Kagamitan − Utang sa Supplier`
- **PROVENANCE — "Saan Napunta ang Pera Ko?"** `Puhunan na Inilagay + Naipon na Kita = Kinuhang Pera + (current holdings net of payables)`

Both are consistent because both reduce to one identity, which the prototype asserts after **every**
transaction:

```
Assets − Liabilities = Capital Injected − Withdrawals + Cumulative Net Profit
```

**Enforced in code:** `src/engine/capital.ts`, with both document examples used as regression
fixtures in `src/engine/capital.test.ts`. Building the engine *found* this error — it was invisible in
prose and unmissable in a test.

---

## 2. The COGS formula contradicted the product's central promise ⚠️ correctness error

**The problem.** Section 5 specified `COGS = Opening Inventory + Purchases − Closing Inventory`. That
is the **periodic** method, and it **requires a physical stock count**. But Section 7 promises the
owner can ask *"Magkano kinita ko ngayong linggo?"* — daily profit, no counting.

**Why it matters.** You cannot report daily profit from a periodic formula. This is the actual reason
most micro-POS products report inaccurate daily profit, and it is a deeper engineering commitment than
a formula change.

**The fix.** **Perpetual inventory at moving weighted average cost** — COGS derived at the moment of
each sale. Inventory value is held as an exact integer in centavos; unit cost is a display-only value,
never a rounding accumulator, so the books cannot drift. Selling below zero stock produces a *negative
position* rather than a clamped zero, because clamping books cost against an asset that was never
created.

**Enforced in code:** `src/engine/inventory.ts`. The clamping bug was caught by the invariant test
during development — the seeded 21-day history failed the identity until it was fixed.

---

## 3. Sipat Score was not reproducible — contradicting its own claim

**The problem.** Section 10 said the score "should not be an arbitrary AI-generated score" and that
"every score must be decomposable into its contributing metrics" — but published **no weights, no
normalisation, no baseline, and no period**. An underdetermined composite is exactly the thing it
disclaimed.

**The fix.** **Sipat Score v1** publishes six weighted dimensions summing to exactly 1.00
(Profitability 0.25, Cash-flow 0.20, Inventory efficiency 0.15, Receivable exposure 0.15, Expense
control 0.15, Sales stability 0.10), each with its basis and its full-marks threshold. The score is
**versioned** so model changes never silently rewrite an owner's history.

**Enforced in code:** `src/engine/score.ts`; tests assert the weights sum to 1, that contributions sum
to the headline value, and that the same ledger always produces the same score.

---

## 4. Evidence graded down in the refined rewrite

**The problem.** The refined `.md` lost material the competition template had:

| Dropped from the refined version | Why it matters |
| --- | --- |
| DTI digitalisation figures (23% no ICT / 51% basic only / 6% advanced / 73% need capacity building) | Replaced by "many surveyed MSMEs remained at low levels" — hedging where the template had hard numbers |
| Inline citations | Figure 2 of the refined note cites nothing inline; sources were exiled to the back |
| SDG 8 / 9 / 10 alignment | Rubric item in the competition template |
| ₱150,000 budget table | Required by the template's own "Financial Requirement" section |
| The embedded process figure | Present in the `.docx`, absent from the `.md` |

**The fix.** All restored. Hard numbers and citations sit next to the claims they support.

---

## 5. The competitive table claimed a clean sweep

**The problem.** The refined table gave SeePat a checkmark in **13 of 13 rows** — including
"Predictive decision support", where it marks *both* "Advanced systems ✓" and SeePat ✓, while
Section 11 concedes forecasting arrives only "once sufficient historical data exists". A perfect sweep
reads as marketing and is discounted on sight. The `.docx` version was more honest: it had a "what it
already does well" column that the rewrite deleted.

**The fix.** An honest table with an explicit **"where SeePat is behind today"** block — payments
and e-wallet reconciliation, receipt-printer and barcode hardware, and distribution footprint (Peddlr
at 2M+ stores, Packworks at 270k+). Naming these raises credibility rather than lowering it.

---

## 6. Unit economics were never modelled — and may be negative

**The problem.** ₱99/month against per-transaction speech and LLM costs. Neither document modelled
this; the ₱40,000 pilot line treats AI as a fixed cost rather than a marginal one.

**The fix.** Explicit modelling with published 2026 rates (Whisper-class API ~$0.006/min, Google Cloud
STT ~$0.016/min, AWS Transcribe ~$0.024/min). At ~8 seconds per spoken transaction, **100 voice
transactions/day costs ~₱137/month — more than the ₱99 subscription.**

**Mitigations now designed in, not hoped for:** batch insight generation (cost scales with users, not
questions), a free tier with **zero AI inference**, and metered voice capture.

---

## 7. Tax and compliance status was silently ambiguous

**The problem.** No e-receipt and no BIR accreditation means SeePat is management accounting, not
the books of record. Saying nothing invites the hardest question a knowledgeable judge can ask.

**The fix.** Stated explicitly: SeePat is a **management-accounting** tool, **not** a BIR-registered
POS, and does not issue official receipts. This is a strength — it avoids a heavy accreditation
programme and sets correct expectations.

---

## 8. Voice: over-promised, now correctly scoped

**The problem.** "Voice-to-Business-Record" was claimed as a core pillar with an offline-first
architecture, and voice was ranked as a *core* differentiator in the competitive table while the MVP
also listed it as one of ten items.

**What the research showed** (checked against current model lists, not blog posts):

- The **only** offline Filipino ASR model in wide circulation (`vosk-model-tl-ph-generic-0.6`) is
  ~320MB, reports **~18.9% WER on clean read speech and 97.9% on BABEL**, and is licensed
  **CC-BY-NC-SA — non-commercial**. Offline Tagalog voice is not a shipping option today, in a PWA or
  in Flutter.
- Browser recognition is the most accurate Taglish option available at any price, but it is a
  **network** feature — so the offline-first claim does not extend to it.
- Whisper-family models carry documented hallucination behaviour (ACM FAccT 2024), which on a
  *financial ledger* means inventing a transaction from silence.

**The fix.** Voice is re-scoped honestly and constrained on three axes: (1) constrained vocabulary
rather than open transcription; (2) **numbers never auto-post** — a misheard item is obvious, a
misheard quantity silently corrupts every downstream insight; (3) parsing produces **drafts** that
cannot be persisted until confirmed. Voice is positioned as an **accelerator, not a prerequisite** —
every flow has an equivalent typed path, and the answering layer works offline.

**Enforced in code:** `src/engine/voice.ts` exposes no API that can post a draft without explicitly
confirmed lines; `src/asr.ts` keeps engines behind one swappable interface.

---

## 9. Cold start was undesigned

**The problem.** The Business Twin, forecasts, slow-mover detection, Score and benchmarking all need
history. Day 1 through Day 7, a new owner has an empty twin and **none** of the differentiators. This
is the main retention cliff, and neither document addressed it.

**The fix.** Section IX now treats seeding (guided first stock take plus backfilled sales) as a
product requirement. The prototype ships a deterministic 21-day seeded history so the product is
useful before any data exists.

---

## 10. Void versus negative sale — an undefined behaviour with real consequences

**The problem.** No void/reversal semantics were specified anywhere, in a ₱199 tier that gives
employees access to a business-health score.

**Why it matters.** Posting a **negative sale** and **voiding a sale** are not equivalent, and the
difference is invisible in a balanced ledger: both keep the books balanced and both land on the same
revenue — but only the void restores the stock. The negative sale leaves inventory **overstated**.

**The fix.** Voids are recorded as separate, auditable markers; the twin is recomputed from the log, so
a void is reproducible. **Enforced in code** by a test that asserts both approaches balance while
producing different inventory — proving a balanced ledger is not sufficient on its own.

---

## 11. Brand: SeePat, not TimbangAI

The `.docx` was filed as **SeePat (SIPAT)** while the refined document used **TimbangAI**. Both names
appeared in submission materials, which is the kind of inconsistency that costs marks.

**This section originally argued for TimbangAI:** *"timbang"* (to weigh) is a natural **spoken
address** for a voice-first product — the owner literally says *"Timbang, nakabenta ako ng…"* —
whereas *"sipat"* (to observe) describes looking at a dashboard. That reasoning is kept here only
because it was the basis of the earlier draft.

**Final decision: SeePat (SIPAT).** It is the name filed with DICT, so it is now the single name used
across the three documents in this repository, the deck, the prototype UI, the PWA manifest and the
installable app. Three things had to move with it, and each was a small product decision rather than a
find-and-replace:

1. **The spoken address changed.** The owner no longer addresses the app as *"Timbang"*; the wake
   word is now *"Sipat, nakabenta ako ng…"*. The parser's wake-word list accepts both `sipat` and
   `seepat`, so a recogniser that spells it the English way still wakes it.
2. **The icon changed.** A balance scale says *weigh*; the mark is now an **eye**, because the
   product's promise is that the owner can finally *see* where the money went.
3. **The tagline changed.** *"Tinitimbang ang buong negosyo"* was a pun on the old name and now reads
   **"Sinisipat ang buong negosyo."** This is copy, not architecture — if the team prefers a
   different closing line, nothing else depends on it.

---

## 12. The interface had no visual language ⚠️ design gap

Neither document says what SeePat *looks like*, and the first working build filled that vacuum with the
browser default: one white rounded card after another on a pale grey page, a 2010s underline tab bar, body
text at 0.6rem, and a dark theme inherited from a template. Nothing about it was wrong, and nothing about it
was designed. For a product whose entire pitch is that an owner can finally **see** where the money went,
that is a positioning failure, not a cosmetic one.

Three decisions were made, and each is enforced in code rather than by taste:

1. **Light only.** A tindahan owner reads this under a canopy at noon, often with brightness turned down to
   save battery. The canvas is a cool off-white with soft light bleeding in from the top edge; the CSS
   declares `color-scheme: light`, and the PWA manifest, `<meta name="theme-color">` and the iOS status-bar
   style were all flipped with it — a light page under a dark status bar is the exact seam that makes an app
   feel unfinished.
2. **One inverted surface, and the flag's three colours.** The jewel card (deep navy, diagonal sheen, a gold
   sun glowing in one corner, grain, a 1px gold inner top highlight) is the only dark surface in the product,
   and it is spent on the two numbers that matter: the day's real profit and the Sipat Score. Everything else
   is purposely flat so nothing competes with them.

   The palette is then the **national flag**, which is a design decision and a load-bearing one: navy for all
   structure, gold for value and premium (so "PRO" reads as a material), flag red for negatives and danger.
   An owner does not need a legend to read it — they have seen that combination on the flag and on every
   sari-sari signage panel painted by the same sign-maker. Emerald is kept as one deliberate exception for
   *state* — money in, and confirmed outcomes like a posted draft or a completed payment — because green
   meaning "money in" is a stronger signal than palette purity. It never appears as chrome.
   The mark changed with it: the **Philippine sun around an eye** — eight gold rays on navy, an eye at the
   centre, because *sipat* means to observe. Both meanings have to survive at 32px.
3. **Figures are the interface.** Balance and score are set at 2.9–3.2rem in a geometric display face with
   tabular figures and count-up animation; the heaviest thing on any screen is a number. Data follows the
   engine: a smoothed 7-day area chart, an 8-week Score trend that **switches from a curve to columns when a
   week has no sales** (an area chart would plunge to zero and invent a collapse that never happened), and a
   donut whose arcs are the components of capital.

**The part worth auditing, and what it caught.** Contrast was computed, not eyeballed. The first pass failed
in six places a designer would not have seen: `fg-faint` sat at 4.39:1 on the `sunken` surface (darkened to
5.0:1), every bar and donut fill in the 500-step hue band fell under the 3:1 floor a meaning-carrying graphic
needs (moved to 600/700 steps), the mic glyph failed at 2.1:1 against its own button (button deepened to
brand-800), and — the subtle one — the *decorative glow blobs* on the jewel card lighten the surface behind
the text they sit near, which quietly pushed white copy down to ~4.2:1. The blobs are now capped at 12% so
white text stays above 5:1 over them.

That audit is now a build-checkable artifact: `npm run check:contrast` computes all 60 shipped pairs and
exits non-zero if any text pair drops below 4.5:1 or any data mark below 3:1. It also records which graphics
are deliberately exempt (chart baselines, gradient washes, glow overlays) and why — a gridline cannot reach
3:1 against its own surface without becoming a bright band that competes with the data it annotates.

The other bug was only findable by *looking at the screen*. The checkout sheet opened onto a blurred scrim
with no sheet in it, because the screen's entrance animation animates `transform` with a forwards fill — so the
finished screen keeps a computed identity matrix, and an ancestor with a transform becomes the containing
block for `position: fixed` descendants. The sheet was being positioned against the Plan screen (2,885px tall)
instead of the viewport. Fixed twice over: the keyframe is now from-only with a backwards fill so the
transform collapses to `none` when it ends, and the sheet is portalled to `<body>` so no ancestor can ever
capture it again. The comment in `src/index.css` records why, because the next person to add a fixed overlay
inside a screen will otherwise hit it too.

---

## 13. The interface had no character — and the first mascot did not move ⚠️ design gap

A fintech UI with no character in it is a spreadsheet with rounded corners. SeePat has one obvious candidate, and
it was already in the brand: *sipat* means to observe, so the mascot is an **owl** — the animal that sees in the
dark, which is the product's whole promise in one silhouette. It is named **Pat**, after the second half of the
wordmark.

The version that shipped first was wrong in three specific ways, and all three were only visible on a screen:

1. **It was too small to see.** Laid out at 58px in a 120-unit drawing, every motion amplitude resolved to under
   a pixel. A 1.6-unit lift is 0.77px at that size: the animation was running, and it was invisible. The bird is
   now rendered at 82–132px depending on the screen, with amplitudes sized for that.
2. **It stopped moving exactly when it mattered.** The worried pose held the eyelids still with `animation: none`
   — and the demo ledger carries a warning, so the dashboard showed the *frozen* variant most of the time. Blinking
   now runs in every mood, and the worried face narrows the lids instead of stopping them.
3. **There were several different owls.** Each screen drew its own variation, which reads as clip art. There is now
   one character with a **wardrobe**: apron and pen for bookkeeping, headphones for listening, reading glasses for
   answering, a beanie for going offline. Same body, same face, same navy eye as the brand mark; only the prop
   changes. On navy the body inverts to lit gold like the sun in the mark, while the face stays identical — on the
   first attempt the navy wings vanished into the navy card and the gold-300 glasses vanished into the white face,
   which is exactly why the face is now tone-independent.

Two engineering notes worth keeping. The mascot is **inline SVG with CSS keyframes rather than Lottie or Rive**:
those runtimes cost ~250KB and ~100KB of WASM respectively, which is a 20–46% larger install for an app that
precaches its shell in prepaid-data territory. And the "alive" quality is entirely in the **timing** — eight
independent periods (3.6s to 26s) so no two motions ever land together, plus a ~130ms blink from two separate
lid clocks that occasionally overlap into a double blink.

The owl is also the app's most disciplined component: **Pat only ever says sentences the engine already wrote,
and already translated.** Its mood comes from the Sipat Score band or from the real voice pipeline — an error
outranks a soft margin, and "working" is tied to the offline model actually transcribing rather than to a
decorative spinner.

---

## 14. The cards were the only surface in the app without physics ⚠️ design gap

By this point the app was light, correct, readable and **flat**: white cards on a pale page, each with one grey
border and one soft shadow. The screen could not say what was wrong, only that it felt like a form. Comparing it
against real fintech work named four missing things, and all four were in the token layer rather than in any
screen:

1. **A card fill that is one solid colour has nothing to catch the light.** Every light surface now carries a
   shallow vertical gradient (white → `--color-card-deep`). That is also why the contrast audit changed: dark text
   is worst at the *foot* of the gradient, so `CARD` in `tools/contrast-check.mjs` is now `#f7f9fd`, the darker
   stop, instead of pure white. Testing against white had been flattering the palette by ~0.05:1.
2. **Elevation was one shadow, not three.** It is now a 1px contact shadow, a mid layer and a wide ambient pool.
   A single blurred shadow is the signature of a template.
3. **Borders were opaque grey strokes.** They are now 6% alpha navy rings, which tint with whatever is underneath
   instead of being drawn around it — the difference between a surface's edge and a box's outline.
4. **Nothing was textured, and one comment lied about it.** The `body` comment claimed "a fine dotted grid" that
   was never in the CSS — the atmosphere was three radial glows and nothing else, and they sat only at the top of
   the page. There is now a real 22px dot grid *behind* the content (`z-index: -1`), dissolving by mid-page, plus
   floor glows at the bottom so the middle of a long scroll never goes dead. The pattern is deliberately **not**
   inside the cards: texture under a number is a legibility cost and dates the work.

Screens did not change to get this — `Card` did. One surface class means every screen in the app is lit by the
same physics, and the three tinted variants (gold for value, navy for an engine reading, sunken for a well inside
a card) are materials *used with meaning* rather than decoration.

**The audit earned its keep again, and this time by getting stricter.** With cards no longer pure white, two data
marks — the amber score bar and the amber list bullet — landed at **3.02:1** against the foot of the gradient.
They passed, and that is exactly the problem: a 0.02 margin is a coincidence, not a design decision, and the next
person to nudge one token would have broken the build with no idea why. Both were moved a full step to amber-700/
800. The tightest meaning-carrying mark in the app is now 3.39:1 rather than 3.02:1.

One follow-on bug was worth noting because of its shape: a `background-image` paints *over* a `background-colour`,
so the new card gradient silently buried the state tints (`bg-amber-50`, `bg-emerald-50`) on the warning and
confirmation cards — a warning would have rendered as an ordinary card. `Card` grew a `flat` variant for cards
that bring their own fill, so the state colour wins and the edge and shadow still apply.

---

## What was added that neither document had

- **Verified prototype status** (Section IX.C) — the finance engine, the invariant, the capital views,
  the Score, the narrator and the voice parser all exist and are tested. The claim that the numbers are
  deterministic is now *executed*, not asserted.
- **Honest deferred scope** — sync, ML forecasting, institutional dashboards, benchmarking and supplier
  integration are explicitly deferred, each with the reason it becomes valuable later.
- **Defensibility stated honestly** — an LLM wrapper is trivially copyable, so the moat is data network
  effects, institutional distribution and supplier integration. Plus an explicit ethical boundary on
  lender-facing data.
- **B2B2C repositioned** from "later add-on" to **primary revenue channel**, because ₱99 ARPU against
  free competitors is a hard market.
