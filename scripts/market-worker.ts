/**
 * Durable market intelligence worker — polls SQLite job queue and runs
 * rate-limited trade API work outside HTTP request timeouts.
 *
 * Usage:
 *   npm run market:worker          # loop forever
 *   npm run market:worker -- --once  # drain queue and exit
 *   npm run market:scan -- --class "Body Armour" [--league "..."]
 */
import { claimNextJob } from "../src/lib/jobs/queue";
import { handleMarketJob } from "../src/lib/jobs/handlers";

const POLL_MS = 3000;
const once = process.argv.includes("--once");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function resolveLeague(): Promise<string> {
  const res = await fetch("https://poe2scout.com/api/poe2/Leagues", {
    headers: { Accept: "application/json" },
  });
  const leagues = (await res.json()) as { Value: string; IsCurrent?: boolean }[];
  const sc = leagues.find((l) => l.IsCurrent && !l.Value.startsWith("HC"));
  return sc?.Value ?? leagues.find((l) => l.IsCurrent)?.Value ?? "Standard";
}

async function drainOnce(): Promise<boolean> {
  const job = await claimNextJob();
  if (!job) return false;
  console.log(`[worker] ${job.kind} ${job.id}`);
  await handleMarketJob(job);
  return true;
}

async function loop(): Promise<void> {
  console.log("[worker] market worker started");
  for (;;) {
    const ran = await drainOnce();
    if (once && !ran) break;
    if (!ran) await new Promise((r) => setTimeout(r, POLL_MS));
  }
  if (once) console.log("[worker] queue empty — exiting");
}

async function main() {
  const itemClass = arg("class");
  const scanGems = process.argv.includes("--gems");
  if (scanGems) {
    const { enqueueJob } = await import("../src/lib/jobs/queue");
    const league = arg("league") ?? (await resolveLeague());
    const id = await enqueueJob({
      kind: "scan:gems",
      payload: { league, scanStartedAt: Date.now() },
    });
    console.log(`Enqueued scan:gems ${id} for ${league}`);
    if (once) {
      await loop();
    }
    return;
  }
  if (itemClass) {
    const { enqueueJob } = await import("../src/lib/jobs/queue");
    const league = arg("league") ?? (await resolveLeague());
    const id = await enqueueJob({
      kind: "scan:class",
      payload: { league, itemClass, itemLevel: Number(arg("ilvl") ?? 82) },
    });
    console.log(`Enqueued scan:class ${id} for ${itemClass} (${league})`);
    if (once) {
      await loop();
    }
    return;
  }
  await loop();
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
