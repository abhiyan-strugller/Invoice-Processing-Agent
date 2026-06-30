import { describe, it, expect } from "vitest";
import { invoicesToCsv, lineItemsToCsv } from "@/lib/csv";
import { cleanInvoice } from "./fixtures";

describe("invoicesToCsv", () => {
  it("emits a header row plus one row per invoice", () => {
    const csv = invoicesToCsv([cleanInvoice(), cleanInvoice({ invoice_number: "INV-2" })]);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("Invoice Number");
    expect(lines[1]).toContain("INV-2026-0042");
    expect(lines[1]).toContain("1440");
  });

  it("escapes commas and quotes per RFC-4180", () => {
    const inv = cleanInvoice();
    inv.vendor.name = 'Acme, "The Best", Ltd';
    const csv = invoicesToCsv([inv]);
    expect(csv).toContain('"Acme, ""The Best"", Ltd"');
  });
});

describe("lineItemsToCsv", () => {
  it("emits one row per line item across invoices", () => {
    const csv = lineItemsToCsv([cleanInvoice()]); // fixture has 2 line items
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(3); // header + 2
    expect(lines[0]).toContain("Description");
    expect(lines[1]).toContain("Widget A");
  });
});
