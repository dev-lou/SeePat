# Feature audit — is every feature necessary, and what is missing?

Written after a research pass over the Philippine builder/lender community and the
local comparator set (Peddlr, Lista, Sari.PH Pro, KwentaPOS, MyTindahan, SukliPH,
TindaPH, plus Indonesian ledger benchmarks), and after fixing the two things that
pass exposed. Sources are listed at the end.

Two questions are answered here:

1. **"I already removed NEGOSYO — why is it still there?"** — a real defect, now fixed.
2. **"Is everything I have necessary, or over-engineered — and what is missing?"**

---

## 1. Why NEGOSYO was still there

The plan was withdrawn from sale, not deleted, and two separate things kept it on screen.

**The picker.** `TIERS` (every plan the type system knows) and `visibleTiers()` (the
plans that are for sale) were two different lists, and they disagreed about NEGOSYO:
the pricing page read the filtered list, the Settings demo switch read the raw one, so
the app sold on one screen a plan the other refused to sell. The first attempt at a fix
routed both through a `planChoicesFor()` helper, which kept selling the plan the owner
was *on* — that is gone. There is now only one list: `visibleTiers()` returns `TIERS`,
and `TIERS` has two members. Nothing in the app holds a second list of plans, so
nothing can disagree with it.

**The entitlement — this is the one that was still biting.** `planChoicesFor(current)`
deliberately re-showed a plan the owner was *already on*, on the theory that their
state is a fact and a picker with nothing selected reads as a bug. So once the demo
picker had sold NEGOSYO, that choice was written to `localStorage`, and from then on
the app kept showing a chip for a plan that no longer existed anywhere else: the
header pill said NEGOSYO, the plan card said NEGOSYO, and the picker offered a
"NEGOSYO" button to select it again. Withdrawing a plan hid it from the shop and left
it in the owner's pocket.

**The fix.** A withdrawn plan is not held either:

- `visibleTiers()` is the only list anything may offer a plan from — pricing page and
  demo picker both map it.
- `migrateOffSale()` runs in `load()`, the one door stored state comes through, and
  moves an entitlement off a plan that is no longer for sale onto the most expensive
  plan still on sale that was already paid for (NEGOSYO ₱199 → PRO ₱99, never up a
  price step, never silently down to free). It is idempotent, and the migration is
  written back so it happens once rather than on every reload.
- Invoices are kept, including the NEGOSYO line in them: a receipt records what was
  paid, not what is on offer now.
- Tests lock all of this: the withdrawal, the retirement, the no-price-rise rule, and
  idempotency (`src/billing.test.ts`).

Verified in the running app with a stored NEGOSYO entitlement (the exact state in the
screenshot): after reload the header reads PRO, the Settings plan card reads
"SeePat PRO ₱99/month", and the demo picker offers FREE and PRO only.

---

## 2. Every feature, judged against what actually ships in the Philippines

"Table stakes" means local competitors already advertise it, so it cannot be the
reason anyone switches. "Differentiator" means it was not found in the reviewed
competitor feature lists — a finding about this sample, not proof nobody has it.

