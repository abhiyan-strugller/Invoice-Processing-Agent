/**
 * The "smart" moat features that are pure, deterministic, and testable today
 * (CLAUDE.md §7). These run in code over the org's own history — no LLM needed — which
 * is exactly why they are cheap to ship and hard for an OCR competitor to fake:
 *
 *   - detectDuplicate()      §7.1 — stop double-payment (a real money-loss event).
 *   - detectBankChange()     §7.3 — classic invoice-fraud vector.
 *   - detectAmountAnomaly()  §7.3 — amount far outside this vendor's historical range.
 *
 * They return ValidationFlags so they slot straight into the same routing layer as the
 * deterministic math checks.
 */
import { createHash } from "node:crypto";
import type { Invoice, BankDetails } from "./schema";
import type { ValidationFlag } from "./validate";
import { moneyEquals } from "./money";

/** Minimal record of a previously-seen invoice for duplicate checking. */
export interface PriorInvoice {
  vendor_name: string;
  invoice_number: string;
  total_amount_due: number;
}

/** Learned per-vendor profile (CLAUDE.md §8 vendors table). */
export interface VendorProfile {
  name: string;
  bank_fingerprint: string | null;
  amount_min: number | null;
  amount_max: number | null;
  invoice_count: number;
}

const norm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().replace(/[\s\-_.]/g, "").trim();

/**
 * Stable fingerprint of bank details. Hashing (not storing raw) means we can detect a
 * CHANGE without keeping sensitive account numbers in a comparable plaintext column
 * (FOUNDATION.md §9: never store PII in plaintext where avoidable).
 */
export function bankFingerprint(bank: BankDetails): string | null {
  const parts = [bank.account_number, bank.routing_or_sort, bank.iban, bank.swift].map(norm);
  if (parts.every((p) => p === "")) return null;
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

/** §7.1 — duplicate = same vendor + invoice_number (amount mismatch makes it suspicious). */
export function detectDuplicate(inv: Invoice, priors: PriorInvoice[]): ValidationFlag | null {
  const match = priors.find(
    (p) => norm(p.vendor_name) === norm(inv.vendor.name) && norm(p.invoice_number) === norm(inv.invoice_number),
  );
  if (!match) return null;

  const sameAmount = moneyEquals(match.total_amount_due, inv.total_amount_due, 0.01);
  return {
    code: "DUPLICATE_INVOICE",
    severity: "critical",
    message: sameAmount
      ? `Possible duplicate: invoice ${inv.invoice_number} from ${inv.vendor.name} has already been processed for the same amount. Do not pay twice.`
      : `Invoice number ${inv.invoice_number} from ${inv.vendor.name} was seen before with a different amount (${match.total_amount_due} vs ${inv.total_amount_due}) — confirm which is correct.`,
    fields: ["invoice_number", "vendor.name", "total_amount_due"],
  };
}

/** §7.3 — bank details changed vs the vendor's last known fingerprint (fraud vector). */
export function detectBankChange(inv: Invoice, vendor: VendorProfile | null): ValidationFlag | null {
  if (!vendor || !vendor.bank_fingerprint) return null;
  const current = bankFingerprint(inv.bank_details);
  if (!current || current === vendor.bank_fingerprint) return null;
  return {
    code: "BANK_DETAILS_CHANGED",
    severity: "critical",
    message: `Vendor bank details differ from the last ${vendor.invoice_count} invoice(s) from ${inv.vendor.name} — please confirm with the vendor before paying. This is a common invoice-fraud signal.`,
    fields: ["bank_details"],
  };
}

/** §7.3 — amount wildly outside this vendor's learned historical range. */
export function detectAmountAnomaly(inv: Invoice, vendor: VendorProfile | null): ValidationFlag | null {
  if (!vendor || vendor.invoice_count < 3 || vendor.amount_min === null || vendor.amount_max === null) {
    return null; // not enough history to judge
  }
  const amt = inv.total_amount_due;
  const span = Math.max(1, vendor.amount_max - vendor.amount_min);
  const high = vendor.amount_max + span * 2;
  const low = Math.max(0, vendor.amount_min - span * 2);
  if (amt > high || amt < low) {
    return {
      code: "AMOUNT_ANOMALY",
      severity: "minor",
      message: `Amount ${amt} is well outside ${inv.vendor.name}'s usual range (${vendor.amount_min}–${vendor.amount_max}). Worth a look.`,
      fields: ["total_amount_due"],
    };
  }
  return null;
}

/** Convenience: run all history-aware smart checks and return any flags. */
export function runSmartChecks(
  inv: Invoice,
  ctx: { priors: PriorInvoice[]; vendor: VendorProfile | null },
): ValidationFlag[] {
  return [
    detectDuplicate(inv, ctx.priors),
    detectBankChange(inv, ctx.vendor),
    detectAmountAnomaly(inv, ctx.vendor),
  ].filter((f): f is ValidationFlag => f !== null);
}
