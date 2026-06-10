import "server-only";
import { searchBases } from "@/lib/data/queries";
import { getEligibleMods, getModPool } from "@/lib/data/queries";
import { groupByModGroup, modLabel } from "@/lib/data/format";
import { getPrices } from "@/lib/pricing/poe2scout";
import { getBasePrice } from "@/lib/trade/basePrice";
import { withTimeout } from "@/lib/trade/client";
import { buildModStatMap, type ModStatMap } from "@/lib/trade/modMap";
import { makePricer, recommendBases } from "@/lib/solver";
import { resolveFlux } from "@/lib/solver/flux";
import { buildSimSpecs } from "@/lib/solver/registry";
import {
  binomialQuantiles,
  buildSimPool,
  simulateMethod,
  SIM_METHODS,
  type SimMethodId,
  type SimMethodSpec,
  type SimTarget,
} from "@/lib/solver/simulate";
import { getComboStats, velocityAdjustedSale } from "./analytics";
import { listManualSales } from "./manual";
import {
  comboKeyFromGroups,
  getProbes,
  getProbeForGroups,
  probeCombo,
} from "./probes";

/**
 * "What should I craft?" — simulation-backed expected value.
 *
 * Sale side: targeted combo probes (exact supply, median ask, velocity) when
 * available, falling back to sample-derived medians. Cost side: Monte Carlo
 * simulation of candidate methods on the best base (real hit rates, average
 * currency consumption), live base purchase price, and resale value of
 * near-miss items (k-1 of k mods, valued via stored probes with a haircut).
 */

export interface Opportunity {
  itemClass: string;
  /** Sorted group key, unique per opportunity. */
  key: string;
  groups: string[];
  labels: string[];
  /* sale side */
  saleExalted: number;
  /** Sale price after the supply/velocity haircut (drives the profit math). */
  adjustedSaleExalted: number;
  /** Rough days to move one item given supply vs daily listing flow. */
  timeToSellDays: number | null;
  saleSource: "probe" | "sample";
  /** Matching online listings (probe-backed only). */
  supply: number | null;
  /** Listings added in the last day (probe-backed only). */
  velocity: number | null;
  saturated: boolean;
  confidence: "high" | "medium" | "low";
  /**
   * Probed live with ZERO matching listings: nothing to undercut, but no
   * proof of demand either — could sell instantly or not at all. Sale price
   * falls back to the sample median.
   */
  rareCombo: boolean;
  sampleCount: number;
  /* craft side */
  baseId: string;
  baseName: string;
  methodId: SimMethodId;
  methodName: string;
  /**
   * "exact": every target mod must hit (small combos). "keys-fillers": the
   * realistic large-combo route — lock/target the 2-3 rarest key mods
   * (essence when available) and grade the rest as whitelist fillers.
   */
  craftModel: "exact" | "keys-fillers";
  /** Display labels of the key mods (keys-fillers model only). */
  keyLabels: string[];
  /** Essence that locks the lead key mod, when one exists. */
  essenceName: string | null;
  /** P(keys all hit AND at most one filler missing) — a sellable item. */
  sellableRate: number;
  /** P(one base ends with every target mod). */
  hitRate: number;
  /** Suggested batch size (expected ≈ 2 hits). */
  basesCount: number;
  totalCostExalted: number;
  excludesBasePrice: boolean;
  /** Expected resale of near-miss items across the batch (after haircut). */
  nearMissResaleExalted: number;
  profitP10Exalted: number;
  profitP50Exalted: number;
  profitP90Exalted: number;
  craftHref: string;
  massHref: string;
}

