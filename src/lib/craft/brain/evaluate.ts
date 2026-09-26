import { Trial } from "../engine/actions";
import { mulberry32 } from "../engine/rng";
import { cloneItem, countRequiredHits, requiredDone, targetSatisfied, type Item } from "../engine/state";
import type { AnyTechnique, CraftContext } from "../techniques/types";

export interface EvalOptions {
  /** Attempts to run at minimum. */
  attempts: number;
  /** Keep going (up to this many attempts) until `minSuccesses` is reached. */
  maxAttempts?: number;
  minSuccesses?: number;
  seed: number;
  baseCost: number;
  /** performance.now() deadline: stop extending past `attempts` after it. */
  deadline?: number;
}

export interface EvalStats {
  attempts: number;
  successes: number;
  /** P(one attempt finishes the item). */
  p: number;
  /** Mean cost of one attempt (base + currency). */
  meanAttemptCost: number;
  /** Expected cost per finished item; null when nothing succeeded. */
  expectedCost: number | null;
  p50: number | null;
  p90: number | null;
  avgActions: number;
  /** Average units of each currency per attempt. */
  currencyPerAttempt: Map<string, number>;
  /** Share of successes that also hit every optional target. */
  optionalHitRate: number;
  /** partial[k] = share of attempts ending with exactly k required targets. */
  partial: number[];
  lowConfidence: boolean;
}

const BOOTSTRAP_RUNS = 400;
const BOOTSTRAP_MIN_P = 0.02;

function needsFlux(item: Item, ctx: CraftContext): boolean {
  const flux = ctx.flux;
  if (!flux) return false;
  const t = ctx.targets.find((x) => x.group === flux.targetGroup);
  if (!t) return false;
  return !item.mods.some((m) => m.group === t.group && m.side === t.side && m.level >= t.minLevel);
}

/** Simulates attempts of one technique choice and summarizes the cost to one finished item. */
export function evaluate(
  tech: AnyTechnique,
  choice: unknown,
  ctx: CraftContext,
  opts: EvalOptions,
): EvalStats {
  const rng = mulberry32(opts.seed);
  const counts = new Map<string, number>();
  const sink = (apiId: string, n: number) => counts.set(apiId, (counts.get(apiId) ?? 0) + n);
  const price = (apiId: string) => ctx.prices.price(apiId);
  const required = ctx.targets.filter((t) => !t.optional);
  const optional = ctx.targets.filter((t) => t.optional);
  const maxAttempts = Math.max(opts.attempts, opts.maxAttempts ?? opts.attempts);
  const minSuccesses = opts.minSuccesses ?? 0;

  const costs: number[] = [];
  const oks: boolean[] = [];
  const partial = new Array<number>(required.length + 1).fill(0);
  let successes = 0;
  let optionalHits = 0;
  let actions = 0;
  let costSum = 0;

  let n = 0;
  while (n < maxAttempts) {
    if (n >= opts.attempts) {
      if (successes >= minSuccesses) break;
      if (opts.deadline != null && (n & 63) === 0 && performance.now() > opts.deadline) break;
    }
    const t = new Trial(ctx.pool, ctx.desecPool, rng, price, sink, ctx.start ? cloneItem(ctx.start) : undefined);
    tech.run(choice, t, ctx);
    const ok = requiredDone(t.item, ctx.targets);
    if (ok) {
      if (needsFlux(t.item, ctx)) t.spend(ctx.flux!.apiId);
      successes++;
      if (optional.length && optional.every((o) => targetSatisfied(t.item, o))) optionalHits++;
    }
    partial[countRequiredHits(t.item, ctx.targets)]++;
    const cost = t.cost + opts.baseCost;
    costs.push(cost);
    oks.push(ok);
    costSum += cost;
    actions += t.actions;
    n++;
  }

  const p = successes / n;
  const meanAttemptCost = costSum / n;
  const currencyPerAttempt = new Map<string, number>();
  for (const [k, v] of counts) currencyPerAttempt.set(k, v / n);

  let p50: number | null = null;
  let p90: number | null = null;
  if (successes > 0) {
    if (p >= BOOTSTRAP_MIN_P) {
      [p50, p90] = bootstrapQuantiles(costs, oks, opts.seed ^ 0x9e3779b9);
    } else {
      let failSum = 0;
      let succSum = 0;
      for (let i = 0; i < n; i++) {
        if (oks[i]) succSum += costs[i];
        else failSum += costs[i];
      }
      const meanFail = n - successes > 0 ? failSum / (n - successes) : 0;
      const meanSucc = succSum / successes;
      const q = (x: number) => {
        const k = Math.ceil(Math.log(1 - x) / Math.log(1 - p));
        return Math.max(0, k - 1) * meanFail + meanSucc;
      };
      p50 = q(0.5);
      p90 = q(0.9);
    }
  }

  return {
    attempts: n,
    successes,
    p,
    meanAttemptCost,
    expectedCost: successes > 0 ? meanAttemptCost / p : null,
    p50,
    p90,
    avgActions: actions / n,
    currencyPerAttempt,
    optionalHitRate: successes ? optionalHits / successes : 0,
    partial: partial.map((x) => x / n),
    lowConfidence: successes < 10,
  };
}

/** Resamples observed attempts into "run until one success" totals. */
function bootstrapQuantiles(costs: number[], oks: boolean[], seed: number): [number, number] {
  const rng = mulberry32(seed);
  const n = costs.length;
  const totals: number[] = [];
  for (let r = 0; r < BOOTSTRAP_RUNS; r++) {
    let sum = 0;
    for (let guard = 0; guard < 10000; guard++) {
      const i = Math.floor(rng() * n);
      sum += costs[i];
      if (oks[i]) break;
    }
    totals.push(sum);
  }
  totals.sort((a, b) => a - b);
  const at = (q: number) => totals[Math.min(totals.length - 1, Math.floor(q * totals.length))];
  return [at(0.5), at(0.9)];
}
