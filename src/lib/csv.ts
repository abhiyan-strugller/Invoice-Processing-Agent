/**
 * CSV export (CLAUDE.md §9 v1). The fastest path to proving value: most businesses will
 * accept "download a clean CSV and import it" before we build any OAuth integration
 * (FOUNDATION.md §7 shortcut). We emit a header-row format that maps cleanly onto
 * QuickBooks/Xero bill imports.
 *
 * Two views are useful:
 *   - invoicesToCsv(): one row per invoice (summary import).
 *   - lineItemsToCsv(): one row per line item (detailed import) — the line-item
 *     extraction that incumbents paywall is free here, so we expose it.
 */
import type { Invoice } from "./schema";

/** RFC-4180 field escaping. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toRow(cells: unknown[]): string {
  return cells.map(cell).join(",");
}

const INVOICE_HEADERS = [
  "Vendor",
  "Vendor Tax ID",
  "Invoice Number",
  "PO Number",
  "Invoice Date",
  "Due Date",
  "Currency",
  "Subtotal",
  "Discount",
  "Tax",
  "Shipping",
  "Total Due",
  "Amount Paid",
  "Balance Due",
];

export function invoicesToCsv(invoices: Invoice[]): string {
  const rows = [toRow(INVOICE_HEADERS)];
  for (const inv of invoices) {
    rows.push(
      toRow([
        inv.vendor.name,
        inv.vendor.tax_id,
        inv.invoice_number,
        inv.purchase_order_number,
        inv.invoice_date,
        inv.due_date,
        inv.currency,
        inv.subtotal,
        inv.discount,
        inv.tax_total,
        inv.shipping,
        inv.total_amount_due,
        inv.amount_already_paid,
        inv.balance_due,
      ]),
    );
  }
  return rows.join("\r\n");
}

const LINE_ITEM_HEADERS = [
  "Vendor",
  "Invoice Number",
  "Invoice Date",
  "Currency",
  "Description",
  "Quantity",
  "Unit Price",
  "Line Total",
  "Tax Rate %",
];

export function lineItemsToCsv(invoices: Invoice[]): string {
  const rows = [toRow(LINE_ITEM_HEADERS)];
  for (const inv of invoices) {
    for (const li of inv.line_items) {
      rows.push(
        toRow([
          inv.vendor.name,
          inv.invoice_number,
          inv.invoice_date,
          inv.currency,
          li.description,
          li.quantity,
          li.unit_price,
          li.line_total,
          li.tax_rate,
        ]),
      );
    }
  }
  return rows.join("\r\n");
}
