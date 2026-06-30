import { describe, it, expect } from "vitest";
import { coerceMoneyFields } from "@/lib/coerce";
import { parseJsonLoose } from "@/lib/extract";
import { InvoiceSchema } from "@/lib/schema";
import { cleanInvoice } from "./fixtures";

describe("coerceMoneyFields", () => {
  it("turns money strings into numbers in EU and US formats", () => {
    const raw = {
      subtotal: "1.234,56",
      total_amount_due: "$1,234.56",
      line_items: [{ description: "x", quantity: "2", unit_price: "100,00", line_total: "200,00", tax_rate: "20" }],
    };
    const out = coerceMoneyFields(raw) as any;
    expect(out.subtotal).toBe(1234.56);
    expect(out.total_amount_due).toBe(1234.56);
    expect(out.line_items[0].unit_price).toBe(100);
    expect(out.line_items[0].quantity).toBe(2);
  });

  it("leaves non-money fields alone", () => {
    const out = coerceMoneyFields({ invoice_number: "INV-001", currency: "USD" }) as any;
    expect(out.invoice_number).toBe("INV-001");
    expect(out.currency).toBe("USD");
  });

  it("produces a blob that still passes the full schema after coercion", () => {
    const clean = cleanInvoice();
    // Simulate messy model output: stringified money.
    const messy = JSON.parse(JSON.stringify(clean));
    messy.total_amount_due = "1.440,00";
    messy.subtotal = "1.200,00";
    const coerced = coerceMoneyFields(messy);
    expect(InvoiceSchema.safeParse(coerced).success).toBe(true);
  });
});

describe("parseJsonLoose", () => {
  it("parses plain JSON", () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
  });
  it("strips ```json fences", () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it("extracts JSON embedded in prose", () => {
    expect(parseJsonLoose('Here you go: {"a":1} hope that helps')).toEqual({ a: 1 });
  });
  it("throws a clear error on non-JSON", () => {
    expect(() => parseJsonLoose("I cannot read this document")).toThrow(/valid JSON/);
  });
});
