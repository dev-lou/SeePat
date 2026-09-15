# PHILIPPINE STARTUP CHALLENGE XI

**TEAM NAME:** _(fill in)_
**STARTUP NAME:** SeePat
**CONCEPT NOTE**

> **Name note for the team:** the earlier concept note was filed as **SeePat (SIPAT)** while the
> refined document used **TimbangAI**. That draft argued for TimbangAI — *"timbang"* (to weigh) is a
> natural *spoken address* for a voice-first product, and the owner literally says *"Timbang,
> nakabenta ako ng…"* — whereas *"sipat"* (to observe) describes looking at a dashboard. **That
> recommendation is withdrawn: SeePat is the name registered with DICT**, so it is the name used in
> this note, the deck, the prototype UI and the installable app. The prototype's wake word is
> therefore *"Sipat, …"* and its icon is an eye rather than a balance scale.

---

## I. SUMMARY

SeePat is a mobile-first, voice-enabled financial decision copilot for Filipino
microentrepreneurs — sari-sari stores, carinderias, public-market vendors, home-based sellers and
neighborhood retailers.

It addresses a practical decision gap: **owners know how much money entered the cash box today, but
not how much they actually earned.** Sales, expenses, inventory, customer credit (*utang*) and
household withdrawals are tracked separately, or not at all, which makes *"Kumikita ba talaga
ako?"*, *"Nasaan ang puhunan ko?"* and *"Bakit malakas ang benta pero walang natitirang pera?"*
surprisingly difficult to answer.

Unlike a conventional POS or bookkeeping app, SeePat is positioned as **explainable,
conversational decision intelligence**. Deterministic accounting formulas compute every financial
figure; AI is confined to interpretation, explanation and prediction. The core promise:

> **Millions of Filipino entrepreneurs know how much they sold today. SeePat helps them
> understand how much they actually earned — and what to consider doing tomorrow.**

**Current status:** a working prototype exists, with the deterministic finance engine covered by an
automated test suite (see Section IX.C).

---

## II. BACKGROUND OF THE PROBLEM

Many microentrepreneurs still depend on notebooks, calculators, memory, chat messages or fragmented
digital tools. These methods make it hard to connect sales, expenses, inventory, receivables and cash
into one reliable view of business health.

**Scale.** 2024 Philippine MSME statistics report **1,236,908 MSMEs, or 99.63% of all business
establishments**, with **microenterprises alone accounting for 1,125,476 — 90.66% of
establishments.** _(Source: Philippine Information Agency, citing DTI/PSA 2024 MSME statistics.)_

**Digitalisation gap.** DTI's MSME baseline found **23% of surveyed MSMEs did not use ICT tools for
business, 51% used only basic tools, and only 6% used advanced digital tools; 73% reported a need for
capacity building, particularly in financial management, customer development and content
management.** _(Source: DTI, Baseline Survey on Digitalization of MSMEs in the Philippines,
September 2020.)_ National programmes such as DTI's **"Tindahan Mo, e-Level Up Mo!"** continue to
promote sari-sari store and MSME digitalisation.

**The five recurring information gaps.** A microentrepreneur might say *"₱8,000 ang benta ko
ngayon."* But ₱8,000 in sales is not ₱8,000 in profit: some is inventory cost, some is operating
expense, some may be *utang*, some may have been withdrawn for the household, and some capital may be
sitting in slow-moving stock. The owner sees **cash movement**, not the **financial state of the
business**:

1. **Profit gap** — *Magkano talaga ang kinita ko?*
2. **Capital gap** — *Nasaan ngayon ang puhunan ko?*
3. **Cash-flow gap** — *Bakit mataas ang benta pero kulang ang cash?*
4. **Inventory gap** — *Ano ang mabilis maubos at ano ang hindi gumagalaw?*
5. **Decision gap** — *Ano ang dapat kong gawin bukas?*

The problem is therefore **not simply the absence of POS software.** It is the absence of
**accessible business intelligence for entrepreneurs who are not accountants or data analysts.**

---

## III. PROPOSED STARTUP SOLUTION

SeePat follows a continuous loop:

