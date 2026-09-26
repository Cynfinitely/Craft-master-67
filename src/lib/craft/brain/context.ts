import "server-only";
import { modLabel, tierValue } from "@/lib/data/format";
import { getEligibleMods, getModPool } from "@/lib/data/queries";
import type { EligibleMod } from "@/lib/data/types";
import { resolveAlloys } from "../data/alloys";
import { boneForClass } from "../data/bones";
import { essenceReachesTarget, resolveDeterminism } from "../data/essences";
import { resolveFlux } from "../data/flux";
import { leagueAdvice } from "../data/league";
import { buildSimPool, freshOdds, type SimPool } from "../engine/pool";
import type { PriceBook } from "../engine/prices";
import { MAX_DESECRATED_MODS, MAX_RARE_PER_SIDE, requiredDone, type Item } from "../engine/state";
import type { GoalEntry } from "../goal";
import type { AlloyOption, CraftContext, EssenceOption, FluxOption } from "../techniques/types";
import type { CurrentMod, DesiredMod, Side, Target } from "../types";

export interface BuiltContext {
  ctx: CraftContext;
  baseId: string;
  desiredPrefixes: DesiredMod[];
  desiredSuffixes: DesiredMod[];
  warnings: string[];
  notes: string[];
  feasible: boolean;
}

interface GroupInfo {
  side: Side;
  label: string;
  /** Tiers lowest level first. */
  tiers: EligibleMod[];
}

function indexGroups(mods: EligibleMod[]): Map<string, GroupInfo> {
  const map = new Map<string, GroupInfo>();
  for (const m of mods) {
    const g = m.groups[0] ?? m.id;
    const side: Side = m.generationType === "suffix" ? "suffix" : "prefix";
    const info = map.get(g) ?? { side, label: modLabel(m), tiers: [] };
    info.tiers.push(m);
    map.set(g, info);
  }
  for (const info of map.values()) info.tiers.sort((a, b) => a.requiredLevel - b.requiredLevel);
  return map;
}

const desecPoolCache = new Map<string, { pool: SimPool; groups: Map<string, GroupInfo> }>();

async function desecratedPool(tags: string[], itemLevel: number) {
  const key = `${[...tags].sort().join(",")}:${itemLevel}`;
  const hit = desecPoolCache.get(key);
  if (hit) return hit;
  const mods = await getEligibleMods(tags, itemLevel, { domains: ["desecrated"] });
  const pool = buildSimPool(
    mods.filter((m) => m.generationType === "prefix"),
    mods.filter((m) => m.generationType === "suffix"),
  );
  const out = { pool, groups: indexGroups(mods) };
  if (desecPoolCache.size > 300) desecPoolCache.clear();
  desecPoolCache.set(key, out);
  return out;
}

/**
 * Resolves a goal against a base: the simulation pools, the targets with
 * their sides and Flux surrogates, the essences/alloys that guarantee them,
 * and the display rows and warnings for the plan.
 */
