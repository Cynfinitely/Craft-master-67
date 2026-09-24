import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildStashRegex,
  buildTabletCatalog,
  comboMeetsMinimum,
  extractFourModCombo,
  resolveListingMods,
  runRateLimitedBatch,
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
