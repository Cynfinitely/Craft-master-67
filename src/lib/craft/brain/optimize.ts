import { hashSeed } from "../engine/rng";
import type { AnyTechnique, CraftContext } from "../techniques/types";
import { evaluate, type EvalStats } from "./evaluate";

export const MAX_CHOICES_PER_TECHNIQUE = 24;
const STAGE1_ATTEMPTS = 300;
/** Rare-success candidates extend stage 1 (up to this factor) to see a few successes. */
const STAGE1_EXTEND = 4;
const STAGE1_MIN_SUCCESSES = 3;
const STAGE2_ATTEMPTS = 2000;
const STAGE2_MAX_ATTEMPTS = 20000;
const STAGE2_MIN_SUCCESSES = 40;
const KEEP_PER_TECHNIQUE = 3;
const DEFAULT_BUDGET_MS = 1200;
const PROMISING_FACTOR = 3;

export interface RankedMethod {
  tech: AnyTechnique;
  choice: unknown;
  key: string;
  stats: EvalStats;
  stepCount: number;
}

export interface OptimizeResult {
  ranked: RankedMethod[];
  /** Technique+choice candidates simulated in stage 1. */
  evaluated: number;
  /** Techniques that didn't apply or never succeeded, with the reason. */
  rejected: { id: string; name: string; reason: string }[];
}

export interface OptimizeOptions {
  baseCost: number;
  /** Stable text identifying the goal (seeds every evaluation). */
  seedKey: string;
  budgetMs?: number;
  /** Stage-1 attempts per candidate (tests may lower it). */
  stage1Attempts?: number;
}

/** Smoothed cost score for a small sample: avoids 0/0 and punishes zero successes. */
function score(s: EvalStats): number {
  const pHat = (s.successes + 0.5) / (s.attempts + 1);
  return s.meanAttemptCost / pHat;
}

function compareRanked(a: RankedMethod, b: RankedMethod): number {
  const ca = a.stats.expectedCost ?? Infinity;
  const cb = b.stats.expectedCost ?? Infinity;
  if (ca !== cb) return ca - cb;
  const pa = a.stats.p90 ?? Infinity;
  const pb = b.stats.p90 ?? Infinity;
  if (pa !== pb) return pa - pb;
  return a.stepCount - b.stepCount;
}

/**
 * Successive halving over every applicable technique and its choices:
 * a cheap pass for all candidates, then a precise pass for the best few per
 * technique. Returns the best choice of each technique, cheapest first.
 */
export function optimize(
  ctx: CraftContext,
  techniques: AnyTechnique[],
  opts: OptimizeOptions,
): OptimizeResult {
  const start = performance.now();
  const deadline = start + (opts.budgetMs ?? DEFAULT_BUDGET_MS);
  const rejected: OptimizeResult["rejected"] = [];
  const seedFor = (tech: AnyTechnique, key: string) => hashSeed(`${opts.seedKey}|${tech.id}|${key}`);

  type Cand = { tech: AnyTechnique; choice: unknown; key: string; stats: EvalStats };
  const perTech = new Map<string, Cand[]>();
  let evaluated = 0;

  for (const tech of techniques) {
    if (!tech.modes.includes(ctx.mode)) continue;
    const ok = tech.applies(ctx);
    if (!ok.ok) {
      rejected.push({ id: tech.id, name: tech.name, reason: ok.reason });
      continue;
    }
    const choices = tech.choices(ctx).slice(0, MAX_CHOICES_PER_TECHNIQUE);
    const cands: Cand[] = [];
    for (const choice of choices) {
      const key = tech.key(choice);
      const attempts = opts.stage1Attempts ?? STAGE1_ATTEMPTS;
      const stats = evaluate(tech, choice, ctx, {
        attempts,
        maxAttempts: attempts * STAGE1_EXTEND,
        minSuccesses: STAGE1_MIN_SUCCESSES,
        seed: seedFor(tech, key),
        baseCost: opts.baseCost,
        deadline,
      });
      evaluated++;
      cands.push({ tech, choice, key, stats });
    }
    if (cands.length) perTech.set(tech.id, cands);
  }

  // Stage 2: the best few choices per technique, most promising techniques first.
  const finalists: Cand[] = [];
  for (const cands of perTech.values()) {
    cands.sort((a, b) => score(a.stats) - score(b.stats));
    finalists.push(...cands.slice(0, KEEP_PER_TECHNIQUE));
  }
  finalists.sort((a, b) => score(a.stats) - score(b.stats));

  const best = new Map<string, RankedMethod>();
  let leader = Infinity;
  for (const c of finalists) {
    // Only candidates that might beat the leader earn the long (precise) run.
    const promising = score(c.stats) < PROMISING_FACTOR * leader;
    let stats =
      performance.now() < deadline
        ? evaluate(c.tech, c.choice, ctx, {
            attempts: STAGE2_ATTEMPTS,
            maxAttempts: promising ? STAGE2_MAX_ATTEMPTS : STAGE2_ATTEMPTS,
            minSuccesses: STAGE2_MIN_SUCCESSES,
            seed: seedFor(c.tech, c.key) ^ 0x5bd1e995,
            baseCost: opts.baseCost,
            deadline,
          })
        : c.stats;
    if (stats.successes === 0 && c.stats.successes > 0) stats = c.stats;
    if (stats.successes === 0) continue;
    if (stats.expectedCost != null && stats.expectedCost < leader) leader = stats.expectedCost;
    const ranked: RankedMethod = {
      tech: c.tech,
      choice: c.choice,
      key: c.key,
      stats,
      stepCount: c.tech.describe(c.choice, ctx).length,
    };
    const prev = best.get(c.tech.id);
    if (!prev || compareRanked(ranked, prev) < 0) best.set(c.tech.id, ranked);
  }

  for (const [id, cands] of perTech) {
    if (!best.has(id)) {
      const tech = cands[0].tech;
      rejected.push({
        id,
        name: tech.name,
        reason: `No success in ${cands.reduce((s, c) => s + c.stats.attempts, 0)} simulated attempts`,
      });
    }
  }

  return { ranked: [...best.values()].sort(compareRanked), evaluated, rejected };
}
