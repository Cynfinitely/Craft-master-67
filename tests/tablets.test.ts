import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createTradeRateLimiter,
  rateLimitWaitMs,
  setTradeRateLimiter,
  TradePacer,
} from "../src/lib/trade/rateLimiter";
import { searchAndFetchForGem } from "../src/lib/trade/client";
import {
  buildStashRegex,
  buildTabletCatalog,
  comboIsConfirmed,
  comboMeetsMinimum,
  CONFIRM_FRESH_MS,
  extractFourModCombo,
  groupTabletOverview,
  nextConfirm,
  orderConfirmQueue,
  TABLET_SAMPLE_LISTINGS,
  type ConfirmQueueRow,
  packComboRegex,
  resolveListingMods,
  runRateLimitedBatch,
  STASH_REGEX_LIMIT,
  uniqueFragment,
  thresholdToExalted,
  type ComboMod,
  type RawTabletBase,
  type RawTabletMod,
} from "../src/lib/tablets/logic";

function base(name: string, tag: string): RawTabletBase {
  return {
    id: name,
    name,
    tags: [tag, "tower_augment", "default"],
    releaseState: "released",
    domain: "tablet",
    itemClass: "TowerAugmentation",
  };
}

function mod(partial: Partial<RawTabletMod> & Pick<RawTabletMod, "id" | "generationType">): RawTabletMod {
  return {
    name: partial.name ?? partial.id,
    text: partial.text ?? partial.name ?? partial.id,
    groups: partial.groups ?? [partial.id],
    requiredLevel: partial.requiredLevel ?? 1,
    spawnWeights: partial.spawnWeights ?? [{ tag: "default", weight: 100 }],
    ...partial,
  };
}

const SHARED_PREFIX = mod({
  id: "breeding",
  name: "Breeding",
  generationType: "prefix",
  text: "Map has (5-7)% increased Pack Size",
  groups: ["PackSize"],
  spawnWeights: [{ tag: "default", weight: 100 }],
});

const SHARED_SUFFIX = mod({
  id: "strongboxes",
  name: "of Strongboxes",
  generationType: "suffix",
  text: "Map has (70-100)% increased chance to contain Strongboxes",
  groups: ["Strongboxes"],
  spawnWeights: [{ tag: "default", weight: 50 }],
});

const BREACH_SUFFIX = mod({
  id: "horde",
  name: "of the Horde",
  generationType: "suffix",
  text: "Breaches in Map have (5-15)% increased Pack Size",
  groups: ["BreachHorde"],
  spawnWeights: [{ tag: "tower_augment_breach", weight: 80 }],
});

const RITUAL_SUFFIX = mod({
  id: "omens",
  name: "of Omens",
  generationType: "suffix",
  text: "Ritual Favours have (35-70)% increased chance to be Omens",
  groups: ["RitualOmens"],
  spawnWeights: [{ tag: "tower_augment_ritual", weight: 80 }],
});

function catalog() {
  return buildTabletCatalog(
    [base("Breach Tablet", "tower_augment_breach"), base("Ritual Tablet", "tower_augment_ritual")],
    [SHARED_PREFIX, SHARED_SUFFIX, BREACH_SUFFIX, RITUAL_SUFFIX],
  );
}

test("each tablet gets shared prefixes and only its own suffixes", () => {
  const tablets = catalog();
  const breach = tablets.find((t) => t.name === "Breach Tablet");
  const ritual = tablets.find((t) => t.name === "Ritual Tablet");
  assert.ok(breach && ritual);
  assert.deepEqual(breach.prefixes.map((p) => p.label), ["Breeding"]);
  assert.deepEqual(ritual.prefixes.map((p) => p.label), ["Breeding"]);
  assert.deepEqual(
    breach.suffixes.map((s) => s.label).sort(),
    ["of Strongboxes", "of the Horde"],
  );
  assert.deepEqual(
    ritual.suffixes.map((s) => s.label).sort(),
    ["of Omens", "of Strongboxes"],
  );
  assert.equal(breach.suffixes.some((s) => s.label === "of Omens"), false);
  assert.equal(ritual.suffixes.some((s) => s.label === "of the Horde"), false);
});

