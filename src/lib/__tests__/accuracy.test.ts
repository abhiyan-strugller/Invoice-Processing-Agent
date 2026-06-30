import { describe, it, expect } from "vitest";
import { compareInvoice, aggregateAccuracy } from "@/lib/accuracy";
import { cleanInvoice } from "./fixtures";

describe("compareInvoice", () => {
  it("scores an identical invoice as 100%", () => {
    const r = compareInvoice(cleanInvoice(), cleanInvoice());
    expect(r.accuracy).toBe(1);
    expect(r.correct).toBe(r.total);
  });

  it("treats money within a cent and case/space-different strings as correct", () => {
    const expected = cleanInvoice();
    const actual = cleanInvoice({ total_amount_due: 1440.004 });
    actual.vendor.name = "  acme   SUPPLIES ltd ";
    const r = compareInvoice(expected, actual);
    expect(r.accuracy).toBe(1);
  });

  it("marks a wrong total and a missing line item as incorrect", () => {
    const expected = cleanInvoice();
    const actual = cleanInvoice({ total_amount_due: 9999 });
    actual.line_items = [actual.line_items[0]]; // dropped one line
    const r = compareInvoice(expected, actual);
    const total = r.fields.find((f) => f.field === "total_amount_due");
    const count = r.fields.find((f) => f.field === "line_items.count");
    expect(total?.correct).toBe(false);
    expect(count?.correct).toBe(false);
    expect(r.accuracy).toBeLessThan(1);
  });

  it("counts a null vs present field as wrong but null vs null as right", () => {
    const expected = cleanInvoice({ due_date: null });
    const actual = cleanInvoice({ due_date: "2026-07-01" });
    const r = compareInvoice(expected, actual);
    expect(r.fields.find((f) => f.field === "due_date")?.correct).toBe(false);

    const r2 = compareInvoice(cleanInvoice({ due_date: null }), cleanInvoice({ due_date: null }));
    expect(r2.fields.find((f) => f.field === "due_date")?.correct).toBe(true);
  });
});

describe("aggregateAccuracy", () => {
  it("aggregates field counts across invoices", () => {
    const a = compareInvoice(cleanInvoice(), cleanInvoice());
    const b = compareInvoice(cleanInvoice(), cleanInvoice({ total_amount_due: 9999 }));
    const agg = aggregateAccuracy([a, b]);
    expect(agg.total).toBe(a.total + b.total);
    expect(agg.accuracy).toBeLessThan(1);
    expect(agg.accuracy).toBeGreaterThan(0.8);
  });
});