export async function buildContext(input: {
  baseId: string;
  itemLevel: number;
  goal: GoalEntry[];
  prices: PriceBook;
  current?: CurrentMod[];
}): Promise<BuiltContext | null> {
  const modPool = await getModPool(input.baseId, input.itemLevel);
  if (!modPool) return null;
  const { base } = modPool;
  const allMods = [...modPool.prefixes, ...modPool.suffixes];
  const groups = indexGroups(allMods);
  const pool = buildSimPool(modPool.prefixes, modPool.suffixes);

  const bone = boneForClass(base.itemClass);
  let desec: { pool: SimPool; groups: Map<string, GroupInfo> } | null = null;
  try {
    desec = await desecratedPool(base.tags, input.itemLevel);
  } catch {
    desec = null;
  }

  const warnings: string[] = [];
  const notes: string[] = [];
  const labels = new Map<string, string>();
  for (const [g, info] of groups) labels.set(g, info.label);
  for (const [g, info] of desec?.groups ?? []) if (!labels.has(g)) labels.set(g, info.label);

  const targets: Target[] = [];
  const desired: DesiredMod[] = [];
  for (const e of input.goal) {
    const normal = groups.get(e.group);
    const dInfo = desec?.groups.get(e.group);
    const useDesec = (!normal || e.desecrated) && !!dInfo;
    const info = useDesec ? dInfo : normal;
    if (!info) {
      warnings.push(`"${e.group}" cannot roll on ${base.name} at item level ${input.itemLevel}.`);
      continue;
    }
    const tier = e.minLevel > 0 ? info.tiers.find((t) => t.requiredLevel >= e.minLevel) ?? info.tiers.at(-1) : undefined;
    const minLevel = e.minLevel > 0 ? tier?.requiredLevel ?? e.minLevel : 0;
    targets.push({
      group: e.group,
      side: info.side,
      minLevel,
      optional: e.optional,
      desecrated: useDesec,
    });
    desired.push({
      group: e.group,
      label: info.label,
      generationType: info.side,
      tierLevel: minLevel > 0 ? minLevel : undefined,
      tierValue: tier ? tierValue(tier) : undefined,
      optional: e.optional || undefined,
      desecrated: useDesec || undefined,
      oddsFresh: 0,
    });
  }

  let flux: FluxOption | null = null;
  const fluxPlan = resolveFlux(targets.map((t) => t.group));
  if (fluxPlan) {
    const t = targets.find((x) => x.group === fluxPlan.targetGroup && !x.desecrated);
    if (t) {
      const alts = fluxPlan.surrogateGroups.filter((g) => pool.byGroup.get(g)?.side === t.side);
      if (alts.length) {
        t.altGroups = alts;
        flux = { apiId: fluxPlan.fluxApiId, name: fluxPlan.fluxName, targetGroup: t.group };
        const d = desired.find((x) => x.group === t.group);
        if (d) d.fluxName = fluxPlan.fluxName;
      }
    }
  }

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const p = t.desecrated ? desec?.pool : pool;
    desired[i].oddsFresh = p ? freshOdds(p, [t.group, ...(t.altGroups ?? [])], t.side, t.minLevel) : 0;
  }

  let feasible = true;
  for (const side of ["prefix", "suffix"] as Side[]) {
    const n = targets.filter((t) => t.side === side).length;
    if (n > MAX_RARE_PER_SIDE) {
      warnings.push(`You selected ${n} ${side}es, but an item can have at most ${MAX_RARE_PER_SIDE}.`);
      feasible = false;
    }
  }
  const desecCount = targets.filter((t) => t.desecrated && !t.optional).length;
  if (desecCount > MAX_DESECRATED_MODS) {
    warnings.push(
      `You selected ${desecCount} desecrated-only modifiers, but in 0.5 an item can carry at most ${MAX_DESECRATED_MODS}.`,
    );
    feasible = false;
  }
  if (!targets.some((t) => !t.optional)) {
    warnings.push("Pick at least one required modifier (not marked optional).");
    feasible = false;
  }
  if (targets.some((t) => t.desecrated) && !bone) {
    warnings.push(`${base.itemClass} has no desecration bone, so desecrated-only modifiers can't be added.`);
    feasible = false;
  }

  const determinism = resolveDeterminism(base.itemClass, allMods);
  const essences: EssenceOption[] = [];
  for (const t of targets) {
    if (t.desecrated) continue;
    const opts = determinism.get(t.group) ?? [];
    const reach = opts.filter((e) => essenceReachesTarget(e, { tierLevel: t.minLevel || undefined }));
    for (const e of reach) {
      essences.push({
        apiId: e.essenceApiId,
        name: e.essenceName,
        group: t.group,
        side: t.side,
        level: e.guaranteedLevel ?? t.minLevel,
        perfect: e.tier === "Perfect",
      });
    }
    if (t.minLevel > 0 && opts.length && !reach.length) {
      const best = [...opts].sort((a, b) => (b.guaranteedLevel ?? 0) - (a.guaranteedLevel ?? 0))[0];
      notes.push(
        `No essence guarantees the chosen tier of "${labels.get(t.group)}"; the best is ${best.essenceName} (${best.guaranteedValue ?? best.modLabel}).`,
      );
    }
  }

  const alloyMap = resolveAlloys(base.itemClass, allMods);
  const alloys: AlloyOption[] = [];
  for (const t of targets) {
    if (t.desecrated || t.minLevel > 0) continue;
    for (const a of alloyMap.get(t.group) ?? []) {
      alloys.push({ apiId: a.alloyApiId, name: a.alloyName, group: t.group, side: t.side, level: 0 });
    }
  }

  let start: Item | null = null;
  if (input.current) {
    start = {
      rarity: "rare",
      mods: input.current.map((m) => ({
        group: m.group,
        side: m.side,
        level: m.level,
        fractured: m.fractured,
        desecrated: m.desecrated,
      })),
    };
    for (const side of ["prefix", "suffix"] as Side[]) {
      if (start.mods.filter((m) => m.side === side).length > MAX_RARE_PER_SIDE) {
        warnings.push(`The pasted item has more than ${MAX_RARE_PER_SIDE} ${side}es.`);
        feasible = false;
      }
    }
    if (feasible && requiredDone(start, targets)) {
      notes.push("Your item already has every required modifier.");
      feasible = false;
    }
  }

  if (feasible) notes.push(...leagueAdvice(base.itemClass, targets.map((t) => t.group)));

  const ctx: CraftContext = {
    mode: input.current ? "finish" : "craft",
    baseName: base.name,
    itemClass: base.itemClass,
    itemLevel: input.itemLevel,
    pool,
    desecPool: bone ? desec?.pool ?? null : null,
    targets,
    labels,
    essences,
    alloys,
    bone,
    flux,
    prices: input.prices,
    start,
  };

  return {
    ctx,
    baseId: base.id,
    desiredPrefixes: desired.filter((d) => d.generationType === "prefix"),
    desiredSuffixes: desired.filter((d) => d.generationType === "suffix"),
    warnings,
    notes,
    feasible,
  };
}
