/**
 * Downloads the PoE2 data export from repoe-fork into data/snapshot/.
 *
 * Run with: npm run data:refresh
 *
 * The downloaded JSON files form the committed, offline-capable snapshot that
 * `seed-db.ts` turns into the local SQLite database.
 */
import fs from "node:fs/promises";
import path from "node:path";

const BASE_URL = "https://repoe-fork.github.io/poe2";
const USER_AGENT =
  "poe2-crafting-helper/0.1 (local-first dev tool; +https://github.com/repoe-fork/repoe)";

const FILES = [
  "base_items.min.json",
  "mods.min.json",
  "tags.min.json",
  "item_classes.min.json",
] as const;

const SNAPSHOT_DIR = path.join(process.cwd(), "data", "snapshot");

async function download(file: string): Promise<void> {
  const url = `${BASE_URL}/${file}`;
  process.stdout.write(`  fetching ${url} ... `);
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  const text = await res.text();
  // Validate it parses as JSON before writing.
  JSON.parse(text);
  // Normalize the local filename (drop the ".min").
  const outName = file.replace(".min.json", ".json");
  const outPath = path.join(SNAPSHOT_DIR, outName);
  await fs.writeFile(outPath, text, "utf8");
  console.log(`ok (${(text.length / 1024).toFixed(0)} KiB -> ${outName})`);
}

async function main() {
  await fs.mkdir(SNAPSHOT_DIR, { recursive: true });
  console.log("Refreshing PoE2 data snapshot from repoe-fork...");
  for (const file of FILES) {
    await download(file);
  }
  const meta = {
    source: BASE_URL,
    files: FILES.map((f) => f.replace(".min.json", ".json")),
    fetchedAt: new Date().toISOString(),
  };
  await fs.writeFile(
    path.join(SNAPSHOT_DIR, "_meta.json"),
    JSON.stringify(meta, null, 2),
    "utf8",
  );
  console.log("Done. Snapshot written to data/snapshot/");
  console.log("Next: run `npm run data:seed` to build the SQLite database.");
}

main().catch((err) => {
  console.error("\nFailed to refresh data:", err);
  process.exit(1);
});
