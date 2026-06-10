import "server-only";
import { getEligibleMods } from "@/lib/data/queries";
import { cleanModText } from "@/lib/data/format";
import type { EligibleMod, ModPool } from "@/lib/data/types";
import { resolveDeterminism } from "./determinism";
import {
  SIM_METHODS,
  buildSimPool,
  type SimDesecrateSpec,
  type SimEssenceSpec,
  type SimFractureSpec,
  type SimGroup,
  type SimMethodId,
  type SimMethodSpec,
  type SimTarget,
} from "./simulate";

/**
 * Method registry: the single source of truth for which crafting actions the
 * simulation engine can run, plus the shared resolution of their per-base
 * prerequisites (essence, desecration pipeline, fracture target). Both the
 * mass-craft planner and the opportunities ranker build their specs here, so
 * they always price the same set of methods the same way.
 */

/* ----------------------------- bones by class ----------------------------- */

export interface BoneInfo {
  bone: string;
  boneApi: string;
}

/** Abyssal bone per item class (Abyss desecration crafting). */
export const BONE_BY_CLASS: {
  test: (ic: string) => boolean;
  bone: string;
  boneApi: string;
}[] = [
  {
    test: (ic) => ic === "Ring" || ic === "Amulet" || ic === "Belt",
    bone: "Collarbone",
    boneApi: "collarbone",
  },
  {
    test: (ic) =>
      ic === "Quiver" ||
      /Mace|Sword|Axe|Dagger|Claw|Bow|Crossbow|Wand|Sceptre|Staff|Warstaff|Spear|Flail/.test(
        ic,
      ),
    bone: "Jawbone",
    boneApi: "jawbone",
  },
  {
    test: (ic) =>
      ic === "Body Armour" ||
      ic === "Helmet" ||
      ic === "Gloves" ||
      ic === "Boots" ||
      ic === "Shield" ||
      ic === "Buckler" ||
      ic === "Focus",
    bone: "Rib",
    boneApi: "rib",
  },
];

export function boneForClass(itemClass: string): BoneInfo | null {
  return BONE_BY_CLASS.find((b) => b.test(itemClass)) ?? null;
}

/* ----------------------------- desecrated pool ----------------------------- */

export interface DesecratedSimPool {
  prefixes: SimGroup[];
  suffixes: SimGroup[];
  /** Display label per desecrated mod group. */
  labels: Map<string, string>;
}

const desecratedPoolCache = new Map<string, DesecratedSimPool>();

/**
 * Desecrated-domain mod pool for a base (Well of Souls reveal options),
 * grouped per side for the simulator.
 */
export async function getDesecratedSimPool(
  baseTags: string[],
  itemLevel: number,
): Promise<DesecratedSimPool> {
  const key = `${[...baseTags].sort().join(",")}:${itemLevel}`;
  const cached = desecratedPoolCache.get(key);
  if (cached) return cached;
  const mods = await getEligibleMods(baseTags, itemLevel, {
    domains: ["desecrated"],
  });
  const pool = buildSimPool(
    mods.filter((m) => m.generationType === "prefix"),
    mods.filter((m) => m.generationType === "suffix"),
  );
  const labels = new Map<string, string>();
  for (const m of mods) {
    const g = m.groups[0] ?? m.id;
    if (!labels.has(g)) {
      labels.set(g, cleanModText(m.text?.split("\n")[0] ?? "") || m.name || g);
    }
  }
  const out = { prefixes: pool.prefixes, suffixes: pool.suffixes, labels };
  if (desecratedPoolCache.size > 300) desecratedPoolCache.clear();
  desecratedPoolCache.set(key, out);
  return out;
}

/* ----------------------------- spec resolution ----------------------------- */

export interface SimSpecBundle {
  /** Ready-to-run spec per runnable method (methods missing prerequisites are absent). */
  specs: Map<SimMethodId, SimMethodSpec>;
  essence: SimEssenceSpec | null;
  desecrate: SimDesecrateSpec | null;
  fracture: SimFractureSpec | null;
}

function groupWeights(mods: EligibleMod[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of mods) {
    const g = x.groups[0] ?? x.id;
    m.set(g, (m.get(g) ?? 0) + x.weight);
  }
  return m;
}

/**
 * Resolves the per-base prerequisites and builds a spec for every method the
 * targets can actually use. Honors the 0.5 caps: at most one essence
 * (crafted mod) and one desecrated mod per item.
 */
