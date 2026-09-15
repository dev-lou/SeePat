# SeePat

**Ang financial copilot ng negosyo.** A voice-enabled, offline-first, explainable decision
copilot for Filipino microentrepreneurs — the sari-sari store, the karinderya, the palengke
vendor — that answers *"kumikita ba ako?"* with arithmetic instead of vibes.

This repository is a **working prototype**. Everything described below runs, and most of it is
covered by tests. Where something is simulated or not yet built, this document says so plainly
rather than implying more than the code does.

- **No payment gateway.** Subscriptions are simulated in full (entitlements, quotas, mock
  invoices with reference numbers) but no money moves.
- **No backend.** There is no server in this repository. Features requiring one are declared,
  priced, and gated — not implemented.
- **No AI service.** The "AI" narration tier is modelled and metered in the billing layer, but
  the intelligence that exists is deterministic and runs on the device.

---

## Table of contents

1. [The problem](#1-the-problem)
2. [Design principles](#2-design-principles)
3. [Feature tour](#3-feature-tour)
4. [Architecture](#4-architecture)
5. [The engine](#5-the-engine)
6. [The data model](#6-the-data-model)
7. [Voice pipeline](#7-voice-pipeline)
8. [Offline & the PWA](#8-offline--the-pwa)
9. [Internationalization](#9-internationalization)
10. [Design system](#10-design-system)
11. [Commercial model](#11-commercial-model)
12. [Tech stack](#12-tech-stack)
13. [Getting started](#13-getting-started)
14. [Testing & verification](#14-testing--verification)
15. [Build output & performance](#15-build-output--performance)
16. [Accessibility](#16-accessibility)
17. [Limitations & roadmap](#17-limitations--roadmap)
18. [Documentation](#18-documentation)
19. [Licensing](#19-licensing)

---

## 1. The problem

The Philippines has roughly **1.1 million microenterprises**, and the overwhelming majority have
no reliable picture of their own profitability. The reason is structural, not a lack of
diligence:

- **Records are memory and notebooks.** Sales are remembered, not written down.
- **"Profit" is confused with "cash in the drawer."** Utang (credit sales) inflates the drawer's
  apparent health: revenue is recognisable the moment a sale is made, but the cash arrives days
  or weeks later, if at all. A store can be busy, full of stock, and insolvent.
- **The books are a chore, not a tool.** Existing apps ask owners to do data entry in exchange
  for reports — a bad trade for someone working a 14-hour day.
- **Existing tools assume a desktop, a spreadsheet habit, and English.** None of that matches the
  market.
- **Connectivity is intermittent and data is expensive.** Anything that requires a round trip to
  a server to answer "magkano ang kita ko ngayon?" will not be used at the moment it matters.

The insight the product is built on: **an owner does not want software, they want to know what to
do next.** Recording is the cost; the answer is the product.

## 2. Design principles

These are enforced in code and in the test suite, not just stated here.

**1 — Deterministic finance, AI on top.** Every number the app shows is computed by fixed,
versioned arithmetic over the ledger. The LLM tier (not implemented here) may *re-phrase* those
results; it may never *produce* them. This is what makes the output reproducible: the same ledger
always yields the same score, the same capital breakdown, the same answer.

**2 — Money is integer centavos.** Ends with `.00` never appear where they shouldn't. Floats are
never persisted or accumulated, which is what allows the accounting identities to hold *exactly*
rather than approximately. See `src/engine/money.ts`.

**3 — Numbers are never auto-posted.** Voice parsing produces a *draft*. Item identity is safe to
infer (a misheard "Coke" is visible on screen); a misheard quantity or price silently corrupts
every downstream insight, so numbers require confirmation. A draft cannot be persisted until the
owner accepts it. This is a property of the types, not a promise in a policy document.

**4 — On-device is free. Server is paid.** Every feature that runs on the owner's phone has a
marginal cost of ₱0, so it sits in the free tier without losing money. What is sold is what
requires a server to be worth anything. `billing.test.ts` asserts that no free-tier feature is
cost-bearing, so the unit economics cannot quietly rot as features are added.

**5 — Explainability is not a feature, it is the architecture.** Every score dimension carries its
weight, its contribution, and a plain-language explanation. Every answer carries its evidence.

**6 — Corrections are auditable, not destructive.** Voiding a transaction appends a marker to
`ledger.voids` and recomputes the Twin from the log. Nothing is mutated, so any past state can be
reproduced.

**7 — The app never invents a word about someone's money.** The mascot's speech bubble is a
sentence the engine already produced and already translated. There is exactly one place in the
codebase where sentences about financial state are written (`narrator.ts`), and it is pure.

## 3. Feature tour

Five destinations, plus two secondary screens.

| Screen | Tab | What it answers |
|---|---|---|
| **Twin** | `twin` | "Kumusta ang negosyo ko ngayon?" — net profit, cash, utang, inventory value, warnings |
| **Tala** (Ledger) | `tala` | Recording: cash sale, credit sale, purchase, expense, payment, capital, withdrawal, stock adjustment, void |
| **Boses** (Voice) | `boses` | Speak the sale; the ledger writes itself |
| **Tanong** (Ask) | `tanong` | "Nasaan ang puhunan ko?" — deterministic answers with evidence |
| **Score** | `score` | Sipat Score, decomposed into weighted dimensions |
| **Plano** (Plan) | `plan` | FREE / PRO / NEGOSYO, simulated checkout |
| **Offline** | `offline` | Voice model download, engine selection, what works without signal |

**Twin.** A dashboard over the Business Twin: net profit for the window, cash on hand, receivables
(utang), inventory value, working capital, a sales trend chart, and a live list of integrity
warnings raised while folding the ledger (oversold stock, unknown SKU, a payment exceeding a
receivable). Warnings are part of the data, not a validation afterthought.

**Ask My Negosyo.** Twelve intents matched by regex, answered from the Twin by fixed templates:
profit for a period, where capital sits, where money went since inception, why cash is low, top
product, slow movers, biggest utang, profit change, what to restock, the score, and a sales
forecast. Each answer returns the figures that produced it as evidence. There is **no LLM call**,
which is why it works offline, costs nothing per question, and cannot hallucinate a number.

**Voice.** Two engines behind one interface — the browser's own recognizer (accurate, needs
signal) and an on-device Whisper model (offline, less accurate, explicitly downloaded). Both feed
the same constrained parser: `parseSpoken` slot-fills against the SKUs this store actually sells,
returns a draft, and requires confirmation.

**Pat, the owl mascot.** One character with five outfits, drawn as inline SVG and animated with
CSS keyframes — no animation runtime, no extra bytes on the critical path. Its mood comes from the
Sipat Score band, or on the Voice screen from the real capture state; it never speaks a sentence
the engine did not write.

## 4. Architecture

Four layers, and the dependency direction is strictly one-way.

```
        UI            src/ui/*.tsx          screens, components, charts, mascot
         │                                   (React 19, no state library)
         ▼
       State          src/store.ts          useNegosyo()  — ledger + derived selectors
                      src/billing.ts        useBilling()  — entitlements, quota, checkout
                      src/i18n/index.ts     useLang()     — external store, no context
         │
         ▼
      Engine          src/engine/*.ts       pure functions over a Ledger. No React, no DOM,
         │                                   no storage, no network, no Date.now() except
         ▼                                   where a clock is passed in.
     Platform         src/storage.ts        localStorage with one-time key migration
                      src/asr.ts            ASR boundary (engine selection)
                      src/asr-offline.ts    on-device Whisper engine
                      src/audio.ts          microphone capture
```

**The engine is pure and that is the whole design.** `Twin` is a fold over the transaction log:
`computeTwin(ledger)` produces the current financial state, and nothing in it is hand-maintained.
That single property buys reproducibility, testability without a DOM, auditability of voids, and
the ability to swap the persistence layer without touching a line of business logic.

**State is two hooks and no library.** `useNegosyo()` owns the ledger and memoizes every derived
value; `useBilling()` owns the entitlement; `useLang()` is a tiny `useSyncExternalStore` module so
the *engine* can read the current language without a React provider.

**Size:** 53 files in `src/`, 44 of them non-test — roughly **10.7k lines** of source, 12.2k
including the 9 test files.

```
src/
├── engine/                     ← 12 pure modules, ~3.0k lines
│   ├── money.ts (59)             integer centavos, PHP formatting, safe division
│   ├── types.ts (228)            Ledger, Sku, Customer, Transaction, BusinessTwin, Warning
│   ├── inventory.ts (84)         perpetual stock at moving weighted-average cost
│   ├── twin.ts (329)             the fold: ledger → BusinessTwin
│   ├── metrics.ts (154)          windowed period metrics (double fold)
│   ├── capital.ts (283)          capital composition + provenance
│   ├── period.ts (56)            local-day boundaries, Windows, date keys
│   ├── score.ts (296)            Sipat Score v1, weighted dimensions, bands
│   ├── history.ts (102)          weekly score recomputation
│   ├── narrator.ts (733)         12 intents → answers with evidence
│   ├── voice.ts (396)            constrained spoken-input parser → drafts
│   └── demo.ts (219)             deterministic 21-day seed ledger
├── ui/                         ← screens and shared kit, ~5.0k lines
│   ├── App.tsx (385)             shell: masthead, tab strip, settings, routing
│   ├── Dashboard.tsx (299)       the Twin
│   ├── Record.tsx (558)          the ledger form
│   ├── Voice.tsx (487)           capture + confirmation
│   ├── Ask.tsx (300)             deterministic Q&A
│   ├── ScoreView.tsx (260)       score + decomposition
│   ├── Plan.tsx (445)            tiers + simulated checkout
│   ├── Offline.tsx (343)         model management
│   ├── Welcome.tsx (455)         first-run deck (3 slides, swipeable)
│   ├── Pat.tsx (445)             the mascot: SVG + outfits + moods
│   ├── PatSays.tsx (79)          the engine-sentence strip
│   ├── components.tsx (660)      Card, HeroShell, Stat, Delta, Donut, ProgressRing, LockedCard…
│   └── charts.tsx (241)          AreaChart, sparkline, SVG geometry
├── i18n/index.ts (803)           two languages, copy-as-data, date/number formatting
├── store.ts (179)                ledger state + persistence
├── billing.ts (585)              tiers, 18 features, quota, mock invoices
├── asr.ts (217)                  ASR boundary + browser engine
├── asr-offline.ts (552)          on-device Whisper engine + model catalogue
├── audio.ts (239)                microphone capture
├── storage.ts (54)               localStorage + legacy-key migration
├── boot.ts (75)                  splash handoff
├── onboarding.ts (65)            versioned first-run gate
└── index.css (928)               design tokens, materials, motion
```

## 5. The engine

**Money** (`money.ts`). `Centavos = number`, integer. `pesos()` converts once at the edges;
`formatPHP()` uses `Intl.NumberFormat('en-PH', …)`.

**Inventory** (`inventory.ts`). Perpetual costing at moving weighted average. This is a deliberate
correction to the periodic `Opening + Purchases − Closing` formula, which requires a physical
stock count and therefore makes a *daily* profit figure impossible to produce. Perpetual costing
derives COGS at the moment of each sale, so "magkano ang kinita ko ngayong araw?" is answerable
without counting shelves. Inventory value is an exact integer; unit cost is display-only, so
rounding can never leak into the books.

**The Twin** (`twin.ts`). Folds the log into cash, payables, fixed assets, capital injected,
withdrawals, revenue, COGS, expenses, shrinkage, per-SKU stock and sales stats, receivables, and
an accumulating `warnings[]`. Because it is a pure fold over `{transactions, skus, customers,
voids}`, voiding is just "recompute" — nothing needs to be trusted.

**Period metrics** (`metrics.ts`). Computed by folding the engine **twice** — once for everything
before the window, once for everything up to now — and subtracting. That is what makes *windowed*
COGS correct: a sale inside the window must be costed against the inventory state as it stood at
the start of the window, not today's moving average.

**Capital Intelligence** (`capital.ts`) — the flagship differentiator. The original concept used
one word, *puhunan*, for two different questions, and both sample breakdowns summed correctly,
which is exactly why the ambiguity survived review. They are separated here:

- **Composition** — *"Nasaan ang puhunan ko?"* Where capital sits **right now**. Assets only;
  expenses and withdrawals are not locations.
- **Provenance** — *"Saan napunta ang pera ko?"* How capital was built and consumed **since
  inception**. Sources and uses must reconcile.

Both are guaranteed consistent because both reduce to the same identity:

```
Assets − Liabilities  ==  Capital − Withdrawals + Cumulative Net Profit
```

**Sipat Score** (`score.ts`). `SCORE_VERSION = 'Sipat-Score v1'`. The concept promised a score
that is "not an arbitrary AI-generated score" and is "decomposable into its contributing
metrics" — but published no weights, normalisation, or baseline, which left it underdetermined and
therefore not reproducible. Weights and every formula are fixed and versioned here, so the same
ledger always yields the same score.

Bands are **keys** (`strong | good | watch | critical`), not words: a band is a fact about the
business, dressed by `bandLabel(band, lang)` at the point of display. Each dimension reports
`weight`, `score`, `contribution`, `rawValue` (formatted in the language it was computed in), and
an `explanation` sentence. `sufficientData` is false while there is too little history for ratios
to mean anything.

**Score history** (`history.ts`). Each past week's score is the same deterministic function
applied to the ledger as it stood at the end of that week. Nothing is stored, nothing is
back-filled, no baseline is invented.

## 6. The data model

```ts
Ledger = { skus: Sku[]; customers: Customer[]; transactions: Transaction[]; voids: VoidRecord[] }
```

**Quantities are integers in the SKU's base unit.** Items sold by weight declare `unit: 'kg'` with
`baseUnit: 'g'`, so 1.5 kg is recorded as `1500`. Exact without floats.

**Ten transaction kinds**, all discriminated by `kind`:

| Kind | Meaning |
|---|---|
| `cash_sale` | Revenue recognised, cash received |
| `credit_sale` | Revenue recognised now, cash later → receivable |
| `payment_received` | Settles a customer receivable |
| `purchase` | Stock in at a unit cost; may be part-paid → payable |
| `expense` | `paid: 'cash' \| 'credit'` — credit raises supplier payables |
| `payable_payment` | Settles a supplier payable |
| `capital_injection` | Owner puts money in |
| `owner_withdrawal` | Owner takes money out (not an expense) |
| `fixed_asset_purchase` | Capital converted to fixed assets, not expensed |
| `stock_adjustment` | `qtyDelta`; negative is a write-off booked as shrinkage |

**Voids are markers, not deletions.** `VoidRecord { txnId, at, reason?, by? }` is appended and the
Twin is recomputed.

**Warnings are first-class.** `Warning.code` is one of `oversold_stock`, `unknown_sku`,
`unknown_customer`, `payment_exceeds_receivable`, `payment_exceeds_payable`, `overpaid_purchase`,
`voided_txn_not_found`, because these are exactly the states a real ledger reaches. Each warning
carries both languages inline (`message`, `messageFil`) since the interpolated values are only in
scope where the warning is raised — so the Twin stays language-free and is never recomputed just
because the owner switched languages.

**Persistence** is `localStorage`, the one deliberately swappable boundary. The concept specifies
SQLite over OPFS; the engine is a pure fold, so the durable store only has to keep the log, and
swapping localStorage for SQLite touches `storage.ts` alone. The prototype takes the lower-risk
option so a demo cannot fail on a WASM filesystem.

| Key | Holds | Legacy (pre-rename) |
|---|---|---|
| `seepat.ledger.v1` | the ledger | `timbangai.ledger.v1` |
| `seepat.entitlement.v1` | subscription state | `timbangai.entitlement.v1` |
| `seepat.voice.model.v1` | voice model installed | `timbangai.voice.model.v1` |
| `seepat.lang.v1` | display language | — |
| `seepat.welcome.v1` | welcome deck seen (versioned) | — |

Reads fall back to the legacy key **once** and write forward. A rebrand should not cost the owner
their ledger, their subscription, or a voice model download.

## 7. Voice pipeline

Voice is the centrepiece and the least certain component, so it sits behind one interface
(`AsrEngine`). Swapping in a native recognizer later touches `asr.ts` and `asr-offline.ts` only.

| | Browser engine | On-device engine |
|---|---|---|
| Backend | `SpeechRecognition` (Web Speech API) | `onnx-community/whisper-base` via transformers.js |
| Model | vendor, on their servers | ~76 MB quantised weights (~81 MB with the ML runtime), downloaded once on consent |
| Licence | n/a | MIT (ONNX conversion of OpenAI's Whisper weights) |
| Taglish quality | strongest available | materially better than `whisper-tiny`, still behind Google |
| Works offline | **no** | **yes** |
| Cost | ₱0 to SeePat | ₱0 to SeePat and to the owner |

**Why the browser engine stays the default.** Google's recognizer is the strongest Taglish model
reachable from any client at any price. It is also a *network* feature, which is the one thing an
offline-first product cannot ship as its only voice path. The offline engine is the fallback for
when there is no signal — which is precisely when a store owner is most likely to be recording.

**Why not the 320MB Tagalog model.** The original concept costed offline voice around
`vosk-model-tl-ph-generic-0.6`, a 320MB Tagalog model. It is licensed **CC-BY-NC-SA**, which
forbids commercial use, so it cannot ship in this product at all. It is still listed in the in-app
model catalogue with `installable: false` and the reason, so the answer lives inside the product
rather than in a footnote. The shipped alternative is an order of magnitude smaller and MIT
licensed.

**Why `@huggingface/transformers` is pinned to exactly `3.7.6`.** Version 4.x bundles an ONNX
Runtime whose graph optimiser refuses to build a session for these quantised weights, failing with
`qdq_actions.cc: TransposeDQWeightsForMatMulNBits Missing required scale` on every dtype,
including fp32, and identically with a cold cache. 3.7.6 loads the same weights correctly. If a
future bump breaks offline voice, **this pin is the first thing to check.**

**How the on-device model actually runs — measured, not assumed.** Inference executes in a worker
via `onnx.wasm.proxy` rather than on the page's thread, so a transcription cannot freeze the
interface: a blocked main thread cannot paint a spinner, so no amount of loading-state polish would
have fixed the "hang". WebGPU is deliberately **not** used, and that is a measurement rather than a
preference — the WebGPU path silently selects fp32 weights instead of q8, taking the download from
the promised ~42MB to **154MB**, while a 3-second clip still took **7.7s cold and 7.6s warm** on a
machine that does expose a WebGPU adapter. The q8/WASM path with the worker proxy measured **2.1s**
for the same clip, with the interface still painting. Cheaper *and* faster: enabling WebGPU would
have charged the owner 3.5× the data for a slower result.

**Which Whisper, and why not the best one.** The installable model is
`onnx-community/whisper-base`: 74M parameters instead of `whisper-tiny`'s 39M, measured at **76MB**
of weights and **3.5s** for a 3-second clip (tiny measured 2.1s on the same clip). The upgrade was
taken because accuracy is the owner's actual problem — tiny returned their own sale as a different
sentence — and base is materially stronger on short, code-switched utterances, which is what this
product records.

The size figure is worth trusting over the in-progress display: the library's download callbacks
under-report (they summed to 51MB for what the browser cache showed was 76MB). That same cache also
exposed a bug — the installed-size badge summed the *shared* cache, so it reported **262MB** for this
76MB model once an earlier `whisper-tiny` install was still present. It now measures this model's
own files, because a badge that reads as "what this cost me" has to be true in a product where data
is bought by the megabyte.

The better Tagalog models on the Hub are not an option *in a browser*: the strongest fine-tune
found, `LWobole/whisper-small-tagalog` (**16.7% WER** on FLEURS `fil_ph`), publishes safetensors
only, and transformers.js can only load ONNX. A model that cannot be loaded is worthless however
accurate it is, so the choice is constrained to the ONNX-ready set — where base is the sweet spot.
`whisper-large-v3-turbo` is ONNX-ready and far stronger, and is also ~800MB, which is not a
download to put in front of a sari-sari store on prepaid data.

**Silence is never sent to the model.** Given silence, a Whisper model does not return nothing — it
invents a fluent sentence. Measured on these weights with three seconds of silence: `"[Musica]"` in
one run, `"[Song ang kawakong]"` in another. That is the *"it transcribed something completely
different from what I said"* failure, and because no downstream check can tell a hallucination from
a real reading, a recording containing under 200ms of detected speech is refused **before** the call
and the owner is told nothing was heard.

**The parser is constrained on purpose** (`engine/voice.ts`), with three constraints each tied to
a failure mode:

1. **Constrained vocabulary.** The recognizer is only asked to distinguish items this store
   actually sells, plus numbers. Free-form Taglish transcription runs at 19–25% word error on the
   best available engines; slot-filling against a known SKU list is an engineering problem, not a
   research one.
2. **Numbers never auto-post.** Item identity is safe to infer; quantities and prices are not.
3. **Drafts, not records.** `parseSpoken` returns a draft that cannot be persisted until accepted.

Whisper-family models can also hallucinate fluent text from silence, which is exactly why the
draft-confirmation step is not optional.

**When a take ends, and what happens next.** Neither engine asks the owner to say when they are
done. The browser engine ends the session through Google's own endpointing; the on-device engine
watches the live level and ends the take after ~1.8s of silence. Four rules govern that, each tied
to a way it could go wrong: 300ms of speech must be heard first (a cough or a tap on the counter
cannot end a take before it starts), 1.8s rather than 3s (long enough to survive the pause in
*"limang Coke … bayad cash"*, short enough not to feel stuck), 10s of total silence abandons the
take (an accidentally opened microphone gets an answer, not a red light), and a 30s ceiling
backstops both.

A take that **ends on its own** is parsed immediately into the confirmation table — speak, check,
confirm. A take the owner **stops by hand** is deliberately not parsed: the partial words land in
the text box to be finished, because half a sentence parses to wrong quantities. Nothing reaches
the ledger on either path until "Confirm and record".

## 8. Offline & the PWA

The offline story has two halves, and only one of them is a build concern.

**The app shell.** A service worker is emitted into the **production build** only. `npm run dev`
therefore has no service worker at all — which is why offline appears "broken" while developing:
nothing is cached because nothing has been built. `npm run offline` builds and serves the real
thing; `npm run dev:offline` turns the worker on in dev for testing.

**The voice model.** Weights are fetched from the Hugging Face CDN on an explicit user download
and cached by the browser, so voice keeps working with no signal afterwards. SeePat pays no
bandwidth for it and the owner pays nothing for it, which is why it sits in the free tier.

**What is precached (15 entries, 577.82 KiB — verified against the generated `sw.js`):**

| Asset | Precached? | Why |
|---|---|---|
| App JS, CSS, HTML, fonts, wordmark | yes | it is the interface |
| `pwa-192`, `pwa-512`, `pwa-maskable-512` | yes, once each | the platform re-reads the icon when launched from the home screen — where "no signal" is the normal condition |
| `og-image.png` (72 KB) | **no** | fetched by crawlers, never by the interface |
| `apple-touch-icon.png` | **no** | captured once when the app is added to the home screen |
| `offline-voice-*.js` (843 KB) | **no** | lazy-loaded only by an owner who chooses the offline engine; charged to nobody else |

Runtime caches: `wasm-runtime` (ONNX Runtime `.wasm`, CacheFirst), `onnx-runtime-cdn` (a safety
net for transformers.js CDN fallbacks), and `app-assets` (scripts and styles, CacheFirst).

**There is deliberately no `huggingface.co` rule.** transformers.js already persists model weights
in its own Cache Storage bucket; a second CacheFirst rule for the same responses stores every
weight twice — measured at **41.6 MB duplicated**, which is real money on a Philippine mobile
plan. The library owns its own cache; the service worker only caches what the library does not.

**Installability, and the bug that broke it.** Chrome offers "Install app" only when the manifest
declares a **PNG icon of at least 144px**. An SVG entry is accepted by the manifest parser and
ignored by the installability check, so a manifest whose only icon is an SVG looks perfectly
correct in devtools and never installs. That was the bug; the manifest now ships PNGs at 192 and
512, plus a separate **maskable** 512 (a rounded tile declared maskable has its corners shaved by
Android, so the safe-zone padding is baked into its own file).

All icons, the Apple touch icon, the 1200×630 social card, and the header wordmark are generated
from a single source image by `node tools/make-assets.mjs` (sharp) — reproducible, nothing
hand-exported.

**Manifest:** `id: '/'` (without it, the installed app's identity is its `start_url`, and changing
that URL later installs a *second* app beside the first instead of updating it), `display:
standalone`, `orientation: portrait`, theme/background `#f5f7fb` matching the page canvas.

**Boot splash.** Static HTML in `index.html`, so it paints on the first byte — a React-rendered
splash cannot. The handoff is the app's half of the contract (`src/boot.ts`): the splash is held
for a **2-second floor** (800ms under `prefers-reduced-motion`, where there is no animation to
watch) and released at a *real* lifecycle point — the first committed frame with `document.fonts.ready`
settled, because the first screen is numbers set in Sora and handing over early means watching the
interface reflow a beat after arriving. It **fails open**: an inline 3200ms timer removes the
splash if the bundle never runs, so a crash in the app can cost you the app but never a screen you
cannot leave.

**Welcome deck.** Three slides (`speak`, `see`, `yours`), shown **once** — a tour that reappears
every launch is an advertisement, and owners learn to dismiss it without reading, which then costs
you the one time it mattered. It is gated on a versioned flag (`WELCOME_VERSION`), so a genuinely
new pillar re-shows it once to everyone. Swipe, keyboard arrows, and a Next button all work; it
can be replayed from Settings.

## 9. Internationalization

**Two languages, one switch. English is the default; Tagalog is a first-class peer.**

English is the default because that is the language the product is pitched and reviewed in.
Tagalog is the language the product was *written* in, so `fil` copy is generally the sharper of
the two.

Three properties worth knowing:

- **Language is not a React context.** `useLang()` is a small external store over
  `useSyncExternalStore`, so the *engine* can read the current language without a provider, the
  setting survives a reload, and nothing re-renders that does not display copy.
- **Copy is data, not code.** Engine modules carry bilingual tables next to the logic that uses
  them (they are pure and take a `lang`); screen copy lives in the `UI` table in `i18n/index.ts`.
  Both paths go through one interpolation and fallback rule, `tr()`.
- **A missing translation is a build error, not a blank label.** `Entry` requires both languages.

Formatting is locale-aware and lives in the same module: `dayMonth` ("Sep 15" / "Set 15"),
`dayMonthYear`, times as 12-hour AM/PM in both languages because a Filipino reader uses AM/PM, and
`Intl.NumberFormat('en-PH')` for currency in both.

The document `lang` attribute is synced before first paint (`syncDocumentLang()` in `main.tsx`),
so a Tagalog session never flashes as English to a screen reader.

**The engine's own sentences are translated too.** Ask answers, warnings, and mascot bubbles are
produced by `narrator.ts` in the reader's language — this was a real bug class: an English
question starter ("What is my strongest item?") initially failed to parse and landed in `unknown`.
`i18n.test.ts` now proves that every suggestion parses in both languages and that no copy string
is missing on either side.

## 10. Design system

**Light theme only, deliberately.** The target user records at a lit counter in daylight. Tokens
live in `src/index.css` (928 lines) and every screen reads from them.

**Type.** `Sora` for figures and display (geometric, instrument-like), `Plus Jakarta Sans` for
body. Both self-hosted as variable fonts (`@fontsource-variable/*`) — no Google Fonts request, so
type is not a network dependency.

**Palette.** Navy (`brand`) carries the interface, gold (`gold`) carries meaning — the plan you
are on, the premium action — and flag red is reserved for genuine alert states. Tiers climb
grey → gold → navy, so the hierarchy is legible without reading copy.

**Materials, not boxes.** A flat white rectangle with a grey stroke is a wireframe regardless of
the type inside it. Cards therefore carry: a fill with a top and a bottom (white → `#f7f9fd`), a
three-layer elevation (1px contact shadow, a mid layer that models the form, a wide ambient pool
that suggests height), and edges as 6% alpha navy hairlines that tint with whatever is underneath
rather than being drawn around it. A `flat` variant exists for cards that bring their own fill,
because a `background-image` paints *over* a `background-color`.

**Texture goes behind the interface, not inside it.** A 22px dot grid sits at `z-index: -1`,
strongest behind the header and dissolving by mid-page, with floor glows so a long scroll never
goes dead. Nothing patterned is ever placed under the numbers.

**Motion.** Every motion is CSS keyframes; there is no animation library and no runtime cost. The
polish is that no two motions share a period, so the loop never becomes visible:

| Part | Period | Motion |
|---|---|---|
| breathe | 3.7s | body lifts, chest expands |
| blink A | 4.3s | eyelid shuts for ~2% of the cycle |
| blink B | 6.9s, offset −1.7s | same, on its own clock (occasionally double-blinking) |
| head sway | 5.1s | ±3.4° |
| wings | 6.2s, right offset −1.4s | ±6.5° |
| ear tufts | 7.3s, right offset −2.6s | twitch at 93% of the cycle |
| pupil scan | 9.7s | sub-pixel gaze drift |
| gauge bezel | 26s | one full rotation |

`prefers-reduced-motion` is honoured throughout, and poses remain correct with motion off — a
worried Pat still looks worried.

**Pat, the owl** (`ui/Pat.tsx`). One character, five outfits — apron and pen for the books
(Twin), headphones for listening (Voice), reading glasses for answering (Ask), a beanie for
Offline — chosen by prop rather than a redesign per screen. On the jewel card the body inverts to
lit gold like the sun in the mark, but the face is tone-independent, because the first pass had
navy wings vanishing into a navy card and gold-300 props vanishing into a white face. Mood comes
from the Sipat band (`moodForScore`) or the real voice-capture state, and is announced to screen
readers in the reader's language.

## 11. Commercial model

Simulated in full, with no payment gateway and no server. What `billing.ts` actually encodes is
the *rule* pricing is built on, so the free tier cannot quietly become loss-making as features are
added:

> ### On-device is free. Server is paid.

| Tier | Price | For | Position |
|---|---|---|---|
| **SeePat FREE** | ₱0, lifetime | the owner just starting to keep records | the entire local product |
| **SeePat PRO** | ₱99 / month | steady sales, wants to understand profit | AI narration, backup, score history |
| **SeePat NEGOSYO** | ₱199 / month | growing store with staff and suppliers | forecasting, benchmarking, team |
| **Institution** | bulk licence | cooperatives, LGUs, livelihood programs | aggregate dashboard |

**18 features** are declared with an `onDevice` flag in a single table. The eight free ones —
ledger, inventory, utang, capital views, deterministic Ask, voice capture, **the offline voice
model**, and the current score — are exactly the ones with ₱0 marginal cost. The ten sold ones all
require a server to be worth anything (narration, history, backup, receipt OCR, restocking,
multi-user, forecasting, supplier intelligence, benchmarking, report export), so stopping a
subscription withdraws a service rather than revoking something downloadable.

`billing.test.ts` asserts that **no free feature is cost-bearing** — the unit economics are
enforced by the suite rather than remembered by a human.

**AI narration is metered**, not unlimited: `AI_QUESTION_LIMIT = 300` questions per month, with
`aiQuestionsRemaining` surfaced in the UI. The simulation covers checkout as well: a chosen
payment method produces a mock invoice with a generated reference number, and grants the
entitlement through the same `can(tier, feature)` gate the UI reads.

**Paid features that exist as UI are gated honestly.** Ask shows its lock over a *preview of real
evidence* and reports remaining quota; Score gates the trend chart the same way. The prototype
never fakes a finished paid feature.

## 12. Tech stack

| Layer | Choice | Version | Why this and not the obvious alternative |
|---|---|---|---|
| UI | React | 19.3 | `useId` gives every SVG instance unique gradient ids; no state library because the app has two hooks of state |
| Language | TypeScript | 7.0 | `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch` — plus `tsc --noEmit` in the build |
| Build | Vite + rolldown | 8.3 | sub-second builds; `manualChunks` isolates the offline voice runtime |
| Styling | Tailwind CSS | 4.3 | `@tailwindcss/vite` with tokens as CSS custom properties, so one variable changes every screen |
| PWA | vite-plugin-pwa (Workbox) | 1.3 | precache + runtime cache declared in one place instead of hand-written cache logic |
| On-device ML | `@huggingface/transformers` | **3.7.6 (exact)** | Whisper Base runs in-browser with no server; pinned — see §7 |
| Fonts | `@fontsource-variable/sora`, `plus-jakarta-sans` | 5.3 | self-hosted, no third-party request, no FOUT on a slow connection |
| Tests | Vitest | 5.0 | pure-logic suites in a **node** environment — no jsdom, no DOM mocking |
| Asset pipeline | sharp | 0.35 | one source image → icons, touch icon, social card, wordmark |
| Runtime requirement | Node | `^20.19 \|\| >=22.12` | Vite 8's own engine range. Developed on Node 22.18 / npm 11.14 |

**No runtime the app didn't need.** There is no state manager, no router, no animation library,
no UI kit, no HTTP client, no i18n framework, and no date library. The only runtime dependency
that is not React or a font is the on-device ML library, and it is lazy-loaded.

**The application code makes no network requests of its own** — there is not a single `fetch()` in
`src/` outside the ML library's own model download. The network is touched in exactly three ways:
the browser's speech recognizer, the one-time consented model download, and service-worker asset
fetches.

## 13. Getting started

**Prerequisites:** Node `^20.19` or `>=22.12`, and npm.

```bash
git clone https://github.com/dev-lou/SeePat.git
cd SeePat
npm install
npm run dev            # http://localhost:5173
```

The app seeds itself with a deterministic 21-day sari-sari ledger on first run — **233
transactions, 10 SKUs, 4 customers** — because a brand-new owner has an empty Twin and none of the
differentiators exist on day one.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server, **no service worker** (so offline looks broken — see below) |
| `npm run dev:offline` | dev server with the service worker enabled (`--mode pwadev`) |
| `npm run build` | `tsc --noEmit && vite build` — typecheck is part of the build |
| `npm run offline` | build, then serve the production bundle — **the honest offline test** |
| `npm run preview` | serve an existing build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest, single run |
| `npm run test:watch` | Vitest, watch mode |
| `npm run check:contrast` | audits every token pair against WCAG |

### Testing offline behaviour

```bash
npm run offline        # then in Chrome: DevTools → Application → Service Workers → Offline
```

Also verify with a cold cache, because a warm service worker hides the failure you are looking
for: DevTools → Application → Storage → Clear site data, reload while offline, and confirm the
shell renders.

### Environment

`VITE_SITE_URL` is the only variable. It is committed **empty on purpose**: the OG/Twitter card
URLs are built as `%VITE_SITE_URL%/og-image.png`, and a wrong hardcoded domain is worse than a
relative path because it points at somebody else's server.

```bash
# .env
VITE_SITE_URL=https://seepat.ph     # no trailing slash
```

With it empty the tags fall back to root-relative paths, which Twitter, Slack and WhatsApp resolve
correctly; Facebook does not.

## 14. Testing & verification

**169 tests across 12 files**, all in a `node` environment — no jsdom, which is the practical
consequence of keeping the engine pure.

| Suite | Lines | What it guards |
|---|---|---|
| `engine/intelligence.test.ts` | 295 | score decomposition, bands, dimension contributions, the `sufficientData` gate |
| `engine/twin.test.ts` | 214 | folding: every transaction kind, payables, receivables, warnings |
| `engine/capital.test.ts` | 182 | the composition/provenance identity `Assets − Liabilities == Capital − Withdrawals + Cumulative Net Profit` |
| `billing.test.ts` | 180 | entitlement gates, quota reset, mock invoices, **and that no free feature is cost-bearing** |
| `engine/history.test.ts` | 89 | weekly score recomputation is stable and reproducible |
| `i18n/i18n.test.ts` | 240 | no missing copy in either language; every starter question parses; document lang |
| `ui/pat.test.ts` | 129 | band → mood mapping, voice-state moods, the tip is the engine's own string in both languages |
| `onboarding.test.ts` | 107 | versioned first-run gate, slide clamping |
| `shell.test.ts` | 90 | `index.html`'s contract: splash floor and fail-open deadline, OG/Twitter tags, manifest icons |
| `asr.test.ts` | 276 | speech failures are *diagnosed* rather than printed; the `fil-PH` → `en-PH` retry; a final transcript arrives with its final flag; every engine reports its session ending, including when starting throws |
| `audio.test.ts` | 125 | the take-ending rule (1.8s of silence, a mid-sentence pause survives, a throttled timer cannot cut one short) and the speech-presence measure that keeps silence away from the model |
| `asr-offline.test.ts` | 88 | a stored install record is only trusted for the model the runtime actually loads |

`shell.test.ts` is the one that keeps the *shell* honest — the splash timing and social metadata
are not reachable from TypeScript, so they are asserted by reading `index.html`. The three voice
suites exist because that is where the behaviour is least visible: a stuck microphone, a wrong
transcript and a stale model record all look the same from the outside — like nothing happening.

```bash
npm run typecheck      # tsc --noEmit
npm test               # 169 passing
npm run check:contrast # all token pairs, WCAG AA
npm run build          # typecheck + production build
```

**Contrast is audited, not eyeballed.** `tools/contrast-check.mjs` tests every foreground/background
token pair the app can produce. It is deliberately stricter than it needs to be: dark text is
tested against `#f7f9fd` (the foot of the card gradient) rather than pure white, because testing
against white flattered the palette by about 0.05:1. Two amber data marks were moved a step darker
by this audit after it caught them passing at **3.02:1** — passing, and that was the problem: a
0.02 margin is a coincidence, so the next token nudge would have broken the build for no visible
reason.

## 15. Build output & performance

Measured from `npm run build` (uncompressed / gzip):

| Asset | Size | Notes |
|---|---|---|
| `index.js` | 397.5 KB / **119.2 KB** | React + app + engine |
| `index.css` | 59.5 KB / **10.9 KB** | Tailwind 4 + tokens |
| `offline-voice.js` | 843.3 KB / 214.1 KB | **lazy** — only fetched on explicit model download |
| `rolldown-runtime.js` | 0.6 KB / 0.4 KB | |
| **Service worker precache** | **15 entries, 577.82 KiB** | what every install costs on prepaid data |

That precache number is treated as a product constraint, not a build statistic: it is what an
owner pays in mobile data for the app to work with no signal. The social card is excluded from it,
the ML runtime is lazy and runtime-cached instead, and a 491 KB wordmark was once trimmed to 16 KB
for the same reason. The 843 KB ML chunk is split by `manualChunks` so it is never on the startup
path.

## 16. Accessibility

- **Language of the page** is set before first paint and updated on switch, so screen readers
  pronounce copy correctly in both languages.
- **`prefers-reduced-motion` is honoured everywhere**: the splash shortens to 800ms, and every
  mascot and ambient animation stops while poses stay correct.
- **Contrast is machine-checked** against a stricter floor than WCAG AA requires (§14).
- **The mascot is decorative with an accessible name**: its mood is announced in the reader's
  language ("Pat — nag-aalala") rather than being a silent image.
- **Numbers are never color-only**: deltas and warnings carry signs, words, and the existing
  ledger language.
- **Keyboard**: the welcome deck is navigable by arrows and Escape, and every control is a
  semantic `<button>`.

## 17. Limitations & roadmap

Honest status, because a prototype that overstates itself is a liability.

**Not built (declared and priced, but unimplemented):**

- **LLM narration.** Metered and gated in `billing.ts`; no model call exists. The deterministic
  narrator is what actually answers.
- **Cloud backup, score history sync, benchmarking, multi-user.** All require a server that does
  not exist in this repository.
- **Receipt OCR, supplier intelligence, report export.** Declared in the feature table only.
- **Real payments.** The checkout is simulated end to end; no gateway, no webhook, no idempotency.

**Deliberate prototype shortcuts:**

- **Persistence is `localStorage`, not SQLite over OPFS** as the concept specifies. The engine is a
  pure fold, so this is a one-file swap; the prototype chose the option that cannot fail on a WASM
  filesystem.
- **No router.** Five tabs and two secondary screens are handled by local state in `App.tsx`.
- **Seeded demo data on first run**, because cold start is otherwise undesigned — an empty Twin has
  no differentiators. A guided first stock take is the intended replacement.

**Open engineering questions:**

- **On-device Taglish accuracy** is the honest weak point, and the one claim in this document that
  is *not* measured: the move from `whisper-tiny` to `whisper-base` was decided on architecture and
  download cost, not on a Tagalog accuracy test, because no labelled Filipino audio was available in
  the build environment. It should be confirmed by ear on a real phone before it is trusted. Either
  way it stays behind the browser engine, which is why it is the fallback and why the draft step is
  mandatory.
- **The transformers.js pin** must be re-tested before any upgrade (§7).
- **`Date.now()` and clocks.** Period boundaries are the device's local time; a store that closes
  late and records next morning makes the day boundary a real product concern rather than an
  implementation detail.

## 18. Documentation

| Document | Contents |
|---|---|
| `SeePat_Final_Startup_Concept.md` | The full concept: problem, market, modules, positioning, pillars |
| `CONCEPT_NOTE_CORRECTIONS.md` | Change log of **14 numbered corrections** to the original note — with the reasoning for each |
| `PSCXI_Concept_Note_SeePat_CORRECTED.md` | Submission-formatted note |

The corrections log is worth reading before the concept note. It records the substantive fixes
this implementation is based on: *puhunan* meaning two different things, a COGS formula that
contradicted the product's own central promise, a Sipat Score with no published weights (i.e. not
reproducible despite claiming to be), unit economics that were never modelled, an over-promised
voice pipeline, an undesigned cold start, ambiguous void semantics, and the brand rename from
TimbangAI to SeePat.

## 19. Licensing

**This repository currently has no licence file.** Absent one, the default is all rights reserved
— the code is public to read, not to reuse. That is a decision to make deliberately (in particular
whether the business model needs a proprietary core), and the following third-party terms already
apply regardless:

| Component | Licence |
|---|---|
| `onnx-community/whisper-base` weights | MIT (OpenAI Whisper) — commercial use permitted |
| `vosk-model-tl-ph-generic-0.6` | CC-BY-NC-SA — **not installable; cannot ship commercially** |
| Sora, Plus Jakarta Sans | SIL Open Font License (licence texts in `public/fonts/`) |
| React, Vite, Tailwind, Vitest, Workbox | MIT |

Brand assets (`seepat_logo.png`, `public/*`) are the project's own and are not covered by any
permissive grant.
