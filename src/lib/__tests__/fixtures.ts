import type { Invoice } from "@/lib/schema";

/** A clean, internally-consistent invoice that should sail through to auto_approve. */
export function cleanInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    vendor: { name: "Acme Supplies Ltd", address: "1 Industrial Rd", email: null, phone: null, tax_id: "GB123456789" },
    buyer: { name: "Buyer Co", address: null },
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
    bank_details: {
      account_name: "Acme Supplies Ltd",
      account_number: "12345678",
      routing_or_sort: "12-34-56",
      iban: null,
      swift: null,
    },
    _meta: {
      field_confidence: {
        invoice_number: 0.99,
        invoice_date: 0.98,
        due_date: 0.97,
        total_amount_due: 0.99,
        vendor_name: 0.99,
      },
      document_quality: "high",
      is_handwritten: false,
      language_detected: "en",
      notes: null,
    },
    ...overrides,
  };
}
