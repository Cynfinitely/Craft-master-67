# Profit-Craft Improvement Design

**Date:** 2026-06-14  
**Status:** Approved for implementation (brainstorming complete)  
**Goal:** Evolve PoE2 Crafting Helper from a cost-ranked planner into a **profit-first crafting advisor** for Trade league players seeking low-stress passive income.

---

## 1. Requirements Summary (from questionnaire)

### Confirmed answers (user)

| # | Question | Answer |
|---|----------|--------|
| 1 | League | Trade league (Softcore) |
| 3 | Primary goal | Low-stress passive income |
| 8 | Profit ranking | Show all three metrics; user toggles (profit/craft, profit/hour, ROI %) |
| 14 | Item classes | All craftable classes |
| 20 | Methods used | Essence+Desecrate+Double-Exalt, Fractured base, Mass slam, Snipe-and-finish, Essence-led |
| 35 | Auto-discovery | Both background scan while app open **and** manual Market Intel override |
| 47 | UI | Unified **Profit Dashboard** (merge Market + Opportunities) |
| 58 | Week-1 priority | **Better EV model** (sell probability + time) |

### Design assumptions (unanswered questions, aligned with passive-income profile)

| Topic | Assumption |
|-------|------------|
| Budget | 10–50 ex per session typical; support filtering by max batch cost |
| Brick tolerance | ≤15% acceptable; hide methods above 25% brick by default |
| Sale price | Median ask with velocity haircut (keep current model); add optional p25 undercut mode later |
| Time discount | Default 0.5 ex/day holding cost for passive ranking (configurable, off for raw profit/craft) |
| Near-misses | Sell at probe-derived subset price with 60% haircut (current behavior) |
| Base purchase | Include in total cost when trade quote available |
| Zero-supply combos | Show with "rare combo" badge; rank lower unless user enables "speculative" filter |
| Confidence | Default filter: medium+ ; low-confidence visible via toggle |
| Freshness | Currency prices ≤1h; probes stale after 24h (current) |
| Background API | Up to ~100 trade calls/day while app open; nightly CLI optional |
| Local-only | Single-user local app; no community probe sharing in v1 |
| Patch | 0.5 Return of the Ancients mechanics fully in scope |

---

## 2. Current State & Gaps

The app already has the core profit pipeline:

```
Market Intel (samples/probes) → Opportunities (Monte Carlo + sale EV) → Mass craft / Single plan
```

**Gaps blocking "find best profit crafts":**

1. **Cold start** — empty `market_samples` / `combo_probes` yields zero opportunities until manual Market Intel work.
2. **Fragmented UX** — user hops Market → Opportunities → Craft; no single profit view.
3. **Naive single-plan profit** — `expectedProfit = sale − cost` ignores hit rate, near-miss EV, and time-to-sell.
4. **Incomplete method simulation** — flagship Essence+Desecrate+Double-Exalt path not in `CANDIDATE_METHODS`; user's top methods underrepresented.
5. **Hard caps** — 6 combos / 3 probes per run limits discovery.
6. **Single ranking metric** — Opportunities sorts by p50 batch profit only; no profit/hour or ROI toggle.

---

## 3. Architectural Approaches Considered

### Approach A: EV Engine First (recommended)

Extract a shared **`ProfitEngine`** module that computes unified expected value for any craft target. Wire it into Opportunities, single-plan cards, and the new dashboard. Add background scanner as a thin scheduler on top.

**Pros:** Directly addresses week-1 priority; reduces duplicated math; incremental migration.  
**Cons:** Dashboard UX comes slightly later in the rollout.

### Approach B: Dashboard First

Merge Market + Opportunities UI immediately; keep existing math underneath.

**Pros:** Fast perceived improvement.  
**Cons:** Still cold-starts; misleading rankings until EV is fixed.

### Approach C: Scanner First

Build aggressive auto-discovery (scan all classes, 200+ API calls) before touching EV or UI.

**Pros:** Solves cold start quickly.  
**Cons:** Rate-limit pain; garbage rankings without better EV; not user's #1 priority.

### Recommendation

**Approach A**, phased:

| Phase | Deliverable | Weeks |
|-------|-------------|-------|
| 1 | Unified EV engine + ranking metrics | 1 |
| 2 | Profit Dashboard (merged UX) | 1–2 |
| 3 | Background scanner + expanded method sim | 2–3 |
| 4 | Snipe-first tab polish + watchlists | 3–4 |

---

## 4. Design: Unified EV Engine

### 4.1 Core formula

New module: `src/lib/market/profitEngine.ts`

```typescript
interface ProfitMetrics {
  // Batch-level (default batch = suggested basesCount)
  costExalted: number;
  grossSaleExalted: number;      // raw median ask
  adjustedSaleExalted: number;   // velocity haircut
  hitRate: number;               // P(all targets)
  sellableRate: number;          // P(≤1 filler short) for keys-fillers
  nearMissResaleExalted: number;
  profitPerCraftP50: number;
  profitPerCraftP10: number;
  profitPerCraftP90: number;
  roiPercent: number;            // profitP50 / cost × 100
  timeToSellDays: number | null;
  profitPerHour: number | null;  // profitP50 / (craftHours + sellDays×24)
  confidence: "high" | "medium" | "low";
  saleSource: "probe" | "sample" | "manual" | "mixed";
}
```

**Expected batch profit (p50):**

```
batchProfit = basesCount × (
  sellableRate × adjustedSale
  + hitRate × (adjustedSale − adjustedSale)  // already in sellable for exact model
  + nearMissEV
) − totalCost
```

For **exact** combos: `sellableRate === hitRate`.

For **keys-fillers**: use existing Opportunities logic (`sellableRate` includes one-filler-short items).

**Profit per hour:**

```
craftHoursPerBase = method-specific estimate (from sim avg currency steps × 30s)
totalHours = basesCount × craftHoursPerBase + timeToSellDays × 24
profitPerHour = profitP50 / totalHours
```

Default `craftHoursPerBase`: 2 min for essence paths, 5 min for fractured, 1 min for mass slam (constants in `profitEngine.ts`, tunable).

**Time discount (passive mode):**

```
adjustedProfitP50 = profitP50 − (timeToSellDays ?? 3) × holdingCostPerDay
```

Default `holdingCostPerDay = 0.5` ex; user setting stored in localStorage.

### 4.2 Refactor targets

| Consumer | Change |
|----------|--------|
| `opportunities.ts` | Call `computeProfitMetrics()` instead of inline math; sort by selected metric |
| `solver/index.ts` | Replace naive `expectedProfitExalted` with `profitEngine.estimateSingle()` when sale data exists |
| `PlanView.tsx` | Show sellable rate, adjusted sale, profit/hour alongside cost |
| `massCraft.ts` | Delegate p10/p50/p90 to profitEngine for consistency |

### 4.3 Ranking modes

User toggle (persisted in URL `?rank=craft|hour|roi` and localStorage):

| Mode | Sort key | Best for |
|------|----------|----------|
| Profit/craft | `profitPerCraftP50` | Batch planning |
| Profit/hour | `profitPerHour` (nulls last) | Passive income (default) |
| ROI % | `roiPercent` | Small-budget crafts |

Default for passive-income profile: **profit/hour**.

---

## 5. Design: Profit Dashboard

### 5.1 Route

New primary route: **`/profit`** (redirect `/opportunities` → `/profit` for bookmarks).

Market Intel content moves under `/profit` as tabs; `/market` redirects to `/profit?tab=market`.

### 5.2 Layout

```
┌─────────────────────────────────────────────────────────────┐
│ Profit Dashboard                          [League ▼] [iLvl] │
├─────────────────────────────────────────────────────────────┤
│ [Opportunities] [Market Data] [Snipes] [Manual Sales]       │
├─────────────────────────────────────────────────────────────┤
│ Rank: (•) Profit/hr  ( ) Profit/craft  ( ) ROI %             │
│ Filters: class ▼  base ▼  min confidence ▼  max batch cost  │
│ [Scan now]  [Background scan: ON ●]  progress bar           │
├─────────────────────────────────────────────────────────────┤
│ #1 Ring combo ...  +12ex  ·  +2.1ex/hr  ·  18% ROI  [Craft] │
│ #2 Amulet ...                                                   │
└─────────────────────────────────────────────────────────────┘
```