export async function buildSimSpecs(opts: {
  pool: ModPool;
  targets: SimTarget[];
  price: (apiId: string) => number;
  maxChaos?: number;
}): Promise<SimSpecBundle> {
  const { pool, targets, price } = opts;

  const preWeights = groupWeights(pool.prefixes);
  const sufWeights = groupWeights(pool.suffixes);
  const preTotal = pool.prefixTotalWeight;
  const sufTotal = pool.suffixTotalWeight;
  const oddsOf = (t: SimTarget): number => {
    const w = (t.side === "prefix" ? preWeights : sufWeights).get(t.group) ?? 0;
    const total = t.side === "prefix" ? preTotal : sufTotal;
    return total > 0 ? w / total : 0;
  };
  // Rarest first; fillers never get the deterministic slots.
  const keysByRarity = targets
    .filter((t) => (t.role ?? "key") === "key")
    .sort((a, b) => oddsOf(a) - oddsOf(b));

  /* ---- essence (single 0.5 crafted-mod slot) ---- */
  let essence: SimEssenceSpec | null = null;
  try {
    const determinism = resolveDeterminism(pool.base.itemClass, [
      ...pool.prefixes,
      ...pool.suffixes,
    ]);
    for (const t of keysByRarity) {
      const options = (determinism.get(t.group) ?? []).filter(
        (e) => (e.guaranteedLevel ?? 0) >= t.minLevel,
      );
      if (options.length === 0) continue;
      const best = [...options].sort(
        (a, b) =>
          price(a.essenceApiId) - price(b.essenceApiId) ||
          (b.guaranteedLevel ?? 0) - (a.guaranteedLevel ?? 0),
      )[0];
      essence = {
        group: t.group,
        side: t.side,
        level: best.guaranteedLevel ?? t.minLevel,
        apiId: best.essenceApiId,
        name: best.essenceName,
      };
      break;
    }
  } catch {
    /* essence lookup optional */
  }

  /* ---- desecration (single 0.5 desecrated slot) ---- */
  let desecrate: SimDesecrateSpec | null = null;
  const bone = boneForClass(pool.base.itemClass);
  if (bone) {
    try {
      const desecPool = await getDesecratedSimPool(
        pool.base.tags,
        pool.itemLevel,
      );
      // Rarest key target whose group can be revealed at the Well of Souls.
      for (const t of keysByRarity) {
        if (essence && t.group === essence.group) continue;
        const sideGroups =
          t.side === "prefix" ? desecPool.prefixes : desecPool.suffixes;
        if (!sideGroups.some((g) => g.group === t.group)) continue;
        desecrate = {
          side: t.side,
          targetGroup: t.group,
          groups: sideGroups,
          useEchoes: targets.length >= 3,
          boneApiId: `ancient-${bone.boneApi}`,
          necroApiId:
            t.side === "prefix"
              ? "omen-of-sinistral-necromancy"
              : "omen-of-dextral-necromancy",
        };
        break;
      }
    } catch {
      /* desecrated pool optional */
    }
  }

  /* ---- fracture (lock the rarest key) ---- */
  const fractureTarget = keysByRarity[0] ?? null;
  const fracture: SimFractureSpec | null = fractureTarget
    ? { targetGroup: fractureTarget.group, side: fractureTarget.side }
    : null;

  /* ---- specs per method ---- */
  const specs = new Map<SimMethodId, SimMethodSpec>();
  specs.set("alch-spam", { id: "alch-spam" });
  specs.set("alch-chaos", { id: "alch-chaos", maxChaos: opts.maxChaos });
  specs.set("transmute-regal-exalt", { id: "transmute-regal-exalt" });
  specs.set("perfect-seed", { id: "perfect-seed" });
  specs.set("omen-exalt", { id: "omen-exalt" });
  if (essence) {
    specs.set("essence-exalt", { id: "essence-exalt", essence });
    specs.set("essence-omen-exalt", {
      id: "essence-omen-exalt",
      essence,
      // A desecration for a SECOND chosen-side mod when one is wanted.
      desecrate: desecrate ?? undefined,
    });
  }
  if (fracture && targets.length >= 2) {
    specs.set("fracture-omen-exalt", { id: "fracture-omen-exalt", fracture });
  }
  if (desecrate) {
    specs.set("desecrate-omen-exalt", { id: "desecrate-omen-exalt", desecrate });
  }

  return { specs, essence, desecrate, fracture };
}

/** Display metadata for a sim method id. */
export function methodMeta(id: SimMethodId) {
  return SIM_METHODS.find((m) => m.id === id) ?? null;
}
