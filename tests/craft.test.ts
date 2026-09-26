import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { Trial } from "../src/lib/craft/engine/actions";
import { makeGroup, makePool, freshOdds, type SimPool } from "../src/lib/craft/engine/pool";
import { makePriceBook } from "../src/lib/craft/engine/prices";
import { mulberry32 } from "../src/lib/craft/engine/rng";
import { sideCount, type Item } from "../src/lib/craft/engine/state";
import { evaluate } from "../src/lib/craft/brain/evaluate";
import { optimize } from "../src/lib/craft/brain/optimize";
import { essenceExalt } from "../src/lib/craft/techniques/essenceExalt";
import { TECHNIQUES } from "../src/lib/craft/techniques";
import { defineTechnique, type CraftContext, type EssenceOption } from "../src/lib/craft/techniques/types";
import type { Target } from "../src/lib/craft/types";

function testPool(): SimPool {
  return makePool([
    makeGroup("Life", "prefix", [
      { level: 1, weight: 1000 },
      { level: 50, weight: 200 },
      { level: 70, weight: 50 },
    ]),
    makeGroup("Mana", "prefix", [{ level: 1, weight: 1000 }]),
    makeGroup("Armour", "prefix", [{ level: 1, weight: 1000 }]),
    makeGroup("FireRes", "suffix", [{ level: 1, weight: 1000 }]),
    makeGroup("ColdRes", "suffix", [{ level: 1, weight: 1000 }]),
    makeGroup("Speed", "suffix", [
      { level: 1, weight: 500 },
      { level: 60, weight: 100 },
    ]),
  ]);
}

function testDesecPool(): SimPool {
  return makePool([
    makeGroup("AbyssLife", "prefix", [{ level: 60, weight: 100 }]),
    makeGroup("AbyssCrit", "suffix", [{ level: 60, weight: 100 }]),
  ]);
}

const prices = makePriceBook({ live: new Map() });
const price = (id: string) => prices.price(id);

function trial(seed: number, start?: Item, pool = testPool()): Trial {
  return new Trial(pool, testDesecPool(), mulberry32(seed), price, null, start);
}

function target(group: string, side: "prefix" | "suffix", minLevel = 0, optional = false): Target {
  return { group, side, minLevel, optional, desecrated: false };
}

const LIFE_ESSENCE: EssenceOption = {
  apiId: "greater-essence-of-the-body",
  name: "Greater Essence of the Body",
  group: "Life",
  side: "prefix",
  level: 70,
  perfect: false,
};

function testContext(targets: Target[], extra: Partial<CraftContext> = {}): CraftContext {
  return {
    mode: "craft",
    baseName: "Test Ring",
    itemClass: "Ring",
    itemLevel: 82,
    pool: testPool(),
    desecPool: null,
    targets,
    labels: new Map(),
    essences: [],
    alloys: [],
    bone: null,
    flux: null,
    prices: makePriceBook({ live: new Map() }),
    start: null,
    ...extra,
  };
}

/* ------------------------------ actions ------------------------------ */

test("magic items hold at most one prefix and one suffix", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const t = trial(seed);
    assert.ok(t.transmute());
    assert.ok(t.augment());
    assert.equal(t.item.mods.length, 2);
    assert.equal(sideCount(t.item, "prefix"), 1);
    assert.equal(sideCount(t.item, "suffix"), 1);
    assert.equal(t.augment(), false, "third mod on a magic item");
    assert.equal(t.exalt(), false, "exalt needs a rare");
  }
});

test("rare items cap at three prefixes and three suffixes", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const t = trial(seed);
    assert.ok(t.alchemy());
    assert.equal(t.item.mods.length, 4);
    while (t.item.mods.length < 6) assert.ok(t.exalt());
    assert.equal(sideCount(t.item, "prefix"), 3);
    assert.equal(sideCount(t.item, "suffix"), 3);
    assert.equal(t.exalt(), false);
  }
});

test("side omens force the exalted mod's side and are paid for", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const t = trial(seed);
    t.transmute();
    t.regal();
    const before = t.cost;
    const suffixesBefore = sideCount(t.item, "suffix");
    if (!t.exalt({ side: "suffix" })) continue;
    assert.equal(sideCount(t.item, "suffix"), suffixesBefore + 1);
    assert.equal(t.cost - before, price("exalted") + price("omen-of-dextral-exaltation"));
  }
});