test("a shared group id does not merge a prefix into a suffix", () => {
  const tablets = buildTabletCatalog(
    [base("Breach Tablet", "tower_augment_breach")],
    [
      mod({
        id: "p",
        name: "Crystallised",
        generationType: "prefix",
        text: "Map contains an additional Essence",
        groups: ["Essence"],
      }),
      mod({
        id: "s",
        name: "of the Essence",
        generationType: "suffix",
        text: "Map has (70-100)% increased chance to contain Essences",
        groups: ["Essence"],
        requiredLevel: 50,
      }),
    ],
  );
  const tablet = tablets[0];
  assert.equal(tablet.prefixes[0].label, "Crystallised");
  assert.match(tablet.prefixes[0].text, /additional Essence/);
  assert.equal(tablet.suffixes[0].label, "of the Essence");
  assert.match(tablet.suffixes[0].text, /increased chance to contain Essences/);
});

function comboMod(group: string, side: "prefix" | "suffix"): ComboMod {
  return { group, side, label: group };
}

test("explicit mod lines match tablet affixes when trade omits stat hashes", () => {
  const breach = catalog().find((t) => t.name === "Breach Tablet");
  assert.ok(breach);
  const resolved = resolveListingMods({
    stats: [],
    lines: [
      "Map has 6% increased Pack Size",
      "Map has 80% increased chance to contain Strongboxes",
      "Breaches in Map have 10% increased Pack Size",
      "Unique Monsters have 1 additional Rare Modifier",
    ],
    affixes: [...breach.prefixes, ...breach.suffixes],
    statText: new Map([
      ["explicit.stat_pack", "Map has (5-7)% increased Pack Size"],
      ["explicit.stat_box", "Map has (70-100)% increased chance to contain Strongboxes"],
    ]),
  });
  const combo = extractFourModCombo(resolved.mods);
  assert.equal(combo, null);
  assert.equal(resolved.mods.length, 3);
  assert.deepEqual(resolved.statIds.sort(), ["explicit.stat_box", "explicit.stat_pack"]);
});

test("only an exact 2-prefix and 2-suffix set becomes a combo", () => {
  const good = extractFourModCombo([
    comboMod("A", "prefix"),
    comboMod("B", "prefix"),
    comboMod("C", "suffix"),
    comboMod("D", "suffix"),
  ]);
  assert.ok(good);
  assert.equal(good.key, "p:A+B|s:C+D");

  assert.equal(
    extractFourModCombo([comboMod("A", "prefix"), comboMod("C", "suffix")]),
    null,
  );
  assert.equal(
    extractFourModCombo([
      comboMod("A", "prefix"),
      comboMod("B", "prefix"),
      comboMod("C", "prefix"),
      comboMod("D", "suffix"),
    ]),
    null,
  );
  assert.equal(
    extractFourModCombo([
      comboMod("A", "prefix"),
      comboMod("A", "prefix"),
      comboMod("C", "suffix"),
      comboMod("D", "suffix"),
    ]),
    null,
  );
});

test("a divine minimum hides cheaper tablet combos", () => {
  const rates = { chaosExalted: 0.5, divineExalted: 100 };
  const min = thresholdToExalted(10, "divine", rates);
  assert.equal(min, 1000);
  assert.equal(comboMeetsMinimum(999, min), false);
  assert.equal(comboMeetsMinimum(1000, min), true);
  assert.equal(comboMeetsMinimum(1500, min), true);
  assert.equal(comboMeetsMinimum(1, thresholdToExalted(0, "chaos", rates)), true);
  assert.equal(comboMeetsMinimum(null, min), false);
});

test("stash regex requires every checked mod and escapes special characters", () => {
  const regex = buildStashRegex([
    "Map has (5-7)% increased Pack Size",
    "Bosses drop extra. loot",
  ]);
  assert.match(regex, /\(\?=.\*Map has increased Pack Size\)/);
  assert.match(regex, /\(\?=.\*Bosses drop extra\\. loot\)/);
  assert.equal(buildStashRegex([]), "");
  assert.equal(buildStashRegex(["(5-7)"]), "");
});