const MAX_COMBOS_TO_SOLVE = 6;
/** Slots reserved for fresh sampler discoveries (they get live-verified). */
const SAMPLE_SLOTS = 2;
/** Live trade probes allowed per opportunities run (each ≈ 2 API calls). */
const PROBE_VERIFY_BUDGET = 3;
/** Probe data older than this is refreshed (budget allowing) and trusted less. */
const PROBE_STALE_MS = 24 * 60 * 60 * 1000;
const SIM_TRIALS = 1500;
/**
 * Methods given a simulation slot per combo. Specs come from the shared
 * registry, so prerequisite-gated methods (essence / desecration / fracture)
 * are only simulated when actually runnable on the combo's base.
 */
const CANDIDATE_METHODS: SimMethodId[] = [
  "alch-spam",
  "transmute-regal-exalt",
  "perfect-seed",
  "omen-exalt",
  "essence-omen-exalt",
  "fracture-omen-exalt",
  "desecrate-omen-exalt",
];
/** Ask haircut applied to near-miss resale (partial items sell slow/low). */
const NEAR_MISS_HAIRCUT = 0.6;
const SATURATION_SUPPLY = 150;

interface Candidate {
  key: string;
  groups: string[];
  labels: string[];
  /** Trade stat ids for this combo (enables live verification probes). */
  statIds: string[] | null;
  saleExalted: number;
  saleSource: "probe" | "sample";
  supply: number | null;
  velocity: number | null;
  sampleCount: number;
  /** When the backing probe was fetched (null for sample-only data). */
  fetchedAt: number | null;
  /** Live probe found zero listings (see Opportunity.rareCombo). */
  rare?: boolean;
}

/**
 * Confidence is earned, not assumed: a candidate is only "high" when its
 * sale price comes from a fresh order-book probe with enough listings to
 * trust the median AND at least one listing in the last day (real demand).
 */
function scoreConfidence(c: Candidate): "high" | "medium" | "low" {
  if (c.saleSource !== "probe") return "low";
  let score = 0;
  if (c.fetchedAt != null && Date.now() - c.fetchedAt <= PROBE_STALE_MS)
    score++;
  if ((c.supply ?? 0) >= 5) score++;
  if ((c.velocity ?? 0) >= 1) score++;
  return score >= 3 ? "high" : score >= 2 ? "medium" : "low";
}

function groupKey(groups: string[]): string {
  return [...groups].sort().join("+");
}

