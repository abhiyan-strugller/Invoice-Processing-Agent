import Link from "next/link";
import { demoRows } from "@/lib/demo";
import { StatusChip } from "@/components/StatusChip";
import type { RouteDecision } from "@/lib/confidence";

// Sort so the items that need a human float to the top (CLAUDE.md §10).
const ORDER: Record<RouteDecision, number> = { needs_review: 0, approve_with_flag: 1, auto_approve: 2 };

function money(currency: string | null, n: number) {
  return `${currency ?? ""} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
}

export default function Dashboard() {
  const rows = demoRows().sort((a, b) => ORDER[a.score.decision] - ORDER[b.score.decision]);
  const needsReview = rows.filter((r) => r.score.decision === "needs_review").length;

  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Invoices</h1>
          <p className="mt-1 text-sm text-slate-500">
            {rows.length} processed · <span className="font-medium text-red-600">{needsReview} need review</span>
          </p>
        </div>
        <span className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-500">
          Forward invoices to <code className="font-mono text-slate-700">your-co@inbox.ourapp.com</code>
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Vendor</th>
              <th className="px-4 py-3 font-medium">Invoice #</th>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 text-right font-medium">Total</th>
              <th className="px-4 py-3 text-right font-medium">Confidence</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link href={`/review/${r.id}`} className="font-medium text-slate-900 hover:underline">
                    {r.invoice.vendor.name}
                  </Link>
                  {r.score.decision !== "auto_approve" && (
                    <p className="mt-0.5 max-w-md truncate text-xs text-slate-500">{r.score.reason}</p>
                  )}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-600">{r.invoice.invoice_number}</td>
                <td className="px-4 py-3 text-slate-600">{r.invoice.invoice_date}</td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-900">
                  {money(r.invoice.currency, r.invoice.total_amount_due)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                  {Math.round(r.score.confidence * 100)}%
                </td>
                <td className="px-4 py-3">
                  <StatusChip decision={r.score.decision} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-slate-400">
        Demo data, produced by the real validation + routing engine. Connect Supabase + an
        Anthropic key to process live invoices.
      </p>
    </div>
  );
}