test("overview lines become 2+2 floors and other shapes are ignored", () => {
  const tablets = buildTabletCatalog(
    [base("Breach Tablet", "tower_augment_breach")],
    [
      SHARED_PREFIX,
      mod({
        id: "pack",
        name: "of Packs",
        generationType: "prefix",
        text: "Map has (10-15)% increased Magic Monsters",
        groups: ["MagicMonsters"],
      }),
      SHARED_SUFFIX,
      BREACH_SUFFIX,
    ],
  );
  const grouped = groupTabletOverview(
    [
      {
        baseType: "Breach Tablet",
        primaryValue: 0.2,
        listingCount: 4,
        explicitModifiers: [
          { text: "Map has 6% increased Pack Size" },
          { text: "Map has 12% increased Magic Monsters" },
          { text: "Map has 80% increased chance to contain Strongboxes" },
          { text: "Breaches in Map have 10% increased Pack Size" },
        ],
      },
      {
        baseType: "Breach Tablet",
        primaryValue: 0.1,
        listingCount: 2,
        explicitModifiers: [
          { text: "Map has 5% increased Pack Size" },
          { text: "Map has 11% increased Magic Monsters" },
          { text: "Map has 90% increased chance to contain Strongboxes" },
          { text: "Breaches in Map have 8% increased Pack Size" },
        ],
      },
      {
        baseType: "Breach Tablet",
        primaryValue: 1,
        listingCount: 9,
        explicitModifiers: [{ text: "Map has 6% increased Pack Size" }],
      },
      {
        baseType: "Breach Tablet",
        primaryValue: 11,
        listingCount: 1,
        explicitModifiers: [
          { text: "Map has 6% increased Pack Size" },
          { text: "Map has 12% increased Magic Monsters" },
          { text: "Map has 80% increased chance to contain Strongboxes" },
          { text: "Breaches in Map have 10% increased Pack Size" },
        ],
      },
    ],
    tablets,
    200,
  );
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].tablet, "Breach Tablet");
  assert.equal(grouped[0].prefixes.length, 2);
  assert.equal(grouped[0].suffixes.length, 2);
  assert.equal(grouped[0].floorExalted, 20);
  assert.equal(grouped[0].listingCount, 6);
  assert.equal(grouped[0].sampleCount, 2);
});

test("a 5-chaos minimum keeps only combinations at or above that price", () => {
  const rates = { chaosExalted: 0.5, divineExalted: 200 };
  const min = thresholdToExalted(5, "chaos", rates);
  assert.equal(min, 2.5);
  assert.equal(comboMeetsMinimum(2.49, min), false);
  assert.equal(comboMeetsMinimum(2.5, min), true);
  assert.equal(comboMeetsMinimum(10, min), true);
});

