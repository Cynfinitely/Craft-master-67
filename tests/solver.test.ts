import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveFlux } from "../src/lib/solver/flux";
import {
  buildSimPool,
  eligibleTiers,
  simulateMethod,
  type SimGroup,
} from "../src/lib/solver/simulate";
import type { EligibleMod } from "../src/lib/data/types";

/* ---------------------- restricted pool (min mod level) ---------------------- */

const group = (name: string, tiers: [level: number, weight: number][]): SimGroup => ({
  group: name,
  tiers: tiers
    .map(([level, weight]) => ({ level, weight }))
    .sort((a, b) => b.level - a.level),
});

test("eligibleTiers keeps only tiers at or above the orb minimum", () => {
  const g = group("Life", [
    [1, 1000],
    [30, 800],
    [55, 400],
    [70, 200],
  ]);
  const tiers = eligibleTiers(g, 70);
  assert.deepEqual(
    tiers.map((t) => t.level),
    [70],
  );
  const tiers55 = eligibleTiers(g, 55);
  assert.deepEqual(
    tiers55.map((t) => t.level).sort((a, b) => a - b),
    [55, 70],
  );
});

test("eligibleTiers: excluded-tier exception keeps the highest tier", () => {
  // Wiki rule: when no tier reaches the minimum, the highest tier still rolls.
  const g = group("Weak", [
    [1, 1000],
    [25, 500],
  ]);
  const tiers = eligibleTiers(g, 70);
  assert.equal(tiers.length, 1);
  assert.equal(tiers[0].level, 25);
});

test("eligibleTiers with no minimum returns the full ladder", () => {
  const g = group("Life", [
    [1, 1000],
    [70, 200],
  ]);
  assert.equal(eligibleTiers(g, 0).length, 2);
});

/* ----------------------------- flux applicability ----------------------------- */

test("flux applies when exactly one elemental res is targeted", () => {
  const plan = resolveFlux(["IncreasedLife", "FireResistance"]);
  assert.ok(plan);
  assert.equal(plan.fluxApiId, "blazing-flux");
  assert.deepEqual(plan.surrogateGroups.sort(), [
    "ColdResistance",
    "LightningResistance",
  ]);
});

test("flux maps each element to its own flux", () => {
  assert.equal(resolveFlux(["ColdResistance"])?.fluxApiId, "chilling-flux");
  assert.equal(
    resolveFlux(["LightningResistance"])?.fluxApiId,
    "crackling-flux",
  );
});

test("flux does NOT apply with two different elemental res targets", () => {
  assert.equal(resolveFlux(["FireResistance", "ColdResistance"]), null);
});

test("void flux applies for chaos res with all three surrogates", () => {
  const plan = resolveFlux(["ChaosResistance", "IncreasedLife"]);
  assert.ok(plan);
  assert.equal(plan.fluxApiId, "void-flux");
  assert.equal(plan.surrogateGroups.length, 3);
});

test("void flux does NOT apply when an elemental res is also wanted", () => {
  assert.equal(resolveFlux(["ChaosResistance", "FireResistance"]), null);
});

test("flux does not apply without any resistance target", () => {
  assert.equal(resolveFlux(["IncreasedLife", "MovementVelocity"]), null);
});

/* ------------------------- simulation: min-level rolls ------------------------- */

const mod = (
  groupName: string,
  level: number,
  weight: number,
  gen: "prefix" | "suffix",
): EligibleMod =>
  ({
    id: `${groupName}-${level}`,
    name: null,
    type: groupName,
    generationType: gen,
    requiredLevel: level,
    isEssenceOnly: false,
    text: null,
    groups: [groupName],
    stats: [],
    addsTags: [],
    implicitTags: [],
    weight,
  }) as unknown as EligibleMod;

test("perfect-seed sim only rolls level >= 70 mods on the seeded steps", () => {
  // Two prefix groups: one with a 70+ tier, one capped at level 10. With a
  // Perfect Transmute (min 70), the first roll must come from the 70+ tier
  // unless the fallback applies — the level-10 group's top tier may also
  // roll via the exception, but never its low weight dominance.
  const prefixes = [
    mod("High", 70, 100, "prefix"),
    mod("High", 30, 5000, "prefix"),
    mod("Low", 10, 5000, "prefix"),
  ];
  const suffixes = [mod("Suf", 75, 100, "suffix")];
  const pool = buildSimPool(prefixes, suffixes);

  const result = simulateMethod(
    pool,
    [{ group: "High", side: "prefix", minLevel: 70 }],
    { id: "perfect-seed" },
    { trials: 2000, price: () => 0 },
  );
  // The "High" group's level-30 tier (weight 5000) is excluded by the min-70
  // restriction, so hits must come from its level-70 tier. With the
  // restriction the hit rate is far higher than the unrestricted ~1%.
  assert.ok(
    result.fullHitRate > 0.2,
    `expected restricted-pool hit rate > 20%, got ${result.fullHitRate}`,
  );
});

