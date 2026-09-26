/**
 * Market worker — the one process that talks to the PoE2 trade API. It drains
 * the durable job queue (interactive jobs first), keeps the trade budget in
 * memory, and ticks the collector schedules.
 *
 * Usage:
 *   npm run market:worker                      # loop forever
 *   npm run market:worker -- --once            # drain due jobs and exit
 *   npm run market:worker -- --gems [--league "..."]
 *   npm run market:worker -- --tablets ["Abyss Tablet,Breach Tablet"]
 *   npm run market:worker -- --class "Body Armour" [--league "..."]
 *
 * Set POESESSID in .env to search with a logged-in session (higher limits).
 */
import { enqueueJob, nextPendingRunAt } from "../src/lib/jobs/queue";
import { drainOne } from "../src/lib/jobs/runner";
import { tickSchedules } from "../src/lib/jobs/schedules";
import { beatDrainer, newDrainerId, removeDrainer } from "../src/lib/jobs/workers";
import { getCurrentLeagueName } from "../src/lib/pricing/poe2scout";
import { flushTradeBudget } from "../src/lib/trade/rateLimiter";

const IDLE_POLL_MS = 2000;
const BEAT_MS = 10_000;
const SCHEDULE_MS = 30_000;
const once = process.argv.includes("--once");
const workerId = newDrainerId("worker");
const startedAt = Date.now();
let currentJob: string | null = null;
let stopping = false;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  return v && !v.startsWith("--") ? v : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function resolveLeague(): Promise<string> {
  return arg("league") ?? (await getCurrentLeagueName());
}

async function beat(): Promise<void> {
  await beatDrainer(workerId, "worker", startedAt, currentJob, {
    session: Boolean(process.env.POESESSID?.trim()),
  }).catch((err) => console.warn("[worker] heartbeat failed:", err));
  await flushTradeBudget().catch(() => {});
}

async function loop(): Promise<void> {
  console.log(
    `[worker] ${workerId} started${process.env.POESESSID?.trim() ? " (logged-in session)" : ""}`,
  );
  await beat();
  const beatTimer = setInterval(() => void beat(), BEAT_MS);
  let lastSchedule = 0;
  try {
    while (!stopping) {
      if (!once && Date.now() - lastSchedule > SCHEDULE_MS) {
        lastSchedule = Date.now();
        try {
          const queued = await tickSchedules();
          if (queued > 0) console.log(`[worker] scheduled ${queued} job(s)`);
        } catch (err) {
          console.warn("[worker] schedule tick failed:", err);
        }
      }

      let ran = false;
      try {
        const job = await drainOne(workerId, (j) => {
          currentJob = j.id;
          console.log(`[worker] ${j.lane} ${j.kind} ${j.id}`);
        });
        ran = job != null;
      } catch (err) {
        console.warn("[worker] job crashed:", err);
      } finally {
        currentJob = null;
      }
      if (ran) continue;

      const next = await nextPendingRunAt().catch(() => null);
      if (once && next == null) break;
      const untilNext = next == null ? IDLE_POLL_MS : Math.max(250, next - Date.now());
      await sleep(Math.min(IDLE_POLL_MS, untilNext));
    }
  } finally {
    clearInterval(beatTimer);
    await flushTradeBudget().catch(() => {});
    await removeDrainer(workerId).catch(() => {});
  }
  if (once) console.log("[worker] queue empty — exiting");
}

function onSignal(signal: string) {
  if (stopping) process.exit(1);
  stopping = true;
  console.log(`[worker] ${signal} — finishing the current job, then exiting`);
}
process.on("SIGINT", () => onSignal("SIGINT"));
process.on("SIGTERM", () => onSignal("SIGTERM"));

async function main() {
  const itemClass = arg("class");
  const tabletsArg = process.argv.includes("--tablets");
  if (process.argv.includes("--gems")) {
    const league = await resolveLeague();
    const id = await enqueueJob({
      kind: "scan:gems",
      payload: { league, scanStartedAt: Date.now() },
      priority: 5,
    });
    console.log(`Enqueued scan:gems ${id} for ${league}`);
    if (!once) return;
  } else if (tabletsArg) {
    const league = await resolveLeague();
    const tablets = arg("tablets")?.split(",").map((t) => t.trim()).filter(Boolean);
    const id = await enqueueJob({
      kind: "scan:tablets",
      payload: {
        league,
        scanStartedAt: Date.now(),
        ...(tablets?.length ? { tablets, scopeKey: [...tablets].sort().join("|") } : {}),
      },
      priority: 5,
    });
    console.log(`Enqueued scan:tablets ${id} for ${tablets?.join(", ") ?? "all tablets"} (${league})`);
    if (!once) return;
  } else if (itemClass) {
    const league = await resolveLeague();
    const id = await enqueueJob({
      kind: "scan:class",
      payload: { league, itemClass, itemLevel: Number(arg("ilvl") ?? 82) },
      priority: 5,
    });
    console.log(`Enqueued scan:class ${id} for ${itemClass} (${league})`);
    if (!once) return;
  }
  await loop();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[worker] fatal:", err);
    process.exit(1);
  });