**RECORD → COMPUTE → UNDERSTAND → PREDICT → DECIDE**

Owners record sales, purchases, expenses, inventory movements and customer credit through simple
forms, conversational text, or a proposed voice-to-transaction interface. Every verified transaction
updates a **Microenterprise Business Twin** — a live digital representation of cash, inventory,
receivables, payables, sales, expenses and profitability.

### A. Trust architecture: AI does not produce the numbers

**Business Records → Financial Engine → Business Twin → Analytics → AI Explanation → Owner Decision**

Never:

**Business Records → LLM → Financial Answer**

Every figure an owner sees is computed by deterministic formulas from their own verified ledger. This
makes the system accurate, auditable, explainable and technically defensible — and it is the reason
the prototype's AI-free answering layer can run **offline at zero marginal cost**.

### B. Core modules

| Module | Function |
| --- | --- |
| **Sipat Ledger** | Sales, purchases, expenses, cash movement |
| **Sipat Inventory** | Stock, cost of goods sold, fast/slow movers, restocking |
| **Sipat Utang** | Customer receivables and repayment tracking |
| **Sipat Voice** | Voice/text to structured business transactions |
| **Sipat Insights** | Explainable business recommendations |
| **Sipat Score** | Versioned, decomposable business-health indicator |
| **Nasaan ang Puhunan Ko?** | Capital decomposition and visualisation |

### C. Two distinct capital questions *(corrected)*

The earlier concept note used the word *puhunan* for **two different questions**, and both worked
examples summed to a believable total — which is precisely why the ambiguity survived review. They
are now separated and stated precisely:

**1. COMPOSITION — "Nasaan ang Puhunan Ko?"** Where capital sits **right now**:

```
Assets − Liabilities = Cash + Paninda + Utang sa Iyo + Kagamitan − Utang sa Supplier
```

**2. PROVENANCE — "Saan Napunta ang Pera Ko?"** How capital was built and consumed **since
inception**:

```
Puhunan na Inilagay + Naipon na Kita
      = Kinuhang Pera + (Cash + Paninda + Utang sa Iyo + Kagamitan − Utang sa Supplier)
```

Withdrawals and expenses are **flows, not locations**. They cannot be a place where capital currently
*sits*, so they never appear as a composition component. Both views are guaranteed consistent because
they reduce to the same identity, which the prototype asserts after every transaction:

```
Assets − Liabilities  =  Capital Injected − Withdrawals + Cumulative Net Profit
```

### D. Cost of goods sold *(corrected)*

The earlier note specified `COGS = Opening Inventory + Purchases − Closing Inventory`. That is the
**periodic** method, and it **requires a physical stock count** — which makes a *daily* profit figure
impossible, contradicting the product's own promise to answer *"Magkano kinita ko ngayong linggo?"*

SeePat therefore uses **perpetual inventory at moving weighted average cost**: cost of goods sold
is derived at the moment of each sale, so daily profit is available **without counting shelves**.
Inventory value is held as an exact integer in centavos and the cost basis is never a rounding
accumulator, so the books cannot drift. Stock adjustments (spoilage, shrinkage) carry their own cost
basis, and sales recorded before the matching purchase is entered produce a *negative* inventory
position — which keeps the identity intact and self-corrects when the purchase is recorded, rather
than silently booking cost against an asset that was never created.

### E. Sipat Score *(corrected)*

The earlier note promised a score that is "not an arbitrary AI-generated score" and "decomposable
into its contributing metrics" — but published no weights, normalisation or baseline, which left it
underdetermined and therefore not reproducible. **Sipat Score v1** now publishes six weighted
dimensions whose weights sum to exactly 1.00:

| Dimension | Weight | Basis | Full marks at |
| --- | --- | --- | --- |
| Profitability *(Kita)* | 0.25 | Net margin | 20% margin |
| Cash-flow health *(Cash)* | 0.20 | Weeks of operating outflow covered by cash | 2× |
| Inventory efficiency *(Galaw ng Paninda)* | 0.15 | Inventory turnover | 2× per period |
| Receivable exposure *(Utang sa Iyo)* | 0.15 | Outstanding utang ÷ period sales | 0% (zero at 50%) |
| Expense control *(Gastos)* | 0.15 | Operating costs + shrinkage ÷ sales | 20% or below |
| Sales stability *(Tibay ng Benta)* | 0.10 | Day-to-day coefficient of variation | 0% (zero at 100%) |

