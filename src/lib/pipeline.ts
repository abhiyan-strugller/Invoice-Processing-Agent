/**
 * The pipeline orchestrator (FOUNDATION.md §1). Ties stages 3–6 together into one call so
 * the API route, the email-ingest worker, and the CLI all share identical logic:
 *
 *   EXTRACT → VALIDATE (math + history-aware smart checks) → SCORE → ROUTE
 *
 * Stages 1–2 (ingest, pre-process/classify) happen before this; stages 7–9 (integrate,
 * notify, store) happen after, using this result. Keeping the brains in one pure-ish
 * function is what makes the engine reusable across all five tools (FOUNDATION.md §0).
 */
import type { Invoice } from "./schema";
import { validateInvoice, type ValidationFlag } from "./validate";
import { scoreAndRoute, type ScoreResult, type RoutingConfig, DEFAULT_ROUTING } from "./confidence";
import { runSmartChecks, type PriorInvoice, type VendorProfile } from "./smart";

export interface PipelineContext {
  /** Previously-processed invoices for this org (duplicate detection). */
  priors?: PriorInvoice[];
  /** Learned profile for this invoice's vendor (bank-change + anomaly). */
  vendor?: VendorProfile | null;
  routing?: RoutingConfig;
}

export interface ProcessedInvoice {
  invoice: Invoice;
  flags: ValidationFlag[];
  score: ScoreResult;
}

/**
 * Validate + score an already-extracted invoice. Combines deterministic math flags with
 * history-aware smart flags, then routes on the union — so a duplicate or bank-change
 * (critical) correctly forces review just like a math error does.
 */
export function processExtractedInvoice(
  invoice: Invoice,
  ctx: PipelineContext = {},
): ProcessedInvoice {
  const mathResult = validateInvoice(invoice);
  const smartFlags = runSmartChecks(invoice, {
    priors: ctx.priors ?? [],
    vendor: ctx.vendor ?? null,
  });

  const flags = [...mathResult.flags, ...smartFlags];
  const combined = { flags, hasCritical: flags.some((f) => f.severity === "critical") };

  const score = scoreAndRoute(invoice, combined, ctx.routing ?? DEFAULT_ROUTING);
  return { invoice, flags, score };
}
