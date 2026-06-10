import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveFlux } from "../src/lib/solver/flux";
import {
  buildSimPool,
  eligibleTiers,
  simulateFinish,
  simulateMethod,
  type SimDesecrateSpec,
  type SimGroup,
} from "../src/lib/solver/simulate";
import {
  splitCraftedBudget,
  validateTargets05,
} from "../src/lib/solver/rules";
import {
  slamTierProfile,
  slamValueFloor,
} from "../src/lib/solver/tierMath";
import type { DesiredMod } from "../src/lib/solver/types";
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

/* ----------------------------- 0.5 rules ----------------------------- */

const desired = (group: string, desecrated = false): DesiredMod =>
  ({
    group,
    label: group,
    generationType: "suffix",
    weight: 100,
    oddsFresh: 0.1,
    desecrated,
  }) as DesiredMod;

test("0.5 rule: two desecrated targets are rejected as infeasible", () => {
  const result = validateTargets05([
    desired("DesecLife", true),
    desired("DesecRes", true),
    desired("FireResistance"),
  ]);
  assert.equal(result.feasible, false);
  assert.ok(result.warnings.length > 0);
});

test("0.5 rule: a single desecrated target is fine", () => {
  const result = validateTargets05([
    desired("DesecLife", true),
    desired("FireResistance"),
  ]);
  assert.equal(result.feasible, true);
});

test("0.5 rule: crafted budget keeps exactly one guarantee (essence+alloy is illegal)", () => {
  const { crafted, overflow } = splitCraftedBudget(["essence", "alloy"]);
  assert.equal(crafted, "essence");
  assert.deepEqual(overflow, ["alloy"]);
  const none = splitCraftedBudget([]);
  assert.equal(none.crafted, null);
});

/* ----------------------------- slam tier math ----------------------------- */

const tieredMod = (
  groupName: string,
  level: number,
  weight: number,
  value: [min: number, max: number],
): EligibleMod =>
  ({
    ...mod(groupName, level, weight, "suffix"),
    stats: [{ id: `${groupName}-stat`, min: value[0], max: value[1] }],
  }) as EligibleMod;

test("slam tier profile: spawn weights pull the expected outcome to low tiers", () => {
  // Classic resistance ladder: low tiers are heavy, T1 is rare.
  const ladder = [
    tieredMod("FireRes", 1, 1000, [6, 11]),
    tieredMod("FireRes", 24, 800, [12, 17]),
    tieredMod("FireRes", 48, 400, [24, 29]),
    tieredMod("FireRes", 72, 100, [36, 41]),
    tieredMod("FireRes", 84, 25, [42, 45]),
  ];
  const p = slamTierProfile(ladder)!;
  // Weighted average sits in the low-mid of the ladder, far from T1.
  assert.ok(p.expectedValue < 20, `expected low avg value, got ${p.expectedValue}`);
  assert.equal(p.topValue, 43.5);
  // Top-2 tiers carry 125 of 2325 total weight ≈ 5.4% — the user is right
  // that a slam "deciding" T1 res is a fantasy.
  assert.ok(
    Math.abs(p.pTopTwo - 125 / 2325) < 1e-9,
    `expected ~5.4% top-2 odds, got ${p.pTopTwo}`,
  );
  // The comparable floor prices the AVERAGE outcome, not the top tier.
  assert.ok(slamValueFloor(p) < p.topValue / 2);
});

test("slam tier profile: single tier means any hit is a full hit", () => {
  const p = slamTierProfile([tieredMod("Spirit", 60, 500, [30, 40])])!;
  assert.equal(p.pTopTwo, 1);
  assert.equal(p.expectedValue, 35);
});

test("slam tier profile: zero-weight and empty pools are rejected", () => {
  assert.equal(slamTierProfile([]), null);
  assert.equal(
    slamTierProfile([
      { ...tieredMod("Dead", 10, 0, [1, 2]) },
    ]),
    null,
  );
});

/* ----------------------- finisher: belt recipe golden ----------------------- */