The same ledger always yields the same score; every point of the total is attributable to a named
dimension. The score is **versioned** so that changing the model never silently changes an owner's
history.

### F. Voice-to-transaction *(corrected — with honest constraints)*

Voice is constrained along three deliberate axes, each tied to a real failure mode:

1. **Constrained vocabulary, not open transcription.** The recogniser is only asked to distinguish
   items the store actually sells, plus numbers. Free-form Taglish transcription runs at roughly
   **19–25% word error** on the best available engines; slot-filling against a known SKU list is an
   engineering problem rather than a research problem.
2. **Numbers never auto-post.** A misheard item name is obvious on screen; a misheard **quantity or
   price silently corrupts the ledger and every downstream insight.** Item identity may be inferred;
   amounts and quantities always require explicit owner confirmation.
3. **Drafts, not records.** Voice parsing produces a draft that cannot be persisted until the owner
   accepts it. This makes "AI never silently modifies financial records" a property of the software
   rather than a promise.

**Offline voice is now downloadable and patent in the prototype.** The 320MB `vosk-model-tl-ph`
remains unusable — it reports ~18.9% word error on clean read speech and 97.9% on the BABEL set, and
its **CC-BY-NC-SA licence forbids commercial use**. But it is not the only option: a **multilingual
Whisper Tiny** model runs fully on-device in the browser, at roughly **42MB** quantised, under an
**MIT licence** that permits commercial shipping. The prototype downloads it once (with real progress
and a real installed-size figure), stores it in the browser cache, and transcribes with no network
whatsoever. The app shows the 320MB model too — as an explicitly non-shippable option, with the
licence reason stated — because "why not just download the free Filipino one?" is the first question
any informed reader asks.

The accuracy caveat stands and is unchanged: a tiny multilingual model is noticeably worse on
Taglish than Google's server recogniser, and Whisper-family models can hallucinate fluent text from
noise or silence (ACM FAccT 2024). It is therefore offered as an **offline fallback, never the
default**, and it inherits the three constraints above — so even a hallucinated sentence cannot reach
the ledger without the owner confirming its quantities and prices. Voice remains an **accelerator
rather than a prerequisite**: every flow it serves has an equivalent typed path, and the answering
layer works offline.

**One implementation note for the team.** On-device inference depends on ONNX Runtime, and the
version bundled by the current `@huggingface/transformers` release had to be pinned (3.7.6) because
newer builds fail to build a session for these quantised weights with an internal
graph-optimiser error. If a future bump breaks offline voice, this pin is the first thing to check.

### G. Offline-first behaviour

SeePat is a mobile-first Progressive Web App. The deterministic engine, the Business Twin, the
capital views, the question-answering layer and — once its model is downloaded — **voice capture** all
run **on-device**, so recording and basic intelligence never depend on connectivity.

The prototype makes this legible rather than aspirational: a *Kalagayan* panel reports live
connectivity, whether the app shell is cached, whether the device can record audio, and how much
storage the app is using; and it lists exactly which features work with no signal and which need a
server, generated from the same feature catalogue that drives pricing. Network-dependent features are
labelled as such. This keeps internet availability from becoming a precondition for running the
business.

### H. SDG alignment

- **SDG 8 — Decent Work and Economic Growth:** entrepreneurship, productive activity and MSME
  development.
- **SDG 9 — Industry, Innovation and Infrastructure:** accessible digital transformation for the
  smallest enterprises.
- **SDG 10 — Reduced Inequalities:** business intelligence for entrepreneurs who cannot afford
  professional accounting and analytics.

---

## IV. OBJECTIVES

SeePat aims to democratise business intelligence for Filipino microentrepreneurs through an
accessible, explainable tool for financial visibility and everyday decision-making. Specifically:

