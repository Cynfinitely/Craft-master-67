import { FLUX_FALLBACK_PRICE } from "../data/flux";

/**
 * Fallback unit prices in Exalted Orbs, used when poe2scout has no quote for
 * an apiId. Deliberately conservative; plans note when a fallback was used.
 */
export const FALLBACK_PRICE: Record<string, number> = {
  transmute: 0.02,
  aug: 0.05,
  regal: 0.3,
  alch: 0.25,
  exalted: 1,
  "greater-exalted-orb": 6,
  "perfect-exalted-orb": 30,
  chaos: 0.5,
  "greater-chaos-orb": 4,
  "perfect-chaos-orb": 20,
  "greater-orb-of-transmutation": 0.5,
  "perfect-orb-of-transmutation": 3,
  "greater-orb-of-augmentation": 0.5,
  "perfect-orb-of-augmentation": 3,
  "greater-regal-orb": 4,
  "perfect-regal-orb": 20,
  annul: 2,
  "omen-of-sinistral-annulment": 5,
  "omen-of-dextral-annulment": 5,
  "omen-of-sinistral-exaltation": 10,
  "omen-of-dextral-exaltation": 10,
  "omen-of-greater-exaltation": 8,
  "omen-of-whittling": 25,
  "omen-of-abyssal-echoes": 20,
  "omen-of-sinistral-necromancy": 10,
  "omen-of-dextral-necromancy": 10,
  divine: 200,
  "fracturing-orb": 30,
  "essence-of-the-abyss": 80,
  "preserved-jawbone": 5,
  "ancient-jawbone": 25,
  "preserved-rib": 5,
  "ancient-rib": 25,
  "preserved-collarbone": 5,
  "ancient-collarbone": 25,
  ...FLUX_FALLBACK_PRICE,
};

/** Alloys aren't listed on poe2scout; flat fallback so they never price at zero. */
export const ALLOY_FALLBACK_PRICE = 3;

export interface PriceBook {
  /** Unit price in Exalted Orbs (live, then fallback, then 0). */
  price(apiId: string): number;
  /** Display name for an apiId. */
  name(apiId: string): string;
  divinePriceExalted: number;
  /** poe2scout snapshot time (0 when no live data); part of cache keys. */
  fetchedAt: number;
  league: string | null;
  /** apiIds that were priced from the fallback table during this plan. */
  fallbacksUsed: Set<string>;
}

const KNOWN_NAMES: Record<string, string> = {
  alch: "Orb of Alchemy",
  chaos: "Chaos Orb",
  exalted: "Exalted Orb",
  transmute: "Orb of Transmutation",
  aug: "Orb of Augmentation",
  regal: "Regal Orb",
  annul: "Orb of Annulment",
  divine: "Divine Orb",
  "fracturing-orb": "Fracturing Orb",
};

export function titleCaseApiId(apiId: string): string {
  return (
    KNOWN_NAMES[apiId] ??
    apiId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

export function makePriceBook(opts: {
  live: Map<string, number>;
  names?: Map<string, string>;
  divinePriceExalted?: number;
  fetchedAt?: number;
  league?: string | null;
}): PriceBook {
  const fallbacksUsed = new Set<string>();
  const memo = new Map<string, number>();
  return {
    price(apiId) {
      const hit = memo.get(apiId);
      if (hit !== undefined) return hit;
      let p = opts.live.get(apiId);
      if (p == null) {
        p = FALLBACK_PRICE[apiId] ?? (apiId.endsWith("-alloy") ? ALLOY_FALLBACK_PRICE : undefined);
        if (p != null) fallbacksUsed.add(apiId);
      }
      const v = p ?? 0;
      memo.set(apiId, v);
      return v;
    },
    name(apiId) {
      return opts.names?.get(apiId) ?? titleCaseApiId(apiId);
    },
    divinePriceExalted:
      opts.divinePriceExalted || opts.live.get("divine") || FALLBACK_PRICE.divine,
    fetchedAt: opts.fetchedAt ?? 0,
    league: opts.league ?? null,
    fallbacksUsed,
  };
}
