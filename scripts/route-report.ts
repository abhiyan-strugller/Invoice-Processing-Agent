/**
 * Run the validation + confidence routing layer over an already-labeled folder
 * (its _expected/*.json files) WITHOUT calling the API again. Shows, per invoice, the
 * routing decision and every flag — i.e. how well the trust layer catches extraction
 * errors. This is the metric that actually matters (FOUNDATION.md §5/§11): not "is every
 * field perfect" but "does the agent refuse to auto-approve wrong data?".
 *
 *   npm run route -- "./samples/reciving invoice"
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { InvoiceSchema } from "../src/lib/schema";
import { processExtractedInvoice } from "../src/lib/pipeline";

const LABEL: Record<string, string> = {
  auto_approve: "✅ AUTO",
  approve_with_flag: "🟡 FLAG",
  needs_review: "🔴 REVIEW",
};

async function main() {
  const dir = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "./samples";
  const expectedDir = join(dir, "_expected");
  const files = (await readdir(expectedDir))
    .filter((f) => f.endsWith(".json"))
    .sort((a, b) => parseInt(a) - parseInt(b));

  const tally: Record<string, number> = { auto_approve: 0, approve_with_flag: 0, needs_review: 0 };
  for (const f of files) {
    const parsed = InvoiceSchema.safeParse(JSON.parse(await readFile(join(expectedDir, f), "utf8")));
    if (!parsed.success) {
      console.log(`${f}: invalid JSON — ${parsed.error.issues[0].message}`);
      continue;
    }
    const { flags, score } = processExtractedInvoice(parsed.data);
    tally[score.decision]++;
    const name = f.replace(".png.expected.json", "").replace(".jpeg.expected.json", "");
    console.log(`\n#${name}  ${LABEL[score.decision]}  (conf ${(score.confidence * 100).toFixed(0)}%)`);
    console.log(`   reason: ${score.reason}`);
    for (const fl of flags) console.log(`   [${fl.severity}] ${fl.code}: ${fl.message}`);
  }

  const total = files.length;
  console.log(`\n════════════════════════════════════════`);
  console.log(`Routing over ${total} invoices:`);
  console.log(`  ✅ auto-approve:     ${tally.auto_approve}`);
  console.log(`  🟡 approve w/ flag:  ${tally.approve_with_flag}`);
  console.log(`  🔴 needs review:     ${tally.needs_review}`);
  const caught = tally.needs_review + tally.approve_with_flag;
  console.log(`\nThe trust layer held back ${caught}/${total} (${((caught / total) * 100).toFixed(0)}%) from silent auto-approval.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
