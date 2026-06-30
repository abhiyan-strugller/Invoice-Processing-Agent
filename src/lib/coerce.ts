/**
 * Coerce a raw model JSON blob into the shape schema.ts expects, applying parseMoney to
 * every monetary field (CLAUDE.md §4: numbers must be parsed as numbers). The model is
 * told to return numbers, but real vision output sometimes hands back "1.234,56" or "$1,200".
 * We fix that here, in ONE place, before the Zod gate — so the schema can stay strict.
 *
 * Non-money fields are passed through untouched. Unknown extra keys are left for Zod to
 * strip. This function never throws; malformed input simply yields nulls that validation
 * (validate.ts) will then flag.
 */
import { parseMoney } from "./money";

const MONEY_KEYS = new Set([
  "subtotal",
  "discount",
  "tax_total",
  "shipping",
  "total_amount_due",
  "amount_already_paid",
  "balance_due",
  "unit_price",
  "line_total",
  "amount",
]);

/** quantity/rate/tax_rate are numeric but not currency — parse leniently, no grouping fuss. */
const NUMERIC_KEYS = new Set(["quantity", "tax_rate", "rate"]);

function coerceValue(key: string, value: unknown): unknown {
  if (MONEY_KEYS.has(key)) return parseMoney(value);
  if (NUMERIC_KEYS.has(key)) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "string") {
      const n = parseMoney(value); // reuse the same EU/US logic
      return n;
    }
    return value ?? null;
  }
  return value;
}

function walk(node: unknown, keyHint?: string): unknown {
  if (Array.isArray(node)) return node.map((v) => walk(v, keyHint));
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out[k] = v && typeof v === "object" ? walk(v, k) : coerceValue(k, v);
    }
    return out;
  }
  return keyHint ? coerceValue(keyHint, node) : node;
}

export function coerceMoneyFields(raw: unknown): unknown {
  return walk(raw);
}
