/**
 * Robust money/number parsing (CLAUDE.md §4 extraction rules).
 *
 * The model is told to return numbers as numbers, but real documents are messy and a
 * vision model will occasionally hand back "1.234,56", "$1,234.56", "1 234,56", or
 * "(120.00)" for a credit. We never want a stray string to crash the pipeline or, worse,
 * be silently coerced wrong (1.234,56 EU → 1.234 instead of 1234.56). This module is the
 * one place that decides US vs EU grouping.
 */

/** Negative if wrapped in parentheses, e.g. "(120.00)" → -120. */
function applyAccountingSign(raw: string, value: number): number {
  return /^\s*\(.*\)\s*$/.test(raw) ? -Math.abs(value) : value;
}

/**
 * Parse a possibly-messy money value into a Number, or null if it is not a number.
 *
 * Grouping/decimal disambiguation:
 *   - If both "," and "." appear, the LAST one is the decimal separator and the other is
 *     the thousands separator ("1,234.56" → 1234.56 ; "1.234,56" → 1234.56).
 *   - If only "," appears: treat as decimal when it looks like a decimal (1–2 trailing
 *     digits and a single comma), otherwise as a thousands separator.
 *   - If only "." appears with >1 group of exactly 3 digits ("1.234.567") treat as
 *     thousands; otherwise as a decimal.
 */
export function parseMoney(input: unknown): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  if (typeof input !== "string") return null;

  const raw = input.trim();
  if (raw === "") return null;

  // Strip currency symbols, letters, and whitespace; keep digits, separators, sign, parens.
  const cleaned = raw.replace(/[^0-9.,\-()]/g, "");
  if (cleaned === "" || /^[().\-,]+$/.test(cleaned)) return null;

  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  let normalized = cleaned.replace(/[()]/g, "");

  if (hasComma && hasDot) {
    const decimalSep = cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".") ? "," : ".";
    const thousandsSep = decimalSep === "," ? "." : ",";
    normalized = normalized.split(thousandsSep).join("");
    normalized = normalized.replace(decimalSep, ".");
  } else if (hasComma) {
    const parts = cleaned.split(",");
    const looksDecimal = parts.length === 2 && parts[1].length > 0 && parts[1].length <= 2;
    normalized = looksDecimal ? normalized.replace(",", ".") : normalized.split(",").join("");
  } else if (hasDot) {
    const parts = cleaned.split(".");
    const looksThousands = parts.length > 2 && parts.slice(1).every((p) => p.length === 3);
    if (looksThousands) normalized = normalized.split(".").join("");
    // else: a single dot is already a valid JS decimal point — leave it.
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return applyAccountingSign(raw, value);
}

/** Round to 2 decimals, killing floating-point dust (e.g. 0.1 + 0.2). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Two money amounts are "equal" within a rounding tolerance (default 1 cent). */
export function moneyEquals(a: number, b: number, tolerance = 0.01): boolean {
  return Math.abs(round2(a) - round2(b)) <= tolerance + 1e-9;
}