### 5.3 Opportunities tab (default)

- Reuses opportunity cards from `opportunities/page.tsx` with added metric columns.
- **Cross-class mode**: when no class selected, run lightweight scan across top 3 classes by sample count (configurable).
- Empty state: prominent **"Start background scan"** instead of "go to Market page".

### 5.4 Market Data tab

- Embeds current `market/page.tsx` content: sample controls, probe controls, combo tables, runic EV.
- Probe actions update opportunities cache immediately (invalidate + re-rank).

### 5.5 Snipes tab

- Existing `SnipePanel` unchanged; add profit/hour using finish planner EV.

### 5.6 Navigation

Update `SiteNav.tsx`: replace separate "Market Intel" + "Craft Opportunities" links with single **"Profit"** link. Home page feature list updated accordingly.

---

## 6. Design: Background Scanner

### 6.1 Module

`src/lib/market/scanner.ts`

Responsibilities:

1. Pick item classes to scan (user-selected or all with rotating priority).
2. For each class: run `sampleMarket()` if samples stale (>6h) OR probe top N combos from `getComboStats`.
3. Respect global rate budget: `SCAN_BUDGET_PER_HOUR = 30` trade API calls.
4. Persist scan state in SQLite table `scan_jobs` (new).

### 6.2 Trigger modes

| Mode | Trigger | Implementation |
|------|---------|----------------|
| Manual | "Scan now" button | POST `/api/market/scan` |
| Background | App open + toggle ON | Client heartbeat every 5 min → `/api/market/scan?mode=incremental` |
| CLI | Nightly cron | Extend `scripts/sample-market.ts` → `npm run market:scan` |

### 6.3 Schema addition

```sql
CREATE TABLE scan_jobs (
  id TEXT PRIMARY KEY,
  league TEXT NOT NULL,
  item_class TEXT,
  status TEXT NOT NULL,  -- pending|running|done|failed
  combos_probed INTEGER DEFAULT 0,
  samples_added INTEGER DEFAULT 0,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  error TEXT
);
```

### 6.4 Incremental discovery

Replace fixed `MAX_COMBOS_TO_SOLVE = 6` with:

- **Warm pool**: all probed combos in last 24h (unlimited read from DB).
- **Per-run simulation budget**: 12 combos (up from 6).
- **Per-run probe budget**: 8 (up from 3), shared with scanner hourly cap.

Prioritize combos by: `(sample median × sample count) / estimated cost` heuristic before full sim.

---

## 7. Design: Method Simulation Expansion

Add to `SimMethodId` and `registry.ts`:

| Method ID | Name | Maps to user method |
|-----------|------|---------------------|
| `essence-desec-double-exalt` | Essence → Desecrate → Double-Exalt | Flagship path |
| `fractured-finish` | Fractured base → finish | Fractured (buy cost from trade) |
| `buy-magic-regal` | Buy magic + Regal | Snipe-adjacent |

Update `CANDIDATE_METHODS` in `opportunities.ts` to include user methods in priority order:

```typescript
const CANDIDATE_METHODS: SimMethodId[] = [
  "essence-desec-double-exalt",
  "essence-omen-exalt",
  "fracture-omen-exalt",
  "desecrate-omen-exalt",
  "fractured-finish",
  "perfect-seed",
  "alch-spam",
  "transmute-regal-exalt",
];
```

Simulation steps for `essence-desec-double-exalt`:

1. Essence guarantee on hardest key mod (from registry essence resolution).
2. Desecrate + reveal best desecrated mod matching second target (Monte Carlo over desec pool).
3. Double-exalt with Omen of Greater Exaltation on remaining open slots.

Reuse step logic from `solver/index.ts` `buildMethods` where possible; extract shared step sequences into `registry.ts`.

---

## 8. Design: Single-Plan Profit Upgrade

When `PlanView` renders a method card:

**Before:** `expectedProfit = sale − cost`

**After:**

