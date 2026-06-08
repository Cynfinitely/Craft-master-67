/**
 * Downloads the full PoE2 crafting-material catalog from poe2scout into
 * data/snapshot/materials.json.
 *
 * Run with: npm run data:materials
 *
 * poe2scout exposes structured per-item metadata (effect text, descriptions,
 * stack sizes, icons) that the repoe export lacks. We snapshot every relevant
 * currency category so the Materials page works offline; live prices are still
 * fetched separately at request time.
 */
import fs from "node:fs/promises";
import path from "node:path";

const BASE_URL = "https://poe2scout.com/api/poe2";
const USER_AGENT =
  "poe2-crafting-helper/0.1 (local-first dev tool; contact: set-your-email@example.com)";

// Categories that hold craftable materials. Human labels keep the Materials
// page readable; the apiId stays for joining live prices.
const CATEGORIES: { apiId: string; label: string }[] = [
  { apiId: "currency", label: "Currency" },
  { apiId: "fragments", label: "Fragments" },
  { apiId: "runes", label: "Runes & Soul Cores" },
  { apiId: "essences", label: "Essences" },
  { apiId: "ultimatum", label: "Ultimatum" },
  { apiId: "expedition", label: "Expedition" },
  { apiId: "ritual", label: "Ritual" },
  { apiId: "vaultkeys", label: "Vault Keys" },
  { apiId: "breach", label: "Breach" },
  { apiId: "abyss", label: "Abyss" },
  { apiId: "uncutgems", label: "Uncut Gems" },
  { apiId: "lineagesupportgems", label: "Lineage Support Gems" },
  { apiId: "delirium", label: "Delirium" },
  { apiId: "incursion", label: "Incursion" },
  { apiId: "idol", label: "Idols" },
  { apiId: "vaal", label: "Vaal / Corruption" },
];

const SNAPSHOT_DIR = path.join(process.cwd(), "data", "snapshot");
const PER_PAGE = 200;

interface SourceMaterial {
  apiId: string;
  name: string;
  category: string;
  label: string;
  effect: string[];
  description: string | null;
  iconUrl: string | null;
  stackSize: number | null;
  maxStackSize: number | null;
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function getCurrentLeague(): Promise<string> {
  const leagues = await fetchJson(`${BASE_URL}/Leagues`);
  const sc = leagues.find(
    (l: any) => l.IsCurrent && !String(l.Value).startsWith("HC"),
  );
  if (sc) return sc.Value;
  const cur = leagues.find((l: any) => l.IsCurrent);
  // Fall back to the first listed league when none is flagged current.
  return cur?.Value ?? leagues[0]?.Value ?? "Standard";
}

async function fetchCategory(
  league: string,
  cat: { apiId: string; label: string },
): Promise<SourceMaterial[]> {
  const out: SourceMaterial[] = [];
  const base = `${BASE_URL}/Leagues/${encodeURIComponent(
    league,
  )}/Currencies/ByCategory?Category=${encodeURIComponent(
    cat.apiId,
  )}&PerPage=${PER_PAGE}`;

  let page = 1;
  let pages = 1;
  do {
    const data = await fetchJson(`${base}&Page=${page}`);
    pages = data.Pages ?? 1;
    for (const i of data.Items ?? []) {
      const meta = i.ItemMetadata ?? {};
      out.push({
        apiId: i.ApiId,
        name: i.Text ?? meta.name ?? i.ApiId,
        category: i.CategoryApiId ?? cat.apiId,
        label: cat.label,
        effect: Array.isArray(meta.effect) ? meta.effect : [],
        description: meta.description ?? null,
        iconUrl: i.IconUrl ?? meta.icon ?? null,
        stackSize: typeof meta.stack_size === "number" ? meta.stack_size : null,
        maxStackSize:
          typeof meta.max_stack_size === "number" ? meta.max_stack_size : null,
      });
    }
    page += 1;
  } while (page <= pages);

  return out;
}

async function main() {
  await fs.mkdir(SNAPSHOT_DIR, { recursive: true });
  console.log("Refreshing PoE2 materials from poe2scout...");
  const league = await getCurrentLeague();
  console.log(`  league: ${league}`);

  const all: SourceMaterial[] = [];
  for (const cat of CATEGORIES) {
    process.stdout.write(`  fetching ${cat.apiId} ... `);
    try {
      const items = await fetchCategory(league, cat);
      all.push(...items);
      console.log(`ok (${items.length})`);
    } catch (err) {
      console.log(`skipped (${(err as Error).message})`);
    }
  }

  // De-duplicate by apiId (some items can appear under multiple queries).
  const byId = new Map<string, SourceMaterial>();
  for (const m of all) if (!byId.has(m.apiId)) byId.set(m.apiId, m);
  const materials = [...byId.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  const payload = {
    source: "https://poe2scout.com",
    league,
    fetchedAt: new Date().toISOString(),
    count: materials.length,
    materials,
  };
  const outPath = path.join(SNAPSHOT_DIR, "materials.json");
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`Done. ${materials.length} materials -> ${outPath}`);
}

main().catch((err) => {
  console.error("\nFailed to refresh materials:", err);
  process.exit(1);
});