test("combo regex stays within 50 characters by shortening unique fragments", () => {
  assert.equal(STASH_REGEX_LIMIT, 50);
  const pool = [
    "Map has increased Pack Size",
    "Breaches in Map have increased Pack Size",
    "Map has increased chance to contain Strongboxes",
    "Ritual Favours have increased chance to be Omens",
  ];
  const pack = uniqueFragment(pool[0], pool);
  const breach = uniqueFragment(pool[1], pool);
  assert.notEqual(pack.toLowerCase(), breach.toLowerCase());
  assert.ok(pack.length <= 8);
  const packed = packComboRegex([pool], STASH_REGEX_LIMIT, pool);
  assert.equal(packed.included, 1);
  assert.ok(packed.regex.length <= 50);
  assert.match(packed.regex, /\(\?=.\*/);
  const second = [
    "Ritual Favours Omens extra",
    "Map has Strongboxes extra",
    "Magic Monsters extra",
    "Horde extra",
  ];
  const both = packComboRegex([pool, second], 50, [...pool, ...second]);
  assert.equal(both.included, 1);
  assert.ok(both.regex.length <= 50);
});

test("a single listing is not treated as a confirmed price", () => {
  assert.equal(comboIsConfirmed("priced", 1), false);
  assert.equal(comboIsConfirmed("priced", 2), false);
  assert.equal(comboIsConfirmed("thin", 10), false);
  assert.equal(comboIsConfirmed("priced", 3), true);
});

test("a full rate-limit window waits before the next request", () => {
  const headers = new Map<string, string>([
    ["x-rate-limit-rules", "Ip,Account"],
    ["x-rate-limit-ip", "10:60:60"],
    ["x-rate-limit-ip-state", "1:60:0"],
    ["x-rate-limit-account", "5:12:60"],
    ["x-rate-limit-account-state", "5:12:0"],
  ]);
  const wait = rateLimitWaitMs({ get: (name) => headers.get(name.toLowerCase()) ?? null });
  assert.ok(wait >= 12_000);

  const open = new Map<string, string>([
    ["x-rate-limit-rules", "Account"],
    ["x-rate-limit-account", "5:12:60"],
    ["x-rate-limit-account-state", "2:12:0"],
  ]);
  assert.equal(
    rateLimitWaitMs({ get: (name) => open.get(name.toLowerCase()) ?? null }),
    0,
  );
});

test("a rate-limit error stops the batch before the next search", async () => {
  let searches = 0;
  const result = await runRateLimitedBatch({
    tasks: ["a", "b", "c"],
    search: async () => {
      searches += 1;
      const err = new Error("trade2 rate-limited") as Error & {
        status: number;
        retryAfterMs: number;
      };
      err.status = 429;
      err.retryAfterMs = 12_000;
      throw err;
    },
  });
  assert.equal(searches, 1);
  assert.equal(result.searches, 1);
  assert.equal(result.processed, 0);
  assert.equal(result.stoppedForRateLimit, true);
  assert.equal(result.rateLimitRetryMs, 12_000);
});

function headerSource(entries: [string, string][]) {
  const map = new Map(entries);
  return { get: (name: string) => map.get(name.toLowerCase()) ?? null };
}

test("30 paced searches never exceed any search window", async () => {
  let clock = 1_000_000;
  const limiter = createTradeRateLimiter({
    persist: false,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
  });
  const windows = [
    [5, 10],
    [15, 60],
    [30, 300],
    [15, 300],
  ];
  await limiter.observe(
    "search",
    headerSource([
      ["x-rate-limit-rules", "Ip"],
      ["x-rate-limit-ip", "5:10:60,15:60:300,30:300:1800"],
      ["x-rate-limit-ip-state", "0:10:0,0:60:0,0:300:0"],
    ]),
  );
  const sent: number[] = [];
  for (let i = 0; i < 30; i++) {
    await limiter.acquire("search");
    sent.push(clock);
    clock += 500;
  }
  for (const [max, periodSec] of windows) {
    for (const t of sent) {
      const inWindow = sent.filter((s) => s >= t && s - t < periodSec * 1000).length;
      assert.ok(inWindow <= Math.floor(max * 0.7), `${inWindow} in ${periodSec}s window`);
    }
  }
});

test("a large 6-hour count does not block the short windows", () => {
  const pacer = new TradePacer();
  pacer.record("search", 0);
  pacer.observe(
    "search",
    headerSource([
      ["x-rate-limit-rules", "Ip"],
      ["x-rate-limit-ip", "5:10:60,15:60:300,30:300:1800,600:21600:3600"],
      ["x-rate-limit-ip-state", "1:10:0,1:60:0,2:300:0,44:21600:0"],
    ]),
    300,
  );
  assert.equal(pacer.waitMs("search", 12_000), 0);

  pacer.observe(
    "search",
    headerSource([
      ["x-rate-limit-rules", "Ip"],
      ["x-rate-limit-ip", "5:10:60,15:60:300,30:300:1800,600:21600:3600"],
      ["x-rate-limit-ip-state", "3:10:0,3:60:0,3:300:0,45:21600:0"],
    ]),
    13_000,
  );
  const wait = pacer.waitMs("search", 13_000);
  assert.ok(wait > 0 && wait <= 10_000, `waited ${wait}`);
});

test("searches keep a minimum gap that widens after a 429", () => {
  const pacer = new TradePacer();
  pacer.record("search", 0);
  assert.equal(pacer.waitMs("search", 0), 12_000);
  pacer.observe("search", headerSource([]), 0, 429);
  assert.equal(pacer.waitMs("search", 0), 24_000);
});

test("any request waits a few seconds after the previous one", () => {
  const pacer = new TradePacer();
  pacer.record("search", 0);
  assert.equal(pacer.waitMs("fetch", 0), 3_500);
  pacer.record("fetch", 3_500);
  assert.equal(pacer.waitMs("fetch", 3_500), 3_500);
  assert.equal(pacer.waitMs("fetch", 7_000), 0);
});

test("a 429 on fetch also pauses searches", () => {
  const pacer = new TradePacer();
  pacer.observe("fetch", headerSource([["retry-after", "600"]]), 0, 429);
  assert.ok(pacer.waitMs("search", 0) >= 600_000);
});

test("repeated 4xx errors pause every request before GGG's threshold", () => {
  const pacer = new TradePacer();
  pacer.observe("search", headerSource([]), 0, 400);
  pacer.observe("search", headerSource([]), 1_000, 404);
  assert.ok(pacer.waitMs("fetch", 60_000) === 0);
  pacer.observe("fetch", headerSource([]), 2_000, 400);
  assert.ok(pacer.waitMs("search", 60_000) > 0);
});

test("a penalty or Retry-After is waited out in full", () => {
  const pacer = new TradePacer();
  pacer.observe(
    "search",
    headerSource([
      ["x-rate-limit-rules", "Ip"],
      ["x-rate-limit-ip", "5:10:60,15:60:300,30:300:1800"],
      ["x-rate-limit-ip-state", "6:10:600,6:60:0,6:300:0"],
    ]),
    0,
  );
  assert.ok(pacer.waitMs("search", 0) >= 600_000);

  const retry = new TradePacer();
  retry.observe("search", headerSource([["retry-after", "900"]]), 0);
  assert.ok(retry.waitMs("search", 0) >= 900_000);
});

test("confirm queue ranks by score, stops at the budget and skips fresh prices", () => {
  const now = 10 * CONFIRM_FRESH_MS;
  const row = (id: string, tablet: string, price: number, seen: number, status = "pending_floor", fetchedAt = now): ConfirmQueueRow => ({
    id,
    tablet,
    status,
    sampledMaxExalted: price,
    sampleCount: seen,
    fetchedAt,
  });
  const rows = [
    row("cheap", "A", 10, 1),
    row("often", "A", 30, 4),
    row("pricey", "A", 100, 1),
    row("fresh", "B", 500, 5, "priced", now - 60_000),
    row("stale", "B", 50, 1, "priced", now - CONFIRM_FRESH_MS - 1),
  ];
  const queue = orderConfirmQueue(rows, now);
  assert.deepEqual(
    queue.map((r) => r.id),
    ["often", "pricey", "stale", "cheap"],
  );
  assert.equal(nextConfirm(rows, now, 0, 20).row?.id, "often");
  const spent = nextConfirm(rows, now, 20, 20);
  assert.equal(spent.row, null);
  assert.equal(spent.budgetSpent, true);
  assert.equal(spent.queued, 4);
});

test("one tablet sample search fetches up to 30 listings", async () => {
  setTradeRateLimiter(createTradeRateLimiter({ persist: false, sleep: async () => {} }));
  const hashes = Array.from({ length: 45 }, (_, i) => `h${i}`);
  let searches = 0;
  let fetches = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    const path = String(url);
    if (path.includes("/search/")) {
      searches++;
      return new Response(JSON.stringify({ id: "q1", total: hashes.length, result: hashes }));
    }
    fetches++;
    const ids = path.split("/fetch/")[1].split("?")[0].split(",");
    return new Response(
      JSON.stringify({
        result: ids.map((id) => ({
          id,
          listing: { price: { amount: 1, currency: "exalted" } },
          item: { baseType: "Tablet" },
        })),
      }),
    );
  }) as typeof fetch;
  try {
    const result = await searchAndFetchForGem(
      `test-${Math.random().toString(36).slice(2)}`,
      { query: { nonce: Math.random() } },
      { maxListings: TABLET_SAMPLE_LISTINGS, ttlMs: 0 },
    );
    assert.equal(searches, 1);
    assert.equal(fetches, 3);
    assert.equal(result.listings.length, 30);
  } finally {
    globalThis.fetch = realFetch;
    setTradeRateLimiter(null);
  }
});
