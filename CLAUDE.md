# CLAUDE.md — Tool A: Invoice Processing Agent

> **Read `FOUNDATION.md` first.** This file covers only what is specific to the Invoice
> Processing Agent. The shared pipeline, stack, database philosophy, confidence layer,
> security model, and build sequence all live in FOUNDATION.md and are not repeated here.

---

## ⏱️ Build Status (living — see `docs/STATUS.md` for detail)

_Updated 2026-06-29._

- **Extraction accuracy gate (§12): CLEARED.** 100% field accuracy (240/240) on 20 real,
  clean PDF invoices, ground truth verified independently from the PDF text layer. Routing
  auto-approved 20/20.
- **Trust layer (§6, FOUNDATION §5): PROVEN.** On a separate set of 20 low-resolution /
  handwritten invoices the model misread, validation + routing held back 19/20 from silent
  auto-approval — the core promise working on real data.
- **Built & unit-tested (no creds needed):** schema, money parsing, validation, confidence
  routing, smart features (duplicate / bank-change / anomaly), extraction engine, pipeline,
  CSV export, accuracy harness. Next.js app (dashboard + review screen) builds and runs.
- **Key insight:** extraction quality is gated by **input resolution** — onboard customers
  to forward **original PDF invoices, not phone photos**.
- **Next:** connect Supabase (persistence → live dashboard, duplicate detection, per-vendor
  learning) → email ingestion → pilot. Needs: a Supabase project + keys in `.env.local`.

---

## 1. What We Are Building (One Sentence)

A background AI agent that receives a business's incoming supplier invoices, understands
them the way a skilled bookkeeper would, validates its own work, and pushes clean,
correct data into the business's accounting software — escalating to a human only when
it is genuinely unsure.

## 2. Who It Is For

- Small and mid-size businesses with a finance person drowning in manual invoice entry.
- **Bookkeeping and accounting firms** managing many clients (the strongest buyer — they
  feel this pain multiplied across every client and will pay per-client).
- E-commerce and trades businesses with high supplier-invoice volume.

## 3. Why We Will Be Better Than Dext, Hubdoc, AutoEntry, Datamolino, Rossum

This is the heart of the spec. We are entering a market with established players, so we
do not build a clone — we build specifically where they are weak. These are not slogans;
each is a hard technical requirement below.

| Their Weakness (verified) | Our Requirement |
|---|---|
| Built on legacy **OCR** that reads characters but doesn't understand context; fails on handwritten, multi-line, and non-standard invoices | **LLM-native extraction.** We use a vision-language model that comprehends the whole document. Messy, varied, multi-line, and poor-quality invoices are our strength, not our failure point. |
| **Line-item extraction is paywalled** (Dext: "a few free credits" then extra) or weak (Hubdoc) | **Full line-item extraction is standard on every plan**, every invoice, no extra charge. This alone is a headline differentiator. |
| **No real intelligence** — they capture data then make the human verify everything | **Self-validation + confidence routing.** The agent checks its own math, flags anomalies, and only surfaces what actually needs a human. The human reviews exceptions, not everything. |
| **Hubdoc rated 3.3★ and dropping**; Dext called "overwhelming," needs training | **Radical simplicity.** Forward an email, done. The default experience requires zero training. Power features are progressive, never in the way. |
| **Weak duplicate detection / no fraud awareness** | **Duplicate + anomaly + fraud-signal detection built in** (see §7). |
| Generic, no awareness of a specific business's patterns | **Per-vendor learning.** The agent remembers how each vendor's invoices look and how this customer codes them, getting more accurate over time. |

**The positioning in one line:** *"Dext and Hubdoc capture your invoices. Ours
understands them — and checks its own work so you don't have to."*

## 4. The Invoice Schema (What We Extract)

Every invoice maps to this structure. The agent returns this as strict JSON.

```jsonc
{
  "vendor": {
    "name": "string",
    "address": "string | null",
    "email": "string | null",
    "phone": "string | null",
    "tax_id": "string | null"            // VAT/GST/EIN/ABN where present
  },
  "buyer": {
    "name": "string | null",
    "address": "string | null"
  },
  "invoice_number": "string",
  "purchase_order_number": "string | null",
  "invoice_date": "YYYY-MM-DD | null",
  "due_date": "YYYY-MM-DD | null",
  "payment_terms": "string | null",       // e.g. "Net 30"
  "currency": "ISO 4217 code | null",      // e.g. "CAD", "USD", "NPR"
  "line_items": [
    {
      "description": "string",
      "quantity": "number | null",
      "unit_price": "number | null",
      "line_total": "number | null",
      "tax_rate": "number | null"
    }
  ],
  "subtotal": "number | null",
  "discount": "number | null",
  "tax_breakdown": [                        // supports multiple tax rates on one invoice
    { "rate": "number", "amount": "number", "label": "string | null" }
  ],
  "tax_total": "number | null",
  "shipping": "number | null",
  "total_amount_due": "number",
  "amount_already_paid": "number | null",
  "balance_due": "number | null",
  "bank_details": {
    "account_name": "string | null",
    "account_number": "string | null",
    "routing_or_sort": "string | null",
    "iban": "string | null",
    "swift": "string | null"
  },
  "_meta": {
    "field_confidence": {                   // 0.00–1.00 per critical field
      "invoice_number": "number",
      "invoice_date": "number",
      "due_date": "number",
      "total_amount_due": "number",
      "vendor_name": "number"
    },
    "document_quality": "high | medium | low",
    "is_handwritten": "boolean",
    "language_detected": "string",
    "notes": "string | null"                // anything unusual the model noticed
  }
}
```

