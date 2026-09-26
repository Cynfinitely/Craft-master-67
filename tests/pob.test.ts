import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import {
  decodePobCode,
  extractPobItems,
  parsePobItemText,
} from "../src/lib/import/pobParse";

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
