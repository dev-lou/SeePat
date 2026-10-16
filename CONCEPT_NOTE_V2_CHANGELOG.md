# Concept Note v2 — Changelog for the team and mentor

Prepared 12 October 2026.

**What this is.** A record of every substantive change between the concept note that was
submitted ([SIPAT_LABS_ConceptNote_PSC11.pdf](SIPAT_LABS_ConceptNote_PSC11.pdf)) and the revised
version, so the mentor can review the edits instead of re-reading both documents.

**Files.**

| File | Role |
|---|---|
| [SIPAT_LABS_ConceptNote_PSC11.pdf](SIPAT_LABS_ConceptNote_PSC11.pdf) | The submitted note. **Untouched** — kept as the record of what went in. |
| [SIPAT_LABS_ConceptNote_PSC11_v2.md](SIPAT_LABS_ConceptNote_PSC11_v2.md) | Editable source. Edit this, not the DOCX. |
| [SIPAT_LABS_ConceptNote_PSC11_v2.docx](SIPAT_LABS_ConceptNote_PSC11_v2.docx) | Generated Word version. |
| [SIPAT_LABS_ConceptNote_PSC11_v2.pdf](SIPAT_LABS_ConceptNote_PSC11_v2.pdf) | **The submission file.** |
| [tools/md_to_docx.py](tools/md_to_docx.py) | Generator (Markdown → DOCX). Extended this round. |
| [tools/docx_to_pdf.ps1](tools/docx_to_pdf.ps1) | DOCX → PDF export via the installed Word. |
| [tools/capture-note-shots.mjs](tools/capture-note-shots.mjs) | Captures the app screenshots used in the note. |

## The one problem this round fixes

The submitted note said the MVP **does not exist yet**. That was no longer true: the prototype
is built, installed, offline-capable, and covered by a passing test suite. A note that
understates the work is read as a team that has not started. The revision's main job was to
describe the product that actually exists — and to be explicit about what genuinely remains.

## Changes, in the order they appear

| # | Section | Change | Why |
|---|---|---|---|
| 1 | **I. Summary** | "Current Development Stage" rewritten to **working prototype, pre-MVP**: it states what already runs (sales incl. *utang*, purchases, expenses, customer payments, capital injections, withdrawals, stock adjustments; moving weighted-average inventory; profit, cash, receivables, capital position; Filipino/English explanations) and names the **169 automated tests** that assert the accounting identities. | Replaces the "not yet built" framing with the verified reality. Evidence: `npm test` → **169 tests passed across 12 files, exit 0**. |
| 2 | **I. Summary** | Added an explicit **"what is *not* yet delivered"** sentence: accounts, cloud backup, onboarding for owners who are not the team, the pilot release. | Credibility. Panels discount claims without a stated boundary; the limitation list costs nothing and buys trust. |
| 3 | **I / III** | Added the **on-device voice** and **offline** capability — a Whisper-class, MIT-licensed model downloaded once with consent, transcribing on the phone itself. | This is the privacy argument made concrete: data never leaves the device. It is also the strongest differentiator against cloud-based competitors. |
| 4 | **III. Proposed Startup Solution** | Added **"What SeePat is not"**: SeePat is a management-accounting and decision-support tool; it is **not a BIR-registered point-of-sale system**, does not issue official receipts, and does not replace the books of record or compliance obligations. Where those are required, records are exported in a form the owner or bookkeeper can use. | Removes the single largest compliance objection a DTI/BIR-adjacent panel will raise, before they raise it. |
| 5 | **IV. Objectives** | Section numbering left as-is, including the pre-existing "I. Explainable Decision Intelligence" block that sits above it. 10 top-level sections, same as the submitted note. | No structural change to the template. The numbering oddity is inherited from the original, not introduced here. |
| 6 | **VII. Business Model** | Pricing table corrected: **voice capture and the Score sit in FREE**, because they run on-device at **₱0 marginal cost**; PRO at **₱99** carries the features that genuinely cost money to serve. Added **unit economics**. | The earlier table charged ₱99 for capability that costs nothing to give away — it undercuts the free tier and cannot beat a competitor's free offering. Cross-checked against the real feature table in [src/billing.ts](src/billing.ts). |
| 7 | **VIII. Market Analysis** | Retained the DTI/PSA 2024 MSME figures — **1,236,908 establishments (99.63%)**, of which **1,125,476 (90.66%)** are microenterprises — and the incumbent facts (Peddlr >2 M stores; Packworks >270,000 stores per DOST-PCIEERD). Verified present in the submitted PDF and kept. | These figures were already in the submitted note; they are the market evidence a panel expects, so they were preserved rather than restated. |
| 8 | **IX. Operations Plan** | Replaced open-ended phases with **dated milestones**: Phase 1 Problem & Prototype Validation (Oct–Nov 2026), Phase 2 Functional MVP (Nov–Dec 2026), Phase 3 Controlled Testing (Jan 2027), Phase 4 Pilot Deployment (Feb 2027), Phase 5 Product Refinement (Mar 2027), Phase 6 Commercialization (from Apr 2027). | Undated plans get scored as intentions. Dated ones get scored as plans. |
| 9 | **Across the note** | Added a short, honest **"where we are behind today"** block (e.g. GCash/Maya/card settlement reconciliation is not yet done). | Same reason as #2, stated once more where the technical review happens. |
| 10 | **Illustration** | Added **three real app screenshots**, captured by driving the running app at phone size. Embedded image count went **1 → 3**. | The panel should see the product, not a description of it. |
| 11 | **Whole document** | **Jev is absent and stays absent.** | A paid cloud model that cannot run offline is a server bill and a dependency for an offline-first product. It is not part of the plan. |

## What deliberately did not change

- **Same ten sections**, same order, no new top-level section.
- **13 pages** — identical to the submitted note (cap respected).
- The mentor's submitted PDF is left on disk **untouched** for comparison.
- The ₱150,000 use-of-funds table is unchanged and still reconciles:
  50,000 + 15,000 + 20,000 + 40,000 + 10,000 + 10,000 + 5,000 = **150,000**. The original's only
  `TOTAL` line is also 150,000, so the two documents agree.

## Verification performed on the generated PDF

Re-extracted the text of `SIPAT_LABS_ConceptNote_PSC11_v2.pdf` and asserted:

- page count **13** (equal to the original, within cap);
- **"Jev" appears 0 times**;
- the working-prototype claim, the **169 test** figure and the **on-device/offline** description are present;
- **"not a BIR-registered point-of-sale"** appears once;
- the ₱150,000 table and its TOTAL are present and reconcile;
- pricing matches the feature table in `src/billing.ts`;
- **3 embedded images** present (the three screenshots).

Also confirmed: `npm test` → 12 test files, **169 tests passed**, exit status 0.

## Still to do (not a document issue)

1. **Confirm PSC XI eligibility.** The competition is open to SHS, college and tech-voc
   students; confirm the team qualifies before the deadline. This gate is independent of the note.
2. The **promo/demo video** is optional supporting evidence — the concept note is the graded
   artifact. Research on a zero-cost production path is in [PROMO_VIDEO_RESEARCH.md](PROMO_VIDEO_RESEARCH.md).
3. If a letter of intent, LGU or cooperative partner can be added, it strengthens the
   validation story more than any wording change.