**Extraction rules (enforce in the prompt):**
- Return `null` for any absent field. **Never guess, never invent a value.**
- Numbers must be parsed as numbers (strip currency symbols, handle `1.234,56` EU format
  vs `1,234.56` US format — detect from context/currency).
- Dates always normalized to `YYYY-MM-DD`. If ambiguous (e.g. `03/04/2026`), use the
  vendor's country/currency to disambiguate and lower the confidence score for that field.
- Always return valid JSON only. No prose, no markdown fences.

## 5. The Pipeline, Invoice-Specific

Follows the universal pipeline in FOUNDATION.md §1. Invoice-specific notes per stage:

1. **Ingest** — Primary path: a dedicated forwarding address per org
   (e.g. `acme-co@inbox.ourapp.com`). The business simply forwards supplier invoice
   emails there, or sets supplier emails to auto-forward. Secondary: drag-and-drop upload.
   Tertiary (later): direct fetch from supplier portals.
2. **Pre-process** — Detect that the attachment is actually an invoice (vs. a statement,
   receipt, or spam) using a cheap Haiku classification call before the expensive
   extraction. Split multi-invoice PDFs into separate documents. Handle PDF, JPG, PNG,
   and emailed-body invoices.
3. **Extract** — Vision-language extraction into the schema above (Sonnet).
4. **Validate** — The math + sanity rules in §6.
5. **Score** — Combine per-field confidence + validation results into one decision.
6. **Route** — Auto-approve / approve-with-flag / needs-review (FOUNDATION.md §5).
7. **Integrate** — Push to QuickBooks/Xero, or CSV export for v1 (§9).
8. **Notify** — Summary to the finance user; immediate alert only on items needing review.
9. **Store** — Original file + extracted JSON + full audit trail.

## 6. Validation Rules (Deterministic — The Trust Layer)

These run in code, not the LLM, after extraction. Each failed rule lowers confidence and
can force review.

- **Line-item math:** `sum(line_item.line_total)` ≈ `subtotal` (within rounding tolerance).
- **Total math:** `subtotal − discount + tax_total + shipping` ≈ `total_amount_due`.
- **Tax math:** each `tax_breakdown.amount` ≈ `rate × taxable_base`.
- **Balance math:** `total_amount_due − amount_already_paid` ≈ `balance_due`.
- **Date sanity:** `invoice_date` not in the future beyond a small tolerance; `due_date`
  ≥ `invoice_date`; neither date absurd (before 2000 / after current year + 1).
- **Required fields present:** `invoice_number`, `vendor.name`, `total_amount_due`.
- **Format checks:** invoice number matches the vendor's known historical pattern if we
  have seen this vendor before (per-vendor learning, §8).
- **Currency present** when an amount is present.

When math fails, the agent does **not** silently "fix" it. It flags the specific
discrepancy ("line items sum to 1,180.00 but subtotal reads 1,180.50") and routes to
review. Surfacing *which* number is suspect is far more useful than a generic "low
confidence" warning — this is a concrete UX win over the incumbents.

## 7. Smart Features That Set Us Apart (Build These — They Are The Moat)

These are what make the agent genuinely intelligent rather than a data-capture toy.

1. **Duplicate detection.** Before posting, check for an existing invoice with the same
   vendor + invoice_number + amount. Flag potential duplicates (a top cause of
   double-payment and a real money-loss event for businesses). Incumbents do this weakly.
2. **PO / 3-way match (where applicable).** If the org provides purchase orders, match
   invoice ↔ PO ↔ (later) goods-receipt. Flag quantity or price mismatches automatically.
3. **Anomaly / fraud signals.** Flag when: a known vendor's bank details suddenly change
   (classic invoice-fraud vector), an amount is wildly outside this vendor's historical
   range, or the due date is suspiciously short. These flags alone can justify the
   subscription by preventing one fraudulent payment.
4. **Per-vendor memory.** Store each vendor's typical layout, invoice-number pattern,
   usual amounts, and how this customer categorizes/codes them. Use it to (a) boost
   extraction accuracy and (b) auto-suggest the GL account / expense category.
5. **Auto-categorization.** Suggest the accounting category/GL code for each invoice
   based on vendor + line items + this org's past coding. Learn from corrections.
