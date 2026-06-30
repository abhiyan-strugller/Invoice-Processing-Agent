/**
 * Deterministic validation rules (CLAUDE.md §6).
 *
 * THIS IS THE TRUST LAYER. It runs in code, not the LLM, after extraction. Every rule
 * that fails produces a specific, human-readable flag naming WHICH number is suspect
 * ("line items sum to 1,180.00 but subtotal reads 1,180.50") — that specificity is the
 * concrete UX win over Dext/Hubdoc (CLAUDE.md §6 closing note).
 *
 * The agent never silently "fixes" a discrepancy. It surfaces it and lets routing decide.
 */
import type { Invoice } from "./schema";
import { moneyEquals, round2 } from "./money";

export type FlagSeverity = "info" | "minor" | "critical";

export interface ValidationFlag {
  /** Stable machine code, e.g. "TOTAL_MISMATCH" — used for analytics + tests. */
  code: string;
  severity: FlagSeverity;
  /** Plain-English, names the specific suspect number. Shown to the reviewer. */
  message: string;
  /** Dotted path to the field(s) involved, for UI highlighting. */
  fields?: string[];
}

export interface ValidationResult {
  flags: ValidationFlag[];
  /** Convenience: true if any flag is `critical`. */
  hasCritical: boolean;
}

const fmt = (n: number): string =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Run all deterministic checks. `tolerance` is the absolute money tolerance for "≈"
 * comparisons; it scales slightly with invoice size to absorb per-line rounding.
 */
