# FOUNDATION.md — Shared Architecture for the Document Intelligence Platform

> This document defines the shared technical foundation reused across all five tools
> (Invoice Processing → Contract Review → Candidate Screening → Compliance Docs →
> Client Onboarding). Each tool has its own CLAUDE.md that references this file.
> Read this FIRST before any individual tool's CLAUDE.md.

---

## 0. The Core Thesis

We are not building five separate apps. We are building **one document intelligence
engine** with five domain modules on top. The engine — ingest, extract, validate,
score confidence, store, integrate, notify — is identical across all five. Only the
*schema*, the *validation rules*, the *business logic*, and the *integrations* change.

Estimated code reuse from Tool A to Tool B: ~70%. From the platform onward: ~80%.

**This is why we finish Tool A completely before starting Tool B.** Tool A is not just
a product — it is the foundation everything else is cloned from. A weak Tool A means
five weak tools. A rock-solid Tool A means each subsequent tool ships faster and better.

---

## 1. The Universal Document Pipeline

Every tool, regardless of document type, follows this exact pipeline:

```
1. INGEST      → Document arrives (email forward, upload, API)
2. PRE-PROCESS → Detect type, check quality, convert to a clean format
3. EXTRACT     → LLM pulls structured data into a defined schema
4. VALIDATE    → Rules check the extracted data for correctness
5. SCORE       → Assign a confidence level to the whole extraction
6. ROUTE       → Auto-approve (high confidence) OR flag for human review (low)
7. INTEGRATE   → Push clean data to the target system (QuickBooks, CRM, etc.)
8. NOTIFY      → Tell the right person what happened
9. STORE       → Keep an audit-ready record of everything
```

The "smart" in our agent is **not** step 3 (extraction). LLMs already extract well.
The intelligence lives in steps 4, 5, and 6 — validation, confidence scoring, and
knowing when to escalate to a human. That is what separates a toy from a tool a
business will pay for and trust.

---

## 2. Tech Stack (Locked — Do Not Substitute Without Reason)

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js (App Router) + TypeScript | Known, fast, full-stack in one repo |
| Styling | Tailwind CSS | Known, fast |
| Database | Supabase (Postgres + pgvector + Auth + Storage) | One service does DB, auth, file storage, vector search |
| AI | Anthropic Claude API (claude-sonnet for extraction, claude-haiku for cheap classification) | Native PDF/image handling, reliable structured output |
| Email (outbound) | Resend | Simple, modern, good deliverability |
| Email (inbound) | Resend Inbound or Postmark Inbound | Lets customers forward documents to a dedicated address |
| SMS (where needed) | Twilio | Industry standard |
| Payments / Billing | Stripe (Billing + Customer Portal) | Subscriptions, trials, self-serve management |
| Hosting | Vercel | Known, zero-config Next.js deploys |
| Background jobs | Vercel Cron + Supabase Edge Functions OR Inngest | For reminders, retries, scheduled processing |
| File parsing fallback | PyMuPDF / pdf-parse (only if Claude native handling is insufficient) | Edge cases |

**Rule:** This stack is identical across all five tools. We never relearn infrastructure.
We only add domain logic.

---

## 3. Database Design Philosophy

Each tool gets its own primary table for its document type, but they share a common
shape so code patterns transfer:

```sql
-- Common shape every document table follows
-- (table named per tool: invoices, contracts, candidates, compliance_docs, onboardings)

id                uuid primary key default gen_random_uuid()
org_id            uuid not null references organizations(id)   -- multi-tenant isolation
status            text not null    -- 'pending','processing','needs_review','approved','rejected','failed'
raw_file_url      text             -- original document in Supabase Storage
extracted_data    jsonb            -- the structured output from the LLM
confidence_score  numeric          -- 0.00 to 1.00, overall extraction confidence
validation_flags  jsonb            -- array of issues found during validation
reviewed_by       uuid             -- which human approved/edited it, if any
created_at        timestamptz default now()
updated_at        timestamptz default now()
```

Shared tables across ALL tools:
- `organizations` — the customer business (multi-tenancy root)
- `users` — people who log in, belong to an org
- `integrations` — connected external systems (QuickBooks tokens, etc.) per org
- `audit_log` — immutable record of every action (critical for trust + compliance)
- `usage_events` — for usage-based billing and analytics

**Multi-tenancy rule:** EVERY query filters by `org_id`. Use Supabase Row Level
Security (RLS) policies so one customer can never see another's data. This is
non-negotiable and must be set up on day one, not bolted on later.

---

## 4. The Extraction Engine (Shared Pattern)

The extraction call is structurally identical for every tool. Only the schema changes.

```typescript
// Pseudocode pattern — same shape for every tool
async function extractDocument(fileBuffer, schema, documentType) {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: fileBuffer }},
        { type: "text", text: buildExtractionPrompt(schema, documentType) }
      ]
    }]
  });
  return parseAndValidateJSON(response);
}
```