| Feature | Verdict | Why |
|---|---|---|
| Benta / gastos ledger | Table stakes | Peddlr, Lista, Sari.PH Pro, KwentaPOS all do this. Necessary to exist, not to win. |
| Utang (customer credit) ledger with partial payments | Table stakes | Peddlr tracks charges, payments and balances; TindaPH sends statements over Messenger. Our correctness work here (partial payment, overpayment warning, void) is the real value. |
| Offline-first operation | Table stakes | Peddlr advertises offline selling explicitly. Being a PWA is a distribution choice, not a user-visible advantage by itself. |
| Inventory + stock value | Table stakes | Everyone has it. |
| Business Twin statements (profit, cash, utang, equity) | Table stakes as *reports*, differentiator as *explanations* | P&L reports ship everywhere. Nobody reviewed explains *why* the numbers moved. Our narrator is the differentiator; the statements are the floor. |
| Capital breakdown — where the money actually sits | **Differentiator** | Not found in the reviewed comparators. Answers the question micro-owners actually ask ("nasaan ang puhunan ko?") instead of restating sales. |
| Owner withdrawals kept separate from expenses | **Differentiator** | Part of the same idea: it separates business money from household money, which is the positioning the research independently lands on. |
| GCash / Maya / bank recorded as a channel, not as cash | **Differentiator** | Providers show *their* transaction history. No reviewed product reconciles GCash **and** Maya **and** cash **and** utang in one shop ledger. Also removes a nonsense "negative drawer" figure. |
| Voice sale entry with on-device Whisper | **Differentiator** | No reviewed competitor lists on-device speech. Strongest claim we have, and it is free at the margin. |
| Deterministic Ask (no LLM, answers from the Twin) | **Differentiator** | Explainable, cheap, cannot invent advice. |
| Sipat Score | **Differentiator, with a caveat** | Lista already offers a *consumer credit score*. Ours must stay visibly a behaviour/health measure of the shop and never imply a credit bureau score or a lending decision. |
| Backup / restore / export | Necessary, not distinctive | Cloud access appears in Lista, BukuWarung and Peddlr. Our owner-controlled export is the stronger version — Peddlr's founders themselves noted records living only on the phone are lost with the phone. |
| Simulated checkout, AI fair-use meter, offline ASR download flow | Necessary plumbing | Small, and they keep the free tier from quietly losing money. Keep. |
| Score history | Table stakes as *data*, differentiator as *history* | It was sold once, which was wrong: it is arithmetic over records already on the phone. Now free and shown. |
| Forecasting, benchmarking, staff accounts | Correctly **not built** | All need a server and none is paid for yet. Parking them was the right call. |

### Over-engineering found

- `nextTier()` — exported, tested, called by nothing in the app. **Removed.**
- NEGOSYO in the type system — **deleted from `TIERS`**. It survives only as
  `RETIRED_PLANS.negosyo`: a name and a price, no tagline, no audience, no feature list,
  and no place in the price ladder. That is what a receipt needs (`planPrice`,
  `planName`) and it is deliberately not a `Tier`, so no screen can offer it. The six
  features it was parked behind went with it, and the six "planned" entries that remain
  all describe what PRO grows into once a server exists.
- Seven transaction kinds (under "More": purchase, payment received, capital
  injection, owner withdrawal) looked like scope creep at first, but the capital
  breakdown is impossible without them, and the capital breakdown is a differentiator.
  **Justified — keep.**
- Everything else earns its place. Nothing else needs cutting.

---

## 3. What is missing, ranked by value

1. **A way to follow up utang.** The single clearest gap. Peddlr ships free SMS
   reminders; TindaPH sends statements through Messenger. We track who owes what and
   then do nothing about it — and uncollected utang is exactly what Pat already nags
   about on the dashboard. The no-server version is a share button (Web Share API to
   Messenger/SMS, prefilled with the name and amount) plus a printable statement from
   the Utang screen; a scheduled server-side reminder is a PRO feature later.
2. **A shareable / printable statement.** BukuWarung and Peddlr both let the owner
   share or print receipts and reports. This is the same work as (1) — one export path
   for the utang list, today's report, and the capital breakdown. It also gives
   cooperatives and LGUs something to collect, which is the distribution channel in
   the concept note.
3. **A low-stock / reorder surface.** TindaPH and Peddlr both surface low stock. We
   have the numbers and the narrator already understands "ano ang dapat bilhin" — but
   the owner has to ask. An automatic "running low" list on the Money tab is cheap and
   uses data we already fold.
4. **Best sellers on screen.** Same story: `salesBySku` is already computed and shown
   only in conversation.
5. **Make the household-money idea explicit.** Rename or annotate the withdrawal flow
   so it reads as "money you took home", not as a business expense. This is the
   positioning line the research independently recommends, and we already have the
   machinery for it.
6. **Say plainly what our documents are not.** RA 11976 (EOPT) makes an *invoice* the
   primary document for sales, and micro taxpayers are exempt from *mandatory*
   e-invoicing — but not from tax obligations. Anything we let an owner share or print
   must be labelled as the shop's own record, not a BIR invoice or official receipt.

## 4. What not to build

