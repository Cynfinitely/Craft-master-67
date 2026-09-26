# PoE2 Crafting Helper

A local-first web app for planning crafts in **Path of Exile 2**. It does one thing: given a base, an item level and the modifiers you want, it tells you the cheapest way to craft it.

- **Crafting Planner** — pick a base and the mods you want (each with a minimum tier, optionally "nice to have"); the **crafting brain** simulates every technique it knows, tunes each technique's options, and ranks them by expected cost per finished item, with the 50% / 90% cost spread, success rate per attempt and a shopping list. Also: **recommend a base** for a goal, **mass craft** a batch, **paste an item** (Ctrl+C) or a PoB build code, and **finish** a pasted item.
- **Items & Mods** — every prefix/suffix that can roll on a base, grouped by mod group with tiers, spawn-weight odds, tag chips and an "essence" badge.
- **Materials** — every crafting currency/material with its effect text and live price.
- **Saved** — saved plans (re-priced at today's prices) and favorite bases.

Built with Next.js (App Router) + TypeScript + Tailwind, with a local SQLite database (Drizzle + `@libsql/client`).

## Data sources

- **Item bases & modifiers**: the community [repoe-fork](https://github.com/repoe-fork/repoe) PoE2 JSON export.
- **Prices**: [poe2scout](https://poe2scout.com/) currency prices — the only live fetch, cached for an hour (stale prices are served while a refresh runs). Set `POE2_LEAGUE` to pin a league.

This product isn't affiliated with or endorsed by Grinding Gear Games in any way. Crafting odds are simulated estimates.

## Getting started

```bash
npm install
npm run data:setup        # download game data + materials, build data/poe2.db
npm run dev               # http://localhost:3000
```

| Script | Description |
| --- | --- |
| `npm run data:refresh` | Re-download the repoe-fork base/mod JSON snapshot into `data/snapshot/`. |
| `npm run data:materials` | Re-download the poe2scout material catalog. |
| `npm run data:seed` | Rebuild `data/poe2.db` from the snapshot. |
| `npm run data:setup` | Refresh + materials + seed (run after each PoE2 patch). |
| `npm run dev` / `build` / `start` | Next.js dev server / production build / serve. |
| `npm test` | Engine, technique, optimizer and import tests. |

Set `LIBSQL_URL` / `LIBSQL_AUTH_TOKEN` to use a hosted (Turso) database instead of `data/poe2.db`.

## The crafting brain (`src/lib/craft`)

```
engine/      item state, mod pool, seeded RNG, currency actions, price book
techniques/  one file per crafting technique + the registry (index.ts)
brain/       evaluator, optimizer, context builder, solve / recommend / mass
data/        essences, alloys, flux, bones, league advice
```

- **Engine.** `Trial` holds one attempt: the item (rarity, mods with side, tier level, fractured / desecrated / crafted flags), the pools and a seeded RNG. Actions check legality and spend currency: Transmute, Augment, Regal (normal / Greater / Perfect), Alchemy, Exalt (tiers, Sinistral/Dextral side omens, Greater Exaltation double-slam), Chaos (tiers), Annul (side omens), Essence (regular on Magic, Perfect on Rare), Alloy, Fracturing Orb, and desecration (bone + Necromancy omen, Well of Souls reveal of 3 or 5 with Abyssal Echoes, Essence of the Abyss when the side is full). PoE2 0.5 rules apply: 3 prefixes / 3 suffixes (1 each on Magic), one crafted mod, one desecrated mod, orb minimum modifier levels, first-match spawn weights.
- **Techniques** are policies with decision points. Each one says when it applies, lists its choices (which essence, orb tier, annul-on-miss or restart, double-slam, Echoes, which target to seed or fracture…), runs one attempt on a fresh base, and describes its steps.
- **Evaluator.** Runs a technique choice for many attempts and restarts on a fresh base after each failure. Expected cost per finished item = mean attempt cost (currency + base cost) / success rate. The 50% / 90% costs come from resampling the attempts (or the geometric formula when success is rare).
- **Optimizer.** Successive halving: every applicable technique and choice gets a quick pass (extended until a few successes), the best 3 choices per technique get a precise pass (up to 20,000 attempts, while they can still beat the leader, within a time budget), and the best choice of each technique is ranked by expected cost, then 90% cost, then step count. Results are cached per goal and price snapshot.

### Adding a technique

1. Create `src/lib/craft/techniques/myTechnique.ts` exporting `defineTechnique<Choice>({ id, name, summary, modes, applies, choices, key, run, describe, options, pros, cons })`. `run(choice, trial, ctx)` drives the engine through one attempt (`trial.transmute()`, `trial.essence(e)`, `directedFill(trial, ctx.targets, fill)`…); success is judged from the final item.
2. Add it to `TECHNIQUES` in `techniques/index.ts`.
3. Bump `ENGINE_VERSION` in `brain/cache.ts` if behavior of existing techniques changed.

The brain tunes its choices and ranks it against the rest automatically; mass craft lists it too.

## Other notes

- `data/snapshot/` holds the committed JSON snapshots; `scripts/seed-db.ts` turns them into `data/poe2.db` (git-ignored). Only equippable gear bases are flagged `craftable`.
- Essence guarantees (`craft/data/essences.ts`) are found by normalizing essence effect text and matching it against mod text for the item class. Alloys (`craft/data/alloys.ts`) are hand-curated for 0.5.
- **Flux**: when the goal has exactly one resistance type, any elemental resistance counts during the craft and a Flux converts it at the end (added to the cost only when needed).
- **Item paste** (`src/lib/import`): parses the clipboard text, matches the base and each mod's group and tier. "Finish this item" plans from the item's current mods; the base cost there is what another copy would cost.
- Path of Exile 2 keeps changing; modifier data is a per-patch snapshot. Sanity-check big crafts in-game.