**Extraction prompt principles (apply to all tools):**
1. Define the exact JSON schema with field names and types.
2. Instruct: "Return `null` for any field not present. Never guess or hallucinate."
3. Instruct: "Return only valid JSON, no explanation, no markdown fences."
4. For each field, ask the model to also return a per-field confidence where it matters.
5. Always parse defensively — wrap in try/catch, strip stray ```json fences, validate
   against the schema before trusting it.

---

## 5. The Confidence & Validation Layer (THE ACTUAL INTELLIGENCE)

This is what makes the agent "smart." Three mechanisms, used by every tool:

**A. Per-field confidence.** The LLM returns how confident it is per critical field.
Low confidence on a critical field (e.g., total amount) forces human review even if
everything else is clean.

**B. Rule-based validation.** Deterministic checks that don't rely on the LLM:
- Do the line items sum to the subtotal?
- Does subtotal + tax = total?
- Is the date in a plausible range (not year 1900, not 2090)?
- Is a required field missing?
- Does an ID match an expected format (regex)?

Each tool defines its own rule set. The *mechanism* is shared.

**C. Confidence routing.** Combine A and B into a single decision:

```
IF all critical fields high-confidence AND all validation rules pass
   → AUTO-APPROVE (send straight to integration)
ELSE IF minor issues only
   → APPROVE WITH FLAG (process but mark for optional review)
ELSE
   → NEEDS_REVIEW (hold; a human checks before anything is pushed)
```

**The golden rule of trust:** It is always better to flag a document for human review
than to silently push wrong data into a customer's accounting system. One wrong invoice
auto-posted to QuickBooks destroys trust permanently. When in doubt, escalate. The agent
earns the right to auto-approve more over time as it proves accurate.

---

## 6. Human-in-the-Loop Review UI (Shared Component)

Every tool needs the same review screen, just with different fields:

- **Left side:** the original document rendered (PDF/image viewer).
- **Right side:** the extracted fields as an editable form, with low-confidence fields
  visually highlighted (e.g., yellow border).
- **Actions:** Approve / Edit & Approve / Reject.
- Every edit a human makes is logged and becomes training signal for prompt improvement.

Build this once as a reusable component. Reuse across all five tools.

---

## 7. Integration Layer (Per-Tool, Shared Pattern)

Integrations differ by tool but follow one pattern: OAuth connect → store tokens in
`integrations` table (encrypted) → push data via the target API → handle token refresh
→ log success/failure in `audit_log`.

- Tool A: QuickBooks, Xero
- Tool B: CRM / contract storage / calendar (for renewals)
- Tool C: ATS (Greenhouse, Lever) / calendar
- Tool D: government/regulatory portals (often manual) / calendar
- Tool E: CRM / practice management software

**Shortcut for early validation:** Before building any real API integration, offer
**CSV export**. Most businesses will accept "download a clean CSV and import it" as a
v1. This lets you validate the product before sinking weeks into OAuth integrations.
Build the integration only after customers confirm they want it.

---

## 8. Billing (Shared — Stripe)

- Free pilot: 14–30 days, no card OR card-on-file with trial.
- Then convert to subscription via Stripe Billing.
- Offer a Customer Portal so they self-manage (cancel, update card) — reduces support load.
- Track `usage_events` so you can later move to or add usage/outcome-based pricing
  (e.g., "first 100 documents included, then $X per document").

Pricing evolution (same across tools): Setup/pilot → flat monthly subscription →
add usage or outcome component once you have ROI proof.

---

## 9. Security & Trust (Non-Negotiable, All Tools)

- RLS on every table. Org isolation enforced at the database level.
- Encrypt integration tokens at rest.
- Never log full document contents or PII in plaintext application logs.
- Immutable `audit_log` for every action (who did what, when) — this is also a selling
  point for compliance-sensitive customers.
- A clear data retention + deletion policy. Let customers delete their data.
- For financial/legal/health documents, this is not optional polish — it is the product.

---

## 10. The Build Sequence (How We Actually Work)

For EVERY tool, we follow this order. Never skip ahead.

1. **Validate demand first.** 10 conversations with real target businesses. Confirm
   they currently pay (in time or money) to do this manually. No code until this is done.
2. **Build the extraction core.** Get the LLM extracting the schema at 90%+ accuracy
   on 20+ real sample documents. Measure it.
3. **Build the validation + confidence layer.** This is where the real work is.
4. **Build the minimal UI.** Upload + review screen + status dashboard. Nothing fancy.
5. **Add ONE ingestion path** (email forwarding is usually best for documents).
6. **Add CSV export** as the v1 "integration."
7. **Run a free pilot** with 3 real businesses using their real documents.
8. **Charge.** Add Stripe. Get the first paying customer.
9. **Only then** add real API integrations and polish.
10. **Validate it works as a business** (people pay and renew) before starting the next tool.

**Definition of "done" for a tool:** Not "the code works." Done means *at least a few
real businesses are paying for it and continuing to use it.* That is the signal to move
to the next tool.

---

## 11. What "Smart Agent" Actually Means Here

When the user says "make it smart and intelligent," it does NOT mean a chatbot or
flashy AI. In this product, "smart" means measurable, trustworthy behavior:

- It extracts accurately across messy, varied real-world document layouts.
- It *knows when it is unsure* and escalates instead of guessing.
- It catches its own errors via validation rules before they reach the customer's system.
- It gets more accurate over time as humans correct it.
- It quietly does in seconds what used to take a person 15 minutes, and the person trusts
  it enough to stop double-checking every one.

That trust — earned through accuracy and good escalation, not flashiness — is the entire
moat. Build for trust above all else.

---

*End of FOUNDATION.md. Each tool's CLAUDE.md builds on this. Start with Tool A.*