- **Payment acceptance / QR acquiring.** GCash, Maya and QR Ph own it, and it is
  regulated (BSP Circular 1198 for acquirers). Recording a channel is bookkeeping;
  accepting money is a licensed business. Stay on the bookkeeping side.
- **Lending, merchant cash advances, credit scoring for underwriting.** No evidence in
  the community material that this is what these stores are asking for, and the Sipat
  Score must never drift into it.
- **ERP breadth: warehouses, production, bills of materials, multi-currency,
  depreciation.** One reviewer of Sari.PH Pro complained the app felt made for larger
  businesses. That is the trap.
- **Payroll.** MyTindahan lists it; nothing in our market evidence says a one-person
  sari-sari store needs it.

## 5. Positioning that follows

Not "digitise the utang notebook" and not "works offline" — Peddlr already claims both.
The defensible statement is the one the feature set already supports:

> The shop's offline finance book that shows where the money went, keeps business
> capital separate from household cash, tracks GCash/Maya alongside cash, and can be
> backed up and restored.

Keep the Score and the Q&A explainable, and never present a bookkeeping output as a
tax document.

---

## Sources

Philippine comparators and community material:

- Peddlr — <https://www.peddlr.io/> and <https://www.peddlr.io/blog/post/best-mobile-pos-free-for-sari-sari-stores>
- Lista PH — <https://www.lista.com.ph/> and <https://play.google.com/store/apps/details?id=com.listaPh>
- Sari.PH Pro (Packworks) — <https://play.google.com/store/apps/details?id=com.packworks.megastoreapp>
- App Builders PH app catalog (KwentaPOS, MyTindahan, SukliPH, Sari-Sari Store Manager, Tarsi) — <https://www.appbuildersph.com/apps/kwentapos>, <https://www.appbuildersph.com/apps/mytindahan>, <https://www.appbuildersph.com/apps/sukliph>, <https://www.appbuildersph.com/apps/tarsi-budget-tracker>
- TindaPH (offline-first POS PWA, ₱199 one-time, receipts explicitly not official receipts) — <https://www.tindaph.com/>
- App Builders PH community posts on offline-first POS and natural-language logging — <https://www.facebook.com/groups/980298767865372/posts/1108379761723938/>, <https://www.facebook.com/groups/980298767865372/posts/1111707374724510/>
- BukuWarung (ledger benchmark, Indonesia) — <https://play.google.com/store/apps/details?id=com.bukuwarung>
- Mekari Jurnal (the "designed for a bigger business" trap) — <https://www.jurnal.id/en/>
- GCash for Business / in-store QR — <https://help.gcash.com/hc/en-us/articles/48456930314649-What-are-the-available-features-of-GCash-for-Business>, <https://gcash.com/business/enterprise/in-store-qr>
- GCash Pera Outlet Plus (agent banking, not shop bookkeeping) — <https://mynt.com.ph/newsroom/gcash-expands-livelihood-opportunities-with-the-new-gcash-pera-outlet-plus-bringing-financial-access-closer-to-filipino-communities>
- Maya for business (QR Ph, Terminal) — <https://www.maya.ph/business/qr-ph>, <https://www.maya.ph/business/terminal>
- Rest of World on sari-sari digitisation, connectivity and trust — <https://restofworld.org/2024/sari-sari-philippines-tech/>
- PhilSTAR Life on offline records living on the phone — <https://www.philstarlife.com/geeky/167194-manage-business-clicks-peddlr>

Tax and registration boundaries:

- RA 11976 (EOPT Act) — <https://lawphil.net/statutes/repacts/ra2024/ra_11976_2024.html>
- Grant Thornton PH, invoicing under EOPT — <https://www.grantthornton.com.ph/insights/articles-and-updates1/lets-talk-tax/invoicing-requirements-under-the-eopt-act/>
- DTI BNRS registration guide — <https://bnrs.dti.gov.ph/resources/registration-guide>

**Caveat on the community source.** `appbuilderph.com` (singular) did not resolve; the
community is at **appbuildersph.com** and its Facebook group. The findable material is
a launch post, an app catalog, and product pages — not long threads of member debate —
so it is evidence of what is being built and shipped, not a survey of what the market
has collectively agreed on. The Facebook and BIR PDF pages were only partly readable.
