import { describe, it, expect } from "vitest";
import { scoreAndRoute } from "@/lib/confidence";
import { validateInvoice } from "@/lib/validate";
import { cleanInvoice } from "./fixtures";

const route = (inv: Parameters<typeof validateInvoice>[0]) =>
  scoreAndRoute(inv, validateInvoice(inv));

describe("scoreAndRoute", () => {
  it("auto-approves a clean, high-confidence invoice", () => {
    const r = route(cleanInvoice());
    expect(r.decision).toBe("auto_approve");
    expect(r.confidence).toBeGreaterThan(0.9);
  });

  it("forces needs_review when a critical validation flag exists, even with high confidence", () => {
    const r = route(cleanInvoice({ total_amount_due: 9999 })); // TOTAL_MISMATCH (critical)
    expect(r.decision).toBe("needs_review");
    expect(r.reason).toMatch(/total/i);
  });

  it("forces needs_review when a critical field is low-confidence, even with clean math", () => {
    const inv = cleanInvoice();
    inv._meta.field_confidence.total_amount_due = 0.4;
    const r = route(inv);
    expect(r.decision).toBe("needs_review");
    expect(r.weakestField?.field).toBe("total_amount_due");
  });

  it("downgrades to approve_with_flag for minor-only issues", () => {
    const inv = cleanInvoice({ currency: null }); // MISSING_CURRENCY (minor)
    const r = route(inv);
    expect(r.decision).toBe("approve_with_flag");
  });

  it("writes a specific plain-English reason naming the suspect number", () => {
    const r = route(cleanInvoice({ subtotal: 1180.5 }));
    expect(r.reason).toContain("1,200.00");
    expect(r.reason).toContain("1,180.50");
  });

  it("never auto-approves a low-quality scan with borderline confidence", () => {
    const inv = cleanInvoice();
    inv._meta.document_quality = "low";
    inv._meta.field_confidence = {
      invoice_number: 0.86,
      invoice_date: 0.86,
      due_date: 0.86,
      total_amount_due: 0.86,
      vendor_name: 0.86,
    };
    const r = route(inv);
    expect(r.decision).not.toBe("auto_approve");
  });
});
