import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import {
  resolveSpecMods,
  templatesFromSpec,
  SPEC_BUY_CAP_FRACTION,
  type SpecVariantContext,
} from "../src/lib/market/specVariants";
import {
  computeSellThrough,
  SELL_THROUGH_MIN_WINDOW_MS,
} from "../src/lib/market/sellThrough";
import {
  decodePobCode,
  extractPobItems,
  parsePobItemText,
} from "../src/lib/import/pobParse";

/* ----------------------------- spec variants ----------------------------- */

function ctx(): SpecVariantContext {
  return {
    itemClass: "Boots",
    sideByGroup: new Map([
      ["MovementVelocity", "prefix"],
      ["IncreasedLife", "prefix"],
      ["FireResistance", "suffix"],
      ["ColdResistance", "suffix"],
      ["DeflectionRating", "suffix"], // desecrated-only
      ["UnmappedMod", "prefix"],
    ]),
    labelByGroup: new Map([
      ["MovementVelocity", "Movement Speed"],
      ["IncreasedLife", "Maximum Life"],
      ["FireResistance", "Fire Resistance"],
      ["ColdResistance", "Cold Resistance"],
      ["DeflectionRating", "Deflection"],
      ["UnmappedMod", "Weird Mod"],
    ]),
    normalGroups: new Set([
      "MovementVelocity",
      "IncreasedLife",
      "FireResistance",
      "ColdResistance",
      "UnmappedMod",
    ]),
    groupToStats: new Map([
      ["MovementVelocity", ["explicit.stat_ms"]],
      ["IncreasedLife", ["explicit.stat_life"]],
      ["FireResistance", ["explicit.stat_fire"]],
      ["ColdResistance", ["explicit.stat_cold"]],
      ["DeflectionRating", ["explicit.stat_deflect"]],
      ["UnmappedMod", []],
    ]),
    baseNameById: new Map([["base/cinched", "Cinched Boots"]]),
  };
}

const spec = (
  mods: { group: string; minLevel?: number }[],
  baseId: string | null = null,
) => ({ id: 7, itemClass: "Boots", baseId, name: "Test target", mods });

test("resolveSpecMods: sides, desecrated-only and mapping detection", () => {
  const { resolved, errors } = resolveSpecMods(
    [
      { group: "MovementVelocity" },
      { group: "FireResistance", minLevel: 60 },
      { group: "DeflectionRating" },
    ],
    ctx(),
  );
  assert.equal(errors.length, 0);
  assert.equal(resolved.length, 3);
  const deflect = resolved.find((m) => m.group === "DeflectionRating")!;
  assert.equal(deflect.desecratedOnly, true);
  assert.equal(deflect.side, "suffix");
  const fire = resolved.find((m) => m.group === "FireResistance")!;
  assert.equal(fire.minLevel, 60);
  assert.equal(fire.mapped, true);
});

test("resolveSpecMods: rejects unknown groups and >3 per side", () => {
  const { errors } = resolveSpecMods([{ group: "NotAMod" }], ctx());
  assert.ok(errors.some((e) => e.includes("NotAMod")));

  const wide = ctx();
  wide.sideByGroup.set("LightningResistance", "suffix");
  wide.sideByGroup.set("ChaosResistance", "suffix");
  wide.normalGroups.add("LightningResistance").add("ChaosResistance");
  const { errors: sideErrors } = resolveSpecMods(
    [
      { group: "FireResistance" },
      { group: "ColdResistance" },
      { group: "LightningResistance" },
      { group: "ChaosResistance" },
    ],
    wide,
  );
  assert.ok(sideErrors.some((e) => e.includes("cap at 3")));
});

test("templatesFromSpec: drop-one variants with open slot on the missing side", () => {
  const resolved = resolveSpecMods(
    [
      { group: "MovementVelocity" },
      { group: "IncreasedLife" },
      { group: "FireResistance" },
    ],
    ctx(),
  ).resolved;
  const warnings: string[] = [];
  const variants = templatesFromSpec({
    spec: spec([]),
    resolved,
    ctx: ctx(),
    finishedValue: 100,
    warnings,
  });
  assert.equal(variants.length, 3);
  for (const v of variants) {
    // The missing mod is the only finish candidate; the rest are required.
    assert.equal(v.finish.candidates?.length, 1);
    const missing = v.finish.candidates![0];
    assert.ok(!v.requiredGroups.includes(missing));
    assert.equal(v.requiredGroups.length, 2);
    // Open slot matches the missing mod's side.
    if (v.finish.side === "prefix") {
      assert.equal(v.query.emptyPrefixesMin, 1);
      assert.equal(v.query.emptySuffixesMin, undefined);
    } else {
      assert.equal(v.query.emptySuffixesMin, 1);
      assert.equal(v.query.emptyPrefixesMin, undefined);
    }
    // Price cap = fraction of finished value.
    assert.equal(
      v.query.maxPriceExalted,
      Math.round(100 * SPEC_BUY_CAP_FRACTION),
    );
  }
  // Suffix slams come before prefix slams.
  assert.equal(variants[0].finish.side, "suffix");
});

