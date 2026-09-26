# Crafting Brain — Design

Date: 2026-09-26
Status: approved (supersedes `2026-06-14-profit-craft-design.md`)

## Goal

The app does one thing: given a base, an item level and a set of desired
modifiers, tell the user the best way to craft it. Developers add crafting
techniques in code; the "brain" decides which technique (and which options
inside it) reaches the goal cheapest.

## Scope

Kept: Crafting planner (from a base, recommend a base, mass craft, paste item,
finish a partial item), Items browser, Materials browser, saved plans and
favorites.

Removed: gem corruption, tablets, market/profit/opportunities/snipes, runs and
the job queue, the market worker, the trade API client, sale estimates.

Live data: poe2scout currency prices only, cached for an hour in
`price_cache` with stale-while-revalidate. No trade API calls. Base purchase
cost is a user input (default 0).

## Goal model

```ts
interface Target {
  group: string;          // mod group id
  side: "prefix" | "suffix";
  minLevel: number;       // minimum modifier level of the tier (0 = any tier)
  optional: boolean;      // "nice to have": graded, not required for success
  desecrated?: boolean;   // only obtainable via desecration
  altGroups?: string[];   // Flux surrogates that also count as hits
}
interface Goal { baseId: string; itemLevel: number; targets: Target[] }
```

URL encoding (backwards compatible): `Group`, `Group@<minLevel>`, suffix
`~d` for desecrated, `~o` for optional (e.g. `Life@60~o`).

Success = every required target present at `minLevel` or better. Optional
targets are reported as a graded distribution.

## Architecture

```
src/lib/craft/
  engine/   state.ts  pool.ts  rng.ts  actions.ts  prices.ts
  techniques/  <one file per technique>  index.ts (registry)
  brain/    evaluate.ts  optimize.ts  cache.ts  solve.ts  recommend.ts
            mass.ts  finish.ts
  types.ts  goal.ts  data/ (essences, alloys, flux, bones, rules, finishers)
```

### Engine

- `ItemState`: rarity, mods (group, level, side, fractured, desecrated,
  crafted), plus counters for the 0.5 caps.
- `SimPool`: weighted groups and tiers for prefixes and suffixes, built from
  `getModPool` (normal pool) and the desecrated-domain pool.
- `Rng`: seeded mulberry32. Every evaluation is reproducible for a given seed.
- Actions: pure-ish functions `(state, ctx) => void` that mutate a cloned
  state and tally the currency they consume. Transmute, augment, regal,
  alchemy, exalt (normal/greater/perfect, with Sinistral/Dextral/Greater
  omens), chaos (tiers), annul (with side omens), essence, desecrate+reveal,
  fracture. Each action checks legality (rarity, open slots, caps).

### Technique contract

```ts
interface Technique<C> {
  id: string; name: string; summary: string;
  applies(goal, ctx): { ok: true } | { ok: false; reason: string };
  choices(goal, ctx): C[];                       // decision points
  run(choice, trial): TrialOutcome;              // one simulated attempt
  describe(choice, ctx): CraftStep[];            // human steps
  label?(choice, ctx): string[];                 // chosen options, for UI
}
```

A technique's `run` drives the engine through one attempt on one base and
returns `"success" | "fail"`; the evaluator restarts on a fresh base after a
failure until success (bounded), so a technique's cost includes restarts,
bricks and the bases consumed.

Decision points express the choices the old solver hard-coded: which essence,
greater vs normal exalt, whether to use side omens, whether to annul-and-retry
or restart, Abyssal Echoes on/off, how many chaos rerolls before giving up.

### Brain

1. Build `CraftContext` (pool, desecrated pool, prices, essences, alloys,
   bone, flux) once per goal.
2. Filter techniques by `applies`.
3. Expand choices (capped at 24 per technique).
4. Successive halving: 200 trials each, keep the best 25% (at least 3) by
   expected cost, re-run with 2000 trials.
5. Rank by expected cost per finished item; ties by p90, then step count.
6. Cache by `(base, ilvl, goal, price snapshot, ENGINE_VERSION)` in an LRU.

Expected cost per finished item is measured directly: total currency plus
bases consumed across attempts until one success, averaged over trials. p50
and p90 come from the same samples.

### Consumers

- `solve(goal)` returns a `CraftPlan` with ranked `CraftMethod`s.
- `recommend(class, ilvl, targets)` pre-ranks bases by pooled odds and runs
  the brain only on the top 10.
- `mass(goal, techniqueId, n)` uses a technique's single-attempt hit rate
  with `binomialQuantiles`.
- `finish(goal, currentMods)` starts every trial from the pasted state.
- `reprice(plan)` re-evaluates saved plans at today's prices.

## Error handling

- Unknown base or no rollable targets: plan with `feasible: false` and
  warnings.
- Over 3 prefixes or suffixes, or two crafted/desecrated mods: infeasible
  with the 0.5 rule warning.
- Missing live prices: fallback price table; plan notes that fallbacks were
  used.
- Techniques that never succeed within the attempt bound are dropped from
  the ranking.

## Testing

- Seeded action tests: slot caps, omen side forcing, essence guarantee,
  fracture protection against annul.
- Technique sanity: single essence-guaranteeable target gives success rate 1;
  a one-target exalt case matches the analytic hit rate within tolerance.
- Optimizer: a synthetic pool where one technique is clearly cheaper ranks
  it first.
- Performance: `solve` under 1.5 s for 4 targets; `recommend` under 5 s.
