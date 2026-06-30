/**
 * Accuracy measurement (CLAUDE.md §12 / §13.2 — accuracy must be MEASURED, not eyeballed).
 *
 * Compares an extracted invoice against a human-verified "ground truth" (`*.expected.json`)
 * and produces a per-field correct/incorrect breakdown plus an overall field-accuracy %.
 * This is the number we tune the prompt against until it clears 90% on 20+ real invoices.
 *
 * Pure + deterministic so it is unit-tested without any API key.
 */
import type { Invoice } from "./schema";
import { moneyEquals } from "./money";

export interface FieldComparison {
  field: string;
  expected: unknown;
  actual: unknown;
  correct: boolean;
}

export interface AccuracyResult {
  fields: FieldComparison[];
  correct: number;
  total: number;
  accuracy: number; // 0..1
}

const normStr = (v: unknown): string =>
  v === null || v === undefined ? "" : String(v).toLowerCase().replace(/\s+/g, " ").trim();

/** Field-type-aware equality: money within a cent, strings normalized, dates exact. */
function fieldEquals(kind: "money" | "string" | "exact", expected: unknown, actual: unknown): boolean {
  const bothEmpty = (a: unknown) => a === null || a === undefined || a === "";
  if (bothEmpty(expected) && bothEmpty(actual)) return true;
  if (bothEmpty(expected) !== bothEmpty(actual)) return false;

  if (kind === "money") {
    const e = Number(expected);
    const a = Number(actual);
    if (!Number.isFinite(e) || !Number.isFinite(a)) return false;
    return moneyEquals(e, a, 0.01);
  }
  if (kind === "string") return normStr(expected) === normStr(actual);
  return expected === actual;
}

/** The scalar fields we score on every invoice. */
const SCALAR_FIELDS: { field: string; kind: "money" | "string" | "exact"; get: (i: Invoice) => unknown }[] = [
  { field: "vendor.name", kind: "string", get: (i) => i.vendor.name },
  { field: "vendor.tax_id", kind: "string", get: (i) => i.vendor.tax_id },
  { field: "invoice_number", kind: "string", get: (i) => i.invoice_number },
  { field: "invoice_date", kind: "exact", get: (i) => i.invoice_date },
  { field: "due_date", kind: "exact", get: (i) => i.due_date },
  { field: "currency", kind: "exact", get: (i) => i.currency },
  { field: "subtotal", kind: "money", get: (i) => i.subtotal },
  { field: "tax_total", kind: "money", get: (i) => i.tax_total },
  { field: "total_amount_due", kind: "money", get: (i) => i.total_amount_due },
];

/**
 * Compare an extracted invoice against ground truth. Line items are scored on (a) count
 * match, and (b) per-line description + line_total for as many lines as both share.
 */
export function compareInvoice(expected: Invoice, actual: Invoice): AccuracyResult {
  const fields: FieldComparison[] = [];

  for (const f of SCALAR_FIELDS) {
    const e = f.get(expected);
    const a = f.get(actual);
    fields.push({ field: f.field, expected: e, actual: a, correct: fieldEquals(f.kind, e, a) });
  }

  // Line-item count.
  fields.push({
    field: "line_items.count",
    expected: expected.line_items.length,
    actual: actual.line_items.length,
    correct: expected.line_items.length === actual.line_items.length,
  });

  // Per-line description + line_total, over the overlap.
  const n = Math.min(expected.line_items.length, actual.line_items.length);
  for (let i = 0; i < n; i++) {
    const e = expected.line_items[i];
    const a = actual.line_items[i];
    fields.push({
      field: `line_items.${i}.description`,
      expected: e.description,
      actual: a.description,
      correct: fieldEquals("string", e.description, a.description),
    });
    fields.push({
      field: `line_items.${i}.line_total`,
      expected: e.line_total,
      actual: a.line_total,
      correct: fieldEquals("money", e.line_total, a.line_total),
    });
  }

  const correct = fields.filter((f) => f.correct).length;
  const total = fields.length;
  return { fields, correct, total, accuracy: total === 0 ? 1 : correct / total };
}

/** Aggregate accuracy across a whole sample set. */
export function aggregateAccuracy(results: AccuracyResult[]): { accuracy: number; correct: number; total: number } {
  const correct = results.reduce((a, r) => a + r.correct, 0);
  const total = results.reduce((a, r) => a + r.total, 0);
  return { correct, total, accuracy: total === 0 ? 1 : correct / total };
}
