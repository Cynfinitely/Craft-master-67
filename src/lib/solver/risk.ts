import type { CraftMethod, CraftStep } from "./types";

/**
 * Luck / brick risk modeling for a crafting sequence.
 *
 * A "pass" is one full run of the steps. Steps with `odds` are retried *in
 * place* (their expected attempts/cost are modeled by the builder), so they do
 * not reduce pass success. Steps with `brickOdds` can instead destroy finished
 * progress (e.g. an Annul/Chaos strips a completed mod), forcing a restart.
 *
 * This is a deliberately simple heuristic. It lives behind the `RiskModel`
 * interface so a precise Monte-Carlo / Markov `simulateRisk` can be dropped in
 * later without touching any method builder.
 */

export interface RiskAssessment {
  /** P(a single full pass completes without bricking). */
  successChance: number;
  /** 1 - successChance. */
  brickRisk: number;
  /** Expected number of full passes / items consumed to succeed once. */
  expectedRestarts: number;
}

export interface RiskModel {
  assess(steps: CraftStep[]): RiskAssessment;
}

/** Product of per-step survival probabilities; restarts are geometric. */
export const heuristicRisk: RiskModel = {
  assess(steps: CraftStep[]): RiskAssessment {
    let survive = 1;
    for (const s of steps) {
      if (s.brickOdds && s.brickOdds > 0) {
        survive *= Math.max(0, 1 - Math.min(1, s.brickOdds));
      }
    }
    const successChance = survive;
    const brickRisk = 1 - successChance;
    const expectedRestarts = successChance > 0 ? 1 / successChance : Infinity;
    return { successChance, brickRisk, expectedRestarts };
  },
};

/**
 * Monte Carlo pass simulation. Unlike the heuristic product (which treats
 * `brickOdds` as a flat once-per-step risk), this couples brick risk to the
 * retry loop: a step with `odds` is attempted until it succeeds, and EVERY
 * failed attempt's cleanup can brick with `brickOdds`. Low-odds steps with
 * cleanup risk are therefore much more dangerous than the flat product
 * suggests — which matches how Exalt+Annul cleanup actually plays out.
 */
export function monteCarloRisk(trials = 4000): RiskModel {
  return {
    assess(steps: CraftStep[]): RiskAssessment {
      const risky = steps.filter(
        (s) =>
          (s.brickOdds != null && s.brickOdds > 0) ||
          (s.odds != null && s.odds > 0 && s.odds < 1),
      );
      if (!risky.some((s) => s.brickOdds && s.brickOdds > 0)) {
        return { successChance: 1, brickRisk: 0, expectedRestarts: 1 };
      }

      let completed = 0;
      for (let t = 0; t < trials; t++) {
        let bricked = false;
        for (const s of risky) {
          const brick = Math.min(1, s.brickOdds ?? 0);
          if (s.odds != null && s.odds > 0 && s.odds < 1) {
            // Retry-in-place until success; each miss may brick on cleanup.
            // P(brick before success) sampled directly.
            for (let guard = 0; guard < 10000; guard++) {
              if (Math.random() < s.odds) break; // landed it
              if (brick > 0 && Math.random() < brick) {
                bricked = true;
                break;
              }
            }
          } else if (brick > 0 && Math.random() < brick) {
            bricked = true;
          }
          if (bricked) break;
        }
        if (!bricked) completed++;
      }
      const successChance = completed / trials;
      const brickRisk = 1 - successChance;
      const expectedRestarts =
        successChance > 0 ? 1 / successChance : Infinity;
      return { successChance, brickRisk, expectedRestarts };
    },
  };
}

export const simulatedRisk: RiskModel = monteCarloRisk();

function round(n: number): number {
  if (!Number.isFinite(n)) return n;
  if (n >= 100) return Math.round(n);
  if (n >= 10) return Math.round(n * 10) / 10;
  return Math.round(n * 100) / 100;
}

/**
 * Annotates a method with risk-derived fields and inflates its cost by the
 * expected number of restarts (you re-buy the base and redo on a brick).
 * Uses the Monte Carlo model by default (per-attempt brick coupling); the
 * heuristic product remains available as a fast fallback.
 */
export function withRisk(
  method: CraftMethod,
  model: RiskModel = simulatedRisk,
): CraftMethod {
  const r = model.assess(method.steps);
  const inflated =
    method.estCostExalted == null
      ? method.estCostExalted
      : round(method.estCostExalted * (Number.isFinite(r.expectedRestarts) ? r.expectedRestarts : 1));
  return {
    ...method,
    estCostExalted: inflated,
    successChancePerAttempt: r.successChance,
    brickRisk: r.brickRisk,
    expectedItemsConsumed: Number.isFinite(r.expectedRestarts)
      ? r.expectedRestarts
      : undefined,
    costApproximate: method.costApproximate || r.brickRisk > 0,
  };
}
