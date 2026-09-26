import assert from "node:assert/strict";
import test from "node:test";
import { isRemoteDb } from "../src/db/index";
import { buildStageRail, inferStage } from "../src/lib/jobs/stages";

test("inferStage marks rate-limit lines", () => {
  assert.equal(inferStage("scan:gems", "Rate limited — retrying in 60s."), "rate_limit");
  assert.equal(inferStage("refresh:prices", "Wrote price cache."), "cache");
});

test("stage rail shows past, current, and upcoming", () => {
  const now = 1_000_000;
  const rail = buildStageRail(
    {
      kind: "refresh:prices",
      status: "running",
      message: "Fetching poe2scout categories…",
      runAt: now,
      current: 1,
      total: 3,
    },
    [
      { at: now - 2000, stage: "league", text: "Resolving league prices…" },
      { at: now - 1000, stage: "fetch", text: "Fetching poe2scout categories…" },
    ],
    now + 90 * 60 * 1000,
    now,
  );
  assert.equal(rail.find((s) => s.id === "league")?.status, "done");
  assert.equal(rail.find((s) => s.id === "fetch")?.status, "current");
  assert.equal(rail.find((s) => s.id === "cache")?.status, "upcoming");
  assert.equal(rail.find((s) => s.id === "wait")?.status, "upcoming");
});

test("a finished pass leaves the next schedule waiting", () => {
  const now = 1_000_000;
  const next = now + 60_000;
  const rail = buildStageRail(
    {
      kind: "scan:gems",
      status: "done",
      message: "Done — 10/10 gems priced.",
      runAt: now,
      current: 10,
      total: 10,
    },
    [{ at: now - 500, stage: "done", text: "Done — 10/10 gems priced." }],
    next,
    now,
  );
  const wait = rail.find((s) => s.id === "wait");
  assert.equal(wait?.status, "waiting");
  assert.equal(wait?.at, next);
});

test("remote database flag follows LIBSQL_URL", () => {
  const previous = process.env.LIBSQL_URL;
  delete process.env.LIBSQL_URL;
  assert.equal(isRemoteDb(), false);
  process.env.LIBSQL_URL = "libsql://example.turso.io";
  assert.equal(isRemoteDb(), true);
  if (previous == null) delete process.env.LIBSQL_URL;
  else process.env.LIBSQL_URL = previous;
});
