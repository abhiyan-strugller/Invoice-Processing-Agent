# Invoice Agent — Tool A

An AI agent that receives a business's incoming supplier invoices, understands them like a
skilled bookkeeper, **validates its own work**, and routes only the genuinely-uncertain
ones to a human. See [`CLAUDE.md`](./CLAUDE.md) and [`FOUNDATION.md`](./FOUNDATION.md) for
the full product spec.

The differentiator is **not** extraction (LLMs already extract well) — it's the
deterministic **validation + confidence-routing trust layer** that catches the agent's own
errors before they reach a customer's accounting system.

## Status

The **engine core is built and fully unit-tested** (49 tests, all green) and the **app
shell builds and runs** on demo data. What needs your credentials to go *live* is listed
under [Next steps](#next-steps).

| Area | State |
|---|---|
| Invoice schema (Zod) — `src/lib/schema.ts` | ✅ |
| Money parsing (EU/US, accounting negatives) — `src/lib/money.ts` | ✅ tested |
| Deterministic validation rules (the trust layer) — `src/lib/validate.ts` | ✅ tested |
| Confidence scoring + routing — `src/lib/confidence.ts` | ✅ tested |
| Smart features: duplicate / bank-change / anomaly — `src/lib/smart.ts` | ✅ tested |
| Extraction prompt + Anthropic engine — `src/lib/prompt.ts`, `src/lib/extract.ts` | ✅ (needs API key to run) |
| Pipeline orchestrator — `src/lib/pipeline.ts` | ✅ |
| CSV export (v1 integration) — `src/lib/csv.ts` | ✅ tested |
| Dashboard + review screen — `src/app`, `src/components` | ✅ (demo data) |
| `POST /api/process` (upload → result) | ✅ (needs API key) |
| Supabase schema + RLS — `supabase/migrations` | ✅ written, not yet applied |
| CLI to measure accuracy on real invoices — `scripts/extract-cli.ts` | ✅ (needs API key) |

## Quick start

```bash
npm install
npm test            # run the trust-layer test suite (no credentials needed)
npm run build       # production build of the app
npm run dev         # http://localhost:3000 — dashboard on demo data
```

## Going live

1. Copy `.env.example` → `.env.local` and fill in `ANTHROPIC_API_KEY`.
2. Drop real invoices into `./samples/` and **measure** accuracy (CLAUDE.md §12 target:
   ≥90% on 20+ varied invoices, *before* relying on the UI):
   ```bash
   npm run extract -- ./samples --csv out.csv   # see extraction + routing per file
   npm run measure -- ./samples --label         # 1. write editable ground-truth files
   #   → open ./samples/_expected/*.json and correct any wrong values
   npm run measure -- ./samples                 # 2. score against the ≥90% gate
   ```
3. Create a Supabase project, set the `NEXT_PUBLIC_SUPABASE_*` + `SUPABASE_SERVICE_ROLE_KEY`
   vars, and apply `supabase/migrations/*.sql`.

## Architecture

Everything follows the universal 9-stage pipeline (FOUNDATION.md §1). The brains live in
stages 4–6 (validate → score → route), which is why those modules are pure functions with
the heaviest test coverage. `src/lib/pipeline.ts` is the one place that ties extraction,
validation, smart checks, and routing into a single result the UI / API / CLI all share.

## Next steps

See [`docs/STATUS.md`](./docs/STATUS.md) for the prioritized build order and the exact
decisions/credentials needed from you.
