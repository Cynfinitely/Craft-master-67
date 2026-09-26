import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { TradePacer } from "../src/lib/trade/rateLimiter";
import { scopeCatalog } from "../src/lib/tablets/logic";

const dir = mkdtempSync(path.join(tmpdir(), "poe2-queue-"));
process.env.DB_FILE = path.join(dir, "queue.db");
delete process.env.LIBSQL_URL;

type Queue = typeof import("../src/lib/jobs/queue");
let q: Queue;

before(async () => {
  q = await import("../src/lib/jobs/queue");
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function row(id: string) {
  const [r] = await q.getJobRows([id]);
  assert.ok(r, `job ${id} exists`);
  return r;
}

test("two concurrent claims hand the job to exactly one worker", async () => {
  const id = await q.enqueueJob({ kind: "test:race", payload: {} });
  const [a, b] = await Promise.all([
    q.claimNextJob({ owner: "worker-a", kinds: ["test:race"] }),
    q.claimNextJob({ owner: "worker-b", kinds: ["test:race"] }),
  ]);
  const winners = [a, b].filter(Boolean);
  assert.equal(winners.length, 1);
  assert.equal(winners[0]!.id, id);
  const claimed = await row(id);
  assert.equal(claimed.status, "running");
  assert.ok(claimed.leaseOwner === "worker-a" || claimed.leaseOwner === "worker-b");
});

test("interactive jobs are claimed before older background jobs", async () => {
  const bg = await q.enqueueJob({ kind: "test:lanes", payload: { n: 1 }, runAt: Date.now() - 60_000 });
  const fg = await q.enqueueJob({ kind: "test:lanes", payload: { n: 2 }, lane: "interactive" });
  const first = await q.claimNextJob({ owner: "w", kinds: ["test:lanes"] });
  assert.equal(first?.id, fg);
  const second = await q.claimNextJob({ owner: "w", kinds: ["test:lanes"] });
  assert.equal(second?.id, bg);
});

test("a duplicate enqueue returns the active job and promotes it", async () => {
  const first = await q.enqueueJob({ kind: "scan:gems", payload: { league: "Dedupe League" } });
  const again = await q.enqueueJob({
    kind: "scan:gems",
    payload: { league: "Dedupe League" },
    lane: "interactive",
    priority: 10,
  });
  assert.equal(again, first);
  const r = await row(first);
  assert.equal(r.lane, "interactive");
  assert.equal(r.priority, 10);

  const scoped = await q.enqueueJob({
    kind: "scan:gems",
    payload: { league: "Dedupe League", scopeKey: "weak" },
  });
  assert.notEqual(scoped, first, "a different scope is a different job");
});

test("an expired lease is requeued and counts an attempt", async () => {
  const id = await q.enqueueJob({ kind: "test:lease", payload: {} });
  const now = Date.now();
  const claimed = await q.claimNextJob({ owner: "gone", kinds: ["test:lease"], now, leaseMs: 1_000 });
  assert.equal(claimed?.id, id);
  assert.equal(await q.reclaimExpiredLeases(now + 500), 0);
  assert.equal(await q.reclaimExpiredLeases(now + 5_000), 1);
  const r = await row(id);
  assert.equal(r.status, "pending");
  assert.equal(r.attempts, 1);
  assert.equal(r.leaseOwner, null);
});

test("a heartbeat keeps the lease alive", async () => {
  const id = await q.enqueueJob({ kind: "test:beat", payload: {} });
  await q.claimNextJob({ owner: "alive", kinds: ["test:beat"], leaseMs: 1_000 });
  await q.heartbeatJob(id, "alive", 60_000);
  assert.equal(await q.reclaimExpiredLeases(Date.now() + 5_000), 0);
  assert.equal((await row(id)).status, "running");
});

test("cancelling a parent cancels its unit jobs", async () => {
  const parent = await q.enqueueJob({ kind: "test:parent", payload: {} });
  const kids = await Promise.all(
    ["A", "B"].map((t) => q.enqueueJob({ kind: "test:unit", payload: { t }, parentId: parent })),
  );
  assert.equal(await q.cancelJob(parent, "Stopped by test"), true);
  assert.equal((await row(parent)).status, "cancelled");
  for (const kid of kids) assert.equal((await row(kid)).status, "cancelled");
  assert.equal(await q.claimNextJob({ owner: "w", kinds: ["test:unit"] }), null);
});

test("failures back off, then fail after max attempts, and can be requeued", async () => {
  assert.equal(q.retryDelayMs(0, () => 0.5), 30_000);
  assert.equal(q.retryDelayMs(2, () => 0.5), 120_000);
  assert.equal(q.retryDelayMs(20, () => 0.5), 30 * 60 * 1000);

  const id = await q.enqueueJob({ kind: "test:retry", payload: {}, maxAttempts: 2 });
  await q.claimNextJob({ owner: "w", kinds: ["test:retry"] });
  const before = Date.now();
  assert.equal(await q.retryOrFailJob(id, "boom"), "retry");
  let r = await row(id);
  assert.equal(r.status, "pending");
  assert.equal(r.attempts, 1);
  assert.ok(r.runAt >= before + 24_000, "retry waits the base delay minus at most 20% jitter");

  await q.claimNextJob({ owner: "w", kinds: ["test:retry"], now: r.runAt + 1 });
  assert.equal(await q.retryOrFailJob(id, "boom again"), "failed");
  r = await row(id);
  assert.equal(r.status, "error");

  assert.equal(await q.requeueJob(id), id);
  r = await row(id);
  assert.equal(r.status, "pending");
  assert.equal(r.attempts, 0);
});

test("a rescheduled job keeps its attempts", async () => {
  const id = await q.enqueueJob({ kind: "test:resched", payload: {} });
  await q.claimNextJob({ owner: "w", kinds: ["test:resched"] });
  const at = Date.now() + 45_000;
  await q.rescheduleJob(id, at, "Trade rate limit — continuing later");
  const r = await row(id);
  assert.equal(r.status, "pending");
  assert.equal(r.runAt, at);
  assert.equal(r.attempts, 0);
  assert.equal(await q.claimNextJob({ owner: "w", kinds: ["test:resched"] }), null);
});

function headers(map: Record<string, string>) {
  const lower = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name: string) => lower[name.toLowerCase()] ?? null };
}

