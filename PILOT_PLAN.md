# Pilot plan — SeePat

**Purpose.** Turn the prototype into measured evidence, in the field, with real sari-sari stores
using their own books. This is Phase 4 of the concept note's operations plan and the request behind
the committee's suggestion of *"a proposed pilot location"*.

**One sentence:** thirty microenterprises in and around Dingle, Iloilo use SeePat for eight to twelve
weeks, and the pilot answers five questions with counts instead of opinions.

---

## 1. Where, and why there

| Site | Store count | Why this site |
| --- | --- | --- |
| **Dingle, Iloilo** (barangays around ISUFST Dingle Campus) | 18 | The team's own municipality. Walking distance, so weekly support visits are free and a same-day fix is possible — which is what keeps a pilot from silently dying in week three. |
| **A public market in Iloilo** (one municipality, selected with the help of the local DTI office) | 12 | A *contrast* site on purpose: market vendors have no fixed premises, cash-heavy days, and no shelf to count. If the product only works in a fixed store, this is where it shows. |

A single-municipality pilot is a deliberate limitation and should be stated as one: results describe
Dingle and a market, not the Philippines.

## 2. Who, and how they are recruited

**Profile.** A store with (a) an existing *utang* notebook, (b) at least one item bought in bulk, and
(c) an Android phone with a browser, data or Wi-Fi for setup only — the app itself needs no
connection afterwards.

**Recruitment path, in order:**

1. **The cooperative or LGU route first.** One letter of intent (template in §6) with a barangay
   livelihood program or a cooperative puts 10–20 stores in reach through a partner who already has
   their trust, and it is also the proof of institutional demand the concept note needs.
2. **Direct approach via the campus** for the remainder, through barangay captains' introductions
   rather than cold visits.
3. **No store is paid to participate.** During the pilot the app is free for everyone; a payment
   would make the willingness-to-pay measurement meaningless.

## 3. When

| Week | What happens |
| --- | --- |
| −2 | Consent and baseline interview with each owner ([`INTERVIEW_PACK.md`](INTERVIEW_PACK.md)). Baseline: her current recording method, and the five questions she cannot answer today. |
| 0 | Onboarding in the store: install, guided opening stock count, first three sales recorded with her own hands. **Anything slower than 20 minutes is a product defect, not a training problem.** |
| 1–2 | Weekly visit. First-week measures: records per day, and every hesitation the owner had. |
| 3–8 | Weekly visit, then a phone check midweek. Support log kept, each issue tagged and counted. |
| 8–12 | Second visit round for lagging stores; exit interview for every store, including the ones that stopped using it. |
| 12–14 | Analysis and write-up: measured profit against a manual check on 3 stores, and the willingness-to-pay question asked again after real use. |

## 4. What is measured, and how

Every line from Section XI of the concept note, with its instrument. Nothing here is asserted — each
row has a number attached at the end of the pilot.

| Measure | Instrument | Baseline taken at |
| --- | --- | --- |
| Record completeness (records per trading day) | App: transactions per day vs days open | Week −2 interview |
| **Time to record one transaction** | Timed observation, 3 transactions per store, week 2 and week 8 | Week 0 onboarding |
| Accuracy of computed profit | Manual recomputation by the team on **3 stores**, compared with the app's figure | Exit |
| Inventory discrepancy | Physical count vs app stock, at week 8, on the 10 highest-value items | Week 0 count |
| **Uncollected receivables** | App total vs the baseline total at week −2 | Week −2 interview |
| Stockout frequency | Counted from the app's own restock alerts and the owner's self-report | Week −2 |
| Owner understanding of profit vs sales | The §2.1 question from the interview pack, asked again at exit | Week −2 |
| Voice transaction accuracy | First-attempt success and corrections, from the app's draft-confirm flow | — |
| Trust in explanations | Exit interview: does she believe the numbers, and what would make her doubt them | — |
| **Willingness to pay** | Stated price at entry, and again at exit **after real use** | Week −2 |
| Retention | Stores still recording in week 8 and week 12 | — |

Three of these deserve emphasis because they are the ones a panel will ask about:

1. **Time to record a transaction** is the single number that decides whether the product has a
   future. A bookkeeping app that takes longer than the notebook is not used, however correct it is.
2. **Accuracy of computed profit against a manual check** is how the claim "the numbers are
   deterministic and can be verified" stops being an architectural statement and becomes evidence.
3. **Willingness to pay measured twice**, before and after use, is the honest version of the
   question. The first answer is a guess; the second one is not.

## 5. Consent, data and support

- Written consent per owner, using the script in the interview pack, covering the app's records and
  the pilot's measures separately. Participation is voluntary and withdrawal is possible at any point.
- **The owner's ledger never leaves her phone.** The team sees a store's figures only when the owner
  shows them, or reads them out. The analysis works from the measures above, not from uploaded
  ledgers — this is the architecture the concept note claims and the pilot should not quietly break it.
- Where a measure needs the app's own numbers, the team asks the owner to read them, and records the
  reading as her statement.
- A weekly support number the owner can call, and a named person answering it.
- Any crash or data-loss event is logged with its date and what was recovered. Data loss during a
  pilot is the single most damaging outcome and must be reported, not smoothed over.

## 6. Institutional partner: letter of intent template

Sent to a cooperative, an LGU livelihood office, or a barangay program. Short on purpose — the ask is
small, and a document a partner has to negotiate internally is a document that never comes back.

> **Subject: Request for a letter of intent — free pilot of SeePat with `N` sari-sari stores**
>
> Dear `name`,
>
> We are **SIPAT LABS**, a student team from ISUFST Dingle Campus, developing **SeePat**: an offline,
> Filipino-language app that helps a sari-sari store see its real profit, where its *puhunan* is, and
> who still owes it money.
>
> We are running a **free 8–12 week pilot** with 30 stores in Dingle and would like to include `N`
> stores under `office/program name`. There is no cost to you or to the stores, and no obligation
> afterwards.
>
> **What we provide:** setup and training in each store, weekly support visits, and a plain-language
> summary of what the stores learned — aggregated, with no individual store's figures, and no store's
> name.
>
> **What we ask:** a short **letter of intent** naming the stores you can refer, and permission to
> mention the partnership in our Philippine Startup Challenge submission.
>
> We are happy to present the prototype to your office first, at your convenience.
>
> Respectfully, `team lead`, `contact`.

## 7. What would make the pilot a failure

Stated in advance so the result cannot be re-interpreted afterwards:

- **Fewer than half the stores still recording in week 8.** Then the product does not fit the daily
  rhythm of a tindahan, and no amount of feature work fixes a tool that is not opened.
- **Time to record a transaction not improving on the notebook.** Then the recording burden is the
  problem, and voice has to become the primary path rather than an accelerator.
- **Profit that does not reconcile on the manual check.** Then the engine is wrong, and that is fixed
  before anything else is built.
- **No store able to name a price for the paid tier at exit.** Then the retail subscription is not a
  revenue line in this market, and the model falls back to the institutional channel — which
  [`REVENUE_PROJECTION.md`](REVENUE_PROJECTION.md) already treats as the primary channel.

## 8. Cost

Within the ₱150,000 requirement already filed, the pilot lines are: **User research and validation
₱15,000**, **Pilot deployment and onboarding ₱20,000**, and the transport inside both. No new funding
is requested for this phase.