test("templatesFromSpec: desecrated-only mod -> desecrate variant first", () => {
  const resolved = resolveSpecMods(
    [
      { group: "IncreasedLife" },
      { group: "FireResistance" },
      { group: "DeflectionRating" },
    ],
    ctx(),
  ).resolved;
  const warnings: string[] = [];
  const variants = templatesFromSpec({
    spec: spec([]),
    resolved,
    ctx: ctx(),
    finishedValue: 50,
    warnings,
  });
  assert.equal(variants[0].finish.kind, "desecrate");
  assert.deepEqual(variants[0].finish.candidates, ["DeflectionRating"]);
  // The other variants require the desecrated mod to already be present.
  const slamVariant = variants.find((v) => v.finish.kind === "slam")!;
  assert.ok(slamVariant.requiredGroups.includes("DeflectionRating"));
});

test("templatesFromSpec: unmapped required mod skips the variant with a warning", () => {
  const resolved = resolveSpecMods(
    [{ group: "UnmappedMod" }, { group: "FireResistance" }],
    ctx(),
  ).resolved;
  const warnings: string[] = [];
  const variants = templatesFromSpec({
    spec: spec([]),
    resolved,
    ctx: ctx(),
    finishedValue: null,
    warnings,
  });
  // "missing FireResistance" needs UnmappedMod as a filter -> skipped;
  // "missing UnmappedMod" works (FireResistance is mapped).
  assert.equal(variants.length, 1);
  assert.deepEqual(variants[0].finish.candidates, ["UnmappedMod"]);
  assert.ok(warnings.some((w) => w.includes("no trade-stat mapping")));
  // No finished value -> no price cap.
  assert.equal(variants[0].query.maxPriceExalted, undefined);
});

test("templatesFromSpec: tier floors raise ilvlMin and ride along for the finish", () => {
  const resolved = resolveSpecMods(
    [
      { group: "IncreasedLife", minLevel: 75 },
      { group: "FireResistance" },
    ],
    ctx(),
  ).resolved;
  const variants = templatesFromSpec({
    spec: spec([], "base/cinched"),
    resolved,
    ctx: ctx(),
    finishedValue: 40,
    warnings: [],
  });
  for (const v of variants) {
    assert.equal(v.query.ilvlMin, 75);
    assert.equal(v.query.type, "Cinched Boots");
    assert.equal(v.minLevelByGroup?.IncreasedLife, 75);
  }
});

/* ----------------------------- sell-through ----------------------------- */

test("computeSellThrough: vanished listings per day", () => {
  const day = 24 * 60 * 60 * 1000;
  // 4 of 8 listings gone over 2 days -> 2/day.
  const prev = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const cur = ["e", "f", "g", "h", "x", "y"];
  assert.equal(computeSellThrough(prev, cur, 2 * day), 2);
  // Nothing gone -> 0.
  assert.equal(computeSellThrough(prev, prev, day), 0);
});

test("computeSellThrough: short windows and empty baselines yield null", () => {
  assert.equal(
    computeSellThrough(["a"], [], SELL_THROUGH_MIN_WINDOW_MS - 1),
    null,
  );
  assert.equal(computeSellThrough([], ["a"], SELL_THROUGH_MIN_WINDOW_MS), null);
});

/* ----------------------------- PoB decode ----------------------------- */

const POB_XML = `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="92" className="Ranger"/>
  <Items>
    <Item id="1">
Rarity: RARE
Pandemonium Span
Cinched Boots
Unique ID: abc123
Item Level: 82
Quality: 20
LevelReq: 62
Implicits: 1
+10% to Fire Resistance
{tags:life}+120 to maximum Life
30% increased Movement Speed
{crafted}+25% to Cold Resistance
    </Item>
    <Item id="2">
Rarity: UNIQUE
Wanderlust
Wool Shoes
Item Level: 10
Implicits: 0
5% increased Movement Speed
    </Item>
  </Items>
</PathOfBuilding>`;

function makePobCode(xml: string): string {
  return deflateSync(Buffer.from(xml, "utf8"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

test("decodePobCode: roundtrips url-safe base64 + zlib", () => {
  const code = makePobCode(POB_XML);
  const xml = decodePobCode(code);
  assert.ok(xml);
  assert.ok(xml!.includes("<PathOfBuilding>"));
  // Garbage is rejected, not thrown.
  assert.equal(decodePobCode("definitely not a pob code !!!"), null);
  assert.equal(decodePobCode("aGVsbG8gd29ybGQ_not_zlib_aGVsbG8gd29ybGQ"), null);
});

test("extractPobItems + parsePobItemText: rare item structure", () => {
  const items = extractPobItems(POB_XML);
  assert.equal(items.length, 2);

  const rare = parsePobItemText(items[0]);
  assert.equal(rare.rarity, "RARE");
  assert.equal(rare.nameLine, "Pandemonium Span");
  assert.equal(rare.baseLine, "Cinched Boots");
  assert.equal(rare.itemLevel, 82);
  // 1 implicit skipped; {tags}/{crafted} annotations stripped.
  assert.deepEqual(rare.explicitLines, [
    "+120 to maximum Life",
    "30% increased Movement Speed",
    "+25% to Cold Resistance",
  ]);

  const unique = parsePobItemText(items[1]);
  assert.equal(unique.rarity, "UNIQUE");
  assert.equal(unique.baseLine, "Wool Shoes");
});