/** Probe-first candidate list, topped up with sample-derived combos. */
async function buildCandidates(opts: {
  league: string;
  itemClass: string;
  statMap: ModStatMap;
  labelByGroup: Map<string, string>;
}): Promise<{ candidates: Candidate[]; unmappedCombos: number }> {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  let unmappedCombos = 0;

  // 1) Targeted probes: exact supply + ask data.
  try {
    const probes = await getProbes(opts.league, opts.itemClass);
    for (const p of probes) {
      if (p.medianAskExalted == null || p.groups.length === 0) continue;
      const key = groupKey(p.groups);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key,
        groups: p.groups,
        labels: p.labels,
        statIds: comboKeyFromGroups(p.groups, opts.statMap.groupToStats)
          ?.statIds ?? null,
        saleExalted: p.medianAskExalted,
        saleSource: "probe",
        supply: p.listingCount,
        velocity: p.recentCount,
        sampleCount: p.listingCount,
        fetchedAt: p.fetchedAt,
      });
    }
  } catch {
    /* probes optional */
  }

  // 2) Sampler discoveries (random listings aggregated into combos).
  // Real items carry up to 6 explicits, so large combos are first-class:
  // exact 4-6 mod repeats are rare across random samples, hence minCount 2
  // (they get live-verified by a probe before being trusted anyway).
  try {
    const combosBySize = await getComboStats({
      league: opts.league,
      itemClass: opts.itemClass,
      sizes: [2, 3, 4, 5, 6],
      minCount: 2,
      limitPerSize: 10,
    });
    const combos = [
      ...(combosBySize.get(6) ?? []),
      ...(combosBySize.get(5) ?? []),
      ...(combosBySize.get(4) ?? []),
      ...(combosBySize.get(3) ?? []),
      ...(combosBySize.get(2) ?? []),
    ].sort((a, b) => b.medianExalted - a.medianExalted);
    for (const combo of combos) {
      const groups: string[] = [];
      let ok = true;
      for (const id of combo.statIds) {
        const g = opts.statMap.statToGroups.get(id)?.[0];
        if (!g) {
          ok = false;
          break;
        }
        if (!groups.includes(g)) groups.push(g);
      }
      if (!ok || groups.length === 0) {
        unmappedCombos++;
        continue;
      }
      const key = groupKey(groups);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key,
        groups,
        labels: groups.map((g) => opts.labelByGroup.get(g) ?? g),
        statIds: comboKeyFromGroups(groups, opts.statMap.groupToStats)
          ?.statIds ?? null,
        saleExalted: combo.medianExalted,
        saleSource: "sample",
        supply: null,
        velocity: null,
        sampleCount: combo.count,
        fetchedAt: null,
      });
    }
  } catch {
    /* samples optional */
  }

  // 3) Manual sale records: real, realized prices — the strongest "this
  // actually sells" signal you can get. Sales whose groups map onto the
  // class's craftable pool become candidates (median across repeats).
  try {
    const sales = await listManualSales(opts.league);
    const byKey = new Map<string, { groups: string[]; prices: number[] }>();
    for (const sale of sales) {
      if (sale.itemClass && sale.itemClass !== opts.itemClass) continue;
      if (sale.groups.length === 0) continue;
      if (!sale.groups.every((g) => opts.labelByGroup.has(g))) continue;
      const key = groupKey(sale.groups);
      const entry = byKey.get(key) ?? { groups: sale.groups, prices: [] };
      entry.prices.push(sale.priceExalted);
      byKey.set(key, entry);
    }
    for (const [key, entry] of byKey) {
      if (seen.has(key)) continue;
      seen.add(key);
      const sorted = [...entry.prices].sort((a, b) => a - b);
      out.push({
        key,
        groups: entry.groups,
        labels: entry.groups.map((g) => opts.labelByGroup.get(g) ?? g),
        statIds:
          comboKeyFromGroups(entry.groups, opts.statMap.groupToStats)
            ?.statIds ?? null,
        saleExalted: sorted[Math.floor(sorted.length / 2)],
        saleSource: "sample",
        supply: null,
        velocity: null,
        sampleCount: entry.prices.length,
        fetchedAt: null,
      });
    }
  } catch {
    /* manual sales optional */
  }

  out.sort((a, b) => b.saleExalted - a.saleExalted);
  return { candidates: out, unmappedCombos };
}

/**
 * Picks which combos get a simulation slot. Verified (probe-backed) combos
 * fill most slots; the top sampler discoveries get the rest, but each is
 * verified with a LIVE probe first (within a strict budget) so its sale
 * price reflects the actual order book. Phantom combos — high sample
 * medians with zero real listings — are discarded instead of displayed.
 * Stale probes are also refreshed from the same budget, oldest first.
 */