export function validateInvoice(inv: Invoice): ValidationResult {
  const flags: ValidationFlag[] = [];
  // Tolerance absorbs PER-CENT ROUNDING NOISE, not real errors. It scales with the number
  // of rounded terms in a sum (n × 1¢), never with invoice size — a percentage tolerance
  // would silently hide a $10 error on a $10k invoice, which is exactly what we refuse to do.
  const sumTol = (terms: number) => 0.01 * Math.max(1, terms) + 0.005;
  const PAIR_TOL = 0.02; // a single A−B / A×B comparison

  // ---- Required fields present (CLAUDE.md §6) ----
  if (!inv.invoice_number?.trim()) {
    flags.push({
      code: "MISSING_INVOICE_NUMBER",
      severity: "critical",
      message: "Invoice number is missing.",
      fields: ["invoice_number"],
    });
  }
  if (!inv.vendor?.name?.trim()) {
    flags.push({
      code: "MISSING_VENDOR_NAME",
      severity: "critical",
      message: "Vendor name is missing.",
      fields: ["vendor.name"],
    });
  }
  if (!isNum(inv.total_amount_due)) {
    flags.push({
      code: "MISSING_TOTAL",
      severity: "critical",
      message: "Total amount due is missing or not a number.",
      fields: ["total_amount_due"],
    });
  }

  // ---- Currency present when an amount is present ----
  if (isNum(inv.total_amount_due) && !inv.currency) {
    flags.push({
      code: "MISSING_CURRENCY",
      severity: "minor",
      message: `An amount (${fmt(inv.total_amount_due)}) is present but no currency was detected.`,
      fields: ["currency"],
    });
  }

  // ---- Line-item math: sum(line_total) ≈ subtotal ----
  const lineTotals = inv.line_items.map((li) => li.line_total).filter(isNum);
  if (lineTotals.length > 0 && isNum(inv.subtotal)) {
    const sum = round2(lineTotals.reduce((a, b) => a + b, 0));
    if (!moneyEquals(sum, inv.subtotal, sumTol(lineTotals.length))) {
      flags.push({
        code: "LINE_ITEMS_SUBTOTAL_MISMATCH",
        severity: "critical",
        message: `Line items sum to ${fmt(sum)} but subtotal reads ${fmt(inv.subtotal)}.`,
        fields: ["line_items", "subtotal"],
      });
    }
  }

  // ---- Per-line math: quantity × unit_price ≈ line_total ----
  inv.line_items.forEach((li, i) => {
    if (isNum(li.quantity) && isNum(li.unit_price) && isNum(li.line_total)) {
      const expected = round2(li.quantity * li.unit_price);
      if (!moneyEquals(expected, li.line_total, PAIR_TOL)) {
        flags.push({
          code: "LINE_ITEM_MATH_MISMATCH",
          severity: "minor",
          message: `Line ${i + 1} ("${li.description}"): ${li.quantity} × ${fmt(
            li.unit_price,
          )} = ${fmt(expected)}, but line total reads ${fmt(li.line_total)}.`,
          fields: [`line_items.${i}`],
        });
      }
    }
  });

  // ---- Total math: subtotal − discount + tax_total + shipping ≈ total_amount_due ----
  if (isNum(inv.subtotal) && isNum(inv.total_amount_due)) {
    const discount = isNum(inv.discount) ? inv.discount : 0;
    const tax = isNum(inv.tax_total) ? inv.tax_total : 0;
    const shipping = isNum(inv.shipping) ? inv.shipping : 0;
    const expected = round2(inv.subtotal - discount + tax + shipping);
    if (!moneyEquals(expected, inv.total_amount_due, sumTol(4))) {
      flags.push({
        code: "TOTAL_MISMATCH",
        severity: "critical",
        message: `subtotal ${fmt(inv.subtotal)} − discount ${fmt(discount)} + tax ${fmt(
          tax,
        )} + shipping ${fmt(shipping)} = ${fmt(expected)}, but total reads ${fmt(
          inv.total_amount_due,
        )}.`,
        fields: ["subtotal", "discount", "tax_total", "shipping", "total_amount_due"],
      });
    }
  }

  // ---- Tax math: each tax_breakdown.amount ≈ rate × taxable_base ----
  if (inv.tax_breakdown.length > 0 && isNum(inv.tax_total)) {
    const sum = round2(inv.tax_breakdown.reduce((a, t) => a + (isNum(t.amount) ? t.amount : 0), 0));
    if (!moneyEquals(sum, inv.tax_total, sumTol(inv.tax_breakdown.length))) {
      flags.push({
        code: "TAX_BREAKDOWN_MISMATCH",
        severity: "minor",
        message: `Tax breakdown sums to ${fmt(sum)} but tax total reads ${fmt(inv.tax_total)}.`,
        fields: ["tax_breakdown", "tax_total"],
      });
    }
  }
  if (inv.tax_breakdown.length > 0 && isNum(inv.subtotal)) {
    inv.tax_breakdown.forEach((t, i) => {
      if (isNum(t.rate) && isNum(t.amount) && inv.subtotal! !== 0) {
        const expected = round2((t.rate / 100) * inv.subtotal!);
        // Loose: taxable base may differ from subtotal; only flag a gross divergence.
        if (!moneyEquals(expected, t.amount, Math.max(0.02, Math.abs(t.amount) * 0.05))) {
          flags.push({
            code: "TAX_RATE_AMOUNT_MISMATCH",
            severity: "info",
            message: `Tax line ${i + 1} (${t.rate}%): ${t.rate}% of subtotal ${fmt(
              inv.subtotal!,
            )} ≈ ${fmt(expected)}, but amount reads ${fmt(t.amount)}. Taxable base may differ.`,
            fields: [`tax_breakdown.${i}`],
          });
        }
      }
    });
  }

  // ---- Balance math: total − amount_already_paid ≈ balance_due ----
  if (isNum(inv.total_amount_due) && isNum(inv.amount_already_paid) && isNum(inv.balance_due)) {
    const expected = round2(inv.total_amount_due - inv.amount_already_paid);
    if (!moneyEquals(expected, inv.balance_due, PAIR_TOL)) {
      flags.push({
        code: "BALANCE_MISMATCH",
        severity: "minor",
        message: `total ${fmt(inv.total_amount_due)} − paid ${fmt(
          inv.amount_already_paid,
        )} = ${fmt(expected)}, but balance due reads ${fmt(inv.balance_due)}.`,
        fields: ["total_amount_due", "amount_already_paid", "balance_due"],
      });
    }
  }

  // ---- Date sanity ----
  const today = new Date();
  const maxYear = today.getFullYear() + 1;
  const invDate = parseISODate(inv.invoice_date);
  const dueDate = parseISODate(inv.due_date);

  if (inv.invoice_date && !invDate) {
    flags.push({
      code: "INVOICE_DATE_UNPARSEABLE",
      severity: "minor",
      message: `Invoice date "${inv.invoice_date}" is not a valid YYYY-MM-DD date.`,
      fields: ["invoice_date"],
    });
  }
  if (invDate) {
    if (invDate.getFullYear() < 2000 || invDate.getFullYear() > maxYear) {
      flags.push({
        code: "INVOICE_DATE_OUT_OF_RANGE",
        severity: "critical",
        message: `Invoice date ${inv.invoice_date} is implausible (before 2000 or after ${maxYear}).`,
        fields: ["invoice_date"],
      });
    }
    const tolDays = 2;
    if (invDate.getTime() - today.getTime() > tolDays * 86_400_000) {
      flags.push({
        code: "INVOICE_DATE_FUTURE",
        severity: "minor",
        message: `Invoice date ${inv.invoice_date} is in the future.`,
        fields: ["invoice_date"],
      });
    }
  }
  if (invDate && dueDate && dueDate.getTime() < invDate.getTime()) {
    flags.push({
      code: "DUE_BEFORE_INVOICE",
      severity: "minor",
      message: `Due date ${inv.due_date} is before invoice date ${inv.invoice_date}.`,
      fields: ["due_date", "invoice_date"],
    });
  }

  // ---- Non-negativity sanity ----
  for (const [field, val] of [
    ["total_amount_due", inv.total_amount_due],
    ["subtotal", inv.subtotal],
    ["tax_total", inv.tax_total],
  ] as const) {
    if (isNum(val) && val < 0) {
      flags.push({
        code: "NEGATIVE_AMOUNT",
        severity: "minor",
        message: `${field} is negative (${fmt(val)}). This may be a credit note rather than an invoice.`,
        fields: [field],
      });
    }
  }

  return { flags, hasCritical: flags.some((f) => f.severity === "critical") };
}

/** Parse a strict YYYY-MM-DD string into a UTC Date, or null. Rejects e.g. month 13. */
export function parseISODate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const year = +y;
  const month = +mo;
  const day = +d;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // Reject rollovers like 2026-02-31 → Mar 3.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}