test("belt recipe: desecrate-finish success rate ≈ 3-of-N reveal odds, cost = bone + omen", () => {
  // Item bought via the snipe template: life prefix + two res suffixes,
  // one open suffix. Finish = Ancient Collarbone + Dextral Necromancy,
  // reveal 3 of 6 equally-weighted desecrated suffix options.
  const prefixes = [mod("IncreasedLife", 50, 100, "prefix")];
  const suffixes = [
    mod("FireResistance", 50, 100, "suffix"),
    mod("ColdResistance", 50, 100, "suffix"),
  ];
  const pool = buildSimPool(prefixes, suffixes);

  const desecGroup = (name: string): SimGroup => group(name, [[50, 100]]);
  const candidates = [
    "DesecTarget",
    "DesecA",
    "DesecB",
    "DesecC",
    "DesecD",
    "DesecE",
  ].map(desecGroup);
  const spec: SimDesecrateSpec = {
    side: "suffix",
    targetGroup: "DesecTarget",
    groups: candidates,
    useEchoes: false,
    boneApiId: "ancient-collarbone",
    necroApiId: "omen-of-dextral-necromancy",
    skipAbyssMark: true,
  };

  const price = (apiId: string) =>
    apiId === "ancient-collarbone" ? 5 : apiId === "omen-of-dextral-necromancy" ? 10 : 0;

  const startMods = [
    { group: "IncreasedLife", side: "prefix" as const, level: 50 },
    { group: "FireResistance", side: "suffix" as const, level: 50 },
    { group: "ColdResistance", side: "suffix" as const, level: 50 },
  ];
  const targets = [
    { group: "IncreasedLife", side: "prefix" as const, minLevel: 0 },
    { group: "FireResistance", side: "suffix" as const, minLevel: 0 },
    { group: "ColdResistance", side: "suffix" as const, minLevel: 0 },
    { group: "DesecTarget", side: "suffix" as const, minLevel: 0 },
  ];

  const result = simulateFinish(pool, startMods, targets, { desecrate: spec }, {
    trials: 6000,
    price,
  });

  // P(target among 3 of 6 equal-weight options) = 1/2.
  assert.ok(
    Math.abs(result.fullHitRate - 0.5) < 0.05,
    `expected ~50% reveal hit, got ${result.fullHitRate}`,
  );
  // Exactly one bone + one omen per attempt — EV cost must be 15ex.
  assert.ok(
    Math.abs(result.avgCurrencyCostExalted - 15) < 1e-9,
    `expected 15ex finish cost, got ${result.avgCurrencyCostExalted}`,
  );
});

/* ----------------------- sim vs closed-form parity ----------------------- */

test("finisher slam EV matches the closed-form expectation", () => {
  // Prefixes full; suffix pool = target + one junk group at equal weight.
  // Slam 1 hits the target with p=1/2; on a miss the junk group occupies a
  // slot, and slam 2 can only roll the target (groups never repeat).
  // E[exalts] = 0.5x1 + 0.5x2 = 1.5, success = 100%, no annuls.
  const prefixes = [
    mod("P1", 50, 100, "prefix"),
    mod("P2", 50, 100, "prefix"),
    mod("P3", 50, 100, "prefix"),
  ];
  const suffixes = [
    mod("Target", 50, 100, "suffix"),
    mod("Junk", 50, 100, "suffix"),
  ];
  const pool = buildSimPool(prefixes, suffixes);
  const startMods = [
    { group: "P1", side: "prefix" as const, level: 50 },
    { group: "P2", side: "prefix" as const, level: 50 },
    { group: "P3", side: "prefix" as const, level: 50 },
  ];
  const targets = [{ group: "Target", side: "suffix" as const, minLevel: 0 }];

  const result = simulateFinish(pool, startMods, targets, {}, {
    trials: 8000,
    price: (apiId) => (apiId === "exalted" ? 1 : 100),
  });

  assert.equal(result.fullHitRate, 1);
  const exalts = result.avgCurrency.find((c) => c.apiId === "exalted");
  assert.ok(exalts, "exalted usage must be tallied");
  assert.ok(
    Math.abs(exalts!.avgPerBase - 1.5) < 0.05,
    `expected ~1.5 exalts per finish, got ${exalts!.avgPerBase}`,
  );
  // Prefixes are full: the slam is side-locked for free — no omens, and the
  // suffix side never overfills, so no annuls either.
  assert.ok(
    Math.abs(result.avgCurrencyCostExalted - exalts!.avgPerBase) < 1e-9,
    "no omen/annul cost should be charged when the slam is already forced",
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
