/**
 * CLI: run the real extraction pipeline against a local invoice file or a folder.
 *
 *   npm run extract -- ./samples/invoice1.pdf          # one file
 *   npm run extract -- ./samples                        # every file in a folder
 *   npm run extract -- ./samples --csv out.csv          # also write a CSV export
 *
 * This is the tool for CLAUDE.md §13.2 / §12: drop 20+ real invoices in ./samples, run
 * it, and eyeball the extracted JSON + routing decision to measure field accuracy before
 * a single line of UI is built. Requires ANTHROPIC_API_KEY in your environment / .env.local.
 */
import { readFile, readdir, writeFile, stat } from "node:fs/promises";
import { join, extname, basename } from "node:path";
import { classifyDocument, extractInvoice, type SupportedMediaType } from "../src/lib/extract";
import { processExtractedInvoice } from "../src/lib/pipeline";
import { invoicesToCsv } from "../src/lib/csv";
import type { Invoice } from "../src/lib/schema";

const MEDIA: Record<string, SupportedMediaType> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const DECISION_LABEL: Record<string, string> = {
  auto_approve: "✅ AUTO-APPROVE",
  approve_with_flag: "🟡 APPROVE WITH FLAG",
  needs_review: "🔴 NEEDS REVIEW",
};

async function loadEnv() {
  // Minimal .env.local loader so the CLI works without extra deps.
  for (const file of [".env.local", ".env"]) {
    try {
      const text = await readFile(file, "utf8");
      for (const line of text.split("\n")) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    } catch {
      /* file may not exist — that's fine */
    }
  }
}

async function filesToProcess(target: string): Promise<string[]> {
  const s = await stat(target);
  if (s.isDirectory()) {
    const entries = await readdir(target);
    return entries
      .filter((f) => MEDIA[extname(f).toLowerCase()])
      .map((f) => join(target, f));
  }
  return [target];
}

async function processFile(path: string): Promise<Invoice | null> {
  const ext = extname(path).toLowerCase();
  const mediaType = MEDIA[ext];
  if (!mediaType) {
    console.log(`  ↳ skipping ${basename(path)} (unsupported type ${ext})`);
    return null;
  }
  const data = await readFile(path);

  console.log(`\n📄 ${basename(path)}`);
  const cls = await classifyDocument({ data, mediaType });
  console.log(`  type: ${cls.type} | processable invoice: ${cls.is_processable_invoice}`);
  if (!cls.is_processable_invoice) {
    console.log(`  ↳ not a processable invoice — ${cls.reason}`);
    return null;
  }

  const { invoice, usage } = await extractInvoice({ data, mediaType });
  const { flags, score } = processExtractedInvoice(invoice);

  console.log(`  vendor: ${invoice.vendor.name}`);
  console.log(`  invoice #: ${invoice.invoice_number}   date: ${invoice.invoice_date}   due: ${invoice.due_date}`);
  console.log(`  total: ${invoice.currency ?? "?"} ${invoice.total_amount_due}   line items: ${invoice.line_items.length}`);
  console.log(`  confidence: ${(score.confidence * 100).toFixed(0)}%   ${DECISION_LABEL[score.decision]}`);
  console.log(`  reason: ${score.reason}`);
  if (flags.length) {
    console.log(`  flags:`);
    for (const f of flags) console.log(`    [${f.severity}] ${f.code}: ${f.message}`);
  }
  console.log(`  tokens: ${usage.input_tokens} in / ${usage.output_tokens} out`);
  return invoice;
}

async function main() {
  await loadEnv();
  const args = process.argv.slice(2);
  const csvIdx = args.indexOf("--csv");
  const csvPath = csvIdx !== -1 ? args[csvIdx + 1] : null;
  const target = args.find((a) => !a.startsWith("--") && a !== csvPath);

  if (!target) {
    console.error("Usage: npm run extract -- <file-or-folder> [--csv out.csv]");
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set. Add it to .env.local (see .env.example).");
    process.exit(1);
  }

  const files = await filesToProcess(target);
  console.log(`Processing ${files.length} file(s)…`);

  const extracted: Invoice[] = [];
  for (const file of files) {
    try {
      const inv = await processFile(file);
      if (inv) extracted.push(inv);
    } catch (err) {
      console.error(`  -- failed: ${(err as Error).message}`);
    }
  }

  if (csvPath && extracted.length) {
    await writeFile(csvPath, invoicesToCsv(extracted), "utf8");
    console.log(`\n💾 Wrote ${extracted.length} invoice(s) to ${csvPath}`);
  }
  console.log(`\nDone. Extracted ${extracted.length}/${files.length}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