test("Perfect Exalts only add tiers at modifier level 50+ (top tier when none reach it)", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const t = trial(seed, { rarity: "rare", mods: [] });
    assert.ok(t.exalt({ tier: 2, side: "prefix" }));
    const m = t.item.mods[0];
    if (m.group === "Life") assert.ok(m.level >= 50, `Life rolled level ${m.level}`);
    else assert.equal(m.level, 1);
  }
});

test("an essence guarantees its mod, and only one crafted mod fits", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const t = trial(seed);
    t.transmute();
    assert.ok(t.essence(LIFE_ESSENCE));
    assert.equal(t.item.rarity, "rare");
    const life = t.item.mods.find((m) => m.group === "Life");
    assert.ok(life?.crafted);
    assert.equal(life.level, 70);
    assert.equal(t.essence({ ...LIFE_ESSENCE, perfect: true }), false);
  }
});

test("fractured mods survive every annul", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const t = trial(seed, {
      rarity: "rare",
      mods: [
        { group: "Life", side: "prefix", level: 70, fractured: true },
        { group: "Mana", side: "prefix", level: 1 },
        { group: "FireRes", side: "suffix", level: 1 },
        { group: "Speed", side: "suffix", level: 1 },
      ],
    });
    while (t.annul()) {
      /* strip everything removable */
    }
    assert.deepEqual(t.item.mods.map((m) => m.group), ["Life"]);
    assert.equal(t.fracture(), false, "only one fractured mod per item");
  }
});

test("desecration adds one desecrated mod on the chosen side", () => {
  const t = trial(7, { rarity: "rare", mods: [{ group: "Life", side: "prefix", level: 1 }] });
  const d = { bone: "ancient-rib", side: "suffix" as const, abyss: false, echoes: true, want: () => true };
  assert.ok(t.desecrate(d));
  const added = t.item.mods.filter((m) => m.desecrated);
  assert.equal(added.length, 1);
  assert.equal(added[0].side, "suffix");
  assert.equal(t.desecrate(d), false, "one desecrated mod per item");
});

/* ----------------------------- techniques ---------------------------- */

test("a single essence-guaranteed target succeeds every attempt", () => {
  const ctx = testContext([target("Life", "prefix", 70)], { essences: [LIFE_ESSENCE] });
  assert.ok(essenceExalt.applies(ctx).ok);
  for (const choice of essenceExalt.choices(ctx)) {
    const s = evaluate(essenceExalt, choice, ctx, { attempts: 500, seed: 1, baseCost: 0 });
    assert.equal(s.p, 1);
    assert.equal(s.expectedCost, s.meanAttemptCost);
  }
});

test("a one-orb technique matches the analytic odds", () => {
  const transmuteOnce = defineTechnique<null>({
    id: "test-transmute",
    name: "Transmute once",
    summary: "",
    modes: ["craft"],
    applies: () => ({ ok: true }),
    choices: () => [null],
    key: () => "",
    run: (_c, t) => void t.transmute(),
    describe: () => [{ title: "Transmute", detail: "" }],
    options: () => [],
    pros: () => [],
    cons: () => [],
  });
  const ctx = testContext([target("Life", "prefix")]);
  // Transmute picks from both sides: Life's weight over the whole pool.
  const analytic = 1250 / (1250 + 1000 + 1000 + 1000 + 1000 + 600);
  const s = evaluate(transmuteOnce, null, ctx, { attempts: 20000, seed: 42, baseCost: 1 });
  assert.ok(Math.abs(s.p - analytic) < 0.015, `p=${s.p} vs ${analytic}`);
  assert.ok(Math.abs(s.expectedCost! - (1 + price("transmute")) / s.p) < 1e-9);
  assert.ok(s.p50! <= s.p90!);

  const prefixOnly = freshOdds(ctx.pool, ["Life"], "prefix", 50);
  assert.ok(Math.abs(prefixOnly - 250 / 3250) < 1e-12);
});

/* ------------------------------ optimizer ---------------------------- */