```
profit = sellableRate × adjustedSale + nearMissEV − cost
roi = profit / cost
profitPerHour = profit / (craftMinutes/60 + sellDays×24)
```

Show badge: "Low confidence" when sale source is sample-only.

Add **"Don't craft"** warning when `profitP50 < 0` or `roi < 5%` after haircut.

---

## 9. Design: User Preferences

New localStorage keys (`profit-prefs`):

```typescript
interface ProfitPrefs {
  rankMode: "craft" | "hour" | "roi";
  holdingCostPerDay: number;       // default 0.5
  minConfidence: "low" | "medium" | "high";
  maxBatchCostExalted: number | null;
  hideHighBrick: boolean;          // default true, threshold 25%
  backgroundScanEnabled: boolean;
  showSpeculativeCombos: boolean;  // zero-supply
}
```

Expose in `ProfitControls` client component.

---

## 10. Error Handling & Edge Cases

| Case | Behavior |
|------|----------|
| No market data | Show onboarding card; auto-start scan if background enabled |
| Rate limit hit | Pause scanner; show "resumes in Xm"; use stale cache |
| Unmapped combo | Skip sim; increment counter; show in "unmapped" expandable section |
| poe2scout down | Fallback prices (existing); badge "stale currency prices" |
| profitPerHour null | No time data; sort nulls last; show "—" in UI |
| SSF / no trade | Hide profit dashboard tabs that need trade API; show message |

---

## 11. Testing Strategy

| Area | Tests |
|------|-------|
| `profitEngine.ts` | Unit tests: exact combo EV, keys-fillers sellable rate, ROI, profit/hour with known inputs |
| `scanner.ts` | Mock trade client; verify budget respected |
| `opportunities.ts` | Integration: ranking order changes with rank mode |
| Regression | Existing `tests/solver.test.ts` still pass |

New file: `tests/profitEngine.test.ts`

---

## 12. Out of Scope (v1)

- Community-shared probe data
- Real sold-item API (doesn't exist for PoE2)
- Mobile-native UI (responsive web only)
- CSV manual sales import (v2)
- Watchlist price alerts (v2, after dashboard stable)
- Alloy-led method simulation (hand-curated; v2)

---

## 13. Success Criteria

1. User opens `/profit` with **zero prior Market Intel** → background scan populates data within 10 minutes.
2. Opportunity cards show **profit/hour, profit/craft, ROI** with toggle; default sort is profit/hour.
3. Single-plan cards show **sellable-rate-adjusted profit**, not naive sale − cost.
4. Flagship **Essence+Desecrate+Double-Exalt** appears in opportunity method picks when applicable.
5. Market + Opportunities accessible from **one page** without navigation hops.

---

## 14. File Map (new / modified)

| File | Action |
|------|--------|
| `src/lib/market/profitEngine.ts` | **Create** — unified EV |
| `src/lib/market/scanner.ts` | **Create** — background discovery |
| `src/app/api/market/scan/route.ts` | **Create** — scan endpoint |
| `src/app/profit/page.tsx` | **Create** — dashboard |
| `src/components/profit/ProfitControls.tsx` | **Create** — rank/filters/prefs |
| `src/components/profit/OpportunityList.tsx` | **Create** — extracted from opportunities page |
| `src/db/schema.ts` | **Modify** — `scan_jobs` table |
| `src/lib/market/opportunities.ts` | **Modify** — use profitEngine, expand budgets |
| `src/lib/solver/simulate.ts` | **Modify** — new method IDs |
| `src/lib/solver/registry.ts` | **Modify** — flagship method spec |
| `src/lib/solver/index.ts` | **Modify** — single-plan profit |
| `src/components/craft/PlanView.tsx` | **Modify** — rich profit display |
| `src/components/SiteNav.tsx` | **Modify** — nav links |
| `src/app/opportunities/page.tsx` | **Modify** — redirect to `/profit` |
| `src/app/market/page.tsx` | **Modify** — redirect to `/profit?tab=market` |
| `tests/profitEngine.test.ts` | **Create** |

---

## 15. Approval

This design incorporates user questionnaire answers and recommended Approach A (EV Engine First). Ready for implementation plan.
