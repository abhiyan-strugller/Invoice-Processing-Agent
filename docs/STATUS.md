# Build status & next steps

_Last updated: 2026-06-28_

This follows the spec's own build order (CLAUDE.md §13 / FOUNDATION.md §10). We do the
extraction + validation core **before** UI polish, and we don't build OAuth integrations
before a customer asks.

## ✅ Done (built and tested, no credentials required)

- **The trust layer** — deterministic validation (`validate.ts`), confidence scoring +
  routing (`confidence.ts`), and the smart features (`smart.ts`: duplicate, bank-change,
  amount-anomaly). 49 passing unit tests. This is the moat (FOUNDATION.md §5/§11).
- **Schema + coercion** — strict Zod schema (`schema.ts`), robust EU/US money parsing
  (`money.ts`), and a coercion pass (`coerce.ts`) that fixes messy model output before the
  schema gate.
- **Extraction engine** — prompt (`prompt.ts`) + Anthropic wrapper (`extract.ts`) with a
  cheap Haiku classification gate and a Sonnet vision extraction, both parsed defensively.
- **Pipeline orchestrator** (`pipeline.ts`), **CSV export** (`csv.ts`).
- **App** — dashboard + review screen (demo data), `POST /api/process`.
- **DB** — `supabase/migrations/0001_foundation.sql` (shared tables + RLS + immutable
  audit log) and `0002_invoices_vendors.sql` (invoices + per-vendor learning table).
- **CLI** — `npm run extract` to measure accuracy on real invoices.

## ▶️ Next, in order

1. **Prove extraction accuracy (the gate before everything else).** ← _current focus._
   Add an Anthropic key, drop 20+ real invoices in `./samples`, then:
   `npm run measure -- ./samples --label` (writes editable ground-truth you correct) →
   `npm run measure -- ./samples` (scores against the ≥90% gate). Tune `prompt.ts` and
   re-run until it clears 90% (CLAUDE.md §12). The harness (`src/lib/accuracy.ts`) is built
   and unit-tested. *Needs: `ANTHROPIC_API_KEY` + your sample invoices.*
2. **Connect Supabase.** Apply the migrations; swap `demo.ts` for real queries; persist
   each processed invoice + audit-log entry. *Needs: a Supabase project + its keys.*
3. **Email ingestion** — dedicated forwarding address per org via Resend/Postmark inbound
   (CLAUDE.md §5.1). *Needs: a domain + inbound-email provider choice.*
4. **Pilot** — 3 real businesses on real invoices; CSV export is the v1 "integration".
5. **Billing** — Stripe; convert the first pilot to paying.
6. **Only then** — QuickBooks/Xero OAuth push, per-vendor learning depth, auto-categorization.

## ❓ Decisions / inputs needed from you

- **Anthropic API key** — unblocks live extraction and the accuracy measurement (step 1).
- **Supabase project** — unblocks persistence, auth, file storage (step 2).
- **Inbound email provider** — Resend Inbound vs Postmark, and a domain to receive
  forwarded invoices at (step 3).
- **Customer validation** — the spec mandates 10 conversations with real target businesses
  confirming they pay (in time/money) to do this manually, before heavy investment
  (FOUNDATION.md §10.1). That's a you-task; the engineering above is ready to back it up.