/* ----------------------- keys + fillers graded model ----------------------- */

test("gradedRates sums to keyHitRate and grades filler hits", () => {
  const prefixes = [
    mod("KeyLife", 50, 100, "prefix"),
    mod("FillerMana", 50, 100, "prefix"),
    mod("FillerArmour", 50, 100, "prefix"),
  ];
  const suffixes = [
    mod("FillerRes", 50, 100, "suffix"),
    mod("OtherA", 50, 100, "suffix"),
    mod("OtherB", 50, 100, "suffix"),
    mod("OtherC", 50, 100, "suffix"),
  ];
  const pool = buildSimPool(prefixes, suffixes);
  const targets = [
    { group: "KeyLife", side: "prefix" as const, minLevel: 0 },
    {
      group: "FillerMana",
      side: "prefix" as const,
      minLevel: 0,
      role: "filler" as const,
    },
    {
      group: "FillerRes",
      side: "suffix" as const,
      minLevel: 0,
      role: "filler" as const,
    },
  ];
  const result = simulateMethod(pool, targets, { id: "alch-spam" }, {
    trials: 4000,
    price: () => 0,
  });
  assert.equal(result.gradedRates.length, 3); // 0, 1, or 2 fillers
  const sum = result.gradedRates.reduce((s, v) => s + v, 0);
  assert.ok(
    Math.abs(sum - result.keyHitRate) < 1e-9,
    `graded sum ${sum} should equal keyHitRate ${result.keyHitRate}`,
  );
  // Full hit (key + both fillers) must match the top grade.
  assert.ok(Math.abs(result.gradedRates[2] - result.fullHitRate) < 1e-9);
  // Sellable (key + ≥1 filler) must beat the full-combo rate.
  const sellable = result.gradedRates[2] + result.gradedRates[1];
  assert.ok(sellable > result.fullHitRate);
});

test("essence-exalt locks the key mod (keyHitRate ≈ 1 for the essence group)", () => {
  const prefixes = [
    mod("KeyLife", 50, 10, "prefix"), // rare without the essence
    mod("OtherP1", 50, 1000, "prefix"),
    mod("OtherP2", 50, 1000, "prefix"),
  ];
  const suffixes = [
    mod("OtherS1", 50, 1000, "suffix"),
    mod("OtherS2", 50, 1000, "suffix"),
  ];
  const pool = buildSimPool(prefixes, suffixes);
  const targets = [{ group: "KeyLife", side: "prefix" as const, minLevel: 0 }];
  const withEssence = simulateMethod(
    pool,
    targets,
    {
      id: "essence-exalt",
      essence: {
        group: "KeyLife",
        side: "prefix",
        level: 50,
        apiId: "essence-of-life",
        name: "Essence of Life",
      },
    },
    { trials: 2000, price: () => 0 },
  );
  assert.ok(
    withEssence.keyHitRate > 0.95,
    `essence should nearly guarantee the key (got ${withEssence.keyHitRate})`,
  );
});

test("sim counts flux surrogate groups as hits", () => {
  const prefixes = [
    mod("IncreasedLife", 50, 100, "prefix"),
    mod("IncreasedMana", 50, 100, "prefix"),
    mod("AddedArmour", 50, 100, "prefix"),
  ];
  const suffixes = [
    mod("FireResistance", 50, 100, "suffix"),
    mod("ColdResistance", 50, 100, "suffix"),
    mod("LightningResistance", 50, 100, "suffix"),
    mod("Strength", 50, 100, "suffix"),
    mod("Dexterity", 50, 100, "suffix"),
    mod("Intelligence", 50, 100, "suffix"),
    mod("LightRadius", 50, 100, "suffix"),
    mod("StunThreshold", 50, 100, "suffix"),
  ];
  const pool = buildSimPool(prefixes, suffixes);

  const withFlux = simulateMethod(
    pool,
    [
      {
        group: "FireResistance",
        side: "suffix",
        minLevel: 0,
        altGroups: ["ColdResistance", "LightningResistance"],
      },
    ],
    { id: "alch-spam" },
    { trials: 3000, price: () => 0 },
  );
  const withoutFlux = simulateMethod(
    pool,
    [{ group: "FireResistance", side: "suffix", minLevel: 0 }],
    { id: "alch-spam" },
    { trials: 3000, price: () => 0 },
  );
  assert.ok(
    withFlux.fullHitRate > withoutFlux.fullHitRate,
    `flux (${withFlux.fullHitRate}) should beat no-flux (${withoutFlux.fullHitRate})`,
  );
});
