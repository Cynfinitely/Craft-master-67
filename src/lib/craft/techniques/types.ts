import type { AlloyUse, EssenceUse, Trial } from "../engine/actions";
import type { SimPool } from "../engine/pool";
import type { PriceBook } from "../engine/prices";
import type { Item } from "../engine/state";
import type { CraftStep, Target } from "../types";

export type CraftMode = "craft" | "finish";

export interface EssenceOption extends EssenceUse {
  name: string;
}

export interface AlloyOption extends AlloyUse {
  name: string;
}

export interface FluxOption {
  apiId: string;
  name: string;
  targetGroup: string;
}

/** Everything a technique may read. Built once per goal by the brain. */
export interface CraftContext {
  mode: CraftMode;
  baseName: string;
  itemClass: string;
  itemLevel: number;
  pool: SimPool;
  /** Desecrated-domain pool for this class (null when none). */
  desecPool: SimPool | null;
  targets: Target[];
  /** Mod group -> display label. */
  labels: Map<string, string>;
  /** Essences that guarantee a target at (or above) its minimum tier. */
  essences: EssenceOption[];
  /** Alloys that guarantee a target (only for any-tier targets). */
  alloys: AlloyOption[];
  /** Bone for this item class (desecration), if any. */
  bone: string | null;
  flux: FluxOption | null;
  prices: PriceBook;
  /** Starting item in finish mode. */
  start: Item | null;
}

export type Applies = { ok: true } | { ok: false; reason: string };

export type StepDraft = Omit<CraftStep, "n">;

/**
 * A crafting technique: a policy with decision points. The brain expands
 * `choices`, simulates `run` many times per choice and ranks the results.
 *
 * `run` performs ONE attempt on one base (or on the pasted item in finish
 * mode). It may stop early; the evaluator judges success from the final item
 * and restarts on a fresh base until one attempt succeeds.
 */
export interface Technique<C = unknown> {
  id: string;
  name: string;
  summary: string;
  modes: CraftMode[];
  applies(ctx: CraftContext): Applies;
  choices(ctx: CraftContext): C[];
  /** Stable key for a choice (method id suffix and RNG seed). */
  key(choice: C): string;
  run(choice: C, trial: Trial, ctx: CraftContext): void;
  describe(choice: C, ctx: CraftContext): StepDraft[];
  /** Human labels for the decisions in `choice`. */
  options(choice: C, ctx: CraftContext): string[];
  pros(choice: C, ctx: CraftContext): string[];
  cons(choice: C, ctx: CraftContext): string[];
}

/** Erases the choice type for the registry. */
export type AnyTechnique = Technique<any>;

export function defineTechnique<C>(t: Technique<C>): Technique<C> {
  return t;
}
