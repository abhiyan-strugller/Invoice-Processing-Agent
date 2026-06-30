import { describe, it, expect } from "vitest";
import {
  detectDuplicate,
  detectBankChange,
  detectAmountAnomaly,
  bankFingerprint,
  type PriorInvoice,
  type VendorProfile,
} from "@/lib/smart";
import { processExtractedInvoice } from "@/lib/pipeline";
import { cleanInvoice } from "./fixtures";

describe("detectDuplicate", () => {
  const priors: PriorInvoice[] = [
    { vendor_name: "Acme Supplies Ltd", invoice_number: "INV-2026-0042", total_amount_due: 1440 },
  ];
  it("flags same vendor + number + amount as a critical duplicate", () => {
    const flag = detectDuplicate(cleanInvoice(), priors);
    expect(flag?.code).toBe("DUPLICATE_INVOICE");
    expect(flag?.severity).toBe("critical");
    expect(flag?.message).toMatch(/do not pay twice/i);
  });
  it("matches despite spacing/case differences in vendor + number", () => {
    const inv = cleanInvoice({ invoice_number: "inv 2026 0042" });
    inv.vendor.name = "ACME SUPPLIES LTD";
    expect(detectDuplicate(inv, priors)?.code).toBe("DUPLICATE_INVOICE");
  });
  it("warns differently when the amount differs", () => {
    const flag = detectDuplicate(cleanInvoice({ total_amount_due: 9999 }), priors);
    expect(flag?.message).toMatch(/different amount/i);
  });
  it("returns null when nothing matches", () => {
    expect(detectDuplicate(cleanInvoice({ invoice_number: "OTHER" }), priors)).toBeNull();
  });
});

describe("detectBankChange", () => {
  it("flags when the fingerprint differs from the vendor's known one", () => {
    const inv = cleanInvoice();
    const vendor: VendorProfile = {
      name: "Acme Supplies Ltd",
      bank_fingerprint: "deadbeef",
      amount_min: null,
      amount_max: null,
      invoice_count: 6,
    };
    const flag = detectBankChange(inv, vendor);
    expect(flag?.code).toBe("BANK_DETAILS_CHANGED");
    expect(flag?.severity).toBe("critical");
  });
  it("does not flag when the fingerprint matches", () => {
    const inv = cleanInvoice();
    const vendor: VendorProfile = {
      name: "Acme",
      bank_fingerprint: bankFingerprint(inv.bank_details),
      amount_min: null,
      amount_max: null,
      invoice_count: 6,
    };
    expect(detectBankChange(inv, vendor)).toBeNull();
  });
});

describe("detectAmountAnomaly", () => {
  const vendor: VendorProfile = {
    name: "Acme",
    bank_fingerprint: null,
    amount_min: 1000,
    amount_max: 1500,
    invoice_count: 10,
  };
  it("flags an amount far outside the learned range", () => {
    expect(detectAmountAnomaly(cleanInvoice({ total_amount_due: 50000 }), vendor)?.code).toBe(
      "AMOUNT_ANOMALY",
    );
  });
  it("does not flag a normal amount", () => {
    expect(detectAmountAnomaly(cleanInvoice({ total_amount_due: 1440 }), vendor)).toBeNull();
  });
  it("stays silent without enough history", () => {
    expect(detectAmountAnomaly(cleanInvoice({ total_amount_due: 50000 }), { ...vendor, invoice_count: 1 })).toBeNull();
  });
});

describe("processExtractedInvoice — smart flags force review", () => {
  it("routes a duplicate to needs_review even though the math is clean", () => {
    const priors: PriorInvoice[] = [
      { vendor_name: "Acme Supplies Ltd", invoice_number: "INV-2026-0042", total_amount_due: 1440 },
    ];
    const result = processExtractedInvoice(cleanInvoice(), { priors });
    expect(result.score.decision).toBe("needs_review");
    expect(result.flags.some((f) => f.code === "DUPLICATE_INVOICE")).toBe(true);
  });
});
