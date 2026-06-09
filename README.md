# PoE2 Crafting Helper

A local-first web app for planning crafts in **Path of Exile 2**:

- **Items & Mods** — search any craftable base item and see every prefix/suffix that can roll on it, grouped by mod group with tiers, spawn-weight odds, descriptive tag chips (life, fire, attack, minion…), a tag filter, and an "essence" badge on groups an essence can guarantee.
- **Materials** — every PoE2 crafting currency/material (essences with per-class guaranteed values and tier, runes, ritual, abyss, breach, fragments, omens, and more), with each item's exact effect text and a live market price.
- **Crafting Planner** — pick a base + the mods you want and get several cost-ranked methods (Essence-led, **Essence + Desecrate + Double-Exalt**, Alloy-led, Transmute→Regal→Exalt, Alchemy+Chaos, Buy-Magic-base+Regal, **Fractured base**, Abyss-Mark Fracture, Desecration, Mass-slam, Remnant) each with steps, odds, an estimated cost, and an honest **luck/brick read** (success per attempt, brick risk, expected items consumed, and a "bricks here" tag on the risky steps); **paste an in-game item** (Ctrl+C) to recreate it at the exact tiers shown; or describe a goal and get base recommendations with the cheapest method cost per base.
- **Price Check** — live currency values (in Exalted Orbs) with a crafting-budget calculator.
- **Saved** — locally stored crafting plans and favorite bases.

Built with Next.js (App Router) + TypeScript + Tailwind, with a local SQLite database (via Drizzle + `@libsql/client`).

## Data sources