1. Develop a functional mobile-first MVP integrating sales, expenses, inventory, utang, profit
   computation, Sipat Score and insights. **_(Substantially complete — see IX.C.)_**
2. Achieve **at least 95% accuracy against manually verified test cases** for deterministic
   financial computation. **_(Automated verification is in place; the accounting identity is asserted
   after every transaction.)_**
3. Pilot with **at least 30 microbusinesses** and achieve **at least 80% unaided completion** of
   essential workflows.
4. Demonstrate improved user ability to identify daily profit, inventory position, receivables and
   capital allocation versus baseline practices.
5. Validate adoption, retention and willingness to pay for premium decision-intelligence features.
6. Build a scalable, privacy-aware and offline-tolerant architecture for wider institutional and
   regional deployment.

---

## V. TARGET MARKET AND BENEFICIARIES

**Primary users:** sari-sari store owners, carinderias and food stalls, public-market vendors,
home-based sellers, and other micro-retail or service businesses.

**Secondary customers:** cooperatives, LGUs, livelihood programmes, microfinance institutions and
MSME-development organisations that can sponsor or procure group access.

Go-to-market is a **geographically concentrated pilot first**, expanding through institutional
partnerships rather than only one-by-one customer acquisition.

---

## VI. VALUE PROPOSITION

**SeePat does not claim that "POS + inventory + AI" is itself novel.** Existing Philippine
platforms already do much of that well, and claiming otherwise is the fastest way to lose a judge's
confidence.

### A. Honest competitive landscape

| Capability | Peddlr | Packworks | Lista / bookkeeping | StoreHub / full POS | **SeePat** |
| --- | --- | --- | --- | --- | --- |
| Sales, expense, inventory recording | ✓ | ✓ | ✓ | ✓ | ✓ |
| Customer utang tracking | ✓ | ✓ | ✓ | ✓ | ✓ |
| Offline operation | ✓ | Partial | Partial | ✓ | ✓ (deterministic layer) |
| Payments / e-wallet reconciliation | ✓ | ✓ | Partial | ✓ | **✗ not yet** |
| Receipt printing, barcode hardware | ✓ | ✓ | ✗ | ✓ | **✗ not yet** |
| Multi-branch / enterprise retail depth | Partial | Partial | ✗ | ✓ | **✗ not planned near-term** |
| Distribution scale | 2M+ stores | 270k+ stores | — | Regional | **Pre-pilot** |
| **Distinct capital decomposition (where the money actually is)** | ✗ | ✗ | ✗ | ✗ | **✓** |
| **Answers grounded in the owner's own verified ledger** | Partial | Partial | ✗ | Partial | **✓** |
| **Explainable, decomposable business score** | ✗ | ✗ | ✗ | Partial | **✓** |
| **Voice capture designed around Taglish business speech** | Limited | Limited | ✗ | ✗ | **✓ core** |
| **Works offline with zero marginal AI cost** | ✓ | Partial | Partial | ✓ | **✓** |

**Where SeePat is genuinely behind today:** payments and e-wallet reconciliation, receipt-printer
and barcode hardware support, and any distribution footprint. These are deliberate near-term
trade-offs, not oversights, and they are the reason the beachhead is microenterprise decision support
rather than retail infrastructure.

**Tax and compliance position (stated explicitly).** SeePat is a **management-accounting** tool:
it helps an owner understand their own business. It is **not** a BIR-registered point-of-sale and does
not issue official receipts. Stating this plainly is a strength — it avoids a heavy accreditation
programme and sets correct user expectations.

### B. Core positioning statement

> **POS records what happened. Bookkeeping calculates what happened. SeePat explains why it
> happened, where the money went, and what the entrepreneur should consider next.**

### C. Five innovation pillars

1. **Conversational Business Intelligence** — owners ask ordinary *negosyo* questions instead of
   interpreting dashboards.
2. **Voice-to-Business-Record** — natural speech becomes structured, auditable data, with mandatory
   numeric confirmation.
3. **Business Twin + Capital Intelligence** — transactions continuously rebuild a digital
   representation of where money and value actually reside.
