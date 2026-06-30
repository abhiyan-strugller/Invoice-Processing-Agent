"use client";

import { useState } from "react";
import type { Invoice } from "@/lib/schema";
import type { ValidationFlag } from "@/lib/validate";
import type { FieldConfidence } from "@/lib/schema";

/** Highlight any field whose model confidence is below this (FOUNDATION.md §6). */
const LOW_CONF = 0.85;

function Field({
  label,
  value,
  confidence,
  onChange,
}: {
  label: string;
  value: string;
  confidence?: number;
  onChange: (v: string) => void;
}) {
  const low = confidence !== undefined && confidence < LOW_CONF;
  return (
    <label className="block">
      <span className="flex items-center justify-between text-xs font-medium text-slate-500">
        {label}
        {confidence !== undefined && (
          <span className={low ? "text-amber-600" : "text-slate-400"}>{Math.round(confidence * 100)}%</span>
        )}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-200 ${
          low ? "border-amber-400 bg-amber-50" : "border-slate-200 bg-white"
        }`}
      />
    </label>
  );
}

export function ReviewForm({
  invoice,
  flags,
  fieldConfidence,
}: {
  invoice: Invoice;
  flags: ValidationFlag[];
  fieldConfidence: FieldConfidence;
}) {
  const [form, setForm] = useState({
    vendor_name: invoice.vendor.name,
    invoice_number: invoice.invoice_number,
    invoice_date: invoice.invoice_date ?? "",
    due_date: invoice.due_date ?? "",
    currency: invoice.currency ?? "",
    subtotal: String(invoice.subtotal ?? ""),
    tax_total: String(invoice.tax_total ?? ""),
    total_amount_due: String(invoice.total_amount_due),
  });
  const [done, setDone] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Vendor" value={form.vendor_name} confidence={fieldConfidence.vendor_name} onChange={set("vendor_name")} />
        <Field label="Invoice #" value={form.invoice_number} confidence={fieldConfidence.invoice_number} onChange={set("invoice_number")} />
        <Field label="Invoice date" value={form.invoice_date} confidence={fieldConfidence.invoice_date} onChange={set("invoice_date")} />
        <Field label="Due date" value={form.due_date} confidence={fieldConfidence.due_date} onChange={set("due_date")} />
        <Field label="Currency" value={form.currency} onChange={set("currency")} />
        <Field label="Total due" value={form.total_amount_due} confidence={fieldConfidence.total_amount_due} onChange={set("total_amount_due")} />
        <Field label="Subtotal" value={form.subtotal} onChange={set("subtotal")} />
        <Field label="Tax total" value={form.tax_total} onChange={set("tax_total")} />
      </div>

      <div className="mt-5">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Line items</h3>
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Description</th>
                <th className="px-3 py-2 text-right font-medium">Qty</th>
                <th className="px-3 py-2 text-right font-medium">Unit</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoice.line_items.map((li, i) => (
                <tr key={i}>
                  <td className="px-3 py-2">{li.description}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{li.quantity ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{li.unit_price ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{li.line_total ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {done ? (
        <div className="mt-6 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
          {done} (demo — wiring to the database + accounting push comes once Supabase is connected.)
        </div>
      ) : (
        <div className="mt-6 flex gap-3">
          <button onClick={() => setDone("Approved")} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
            Approve
          </button>
          <button onClick={() => setDone("Edited & approved")} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Edit &amp; approve
          </button>
          <button onClick={() => setDone("Rejected")} className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50">
            Reject
          </button>
        </div>
      )}
    </div>
  );
}
