# SeePat — DICT evidence pack (answers the 4 feedback asks)

> Source: `FEEDBACK - SIPAT LABS.pdf` (DICT screening committee, PSC XI).
> Each ask below is answered with an artefact, not a paragraph.

## 1. Revenue projection — realistic adoption rates

Rule: on-device is free (₱0 marginal cost), server is paid. Only live features are sold.

**Assumptions (separated from facts):** pilot = 30 stores, Dingle/Iloilo barangay
cluster; PRO = ₱99/mo or ₱999/yr; AI cost ≈ ₱2/explanation × ~20/mo = ₱40;
hosting/sync ≈ ₱15/store/mo; institutional bundle = 30-store yearly licence at
~50% effective per-store rate (₱~18,000/yr per bundle).

| Scenario | PRO conversion (of 30) | Annual subs | Institutional bundles yr-1 | Gross/yr | Serving cost/yr | Net/yr |
|---|---|---|---|---|---|---|
| Conservative (10%) | 3 mo + 1 yr | ₱4,563 | 0 | ₱4,563 | ₱1,980 | ₱2,583 |
| Base (25%) | 5 mo + 3 yr | ₱8,937 | 1 | ₱26,937 | ₱6,600 | ₱20,337 |
| Strong (40%) | 8 mo + 4 yr | ₱13,500 | 2 | ₱49,500 | ₱11,880 | ₱37,620 |

Break-even on variable cost is immediate per PRO store (₱99 > ~₱55 serving
cost); fixed costs (build, support, pilot) are covered in Base by the first
institutional bundle. Volume target for sustainability: ~100 PRO stores OR
3–4 bundles. NEGOSYO tier is parked until staff access is built — it contributes
₱0 to every scenario above, deliberately.

## 2. Customer interviews — plan + findings table

8–12 sari-sari owners near ISUFST Dingle, 20 minutes each:
1. How do you record sales/utang today (notebook, memory, phone)?
2. What is the one money question you cannot answer at closing time?
3. Phone model, signal at the store, data budget per week?
4. 3-minute voice demo (cash sale → utang → expense): complete unaided?
5. Would ₱99/mo be worth it for explanations + safe copies + history? What about ₱999/yr?

| # | Store (barangay) | Current method | Unanswerable question | Signal/data | Demo completed? | WTP ₱99? | Quote |
|---|---|---|---|---|---|---|---|
| 1 | _fill_ | | | | | | |
| … | | | | | | | |

Target: ≥80% unaided completion of record-a-sale by voice or type.

## 3. Pilot location (proposed)

**Dingle, Iloilo — poblacion + 2 adjacent barangays, ~30 microbusinesses,
8–12 weeks.** Owner: SIPAT LABS + ISUFST Dingle campus coordinator. Baseline:
notebook-only recording, unmeasured profit. Targets: record completeness,
unaided completion ≥80%, retention at week 8, voice accuracy, trust in
explanations, WTP validation. No personal data leaves a device without explicit
consent; institutional view is cohort-aggregate only.

## 4. Demo freshness (what changed since "no working MVP")

Working prototype, pre-MVP: cash/credit sales, purchases, expenses, payments,
capital in/out, stock adjustments; moving-average inventory; profit, cash,
receivables, capital position; Filipino/English explanations; voice + typed
capture with on-device Whisper option; offline-first; 201 automated tests
asserting accounting identities. Not yet delivered: accounts, cloud sync,
first-run onboarding for non-team owners, pilot build — dated in the concept
note (MVP Nov–Dec 2026, pilot Feb 2027).

## 5. Compliance sheets (one page each, expand on demand)

- **Privacy (NPC):** store = controller of its own ledger; SeePat device-side =
  processor under owner direction; institutional path carries only opt-in
  indicators (`storeId, recordingDays, profitUp, completedOnboarding,
  scoreLatest`) — see `src/cohort.ts`. No raw transactions, names or amounts
  leave the store. Retention = on-device until owner deletes; backup file is
  owner-held. Breach cooperation clause in institutional agreement.
- **Accessibility (DICT MC 2017-004 / WCAG 2.0):** contrast audit gates the
  build (`npm run check:contrast`); 44px targets; full keyboard operability;
  `aria-pressed/expanded` on all chips/sections; reading-size options;
  reduced-motion paths for every animation.
- **SDG 8/9/10 (measurable):** stores recording weekly (8), unaided completion
  % (8/9), retention at 8 weeks (8), owners without prior accounting tools
  served (10), offline-capable usage share (9).
