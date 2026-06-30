/**
 * In-memory demo data so the UI renders a realistic dashboard before Supabase is wired up.
 * Each row is produced by the REAL pipeline (processExtractedInvoice) over a sample
 * invoice, so the status chips, confidence, and escalation reasons are genuine output —
 * not hand-faked. Swap this for a Supabase query once the DB is connected.
 */
import type { Invoice } from "./schema";
import { processExtractedInvoice, type ProcessedInvoice } from "./pipeline";
import type { PriorInvoice } from "./smart";

function sample(overrides: Partial<Invoice>, meta?: Partial<Invoice["_meta"]>): Invoice {
  const base: Invoice = {
    vendor: { name: "Acme Supplies Ltd", address: "1 Industrial Rd, London", email: null, phone: null, tax_id: "GB123456789" },
    buyer: { name: "Your Company", address: null },
    invoice_number: "INV-2026-0042",
    purchase_order_number: null,
    invoice_date: "2026-06-01",
    due_date: "2026-07-01",
    payment_terms: "Net 30",
    currency: "GBP",
    line_items: [
      { description: "Widget A", quantity: 10, unit_price: 100, line_total: 1000, tax_rate: 20 },
      { description: "Widget B", quantity: 1, unit_price: 200, line_total: 200, tax_rate: 20 },
    ],
    subtotal: 1200,
    discount: 0,
    tax_breakdown: [{ rate: 20, amount: 240, label: "VAT" }],
    tax_total: 240,
    shipping: 0,
    total_amount_due: 1440,
    amount_already_paid: 0,
    balance_due: 1440,
    bank_details: { account_name: "Acme Supplies Ltd", account_number: "12345678", routing_or_sort: "12-34-56", iban: null, swift: null },
    _meta: {
      field_confidence: { invoice_number: 0.99, invoice_date: 0.98, due_date: 0.97, total_amount_due: 0.99, vendor_name: 0.99 },
      document_quality: "high",
      is_handwritten: false,
      language_detected: "en",
      notes: null,
      ...meta,
    },
    ...overrides,
  };
  return base;
}

export interface DemoRow extends ProcessedInvoice {
  id: string;
  receivedAt: string;
}

export function demoRows(): DemoRow[] {
  const priors: PriorInvoice[] = [
    { vendor_name: "Office Depot", invoice_number: "OD-55012", total_amount_due: 320.5 },
  ];

  const defs: { id: string; inv: Invoice; receivedAt: string; priors?: PriorInvoice[] }[] = [
    // 1. Clean → auto-approve
    { id: "1", receivedAt: "2026-06-28 09:14", inv: sample({}) },
    // 2. Subtotal mismatch → needs review (math caught it)
    {
      id: "2",
      receivedAt: "2026-06-28 09:31",
      inv: sample({ invoice_number: "INV-2026-0043", subtotal: 1180.5, vendor: { name: "Globex Manufacturing", address: null, email: null, phone: null, tax_id: null } }),
    },
    // 3. Missing currency → approve with flag (minor)
    {
      id: "3",
      receivedAt: "2026-06-28 10:02",
      inv: sample({ invoice_number: "INV-9981", currency: null, vendor: { name: "Initech Services", address: null, email: null, phone: null, tax_id: null } }),
    },
    // 4. Duplicate → needs review
    {
      id: "4",
      receivedAt: "2026-06-28 10:20",
      inv: sample({ invoice_number: "OD-55012", total_amount_due: 320.5, subtotal: 267.08, tax_total: 53.42, tax_breakdown: [{ rate: 20, amount: 53.42, label: "VAT" }], line_items: [{ description: "Printer paper", quantity: 1, unit_price: 267.08, line_total: 267.08, tax_rate: 20 }], vendor: { name: "Office Depot", address: null, email: null, phone: null, tax_id: null } }),
      priors,
    },
    // 5. Low-confidence handwritten → needs review
    {
      id: "5",
      receivedAt: "2026-06-28 11:05",
      inv: sample(
        { invoice_number: "HW-0007", vendor: { name: "Joe's Plumbing", address: null, email: null, phone: null, tax_id: null } },
        { document_quality: "low", is_handwritten: true, field_confidence: { invoice_number: 0.62, invoice_date: 0.55, due_date: 0.4, total_amount_due: 0.7, vendor_name: 0.8 } },
      ),
    },
  ];

  return defs.map((d) => ({
    id: d.id,
    receivedAt: d.receivedAt,
    ...processExtractedInvoice(d.inv, { priors: d.priors }),
  }));
}

export function demoRow(id: string): DemoRow | undefined {
  return demoRows().find((r) => r.id === id);
}
