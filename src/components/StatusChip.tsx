import type { RouteDecision } from "@/lib/confidence";

const STYLES: Record<RouteDecision, { label: string; cls: string }> = {
  auto_approve: { label: "Auto-approved", cls: "bg-green-100 text-green-700" },
  approve_with_flag: { label: "Approved · flagged", cls: "bg-amber-100 text-amber-700" },
  needs_review: { label: "Needs review", cls: "bg-red-100 text-red-700" },
};

export function StatusChip({ decision }: { decision: RouteDecision }) {
  const s = STYLES[decision];
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>
      {s.label}
    </span>
  );
}