4. **Explainable Decision Intelligence** — every recommendation shows the evidence behind it.
5. **Hyperlocal Financial UX** — Filipino-first business language (*benta*, *tubo*, *puhunan*,
   *utang*, *paninda*, *gastos*), with regional-language expansion, over rigorous accounting
   underneath.

---

## VII. BUSINESS MODEL

Freemium SaaS, designed so that the free tier costs almost nothing to serve.

The tiers are drawn along one rule, which the prototype enforces in code rather than in prose:

> **On-device is free. Server is paid.**

Everything that runs on the owner's own phone — the ledger, the Business Twin, the capital views, the
deterministic narrator, the browser speech recogniser, and the downloadable offline voice model —
costs SeePat **₱0 in marginal cost**, so it can sit in the free tier without losing money, and
nothing in it can be arbitraged: there is no downloadable asset to keep after cancelling. What is
sold is what has a marginal cost or needs a server to be worth anything.

### SeePat FREE — ₱0/month
Core transaction recording, inventory, utang tracking, daily and weekly profit, **Nasaan ang Puhunan
Ko?** and **Saan Napunta ang Pera Ko?**, the current Sipat Score, unlimited questions answered by
the **deterministic** engine — and **voice capture**, including the one-time download of the on-device
voice model.

> **Deliberate design decision:** the free tier uses **zero paid inference**. Every figure and every
> templated answer is computed from the owner's own records on-device, and voice recognition is
> performed by the owner's own browser or by a model running on the owner's own phone. This is what
> makes a free tier sustainable across a market of 1.1 million microenterprises.
>
> Voice is free **on purpose**. It is the product's centrepiece, so gating it would starve the exact
> behaviour the pitch depends on — and it costs nothing to give away, because neither the browser
> recogniser nor the on-device model bills SeePat per utterance. The concept note previously
> placed voice in the paid tier; that was a pricing choice made before the free path was measured.

### SeePat PRO — proposed ₱99/month
**AI na Paliwanag** — the LLM layer that explains *why* the deterministic figures moved, and the only
feature with a real per-use cost — plus Sipat Score history and trend, cloud backup and multi-device
sync, receipt photo import, and restocking recommendations.

### Institutional packages
Bulk licensing and aggregate dashboards for cooperatives, LGUs, livelihood programmes and partner
organisations. **This is treated as the primary long-term revenue channel, not a later add-on:**
direct ₱99 subscriptions from microentrepreneurs are a hard market to monetise when free
alternatives exist.

### Unit economics *(new — previously unmodelled)*

AI and speech costs scale with **usage per store**, not with seats, so they were modelled explicitly.
Published rates in 2026 are approximately **$0.006/minute for Whisper-class API transcription**,
**$0.016/minute for Google Cloud STT** and **$0.024/minute for AWS Transcribe.**

At roughly 8 seconds per spoken transaction:

| Voice transactions / day | Minutes / month | Approx. transcription cost | Against ₱99 |
| --- | --- | --- | --- |
| 20 | 80 | ~$0.48 (₱27) | Healthy |
| 50 | 200 | ~$1.20 (₱68) | Thin |
| 100 | 400 | **~$2.40 (₱137)** | **Loss-making** |

**Mitigations designed into the product:** insights are computed in a **scheduled batch** rather than
per question (cost scales with *users*, not *questions*); the free tier incurs **no paid inference at
all** — its answers are deterministic and its speech recognition happens on the owner's device; and
the LLM narration that does cost money is **metered with a visible cap** of 300 questions per month,
rather than billing silently. Voice capture carries **no** per-minute cost in either tier, because the
browser performs the recognition; the transcription rates in the table above would apply only if
SeePat chose to route audio through a paid API, which the prototype does not. This is the single
most important commercial risk in the model and it is stated rather than ignored.

---

## VIII. MARKET ANALYSIS

Microenterprises dominate Philippine establishments and national programmes continue to promote MSME
digitalisation _(Sources: PIA citing DTI/PSA 2024 MSME statistics; DTI Baseline Survey on
Digitalization of MSMEs, September 2020; DTI "Tindahan Mo, e-Level Up Mo!")_.