async function selectAndVerify(opts: {
  league: string;
  itemClass: string;
  candidates: Candidate[];
}): Promise<Candidate[]> {
  const probeBacked = opts.candidates.filter((c) => c.saleSource === "probe");
  const sampleOnly = opts.candidates.filter((c) => c.saleSource === "sample");

  const sampleSlots =
    probeBacked.length >= MAX_COMBOS_TO_SOLVE - SAMPLE_SLOTS
      ? SAMPLE_SLOTS
      : MAX_COMBOS_TO_SOLVE - probeBacked.length;

  let budget = PROBE_VERIFY_BUDGET;
  const verified: Candidate[] = [];

  // 1) Verify the best sampler discoveries against the live order book.
  for (const cand of sampleOnly) {
    if (verified.length >= sampleSlots) break;
    if (!cand.statIds || budget <= 0) {
      // Keep unverified only when there is no probe budget; it stays "low".
      if (budget <= 0) verified.push(cand);
      continue;
    }
    budget--;
    try {
      const probe = await withTimeout(
        probeCombo({
          league: opts.league,
          itemClass: opts.itemClass,
          groups: cand.groups,
          labels: cand.labels,
          statIds: cand.statIds,
          ttlMs: PROBE_STALE_MS,
        }),
        20000,
      );
      if (!probe) continue;
      if (probe.medianAskExalted == null || probe.listingCount === 0) {
        // Zero listings: not a phantom to hide, but a rare combo. Keep the
        // sample median as the only price signal and flag it explicitly.
        verified.push({
          ...cand,
          supply: 0,
          velocity: probe.recentCount,
          fetchedAt: probe.fetchedAt,
          rare: true,
        });
        continue;
      }
      verified.push({
        ...cand,
        saleExalted: probe.medianAskExalted,
        saleSource: "probe",
        supply: probe.listingCount,
        velocity: probe.recentCount,
        sampleCount: probe.listingCount,
        fetchedAt: probe.fetchedAt,
      });
    } catch {
      verified.push(cand); // probe failed (rate limit) — keep as low conf
      budget = 0; // stop spending on a struggling API
    }
  }

  // 2) Refresh the stalest probe-backed picks with the remaining budget.
  const picks = probeBacked.slice(0, MAX_COMBOS_TO_SOLVE - verified.length);
  const now = Date.now();
  const staleFirst = [...picks]
    .filter((c) => c.statIds && now - (c.fetchedAt ?? 0) > PROBE_STALE_MS)
    .sort((a, b) => (a.fetchedAt ?? 0) - (b.fetchedAt ?? 0));
  for (const cand of staleFirst) {
    if (budget <= 0) break;
    budget--;
    try {
      const probe = await withTimeout(
        probeCombo({
          league: opts.league,
          itemClass: opts.itemClass,
          groups: cand.groups,
          labels: cand.labels,
          statIds: cand.statIds!,
          ttlMs: PROBE_STALE_MS,
        }),
        20000,
      );
      if (probe?.medianAskExalted != null) {
        cand.saleExalted = probe.medianAskExalted;
        cand.supply = probe.listingCount;
        cand.velocity = probe.recentCount;
        cand.sampleCount = probe.listingCount;
        cand.fetchedAt = probe.fetchedAt;
      }
    } catch {
      break;
    }
  }

  return [...picks, ...verified].sort(
    (a, b) => b.saleExalted - a.saleExalted,
  );
}

/**
 * Stored-probe value of the (k-1)-subsets of a combo (no API calls). With
 * `dropGroups`, only subsets formed by dropping one of those groups are
 * considered (keys-fillers model: a near-miss never misses a key mod).
 */