function fixedCostTechnique(id: string, exalts: number, succeed = true) {
  return defineTechnique<null>({
    id,
    name: id,
    summary: "",
    modes: ["craft"],
    applies: () => ({ ok: true }),
    choices: () => [null],
    key: () => "",
    run(_c, t) {
      t.spend("exalted", exalts);
      if (succeed) t.item = { rarity: "rare", mods: [{ group: "Life", side: "prefix", level: 70 }] };
    },
    describe: () => [{ title: id, detail: "" }],
    options: () => [],
    pros: () => [],
    cons: () => [],
  });
}

test("the optimizer ranks the clearly cheaper technique first and explains rejections", () => {
  const ctx = testContext([target("Life", "prefix")]);
  const notApplicable = { ...fixedCostTechnique("never-applies", 1), applies: () => ({ ok: false as const, reason: "nope" }) };
  const result = optimize(
    ctx,
    [fixedCostTechnique("pricey", 10), fixedCostTechnique("cheap", 1), fixedCostTechnique("hopeless", 1, false), notApplicable],
    { baseCost: 0, seedKey: "t", budgetMs: 500, stage1Attempts: 50 },
  );
  assert.deepEqual(result.ranked.map((r) => r.tech.id), ["cheap", "pricey"]);
  assert.equal(result.ranked[0].stats.expectedCost, 1);
  const rejected = new Map(result.rejected.map((r) => [r.id, r.reason]));
  assert.equal(rejected.get("never-applies"), "nope");
  assert.match(rejected.get("hopeless") ?? "", /No success/);
});

test("all built-in techniques run on a synthetic goal, sorted and reproducible", () => {
  const ctx = testContext([target("Life", "prefix", 50), target("FireRes", "suffix")], {
    essences: [LIFE_ESSENCE],
    prices: makePriceBook({ live: new Map([[LIFE_ESSENCE.apiId, 2]]) }),
  });
  // A budget this large never cuts a run short, so results depend only on the seeds.
  const run = () => optimize(ctx, TECHNIQUES, { baseCost: 1, seedKey: "synthetic", budgetMs: 60_000, stage1Attempts: 150 });
  const a = run();
  assert.ok(a.ranked.length >= 3, `only ${a.ranked.length} techniques succeeded`);
  assert.ok(a.ranked.some((r) => r.tech.id === "essence-exalt"));
  const costs = a.ranked.map((r) => r.stats.expectedCost!);
  assert.deepEqual([...costs].sort((x, y) => x - y), costs);

  const b = run();
  assert.equal(b.ranked[0].tech.id, a.ranked[0].tech.id);
  assert.equal(b.ranked[0].key, a.ranked[0].key);
});

/* --------------------------- performance budget ---------------------- */

const hasDb = existsSync("data/poe2.db") || !!process.env.LIBSQL_URL;

test("solve and recommend stay within their time budgets", { skip: !hasDb && "no data/poe2.db" }, async () => {
  const { searchBases, getModPool } = await import("../src/lib/data/queries");
  const { solve } = await import("../src/lib/craft/brain/solve");
  const { recommendBases } = await import("../src/lib/craft/brain/recommend");

  const [base] = await searchBases({ itemClass: "Ring", limit: 1 });
  assert.ok(base, "no Ring base in the database");
  const pool = await getModPool(base.id, 82);
  assert.ok(pool);
  const group = (m: { groups: string[]; id: string }) => m.groups[0] ?? m.id;
  const goal = [
    ...[...new Set(pool.prefixes.map(group))].slice(0, 2),
    ...[...new Set(pool.suffixes.map(group))].slice(0, 2),
  ].map((g) => ({ group: g, minLevel: 0, desecrated: false, optional: false }));

  const fallback = makePriceBook({ live: new Map() });
  let t0 = performance.now();
  const plan = await solve({ baseId: base.id, itemLevel: 82, goal, prices: fallback });
  const solveMs = performance.now() - t0;
  assert.ok(plan && plan.methods.length > 0, "solve found no method");
  assert.ok(solveMs < 1500, `solve took ${Math.round(solveMs)} ms`);

  t0 = performance.now();
  const recs = await recommendBases({ itemClass: "Ring", itemLevel: 82, goal, prices: fallback });
  const recommendMs = performance.now() - t0;
  assert.ok(recs.length > 0);
  assert.ok(recommendMs < 5000, `recommend took ${Math.round(recommendMs)} ms`);
});
