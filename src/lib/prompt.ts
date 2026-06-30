/**
 * Extraction + classification prompts (FOUNDATION.md §4, CLAUDE.md §4).
 *
 * The prompt is deliberately strict: define the exact schema, forbid guessing, demand raw
 * JSON. Per-field confidence is requested for the critical fields so the routing layer
 * (confidence.ts) has signal A to work with. We keep the schema text here in sync with
 * schema.ts — that Zod schema is the gate that rejects anything off-shape.
 */

export const EXTRACTION_SYSTEM_PROMPT = `You are a meticulous accounts-payable bookkeeper. You read a supplier invoice the way an experienced human bookkeeper would — understanding the whole document, its layout, and its intent — not just transcribing characters. You handle messy, handwritten, multi-line, multi-currency, and poor-quality invoices. You never invent data.`;

/** The JSON schema, expressed for the model. Kept in lockstep with schema.ts. */
const SCHEMA_BLOCK = `{
  "vendor": { "name": string, "address": string|null, "email": string|null, "phone": string|null, "tax_id": string|null },
  "buyer": { "name": string|null, "address": string|null },
  "invoice_number": string,
  "purchase_order_number": string|null,
  "invoice_date": "YYYY-MM-DD"|null,
  "due_date": "YYYY-MM-DD"|null,
  "payment_terms": string|null,
  "currency": "ISO 4217 code"|null,
  "line_items": [ { "description": string, "quantity": number|null, "unit_price": number|null, "line_total": number|null, "tax_rate": number|null } ],
  "subtotal": number|null,
  "discount": number|null,
  "tax_breakdown": [ { "rate": number, "amount": number, "label": string|null } ],
  "tax_total": number|null,
  "shipping": number|null,
  "total_amount_due": number,
  "amount_already_paid": number|null,
  "balance_due": number|null,
  "bank_details": { "account_name": string|null, "account_number": string|null, "routing_or_sort": string|null, "iban": string|null, "swift": string|null },
  "_meta": {
    "field_confidence": { "invoice_number": number, "invoice_date": number, "due_date": number, "total_amount_due": number, "vendor_name": number },
    "document_quality": "high"|"medium"|"low",
    "is_handwritten": boolean,
    "language_detected": string,
    "notes": string|null
  }
}`;

export function buildExtractionPrompt(): string {
  return `Extract this invoice into EXACTLY the following JSON structure:

${SCHEMA_BLOCK}

RULES — follow every one:
1. Return null for any field that is genuinely not present. NEVER guess, infer, or invent a value. A wrong value is far worse than null.
2. Parse all monetary values as plain numbers — strip currency symbols and thousands separators. Detect EU ("1.234,56") vs US ("1,234.56") format from the invoice's currency/country, and convert correctly.
3. Normalize every date to "YYYY-MM-DD". If a date is ambiguous (e.g. 03/04/2026), use the vendor's country/currency to decide, and LOWER that field's confidence score.
4. line_items must capture EVERY line, including multi-line descriptions. This is mandatory, not optional.
5. tax_breakdown must list each distinct tax rate separately when an invoice has more than one.
6. In _meta.field_confidence, give an honest 0.00–1.00 score for each listed field: 1.00 = the value is unmistakable; below 0.85 = you are genuinely unsure and a human should check.
7. Set _meta.document_quality, _meta.is_handwritten, and _meta.language_detected honestly. Put anything unusual you noticed in _meta.notes.
8. Output ONLY the raw JSON object. No prose, no explanation, no markdown code fences.`;
}

/**
 * Cheap pre-classification (CLAUDE.md §5.2): is this attachment actually an invoice,
 * before we spend a Sonnet extraction call on it? Run on Haiku.
 */
export const CLASSIFICATION_PROMPT = `Classify this document. Respond with ONLY one raw JSON object, no prose, no fences:
{ "type": "invoice" | "receipt" | "statement" | "purchase_order" | "credit_note" | "other", "is_processable_invoice": boolean, "reason": string }

"is_processable_invoice" is true ONLY for a supplier/vendor invoice or bill requesting payment. A receipt, account statement, purchase order, or marketing document is NOT a processable invoice.`;