The market is competitive, which validates demand but demands precise positioning. Peddlr reports
serving more than **two million** Filipino stores; DOST-PCIEERD has documented Packworks' network at
over **270,000** sari-sari stores and funded its AI/ML recommendation work. SeePat therefore avoids
competing on basic POS breadth. Its beachhead is microentrepreneurs who need **low-friction,
explainable decision support** and prefer conversation over accounting dashboards.

**Defensibility, stated honestly.** An LLM wrapper is trivially copyable, so differentiation cannot
rest on "we added AI". The three defensible assets are:

1. **Data network effects** — consented, aggregate benchmarking (*"your margin versus similar stores
   in your barangay"*), which improves with scale.
2. **Institutional distribution** — LGUs, cooperatives and microfinance partners as the primary
   channel.
3. **Supplier and distributor integration** — importing delivery records removes the most tedious
   data-entry burden, which is how comparable platforms in this market achieved their reach.

**Explicit ethical boundary:** payer-aggregated lending signals to microfinance partners are a larger
revenue pool than ₱99 subscriptions, but they create an adversarial incentive between the tool and its
user. SeePat's position is that **the owner's data is used for the owner's decisions first**, and
any aggregate sharing requires explicit, revocable consent.

---

## IX. OPERATIONS PLAN

### A. Approach

Lean Startup, evidence-driven, with a fixed sequencing rule: **prioritise features that measurably
improve the owner's decisions over features that merely add capability.**

| Phase | Focus | Status |
| --- | --- | --- |
| 1. Problem validation | Structured interviews; document existing methods for sales, expenses, inventory, credit, profit and purchasing | Overlaps pilot recruitment |
| 2. MVP development | Mobile-first PWA, deterministic engine, voice capture, capital views, Score | **Substantially complete** |
| 3. Controlled testing | Financial computation verified against manual test cases; recommendations constrained by verified data | **In place (see C)** |
| 4. Pilot deployment | ~30 microbusinesses | Next |
| 5. Product refinement | Driven by pilot evidence | — |
| 6. Commercialisation | Freemium plus institutional partnerships | — |

### B. Deliberately deferred

Multi-device sync, machine-learned forecasting, institutional dashboards, benchmarking and supplier
integration. Each becomes valuable only once meaningful transaction history exists; none is required
to prove the central hypothesis.

### C. Verified prototype status *(new — proof rather than promise)*

Because the concept asserts that the numbers are deterministic and trustworthy, that assertion is
**executed rather than stated**:

- A pure-TypeScript finance engine computes COGS, gross and net profit, margins, inventory turnover,
  receivable exposure, both capital views and the Score — with **no framework and no database
  dependency**, so it is fully testable in isolation.
- The Business Twin is a **fold over the transaction log**. Voiding a transaction recomputes the twin
  from the log, which makes corrections reproducible and auditable rather than a mutation someone has
  to trust.
- An automated suite asserts the accounting identity **after every kind of transaction**, and the
  documented worked examples from the previous concept note are used as regression fixtures.- Writing only the zero-cost, deterministic layer first is also what makes the "works offline, free
tier costs nothing" claim true rather than aspirational.
- The pricing rule is **executed, not asserted**: `src/billing.ts` records, for every feature, whether
  it runs on-device, and the test suite fails if any free-tier feature is ever marked cost-bearing.
  The unit economics cannot quietly regress through a later feature addition.
- Offline voice is **verified rather than claimed**: an on-device multilingual Whisper model is
downloaded (≈42MB, measured in-app), cached by the browser and run without a network, with the
non-commercial 320MB Tagalog model shown alongside it and explicitly marked as unshippable.

### D. Data protection

Privacy by design: data minimisation, on-device storage by default, role-based access controls, secure
authentication, encryption where appropriate, consent mechanisms, auditability and compliance with
applicable Philippine data-protection requirements. Business data is not used to train external AI
models.

---

## X. FINANCIAL REQUIREMENT

| Use of funds | Amount | Purpose |
| --- | --- | --- |
| MVP development and technical infrastructure | ₱50,000 | PWA, database/cloud services, voice processing, financial engine, AI integration, security, domain and deployment |
| User research and validation | ₱15,000 | Field interviews, workflow validation, usability testing, transport and documentation |
| Pilot deployment and onboarding | ₱20,000 | Deployment to initial microbusinesses, onboarding, training materials and pilot support |
| AI, speech and cloud services | ₱40,000 | Speech-to-text, LLM/API usage, database, storage and monitoring during the pilot |
| Testing, QA and data privacy | ₱10,000 | Functional testing, financial-computation validation, security checks and privacy-compliance preparation |
| Early commercialisation and marketing | ₱10,000 | Branding, promotional materials, demonstrations, merchant acquisition and partnership activity |
| Contingency | ₱5,000 | Unanticipated pilot and technical expenses |
| **TOTAL** | **₱150,000** | |

**Allocation note.** Because the deterministic engine and core screens are already built and tested,
a larger share of the pilot budget can go to **field validation and onboarding** rather than
foundational development. The ₱40,000 AI/speech line is the most exposed to the unit-economics risk
described in Section VII and should be reviewed against actual pilot usage.

---

## XI. VALIDATION STRATEGY

Pilot approximately **30–50 microenterprises for 8–12 weeks**, measuring: record completeness; time
to record a transaction; accuracy of computed profit; inventory discrepancies; uncollected
receivables; stockout frequency; owner understanding of profit versus sales; frequency of
recommendation adoption; retention; voice transaction accuracy; trust in explanations; and
willingness to pay.

The central validation question:

> **Can entrepreneurs make measurably better decisions with SeePat than with their previous
> notebook, calculator, spreadsheet or manual method?**

---

## XII. LONG-TERM VISION

Become the **financial intelligence layer for Philippine microenterprise**, rather than another POS
vendor:

**Digital Ledger → Business Twin → Conversational Business Intelligence → Predictive Intelligence →
Decision Optimisation → Microenterprise Financial Intelligence Platform**

---

## XIII. FINAL DEFINITION

> **SeePat is a voice-enabled, explainable financial decision copilot for Filipino
> microentrepreneurs. It transforms everyday sales, expenses, inventory, purchases and utang into a
> continuously updated Business Twin of the negosyo. Using deterministic financial calculations
> combined with AI-powered explanation and prediction, SeePat helps owners understand how much
> they actually earn, where their capital is located, why business performance changes, and what
> actions they should consider next.**

**Core pitch:**

> ## Hindi lang benta ang binibilang. Sinisipat ang buong negosyo.

---

## XIV. EVIDENCE BASE AND SOURCES

1. **Philippine Information Agency, citing DTI/PSA 2024 MSME statistics** — scale and composition of
   Philippine MSMEs and microenterprises.
2. **DTI, Baseline Survey on Digitalization of MSMEs in the Philippines (September 2020)** — MSME
   digital-adoption levels and capacity-building needs.
3. **DTI, "Tindahan Mo, e-Level Up Mo!"** — national sari-sari store and MSME digitalisation effort.
4. **Peddlr Philippines** — benchmark for POS, inventory, expense, ledger and offline capability;
   public statement of 2M+ stores served.
5. **DOST-PCIEERD / Packworks** — benchmark for sari-sari store inventory, sales, utang, business
   intelligence and ML recommendation work; network reported at 270k+ stores.
6. **Lista PH** — comparison for business-finance, expense, receivable and bookkeeping applications.
7. **StoreHub Philippines** — comparison for full POS, reporting, inventory and analytics.
8. **DICT, Philippine Startup Challenge XI** — competition mechanics and timeline.
9. **Published 2026 automatic speech recognition benchmarks and pricing** — FLEURS/BABEL word-error
   rates for Filipino models; Whisper-family hallucination behaviour (ACM FAccT 2024); and per-minute
   transcription pricing for Whisper-class, Google Cloud STT and AWS Transcribe.

**Important:** the Business Twin, Sipat Score, Voice-to-Business-Record, Ask My Negosyo, Capital
Intelligence, "Nasaan ang Puhunan Ko?", the pricing model, the validation targets and the proposed
architecture are **SeePat design elements**, not claims sourced from the competing products above.
