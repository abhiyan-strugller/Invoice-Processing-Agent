import { describe, it, expect } from "vitest";
import { parseMoney, moneyEquals, round2 } from "@/lib/money";

describe("parseMoney", () => {
  it("passes through finite numbers", () => {
    expect(parseMoney(1234.56)).toBe(1234.56);
    expect(parseMoney(0)).toBe(0);
  });

  it("parses US grouping", () => {
    expect(parseMoney("1,234.56")).toBe(1234.56);
    expect(parseMoney("$1,234,567.89")).toBe(1234567.89);
  });

  it("parses EU grouping", () => {
    expect(parseMoney("1.234,56")).toBe(1234.56);
    expect(parseMoney("1.234.567,89")).toBe(1234567.89);
    expect(parseMoney("€1.234,56")).toBe(1234.56);
  });

  it("disambiguates a lone comma", () => {
    expect(parseMoney("1234,56")).toBe(1234.56); // decimal
    expect(parseMoney("1,234")).toBe(1234); // thousands
    expect(parseMoney("1,234,567")).toBe(1234567); // thousands
  });

  it("disambiguates a lone dot", () => {
    expect(parseMoney("1234.56")).toBe(1234.56);
    expect(parseMoney("1.234.567")).toBe(1234567); // thousands
  });

  it("handles accounting-style negatives", () => {
    expect(parseMoney("(120.00)")).toBe(-120);
    expect(parseMoney("-120.00")).toBe(-120);
  });

  it("returns null for junk", () => {
    expect(parseMoney("N/A")).toBeNull();
    expect(parseMoney("")).toBeNull();
    expect(parseMoney(null)).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
    expect(parseMoney("--")).toBeNull();
  });
});

describe("round2 / moneyEquals", () => {
  it("rounds floating-point dust", () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
  it("compares within tolerance", () => {
    expect(moneyEquals(1180.0, 1180.005)).toBe(true);
    expect(moneyEquals(1180.0, 1180.5)).toBe(false);
  });
});
