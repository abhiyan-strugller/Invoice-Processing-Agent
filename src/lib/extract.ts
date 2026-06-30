/**
 * The extraction engine (FOUNDATION.md §4, CLAUDE.md §5 stages 2–3).
 *
 * Pipeline-facing entry points:
 *   - classifyDocument()  → cheap Haiku gate: is this even an invoice? (skip the expensive call)
 *   - extractInvoice()    → Sonnet vision extraction into the strict schema.
 *
 * Both parse defensively: strip stray ```json fences, coerce money strings to numbers,
 * then validate against the Zod schema. Nothing downstream ever sees an unvalidated blob.
 */
import Anthropic from "@anthropic-ai/sdk";
import { InvoiceSchema, type Invoice } from "./schema";
import {
  EXTRACTION_SYSTEM_PROMPT,
  buildExtractionPrompt,
  CLASSIFICATION_PROMPT,
} from "./prompt";
import { coerceMoneyFields } from "./coerce";

const EXTRACTION_MODEL = process.env.ANTHROPIC_EXTRACTION_MODEL ?? "claude-sonnet-4-6";
const CLASSIFICATION_MODEL =
  process.env.ANTHROPIC_CLASSIFICATION_MODEL ?? "claude-haiku-4-5-20251001";

export type SupportedMediaType =
  | "application/pdf"
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/gif";

export interface DocumentInput {
  /** Raw file bytes. */
  data: Buffer | Uint8Array;
  mediaType: SupportedMediaType;
  /** Optional filename, used only for logging/debugging. */
  filename?: string;
}

export interface ClassificationResult {
  type: "invoice" | "receipt" | "statement" | "purchase_order" | "credit_note" | "other";
  is_processable_invoice: boolean;
  reason: string;
}

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Copy .env.example to .env.local and add your key.",
    );
  }
  _client = new Anthropic({ apiKey });
  return _client;
}

/** Build the Anthropic content block for a document (PDF → document, image → image). */
function toContentBlock(doc: DocumentInput): Anthropic.ContentBlockParam {
  const base64 = Buffer.from(doc.data).toString("base64");
  if (doc.mediaType === "application/pdf") {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } };
  }
  return { type: "image", source: { type: "base64", media_type: doc.mediaType, data: base64 } };
}

/** Pull the first text block out of a Messages response. */
function responseText(msg: Anthropic.Message): string {
  const block = msg.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  return block?.text ?? "";
}

/**
 * Defensive JSON parse: strips markdown fences and any prose around the JSON object,
 * then JSON.parse. Throws a clear error (with a snippet) if it cannot find valid JSON.
 */
export function parseJsonLoose(raw: string): unknown {
  let text = raw.trim();
  // Strip ```json ... ``` or ``` ... ``` fences.
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fence) text = fence[1].trim();
  // If there is still surrounding prose, grab the outermost {...}.
  if (!text.startsWith("{")) {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first !== -1 && last > first) text = text.slice(first, last + 1);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(
      `Model did not return valid JSON. First 200 chars: ${raw.slice(0, 200)}`,
      { cause: err },
    );
  }
}

/** Cheap classification gate (CLAUDE.md §5.2). */
export async function classifyDocument(doc: DocumentInput): Promise<ClassificationResult> {
  const msg = await client().messages.create({
    model: CLASSIFICATION_MODEL,
    max_tokens: 256,
    temperature: 0, // deterministic: the same document must classify the same way every time
    messages: [{ role: "user", content: [toContentBlock(doc), { type: "text", text: CLASSIFICATION_PROMPT }] }],
  });
  const parsed = parseJsonLoose(responseText(msg)) as ClassificationResult;
  return parsed;
}

export interface ExtractionOutcome {
  invoice: Invoice;
  /** Raw model JSON before coercion/validation — kept for the audit trail. */
  raw: unknown;
  usage: { input_tokens: number; output_tokens: number };
  model: string;
}

/**
 * Extract one invoice document into the validated schema. Throws if the model output
 * cannot be coerced/validated into a well-formed Invoice — the caller routes that to
 * `failed` rather than guessing.
 */
export async function extractInvoice(doc: DocumentInput): Promise<ExtractionOutcome> {
  const msg = await client().messages.create({
    model: EXTRACTION_MODEL,
    max_tokens: 4096,
    temperature: 0, // deterministic extraction — same invoice, same JSON, every run
    system: EXTRACTION_SYSTEM_PROMPT,
    messages: [{ role: "user", content: [toContentBlock(doc), { type: "text", text: buildExtractionPrompt() }] }],
  });

  const raw = parseJsonLoose(responseText(msg));
  const coerced = coerceMoneyFields(raw);
  const result = InvoiceSchema.safeParse(coerced);
  if (!result.success) {
    throw new Error(
      `Extraction did not match the invoice schema: ${result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .slice(0, 5)
        .join("; ")}`,
    );
  }

  return {
    invoice: result.data,
    raw,
    usage: { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens },
    model: EXTRACTION_MODEL,
  };
}