async function nearMissValue(opts: {
  league: string;
  itemClass: string;
  groups: string[];
  statMap: ModStatMap;
  dropGroups?: string[];
}): Promise<number> {
  if (opts.groups.length < 2) return 0;
  const droppable = opts.dropGroups?.length
    ? opts.dropGroups
    : opts.groups;
  const values: number[] = [];
  for (const dropGroup of droppable) {
    const subset = opts.groups.filter((g) => g !== dropGroup);
    if (subset.length === opts.groups.length) continue;
    try {
      const probe = await getProbeForGroups({
        league: opts.league,
        itemClass: opts.itemClass,
        groups: subset,
        statIdsPerGroup: opts.statMap.groupToStats,
        maxAgeMs: 48 * 60 * 60 * 1000,
      });
      if (probe?.medianAskExalted != null) values.push(probe.medianAskExalted);
    } catch {
      /* subset probe missing */
    }
  }
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export async function getOpportunities(opts: {
  league: string;
  itemClass: string;
  itemLevel?: number;
  minSamples?: number;
  /** Pin the search to one specific base instead of auto-picking per combo. */
  baseId?: string | null;
}): Promise<{ opportunities: Opportunity[]; unmappedCombos: number }> {
  const itemLevel = opts.itemLevel ?? 82;

  // Class-wide stat <-> group mapping + display labels.
  const bases = await searchBases({ itemClass: opts.itemClass, limit: 500 });
  const pinnedBase = opts.baseId
    ? (bases.find((b) => b.id === opts.baseId) ?? null)
    : null;
  const tagSet = new Set<string>();
  for (const b of bases) for (const t of b.tags) tagSet.add(t);
  const classMods = await getEligibleMods([...tagSet], itemLevel);
  const statMap = await buildModStatMap(classMods);
  const labelByGroup = new Map<string, string>();
  for (const g of groupByModGroup(classMods)) {
    labelByGroup.set(g.group, modLabel(g.mods[0]));
  }

  const { candidates, unmappedCombos } = await buildCandidates({
    league: opts.league,
    itemClass: opts.itemClass,
    statMap,
    labelByGroup,
  });
  if (candidates.length === 0) return { opportunities: [], unmappedCombos };

  // Live currency prices for the simulator's cost model.
  let priceMap = new Map<string, number>();
  try {
    const prices = await getPrices(opts.league);
    priceMap = new Map(prices.items.map((i) => [i.apiId, i.priceExalted]));
  } catch {
    /* fallback prices */
  }
  const price = makePricer(priceMap);

  // Verify sampler discoveries against the live order book and refresh
  // stale probes before spending simulation time on them.
  const selected = await selectAndVerify({
    league: opts.league,
    itemClass: opts.itemClass,
    candidates,
  });

  const baseQuoteCache = new Map<string, number | null>();
  const opportunities: Opportunity[] = [];

  for (const cand of selected.slice(0, MAX_COMBOS_TO_SOLVE)) {
    try {
      // Pinned base, or the best base for this combo.
      let best: { baseId: string; baseName: string };
      if (pinnedBase) {
        best = { baseId: pinnedBase.id, baseName: pinnedBase.name };
      } else {
        const recs = await recommendBases(
          opts.itemClass,
          itemLevel,
          cand.groups,
          1,
        );
        const rec = recs[0];
        if (!rec || rec.missing.length > 0) continue;
        best = { baseId: rec.baseId, baseName: rec.baseName };
      }

      const pool = await getModPool(best.baseId, itemLevel);
      if (!pool) continue;
      const groupWeight = (mods: { weight: number }[]) =>
        mods.reduce((s, m) => s + m.weight, 0);
      const preGroups = new Map(
        groupByModGroup(pool.prefixes).map((g) => [
          g.group,
          groupWeight(g.mods),
        ]),
      );
      const sufGroups = new Map(
        groupByModGroup(pool.suffixes).map((g) => [
          g.group,
          groupWeight(g.mods),
        ]),
      );
      const preTotal = [...preGroups.values()].reduce((s, w) => s + w, 0);
      const sufTotal = [...sufGroups.values()].reduce((s, w) => s + w, 0);

      const targets: SimTarget[] = [];
      for (const g of cand.groups) {
        const side = preGroups.has(g)
          ? "prefix"
          : sufGroups.has(g)
            ? "suffix"
            : null;
        if (!side) continue;
        targets.push({ group: g, side, minLevel: 0 });
      }
      if (targets.length !== cand.groups.length) continue;

      // Spawn odds per target — rarest mods are the hardest to hit blind,
      // so they become the "keys" you lock/target first.
      const oddsOf = (t: SimTarget) => {
        const w =
          (t.side === "prefix" ? preGroups : sufGroups).get(t.group) ?? 0;
        const total = t.side === "prefix" ? preTotal : sufTotal;
        return total > 0 ? w / total : 0;
      };
      const byRarity = [...targets].sort((a, b) => oddsOf(a) - oddsOf(b));

      // Keys-fillers model for large combos: nobody slams 4-6 exact mods.
      // Lock/target the rarest 2-3 keys; grade the rest as fillers.
      const useKeysFillers = targets.length >= 4;
      const fillerTargets: SimTarget[] = [];
      if (useKeysFillers) {
        const keySet = new Set(byRarity.slice(0, 3).map((t) => t.group));
        for (const t of targets) {
          t.role = keySet.has(t.group) ? "key" : "filler";
          if (t.role === "filler") fillerTargets.push(t);
        }
      }

      // Flux conversion widens the acceptable resistance pool.
      const fluxPlan = resolveFlux(cand.groups);
      if (fluxPlan) {
        const t = targets.find((x) => x.group === fluxPlan.targetGroup);
        if (t) {
          const sideSet = t.side === "prefix" ? preGroups : sufGroups;
          const surrogates = fluxPlan.surrogateGroups.filter((g) =>
            sideSet.has(g),
          );
          if (surrogates.length > 0) t.altGroups = surrogates;
        }
      }

      // Live white-base price (cached per base across combos).
      let basePerBase = baseQuoteCache.get(best.baseId);
      if (basePerBase === undefined) {
        const quote = await withTimeout(
          getBasePrice({
            league: opts.league,
            baseType: best.baseName,
            rarity: "normal",
            ilvlMin: itemLevel,
            priceMap,
          }),
          15000,
        );
        basePerBase = quote?.priceExalted ?? null;
        baseQuoteCache.set(best.baseId, basePerBase);
      }

      // Simulate candidate methods; keep the best cost per SELLABLE item
      // (full hit, or all keys + at most one filler short). Specs come from
      // the shared method registry (same engine as the mass-craft planner).
      const simPool = buildSimPool(pool.prefixes, pool.suffixes);
      const bundle = await buildSimSpecs({ pool, targets, price });
      const methodSpecs: SimMethodSpec[] = CANDIDATE_METHODS.map((id) =>
        bundle.specs.get(id),
      ).filter((s): s is SimMethodSpec => s != null);
      let bestMethod: {
        spec: SimMethodSpec;
        hitRate: number;
        sellableRate: number;
        pNearMiss: number;
        costPerBase: number;
      } | null = null;
      // Larger target sets have tiny hit rates; more trials keep the
      // estimate resolvable (4+ mods would read as 0% at 1500 trials).
      const trials =
        targets.length >= 5
          ? SIM_TRIALS * 8
          : targets.length === 4
            ? SIM_TRIALS * 4
            : SIM_TRIALS;
      for (const spec of methodSpecs) {
        const sim = simulateMethod(simPool, targets, spec, { trials, price });
        const F = fillerTargets.length;
        const pFull = sim.fullHitRate;
        // Sellable = all keys + at most one filler missing. For exact
        // combos (no fillers) this collapses to the full hit rate.
        const pNearMiss =
          F > 0
            ? (sim.gradedRates[F - 1] ?? 0)
            : targets.length >= 2
              ? (sim.partialCounts[targets.length - 1] ?? 0)
              : 0;
        const sellableRate = F > 0 ? pFull + pNearMiss : pFull;
        if (sellableRate <= 0) continue;
        const costPerBase = sim.avgCurrencyCostExalted + (basePerBase ?? 0);
        const costPerSellable = costPerBase / sellableRate;
        if (
          !bestMethod ||
          costPerSellable <
            bestMethod.costPerBase / bestMethod.sellableRate
        ) {
          bestMethod = {
            spec,
            hitRate: pFull,
            sellableRate,
            pNearMiss,
            costPerBase,
          };
        }
      }
      if (!bestMethod) continue;

      const methodMeta = SIM_METHODS.find(
        (m) => m.id === bestMethod!.spec.id,
      )!;
      const hitRate = bestMethod.hitRate;
      // Batch sized so ~2 sellable items are expected, not 2 perfect ones.
      const basesCount = Math.min(
        500,
        Math.max(5, Math.ceil(2 / bestMethod.sellableRate)),
      );
      const batch = binomialQuantiles(basesCount, hitRate);
      const totalCost = basesCount * bestMethod.costPerBase;

      // Near-miss resale: keys always land (keys-fillers model), so the
      // subset dropped is a filler; probe-valued with a fallback fraction.
      let subsetValue = await nearMissValue({
        league: opts.league,
        itemClass: opts.itemClass,
        groups: cand.groups,
        statMap,
        dropGroups: useKeysFillers
          ? fillerTargets.map((t) => t.group)
          : undefined,
      });
      if (subsetValue <= 0 && useKeysFillers) {
        // No subset probes yet — assume a one-filler-short item keeps a
        // conservative 35% of the full combo's price.
        subsetValue = cand.saleExalted * 0.35;
      }
      const nearMissTotal =
        basesCount * bestMethod.pNearMiss * subsetValue * NEAR_MISS_HAIRCUT;

      // Asks are upper bounds — haircut revenue by how slow this market is.
      const velAdj = velocityAdjustedSale(
        cand.saleExalted,
        cand.supply,
        cand.velocity,
      );

      const profitAt = (hits: number) =>
        Math.round(hits * velAdj.adjustedExalted + nearMissTotal - totalCost);

      const confidence = scoreConfidence(cand);

      const groupsParam = encodeURIComponent(cand.groups.join(","));
      opportunities.push({
        itemClass: opts.itemClass,
        key: cand.key,
        groups: cand.groups,
        labels: cand.labels,
        saleExalted: cand.saleExalted,
        adjustedSaleExalted: Math.round(velAdj.adjustedExalted * 100) / 100,
        timeToSellDays: velAdj.timeToSellDays,
        saleSource: cand.saleSource,
        supply: cand.supply,
        velocity: cand.velocity,
        saturated: (cand.supply ?? 0) >= SATURATION_SUPPLY,
        confidence,
        rareCombo: cand.rare ?? false,
        sampleCount: cand.sampleCount,
        baseId: best.baseId,
        baseName: best.baseName,
        methodId: bestMethod.spec.id,
        methodName: methodMeta.name,
        craftModel: useKeysFillers ? "keys-fillers" : "exact",
        keyLabels: useKeysFillers
          ? targets
              .filter((t) => t.role !== "filler")
              .map((t) => labelByGroup.get(t.group) ?? t.group)
          : [],
        essenceName: bestMethod.spec.essence?.name ?? null,
        sellableRate: bestMethod.sellableRate,
        hitRate,
        basesCount,
        totalCostExalted: Math.round(totalCost),
        excludesBasePrice: basePerBase == null,
        nearMissResaleExalted: Math.round(nearMissTotal),
        profitP10Exalted: profitAt(batch.p10),
        profitP50Exalted: profitAt(batch.p50),
        profitP90Exalted: profitAt(batch.p90),
        craftHref: `/craft?mode=base&class=${encodeURIComponent(opts.itemClass)}&ilvl=${itemLevel}&base=${encodeURIComponent(best.baseId)}&groups=${groupsParam}`,
        massHref: `/craft?mode=mass&class=${encodeURIComponent(opts.itemClass)}&ilvl=${itemLevel}&base=${encodeURIComponent(best.baseId)}&groups=${groupsParam}&method=${bestMethod.spec.id}&n=${basesCount}`,
      });
    } catch {
      /* skip combos the simulator can't price */
    }
  }

  // Rank: verified opportunities first, then expected profit. An unverified
  // sample median should never outrank a probe-confirmed money-maker.
  const tier = { high: 2, medium: 1, low: 0 } as const;
  opportunities.sort((a, b) => {
    const t = tier[b.confidence] - tier[a.confidence];
    if (t !== 0) return t;
    if (a.saturated !== b.saturated) return a.saturated ? 1 : -1;
    return b.profitP50Exalted - a.profitP50Exalted;
  });
  return { opportunities, unmappedCombos };
}