test("Ip and Account windows with the same period are tracked separately", () => {
  const now = 1_000_000;
  const pacer = new TradePacer();
  pacer.observe(
    "fetch",
    headers({
      "X-Rate-Limit-Rules": "Ip,Account",
      "X-Rate-Limit-Ip": "12:10:60",
      "X-Rate-Limit-Ip-State": "1:10:0",
      "X-Rate-Limit-Account": "4:10:60",
      "X-Rate-Limit-Account-State": "3:10:0",
    }),
    now,
  );
  const fetch = pacer.usage(now).find((p) => p.policy === "fetch")!;
  const ip = fetch.windows.find((w) => w.rule === "Ip")!;
  const account = fetch.windows.find((w) => w.rule === "Account")!;
  assert.deepEqual([ip.used, ip.max], [1, 12]);
  assert.deepEqual([account.used, account.max], [3, 4]);
  // 3 of 4 account hits is over the 70% interactive share even though Ip is nearly empty.
  assert.ok(pacer.waitMs("fetch", now, "interactive") > 9_000);
});

test("background work stops at a lower share of the window than interactive work", () => {
  const now = 2_000_000;
  const pacer = new TradePacer();
  pacer.observe(
    "fetch",
    headers({ "X-Rate-Limit-Rules": "Ip", "X-Rate-Limit-Ip": "10:60:60", "X-Rate-Limit-Ip-State": "6:60:0" }),
    now,
  );
  assert.equal(pacer.waitMs("fetch", now, "interactive"), 0);
  assert.ok(pacer.waitMs("fetch", now, "background") > 50_000);
});

test("costWaitMs simulates a whole unit before it starts", () => {
  const now = 3_000_000;
  const fresh = new TradePacer();
  const plan = fresh.costWaitMs({ search: 1, fetch: 2 }, now);
  assert.equal(plan.startInMs, 0);
  assert.equal(plan.durationMs, 7_000, "fetches keep the 3.5 s gap between any two requests");

  const blocked = new TradePacer();
  blocked.observe("search", headers({ "Retry-After": "30" }), now, 429);
  assert.ok(blocked.costWaitMs({ search: 1 }, now).startInMs >= 30_000);
});

test("scopeCatalog keeps catalog order and rejects unknown tablets", () => {
  const catalog = [{ name: "Abyss Tablet" }, { name: "Breach Tablet" }, { name: "Delirium Tablet" }];
  assert.equal(scopeCatalog(catalog), catalog);
  assert.deepEqual(
    scopeCatalog(catalog, ["Delirium Tablet", "Abyss Tablet"]).map((t) => t.name),
    ["Abyss Tablet", "Delirium Tablet"],
  );
  assert.throws(() => scopeCatalog(catalog, ["Abyss Tablet", "Nope Tablet"]), /Nope Tablet/);
});