- **Item bases & modifiers**: the community [repoe-fork](https://github.com/repoe-fork/repoe) PoE2 JSON export.
- **Prices**: [poe2scout](https://poe2scout.com/) (PoE2-native, based on the in-game Currency Exchange).

This product isn't affiliated with or endorsed by Grinding Gear Games in any way. Crafting odds are approximate.

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Download the game-data snapshots and build the local SQLite database
npm run data:setup        # = data:refresh + data:materials + data:seed

# 3. Run the dev server
npm run dev               # http://localhost:3000
```

### Useful scripts

| Script | Description |
| --- | --- |
| `npm run data:refresh` | Re-download the repoe-fork base/mod JSON snapshot into `data/snapshot/`. |
| `npm run data:materials` | Re-download the poe2scout material catalog into `data/snapshot/materials.json`. |
| `npm run data:seed` | Rebuild `data/poe2.db` from the snapshot. |
| `npm run data:setup` | Refresh + materials + seed (run after each PoE2 patch). |
| `npm run dev` | Start the Next.js dev server. |
| `npm run build` / `npm start` | Production build / serve. |

## How it works

- `data/snapshot/` holds the committed JSON snapshots (`base_items`, `mods`, `tags`, `item_classes` from repoe-fork; `materials.json` from poe2scout); `scripts/seed-db.ts` turns the game data into `data/poe2.db` (git-ignored, regenerated).
- Only real equippable gear is shown: bases are flagged `craftable` at seed time using an item-class whitelist (weapons, armour, off-hands, jewellery, quivers) restricted to released items, so currency/gems/maps/soul-cores are filtered out.
- Modifier eligibility uses PoE first-match spawn-weight semantics: a mod's effective weight for a base is the weight of the first `spawn_weights` entry whose tag the base carries (zero-weight entries earlier in the list block the mod).
- Essence determinism (`src/lib/solver/determinism.ts`) maps each essence to the mod groups it guarantees by normalizing its effect text (e.g. `+(30-39) to maximum Life` → `# to maximum life`) and matching it against normalized mod text, scoped to the item class.
- The crafting solver (`src/lib/solver`) is a heuristic, not a full probabilistic optimizer. It generates several strategies and ranks them by estimated cost (expected attempts × live unit price, with conservative fallbacks). The "Buy Magic base" method excludes the unknown item-listing price and is labeled accordingly.
- Tiers are first-class. Each modifier group exposes its tiers (value range, required level, individual spawn weight) and notable tags ("attack", "life", "speed"…). In the craft selector you can target a specific minimum tier; odds are then computed against the eligible-tier weight, and the solver auto-picks the cheapest exalt that reaches it — Exalted (any), **Greater** (modifier level ≥ 35) or **Perfect** (≥ 50). The Materials browser annotates Greater/Perfect orbs and Ancient bones with their minimum modifier level.
- The Divine step is modeled as a full value reroll: a Divine Orb randomizes *all* variable values at once, so the estimate is geometric in the number of variable target mods (it can take many tries — not a single "perfect" Divine).
- Extra methods cover the current endgame: **Desecration** (Essence of the Abyss → Mark of the Abyssal Lord, then an Ancient Jawbone/Rib/Collarbone per item class, revealed at the Well of Souls as a choice of 3), the **Abyss-Mark Fracture** path (Essence of the Abyss → Mark → desecrate with a Preserved bone but leave it *unrevealed*: desecrated mods can't be fractured yet still count toward the 4-mod minimum, so a targeted fracture goes from 1/4 to **1/3**), and **Mass-slam** (buy many cheap bases and Exalt-slam each; with two targets an **Omen of Greater Exaltation** adds both mods in one double-slam with high-tier bias).
- **Item paste** (`src/lib/import`): `parseItem` tokenizes the in-game clipboard text (base, item level, prefix/suffix/desecrated mods with tiers/tags/values); `resolveItem` matches the base and each mod to the DB, encodes the exact shown tier as `Group@<requiredLevel>`, and flags desecrated/Runic-Ward lines so the plan routes to the desecration/runeforging steps.
- **PoE2 0.5 "Return of the Ancients"** integration: `src/lib/solver/alloys.ts` holds the 13 curated Alloys (each removes a random mod and adds a class-specific guaranteed mod, like a Perfect Essence) — they feed an **Alloy-led** method via the same normalize/class-match logic as essences. `src/lib/data/runeforging.ts` models Verisium **Runic Ward** runeforging (free below item level 55, a defence trade-off at/above 55) and is surfaced as an optional armour step. A high-level **Remnant / Runic Recipe** option is included as guidance (league-only, fuzzy odds). Alloy/runeforging values are hand-curated from the wiki/patch notes and need a refresh each patch.
- **Luck / brick modeling** (`src/lib/solver/risk.ts`): a `RiskModel` interface scores each method's chance of bricking (an Annul/Chaos stripping finished progress). Steps carry a `brickOdds`, the method's cost is inflated by the expected number of restarts, and a `successChancePerAttempt` / `brickRisk` / `expectedItemsConsumed` are shown on the card. Today's `heuristicRisk` is a simple closed form (a random Annul strips a good same-side mod with `u/(u+1)` odds when `u` of them are strippable); fracture-locked, open-slot double-slam and directional-Crystallisation steps are treated as safe, which is why the flagship and fracture methods rank as low-risk. The interface is built so a Monte-Carlo `simulateRisk` can replace the heuristic later without touching any method builder.
- **Community recipes built in**: the flagship **Essence + Desecrate + Double-Exalt** (guarantee the hardest mod at its tier with a Greater/Perfect essence → directional desecrate-unveil a second mod, optionally with an Omen of Abyssal Echoes → fill the last open slots with a Greater/Perfect Exalt + Omen of Greater Exaltation), a **Fractured-base** deterministic path (start from a fractured key mod → Whittle-annul the junk → Essence + Sinistral/Dextral Crystallisation directional adds → finish), tiered base orbs (Greater/Perfect Transmute/Regal/Chaos bias the roll to higher modifier levels), a Greater/Perfect **Chaos-replace** step with explicit brick odds, and **finishers** (`src/lib/solver/finishers.ts`): Tul/Xoph/Esh/Uul-Netol catalyst quality for jewellery and an optional Vaal corruption.

## Notes

- Path of Exile 2 is still evolving; modifier data is a per-patch snapshot and crafting mechanics change between versions. Treat odds and material effects as guidance, and sanity-check large crafts in-game.
