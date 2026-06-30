import { describe, it, expect } from "vitest";
import { validateInvoice, parseISODate } from "@/lib/validate";
import { cleanInvoice } from "./fixtures";

const codes = (inv: Parameters<typeof validateInvoice>[0]) =>
  validateInvoice(inv).flags.map((f) => f.code);

describe("validateInvoice — clean invoice", () => {
  it("produces no flags on an internally-consistent invoice", () => {
    const result = validateInvoice(cleanInvoice());
    expect(result.flags).toEqual([]);
    expect(result.hasCritical).toBe(false);
  });
});

describe("validateInvoice — required fields", () => {
  it("flags missing invoice number", () => {
    expect(codes(cleanInvoice({ invoice_number: "" }))).toContain("MISSING_INVOICE_NUMBER");
  });
  it("flags missing vendor name", () => {
    const inv = cleanInvoice();
    inv.vendor.name = "";
    expect(codes(inv)).toContain("MISSING_VENDOR_NAME");
  });
});

describe("validateInvoice — math", () => {
  it("catches a line-item/subtotal mismatch and names the numbers", () => {
    const inv = cleanInvoice({ subtotal: 1180.5 }); // line items sum to 1200
    const result = validateInvoice(inv);
    const flag = result.flags.find((f) => f.code === "LINE_ITEMS_SUBTOTAL_MISMATCH");
    expect(flag).toBeDefined();
    expect(flag!.severity).toBe("critical");
    expect(flag!.message).toContain("1,200.00");
    expect(flag!.message).toContain("1,180.50");
  });

  it("catches a total mismatch", () => {
    expect(codes(cleanInvoice({ total_amount_due: 9999 }))).toContain("TOTAL_MISMATCH");
  });

  it("catches per-line quantity × unit_price errors", () => {
    const inv = cleanInvoice();
    inv.line_items[0].line_total = 999; // 10 × 100 should be 1000
    inv.subtotal = 1199; // keep subtotal consistent w/ broken line so we isolate the line check
    expect(codes(inv)).toContain("LINE_ITEM_MATH_MISMATCH");
  });

  it("catches a balance mismatch", () => {
    expect(codes(cleanInvoice({ amount_already_paid: 440, balance_due: 1440 }))).toContain(
      "BALANCE_MISMATCH",
    );
  });

  it("tolerates sub-cent rounding", () => {
    const inv = cleanInvoice({ subtotal: 1200.004 });
    expect(codes(inv)).not.toContain("LINE_ITEMS_SUBTOTAL_MISMATCH");
  });
});

describe("validateInvoice — dates", () => {
  it("flags an out-of-range invoice date", () => {
    expect(codes(cleanInvoice({ invoice_date: "1995-01-01" }))).toContain(
      "INVOICE_DATE_OUT_OF_RANGE",
    );
  });
  it("flags due date before invoice date", () => {
    expect(codes(cleanInvoice({ invoice_date: "2026-06-01", due_date: "2026-05-01" }))).toContain(
      "DUE_BEFORE_INVOICE",
    );
  });
  it("flags an unparseable date", () => {
    expect(codes(cleanInvoice({ invoice_date: "06/01/2026" }))).toContain(
      "INVOICE_DATE_UNPARSEABLE",
    );
  });
});

describe("validateInvoice — currency", () => {
  it("flags an amount present without a currency", () => {
    expect(codes(cleanInvoice({ currency: null }))).toContain("MISSING_CURRENCY");
  });
});

describe("parseISODate", () => {
  it("accepts valid dates", () => {
    expect(parseISODate("2026-06-28")?.getUTCFullYear()).toBe(2026);
  });
  it("rejects invalid calendar dates", () => {
    expect(parseISODate("2026-02-31")).toBeNull();
    expect(parseISODate("2026-13-01")).toBeNull();
    expect(parseISODate("not-a-date")).toBeNull();
  });
});
