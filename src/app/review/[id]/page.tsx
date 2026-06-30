import Link from "next/link";
import { notFound } from "next/navigation";
import { demoRow } from "@/lib/demo";
import { ReviewForm } from "@/components/ReviewForm";
import { StatusChip } from "@/components/StatusChip";

const SEVERITY_STYLE: Record<string, string> = {
  critical: "border-red-200 bg-red-50 text-red-700",
  minor: "border-amber-200 bg-amber-50 text-amber-700",
  info: "border-slate-200 bg-slate-50 text-slate-600",
};

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = demoRow(id);
  if (!row) notFound();

  const { invoice, flags, score } = row;

  return (
    <div>
      <Link href="/" className="text-sm text-slate-500 hover:underline">
        ← Back to invoices
      </Link>

      <div className="mt-3 mb-5 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">
          {invoice.vendor.name} · {invoice.invoice_number}
        </h1>
        <StatusChip decision={score.decision} />
      </div>

      {/* Plain-English escalation reason at the very top (CLAUDE.md §7.6) */}
      {score.decision !== "auto_approve" && (
        <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="font-medium">Why this needs a look: </span>
          {score.reason}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left: the original document (placeholder until Storage is wired) */}
        <div className="flex min-h-[460px] items-center justify-center rounded-xl border border-slate-200 bg-white text-center text-sm text-slate-400">
          <div>
            <div className="mb-2 text-4xl">📄</div>
            Original document renders here
            <br />
            (PDF / image from Supabase Storage)
          </div>
        </div>

        {/* Right: extracted fields, low-confidence highlighted */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <ReviewForm invoice={invoice} flags={flags} fieldConfidence={invoice._meta.field_confidence} />

          {flags.length > 0 && (
            <div className="mt-6">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                Validation findings
              </h3>
              <ul className="space-y-2">
                {flags.map((f, i) => (
                  <li key={i} className={`rounded-md border px-3 py-2 text-xs ${SEVERITY_STYLE[f.severity]}`}>
                    <span className="font-mono font-medium">{f.code}</span> — {f.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
