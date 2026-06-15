import type { CraftMethod } from "./types";

export type MethodSortMode = "cost" | "profit" | "roi";

export function parseMethodSort(raw: string | undefined): MethodSortMode {
  if (raw === "profit" || raw === "roi") return raw;
  return "cost";
}

/** Re-ranks feasible methods after profit fields are attached. */
export function sortMethods(
  methods: CraftMethod[],
  mode: MethodSortMode,
): CraftMethod[] {
  const out = [...methods];
  out.sort((a, b) => {
    const am = a.excludesMarketPrice ? 1 : 0;
    const bm = b.excludesMarketPrice ? 1 : 0;
    if (am !== bm) return am - bm;

    if (mode === "profit") {
      const ap = a.expectedProfitExalted;
      const bp = b.expectedProfitExalted;
      if (ap != null && bp != null && ap !== bp) return bp - ap;
      if (ap != null && bp == null) return -1;
      if (ap == null && bp != null) return 1;
    }

    if (mode === "roi") {
      const ar =
        a.expectedProfitExalted != null && a.estCostExalted != null && a.estCostExalted > 0
          ? a.expectedProfitExalted / a.estCostExalted
          : null;
      const br =
        b.expectedProfitExalted != null && b.estCostExalted != null && b.estCostExalted > 0
          ? b.expectedProfitExalted / b.estCostExalted
          : null;
      if (ar != null && br != null && ar !== br) return br - ar;
      if (ar != null && br == null) return -1;
      if (ar == null && br != null) return 1;
    }

    return (a.estCostExalted ?? Infinity) - (b.estCostExalted ?? Infinity);
  });
  return out;
}

export function methodSortLabel(mode: MethodSortMode): string {
  switch (mode) {
    case "profit":
      return "highest profit first";
    case "roi":
      return "best ROI first";
    default:
      return "cheapest first";
  }
}

export function topMethodBadge(mode: MethodSortMode): string {
  switch (mode) {
    case "profit":
      return "best profit";
    case "roi":
      return "best ROI";
    default:
      return "cheapest";
  }
}
