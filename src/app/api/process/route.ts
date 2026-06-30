/**
 * POST /api/process — run the full pipeline on an uploaded invoice file.
 *
 * multipart/form-data: field "file" = the invoice (PDF/JPG/PNG).
 * Returns { classification, invoice, flags, score } or { error }.
 *
 * This is stages 2–6 of the pipeline behind one HTTP call. Persisting to Supabase
 * (stage 9) and pushing to accounting (stage 7) are layered on once those are connected;
 * the brains here are already final.
 */
import { NextRequest, NextResponse } from "next/server";
import { classifyDocument, extractInvoice, type SupportedMediaType } from "@/lib/extract";
import { processExtractedInvoice } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 60;

const MEDIA: Record<string, SupportedMediaType> = {
  "application/pdf": "application/pdf",
  "image/jpeg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
  "image/gif": "image/gif",
};

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured on the server." },
      { status: 503 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'file' field." }, { status: 400 });
  }
  const mediaType = MEDIA[file.type];
  if (!mediaType) {
    return NextResponse.json(
      { error: `Unsupported file type "${file.type}". Use PDF, JPG, PNG, WEBP, or GIF.` },
      { status: 415 },
    );
  }

  const data = Buffer.from(await file.arrayBuffer());

  try {
    const classification = await classifyDocument({ data, mediaType });
    if (!classification.is_processable_invoice) {
      return NextResponse.json({ classification, invoice: null, flags: [], score: null });
    }
    const { invoice } = await extractInvoice({ data, mediaType });
    // TODO: load org priors + vendor profile from Supabase to enable duplicate/bank-change checks.
    const { flags, score } = processExtractedInvoice(invoice);
    return NextResponse.json({ classification, invoice, flags, score });
  } catch (err) {
    return NextResponse.json(
      { error: `Processing failed: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
