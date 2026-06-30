/**
 * Confidence scoring + routing (FOUNDATION.md §5C, CLAUDE.md §5).
 *
 * Combines two independent signals into ONE decision:
 *   A. Per-field model confidence on the critical fields (schema._meta.field_confidence).
 *   B. Deterministic validation flags (validate.ts).
 *
 * The golden rule of trust (FOUNDATION.md §5): when in doubt, escalate. It is always
 * better to send a document to a human than to silently push wrong data into a customer's
 * accounting system. Auto-approve is the EXCEPTION, earned by being clean on both signals.
 */
import type { Invoice } from "./schema";
import type { ValidationFlag, ValidationResult } from "./validate";

export type RouteDecision = "auto_approve" | "approve_with_flag" | "needs_review";

export interface RoutingConfig {
  /** Min per-field confidence on EVERY critical field to be eligible for auto-approve. */
  criticalFieldFloor: number;
  /** Min combined score to auto-approve. */
  autoApproveScore: number;
  /** Below this combined score → needs_review even with no critical flags. */
  reviewScore: number;
}

/**
 * Default thresholds. Deliberately conservative — a brand-new install should over-escalate
 * and earn the right to auto-approve more over time (per-vendor accuracy, CLAUDE.md §7.7).
 */
export const DEFAULT_ROUTING: RoutingConfig = {
  criticalFieldFloor: 0.85,
  autoApproveScore: 0.9,
  reviewScore: 0.7,
};

export interface ScoreResult {
  /** Overall 0.00–1.00 confidence for the whole extraction. */
  confidence: number;
  decision: RouteDecision;
  /** The single plain-English reason shown at the top of the review screen (CLAUDE.md §7.6). */
  reason: string;
  /** Lowest critical-field confidence, surfaced for the UI. */
  weakestField: { field: string; confidence: number } | null;
}

const SEVERITY_PENALTY: Record<ValidationFlag["severity"], number> = {
  info: 0.02,
  minor: 0.08,
  critical: 0.35,
};

/**
 * Score and route an extraction. Pure function of (invoice, validation, config) so it is
 * fully unit-testable and deterministic — the same inputs always route the same way.
 */
export function scoreAndRoute(
  inv: Invoice,
  validation: ValidationResult,
  config: RoutingConfig = DEFAULT_ROUTING,
): ScoreResult {
  const fc = inv._meta.field_confidence;
  const fieldEntries = Object.entries(fc) as [string, number][];

  // Mean field confidence, minus accumulated validation penalties.
  const meanFieldConf =
    fieldEntries.reduce((a, [, v]) => a + v, 0) / Math.max(1, fieldEntries.length);
  const penalty = validation.flags.reduce((a, f) => a + SEVERITY_PENALTY[f.severity], 0);

  // Document-quality nudge: low-quality scans get a small haircut.
  const qualityFactor =
    inv._meta.document_quality === "low" ? 0.9 : inv._meta.document_quality === "medium" ? 0.97 : 1;

  const confidence = clamp01((meanFieldConf - penalty) * qualityFactor);

  const weakest = fieldEntries.reduce<{ field: string; confidence: number } | null>(
    (min, [field, v]) => (min === null || v < min.confidence ? { field, confidence: v } : min),
    null,
  );

  const anyCriticalFlag = validation.hasCritical;
  const anyFieldBelowFloor = fieldEntries.some(([, v]) => v < config.criticalFieldFloor);
  // A "blocking" flag is anything that means a validation rule did NOT pass. Per
  // FOUNDATION.md §5C, auto-approve requires ALL rules to pass, so even a minor flag
  // drops the document to approve_with_flag. Only `info` flags are tolerated for auto.
  const anyBlockingFlag = validation.flags.some((f) => f.severity !== "info");

  let decision: RouteDecision;
  if (anyCriticalFlag || anyFieldBelowFloor || confidence < config.reviewScore) {
    // Low confidence on a critical field forces review even if everything else is clean
    // (FOUNDATION.md §5A). When in doubt, escalate (the golden rule of trust).
    decision = "needs_review";
  } else if (anyBlockingFlag || confidence < config.autoApproveScore) {
    decision = "approve_with_flag";
  } else {
    decision = "auto_approve";
  }

  return { confidence, decision, reason: buildReason(decision, validation, weakest, config), weakestField: weakest };
}

/** One-line, plain-English escalation reason (CLAUDE.md §7.6 smart escalation summaries). */
function buildReason(
  decision: RouteDecision,
  validation: ValidationResult,
  weakest: { field: string; confidence: number } | null,
  config: RoutingConfig,
): string {
  if (decision === "auto_approve") {
    return "All critical fields are high-confidence and every validation check passed.";
  }

  const critical = validation.flags.filter((f) => f.severity === "critical");
  if (critical.length > 0) {
    const extra = critical.length > 1 ? ` (+${critical.length - 1} more issue${critical.length > 2 ? "s" : ""})` : "";
    return `${critical[0].message}${extra}`;
  }

  if (weakest && weakest.confidence < config.criticalFieldFloor) {
    return `Low confidence on ${prettyField(weakest.field)} (${Math.round(
      weakest.confidence * 100,
    )}%) — please confirm.`;
  }

  const minor = validation.flags.filter((f) => f.severity === "minor");
  if (minor.length > 0) {
    return `${minor[0].message}`;
  }

  return decision === "approve_with_flag"
    ? "Processed with minor flags — optional review."
    : "Overall confidence is below the auto-approve threshold — please review.";
}

function prettyField(field: string): string {
  return field.replace(/_/g, " ");
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
