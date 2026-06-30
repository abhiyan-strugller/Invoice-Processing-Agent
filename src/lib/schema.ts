/**
 * The canonical invoice schema (CLAUDE.md §4).
 *
 * This is the single source of truth for the shape the agent extracts. The LLM is
 * prompted to return exactly this JSON; we then parse it defensively against this Zod
 * schema before trusting a single field (FOUNDATION.md §4, principle 5).
 *
 * Design notes:
 * - Almost everything is nullable. The model is instructed to return `null` rather than
 *   guess (CLAUDE.md §4 extraction rules). `.nullable().default(null)` lets us accept a
 *   missing key OR an explicit null without throwing.
 * - Numbers are coerced from strings post-extraction (see money.ts) before this schema
 *   runs, so by the time we validate here, money fields are real numbers.
 */
import { z } from "zod";

export const VendorSchema = z.object({
  name: z.string(),
  address: z.string().nullable().default(null),
  email: z.string().nullable().default(null),
  phone: z.string().nullable().default(null),
  tax_id: z.string().nullable().default(null), // VAT/GST/EIN/ABN where present
});

export const BuyerSchema = z.object({
  name: z.string().nullable().default(null),
  address: z.string().nullable().default(null),
});

export const LineItemSchema = z.object({
  description: z.string(),
  quantity: z.number().nullable().default(null),
  unit_price: z.number().nullable().default(null),
  line_total: z.number().nullable().default(null),
  tax_rate: z.number().nullable().default(null),
});

export const TaxBreakdownSchema = z.object({
  // Nullable on purpose: a real invoice may show a tax amount whose rate is unstated (or
  // vice versa). Per the "return null, never guess" rule, the model should null the field
  // it can't read rather than fail — validation (validate.ts) guards every use with isNum.
  rate: z.number().nullable().default(null),
  amount: z.number().nullable().default(null),
  label: z.string().nullable().default(null),
});

export const BankDetailsSchema = z.object({
  account_name: z.string().nullable().default(null),
  account_number: z.string().nullable().default(null),
  routing_or_sort: z.string().nullable().default(null),
  iban: z.string().nullable().default(null),
  swift: z.string().nullable().default(null),
});

/** Per-field confidence (0.00–1.00) for the critical fields that gate auto-approval. */
export const FieldConfidenceSchema = z.object({
  invoice_number: z.number().min(0).max(1),
  invoice_date: z.number().min(0).max(1),
  due_date: z.number().min(0).max(1),
  total_amount_due: z.number().min(0).max(1),
  vendor_name: z.number().min(0).max(1),
});

export const MetaSchema = z.object({
  field_confidence: FieldConfidenceSchema,
  document_quality: z.enum(["high", "medium", "low"]),
  is_handwritten: z.boolean(),
  language_detected: z.string(),
  notes: z.string().nullable().default(null),
});

export const InvoiceSchema = z.object({
  vendor: VendorSchema,
  buyer: BuyerSchema,
  invoice_number: z.string(),
  purchase_order_number: z.string().nullable().default(null),
  invoice_date: z.string().nullable().default(null), // YYYY-MM-DD
  due_date: z.string().nullable().default(null), // YYYY-MM-DD
  payment_terms: z.string().nullable().default(null),
  currency: z.string().nullable().default(null), // ISO 4217
  line_items: z.array(LineItemSchema).default([]),
  subtotal: z.number().nullable().default(null),
  discount: z.number().nullable().default(null),
  tax_breakdown: z.array(TaxBreakdownSchema).default([]),
  tax_total: z.number().nullable().default(null),
  shipping: z.number().nullable().default(null),
  total_amount_due: z.number(),
  amount_already_paid: z.number().nullable().default(null),
  balance_due: z.number().nullable().default(null),
  bank_details: BankDetailsSchema.default({
    account_name: null,
    account_number: null,
    routing_or_sort: null,
    iban: null,
    swift: null,
  }),
  _meta: MetaSchema,
});

export type Vendor = z.infer<typeof VendorSchema>;
export type Buyer = z.infer<typeof BuyerSchema>;
export type LineItem = z.infer<typeof LineItemSchema>;
export type TaxBreakdown = z.infer<typeof TaxBreakdownSchema>;
export type BankDetails = z.infer<typeof BankDetailsSchema>;
export type FieldConfidence = z.infer<typeof FieldConfidenceSchema>;
export type InvoiceMeta = z.infer<typeof MetaSchema>;
export type Invoice = z.infer<typeof InvoiceSchema>;

/** The critical fields whose low confidence forces human review (FOUNDATION.md §5A). */
export const CRITICAL_FIELDS = [
  "invoice_number",
  "invoice_date",
  "due_date",
  "total_amount_due",
  "vendor_name",
] as const;
export type CriticalField = (typeof CRITICAL_FIELDS)[number];
