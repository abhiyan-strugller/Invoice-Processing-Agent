/**
 * CLI: measure field-extraction accuracy against human-verified ground truth
 * (CLAUDE.md §12 — the ≥90% gate that must pass before we lean on the UI).
 *
 * Workflow:
 *   1. Label (once per sample): extract and write an editable ground-truth file you correct.
 *        npm run measure -- ./samples --label
 *      → writes ./samples/_expected/<name>.expected.json for each invoice.
 *      → OPEN each one and fix any wrong values so it is 100% correct.
 *   2. Score: re-extract and compare against your corrected ground truth.
 *        npm run measure -- ./samples
 *      → prints per-file + overall field accuracy, and whether it clears 90%.
 *
 * Requires ANTHROPIC_API_KEY (see .env.example).
 */
import { readFile, readdir, writeFile, mkdir, stat } from "node:fs/promises";
import { join, extname, basename } from "node:path";
import { existsSync } from "node:fs";
import { extractInvoice, type SupportedMediaType } from "../src/lib/extract";
import { compareInvoice, aggregateAccuracy, type AccuracyResult } from "../src/lib/accuracy";
import { InvoiceSchema, type Invoice } from "../src/lib/schema";

const MEDIA: Record<string, SupportedMediaType> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};
const TARGET = 0.9;

async function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    try {
      const text = await readFile(file, "utf8");
      for (const line of text.split("\n")) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    } catch {
      /* ignore */
    }
  }
}

async function invoiceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  return entries.filter((f) => MEDIA[extname(f).toLowerCase()]).map((f) => join(dir, f));
}

async function main() {
  await loadEnv();
  const args = process.argv.slice(2);
  const label = args.includes("--label");
  const dir = args.find((a) => !a.startsWith("--")) ?? "./samples";

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set. Add it to .env.local (see .env.example).");
    process.exit(1);
  }
  if (!(await stat(dir)).isDirectory()) {
    console.error(`${dir} is not a directory.`);
    process.exit(1);
  }

  const expectedDir = join(dir, "_expected");
  const files = await invoiceFiles(dir);
  if (files.length === 0) {
    console.error(`No invoice files found in ${dir}. Drop some PDFs/images in there first.`);
    process.exit(1);
  }

  if (label) {
    await mkdir(expectedDir, { recursive: true });
    console.log(`Labeling ${files.length} file(s) → ${expectedDir}`);
    for (const file of files) {
      const data = await readFile(file);
      const out = join(expectedDir, `${basename(file)}.expected.json`);
      if (existsSync(out)) {
        console.log(`  · ${basename(file)} — ground truth already exists, skipping`);
        continue;
      }
      try {
        const { invoice } = await extractInvoice({ data, mediaType: MEDIA[extname(file).toLowerCase()] });
        await writeFile(out, JSON.stringify(invoice, null, 2), "utf8");
        console.log(`  ✓ ${basename(file)} → ${basename(out)}  (CORRECT THIS FILE BY HAND)`);
      } catch (err) {
        console.error(`  ✗ ${basename(file)} — ${(err as Error).message}`);
      }
    }
    console.log(`\nNow open the files in ${expectedDir} and fix any wrong values, then run:\n  npm run measure -- ${dir}`);
    return;
  }

  // Score mode.
  const results: AccuracyResult[] = [];
  let scored = 0;
  for (const file of files) {
    const expectedPath = join(expectedDir, `${basename(file)}.expected.json`);
    if (!existsSync(expectedPath)) {
      console.log(`· ${basename(file)} — no ground truth, run with --label first`);
      continue;
    }
    let expected: Invoice;
    try {
      expected = InvoiceSchema.parse(JSON.parse(await readFile(expectedPath, "utf8")));
    } catch (err) {
      console.error(`✗ ${basename(file)} — bad ground-truth JSON: ${(err as Error).message}`);
      continue;
    }
    try {
      const data = await readFile(file);
      const { invoice } = await extractInvoice({ data, mediaType: MEDIA[extname(file).toLowerCase()] });
      const r = compareInvoice(expected, invoice);
      results.push(r);
      scored++;
      const pct = (r.accuracy * 100).toFixed(0);
      const wrong = r.fields.filter((f) => !f.correct);
      console.log(`${r.accuracy >= TARGET ? "✅" : "❌"} ${basename(file)} — ${pct}% (${r.correct}/${r.total})`);
      for (const w of wrong) {
        console.log(`     ✗ ${w.field}: expected ${JSON.stringify(w.expected)} | got ${JSON.stringify(w.actual)}`);
      }
    } catch (err) {
      console.error(`✗ ${basename(file)} — extraction failed: ${(err as Error).message}`);
    }
  }

  if (scored === 0) {
    console.log(`\nNothing scored. Label your samples first:\n  npm run measure -- ${dir} --label`);
    return;
  }
  const agg = aggregateAccuracy(results);
  console.log(`\n────────────────────────────────────────`);
  console.log(`Overall field accuracy: ${(agg.accuracy * 100).toFixed(1)}% (${agg.correct}/${agg.total}) across ${scored} invoice(s)`);
  console.log(agg.accuracy >= TARGET ? `✅ Clears the ${TARGET * 100}% gate.` : `❌ Below the ${TARGET * 100}% gate — tune src/lib/prompt.ts and re-run.`);
  if (scored < 20) console.log(`⚠ Only ${scored} invoice(s) scored. The spec wants 20+ varied invoices for a real measurement.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