6. **Smart escalation summaries.** When a human review is needed, the agent writes a
   one-line plain-English reason ("Vendor bank details differ from last 6 invoices —
   please confirm before paying"). The reviewer never has to hunt for *why*.
7. **Confidence that improves over time.** As humans approve/correct, the system tracks
   per-vendor accuracy and gradually raises the auto-approve threshold for vendors it has
   proven reliable on. The product visibly gets better the more it is used.

## 8. Per-Vendor Learning (Data Model Note)

Add a `vendors` table keyed per org:

```sql
vendors(
  id, org_id, name, tax_id,
  invoice_number_pattern,      -- learned regex/format
  typical_currency,
  amount_min, amount_max,      -- learned historical range
  last_known_bank_fingerprint, -- hash of bank details, to detect changes
  default_gl_code,             -- learned categorization
  invoice_count, accuracy_rate,
  created_at, updated_at
)
```

This table is what turns a generic extractor into an agent that *knows this business's
suppliers*. It is a core differentiator — guard it.

## 9. Integrations

- **v1 (validate fast):** Clean **CSV export** in QuickBooks/Xero import format. Do NOT
  build OAuth integrations before customers confirm they want them. Many will accept CSV
  to start, which lets us prove value in weeks instead of months.
- **v2:** **QuickBooks Online API** and **Xero API** (OAuth, token storage encrypted in
  `integrations`, push as bills/purchase invoices, handle token refresh, log every push).
- **v3:** Sage, FreshBooks, and webhook/Zapier output for everything else.

Always write the integration result to `audit_log` (success + the external record ID, or
the failure reason). A customer must always be able to trace where every invoice went.

## 10. UI (Minimal, Trust-First)

- **Dashboard:** a single inbox-style list of invoices with status chips
  (`Processing` / `Auto-approved` / `Needs review` / `Pushed` / `Failed`). Sort by status
  so "Needs review" floats to the top. This is the whole app for most users.
- **Review screen (the one screen that matters):** original invoice rendered on the left;
  editable extracted fields on the right with low-confidence fields highlighted and the
  plain-English escalation reason at the top. Approve / Edit & Approve / Reject.
- **Vendor view:** per-vendor history and learned patterns (builds trust + stickiness).
- **Settings:** forwarding address, connected accounting software, auto-approve threshold,
  team members.

Design principle: a brand-new user should succeed (forward an invoice → see clean data)
with **zero onboarding**. Every advanced feature is opt-in and out of the way. This is the
direct answer to "Dext is overwhelming."

## 11. Pricing (Reference — validate with real customers)

- **Free pilot:** 14–30 days, real invoices, no friction.
- **Business:** ~$200–$500/mo, includes line items and all smart features (undercutting
  the feeling of being nickel-and-dimed for line items).
- **Accounting firm (white-label-ish):** per-client pricing, e.g. ~$1,000–$3,000/mo for a
  firm managing 20+ clients — the highest-value segment.
- Track `usage_events` (documents processed) from day one so a usage or hybrid model can
  be layered in later.

## 12. Definition of Done for Tool A

Tool A is **not** done when the code runs. It is done when:
- It extracts the full schema (including line items) at **≥90% field accuracy** measured
  on **20+ real, varied invoices** (including at least a few messy/handwritten/multi-line).
- The validation + confidence routing demonstrably catches its own errors.
- Duplicate detection and bank-detail-change detection work.
- At least **3 real businesses complete a pilot**, and **at least 1 is paying** and
  continuing to use it.

Only when that bar is met do we move to Tool B (Contract Review). The lessons from Tool A
— how customers actually forward documents, what "smart" needed to mean, which validations
mattered — get folded back into FOUNDATION.md before Tool B begins.

## 13. Build Order (Concrete First Steps)

1. Set up Next.js + Supabase + Anthropic API. Apply RLS and the base tables from
   FOUNDATION.md §3 plus the `invoices` and `vendors` tables.
2. Write the extraction prompt for the §4 schema. Test on 20+ downloaded sample invoices.
   Measure field accuracy. Iterate the prompt until ≥90%. **Do this before any UI.**
3. Implement the §6 validation rules and §5 confidence routing in code.
4. Build the §10 review screen and dashboard. Nothing else yet.
5. Add email-forwarding ingestion (dedicated address per org).
6. Add CSV export (§9 v1).
7. Add duplicate + bank-change detection (§7.1, §7.3) — the cheapest high-impact "smart"
   features.
8. Run a pilot with 3 real businesses on their real invoices.
9. Add Stripe billing; convert the first pilot to paying.
10. Only then: QuickBooks/Xero API, per-vendor learning depth, auto-categorization.

---

*End of Tool A CLAUDE.md. The same discipline, foundation, and "find where incumbents are
weak" approach will produce Tool B (Contract Review) once Tool A is validated and earning.*
