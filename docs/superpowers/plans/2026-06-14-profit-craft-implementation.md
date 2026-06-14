# Profit-Craft Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the app into a profit-first crafting advisor with unified EV math, a merged Profit Dashboard, background market scanning, and expanded method simulation.

**Architecture:** Extract `profitEngine.ts` as the single source of profit truth; refactor Opportunities and single-plan cards to consume it. Add `scanner.ts` for incremental market discovery. New `/profit` route merges Market Intel + Opportunities with rank-mode toggle (profit/hour default).

**Tech Stack:** Next.js 14 App Router, TypeScript, SQLite/Drizzle, existing trade client + Monte Carlo simulator.

**Design spec:** [docs/superpowers/specs/2026-06-14-profit-craft-design.md](../specs/2026-06-14-profit-craft-design.md)

---

## File Map

| File | Responsibility |
|------|----------------|
| `src/lib/market/profitEngine.ts` | Unified EV: batch profit, ROI, profit/hour, time discount |
| `src/lib/market/scanner.ts` | Background/incremental sample + probe orchestration |
| `src/app/api/market/scan/route.ts` | HTTP trigger for scanner |
| `src/app/profit/page.tsx` | Profit Dashboard shell + tabs |
| `src/components/profit/ProfitControls.tsx` | Rank mode, filters, background scan toggle |
| `src/components/profit/OpportunityList.tsx` | Ranked opportunity cards |
| `src/db/schema.ts` | `scan_jobs` table |
| `src/lib/market/opportunities.ts` | Delegate to profitEngine; raise budgets |
| `src/lib/solver/simulate.ts` | New `SimMethodId` values |
| `src/lib/solver/registry.ts` | Flagship method spec builder |
| `src/lib/solver/index.ts` | Single-plan profit via profitEngine |
| `src/components/craft/PlanView.tsx` | Rich profit metrics on method cards |
| `tests/profitEngine.test.ts` | Unit tests for EV math |

---

## Phase 1: Unified EV Engine (Week 1 — user priority)

### Task 1: Profit engine types and core batch EV

**Files:**
- Create: `src/lib/market/profitEngine.ts`
- Create: `tests/profitEngine.test.ts`

- [ ] **Step 1: Write failing tests for exact-combo batch profit**

```typescript
// tests/profitEngine.test.ts
import { describe, it, expect } from "vitest";
import { computeBatchProfit } from "@/lib/market/profitEngine";

describe("computeBatchProfit", () => {
  it("computes p50 profit for exact combo with near-miss resale", () => {
    const result = computeBatchProfit({
      basesCount: 10,
      hitRate: 0.08,
      sellableRate: 0.08,
      adjustedSaleExalted: 40,
      totalCostExalted: 200,
      nearMissResaleExalted: 15,
      craftMinutesPerBase: 2,
      timeToSellDays: 2,
    });
    // hits ≈ 0.8 → gross 32, nearMiss ≈ 15, cost 200 → p50 ≈ -153
    expect(result.profitPerCraftP50).toBeCloseTo(-15.3, 0);
    expect(result.roiPercent).toBeLessThan(0);
    expect(result.profitPerHour).not.toBeNull();
  });

  it("computes profit per hour with craft + sell time", () => {
    const result = computeBatchProfit({
      basesCount: 5,
      hitRate: 0.2,
      sellableRate: 0.25,
      adjustedSaleExalted: 50,
      totalCostExalted: 100,
      nearMissResaleExalted: 0,
      craftMinutesPerBase: 2,
      timeToSellDays: 1,
    });
    // 1 hit × 50 = 50 revenue, cost 100 → profit -50 → -10/craft
    expect(result.profitPerCraftP50).toBeCloseTo(-10, 0);
    const craftHours = (5 * 2) / 60;
    const totalHours = craftHours + 24;
    expect(result.profitPerHour).toBeCloseTo(-50 / totalHours, 1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/profitEngine.test.ts`  
Expected: FAIL — module not found

- [ ] **Step 3: Implement `computeBatchProfit` and `ProfitMetrics` type**

```typescript
// src/lib/market/profitEngine.ts
import { binomialQuantiles } from "@/lib/solver/simulate";

export interface BatchProfitInput {
  basesCount: number;
  hitRate: number;
  sellableRate: number;
  adjustedSaleExalted: number;
  totalCostExalted: number;
  nearMissResaleExalted: number;
  craftMinutesPerBase: number;
  timeToSellDays: number | null;
  holdingCostPerDay?: number;
}

export interface ProfitMetrics {
  profitPerCraftP50: number;
  profitPerCraftP10: number;
  profitPerCraftP90: number;
  roiPercent: number;
  profitPerHour: number | null;
  adjustedProfitP50: number;
  totalBatchProfitP50: number;
}

export function computeBatchProfit(input: BatchProfitInput): ProfitMetrics {
  const n = input.basesCount;
  const { p10, p50, p90 } = binomialQuantiles(n, input.sellableRate);
  const revenueAt = (hits: number) =>
    hits * input.adjustedSaleExalted + input.nearMissResaleExalted;
  const profitAt = (hits: number) => revenueAt(hits) - input.totalCostExalted;

  const profitP50 = profitAt(p50);
  const profitP10 = profitAt(p10);
  const profitP90 = profitAt(p90);
  const profitPerCraftP50 = profitP50 / n;
  const roiPercent =
    input.totalCostExalted > 0
      ? (profitP50 / input.totalCostExalted) * 100
      : 0;

  const craftHours = (n * input.craftMinutesPerBase) / 60;
  const sellHours = (input.timeToSellDays ?? 0) * 24;
  const totalHours = craftHours + sellHours;
  const profitPerHour =
    totalHours > 0 ? profitP50 / totalHours : null;

  const holding = (input.holdingCostPerDay ?? 0) * (input.timeToSellDays ?? 0);

  return {
    profitPerCraftP50,
    profitPerCraftP10: profitP10 / n,
    profitPerCraftP90: profitP90 / n,
    roiPercent,
    profitPerHour,
    adjustedProfitP50: profitP50 - holding,
    totalBatchProfitP50: profitP50,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/profitEngine.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/market/profitEngine.ts tests/profitEngine.test.ts
git commit -m "feat: add unified profit engine with batch EV metrics"
```

---

### Task 2: Wire profitEngine into opportunities.ts

**Files:**
- Modify: `src/lib/market/opportunities.ts`
- Modify: `src/lib/market/opportunities.ts` — export `RankMode` type

- [ ] **Step 1: Replace inline p10/p50/p90 profit math with `computeBatchProfit`**

In the opportunity builder (where `profitP50Exalted` is currently computed), call:

```typescript
import { computeBatchProfit } from "./profitEngine";

const metrics = computeBatchProfit({
  basesCount,
  hitRate,
  sellableRate,
  adjustedSaleExalted: adjustedSale,
  totalCostExalted: totalCost,
  nearMissResaleExalted: nearMissResale,
  craftMinutesPerBase: methodCraftMinutes[methodId] ?? 2,
  timeToSellDays,
  holdingCostPerDay: 0.5,
});
```

Map `metrics.profitPerCraftP50` → `profitP50Exalted`, etc.

Add to `Opportunity` interface:

```typescript
roiPercent: number;
profitPerHour: number | null;
adjustedProfitP50: number;
```

- [ ] **Step 2: Add `rankOpportunities(opps, mode: RankMode)` helper**

```typescript
export type RankMode = "craft" | "hour" | "roi";

export function rankOpportunities(
  opps: Opportunity[],
  mode: RankMode,
): Opportunity[] {
  const sorted = [...opps];
  const key = (o: Opportunity) => {
    if (mode === "hour") return o.profitPerHour ?? -Infinity;
    if (mode === "roi") return o.roiPercent;
    return o.profitP50Exalted;
  };
  sorted.sort((a, b) => key(b) - key(a));
  return sorted;
}
```

- [ ] **Step 3: Run existing tests**

Run: `npm test`  
Expected: PASS (no regressions)

- [ ] **Step 4: Commit**

```bash
git add src/lib/market/opportunities.ts
git commit -m "refactor: opportunities use unified profit engine"
```

---

### Task 3: Single-plan profit upgrade

**Files:**
- Modify: `src/lib/solver/index.ts`
- Modify: `src/components/craft/PlanView.tsx`

- [ ] **Step 1: Add `estimateSinglePlanProfit` to profitEngine.ts**

```typescript
export interface SinglePlanProfitInput {
  costExalted: number;
  saleExalted: number;
  adjustedSaleExalted: number;
  hitRate: number;
  sellableRate: number;
  nearMissResaleExalted: number;
  craftMinutes: number;
  timeToSellDays: number | null;
}

export function estimateSinglePlanProfit(
  input: SinglePlanProfitInput,
): ProfitMetrics {
  return computeBatchProfit({
    basesCount: 1,
    hitRate: input.hitRate,
    sellableRate: input.sellableRate,
    adjustedSaleExalted: input.adjustedSaleExalted,
    totalCostExalted: input.costExalted,
    nearMissResaleExalted: input.nearMissResaleExalted,
    craftMinutesPerBase: input.craftMinutes,
    timeToSellDays: input.timeToSellDays,
  });
}
```

- [ ] **Step 2: In solver/index.ts, replace naive `expectedProfitExalted`**

When sale estimate exists, use sellableRate from a lightweight sim (or default hitRate for display) and call `estimateSinglePlanProfit`. Set `expectedProfitExalted` to `metrics.profitPerCraftP50`.

- [ ] **Step 3: Update PlanView.tsx to show ROI and profit/hour**

Add lines under existing profit display:

```tsx
{method.roiPercent != null && (
  <span className="text-xs text-forge-gold/55">
    {method.roiPercent.toFixed(0)}% ROI
    {method.profitPerHour != null &&
      ` · ${formatCost(method.profitPerHour, divinePrice)}/hr`}
  </span>
)}
```

Extend `CraftMethod` type in `types.ts` with optional `roiPercent`, `profitPerHour`.

- [ ] **Step 4: Manual smoke test**

Run: `npm run dev`  
Navigate to `/craft`, pick a base + mods, verify method cards show adjusted profit.

- [ ] **Step 5: Commit**

```bash
git add src/lib/market/profitEngine.ts src/lib/solver/index.ts src/lib/solver/types.ts src/components/craft/PlanView.tsx
git commit -m "feat: single-plan profit uses sellable-rate EV"
```

---

## Phase 2: Profit Dashboard

### Task 4: Profit Dashboard page and controls

**Files:**
- Create: `src/app/profit/page.tsx`
- Create: `src/components/profit/ProfitControls.tsx`
- Create: `src/components/profit/OpportunityList.tsx`
- Modify: `src/components/SiteNav.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Extract opportunity list JSX from `opportunities/page.tsx` into `OpportunityList.tsx`**

Props: `opportunities`, `divinePrice`, `itemLevel`, `rankMode`.

Display all three metrics; highlight active rank mode column.

- [ ] **Step 2: Create `ProfitControls.tsx`**

Client component with:
- Tab switcher: `opportunities | market | snipes | manual`
- Rank mode radio: craft / hour / roi (URL param `rank`, localStorage backup)
- Class/base/ilvl selects (reuse pattern from OpportunityControls)
- Background scan toggle

- [ ] **Step 3: Create `src/app/profit/page.tsx`**

Server component composing:
- `ProfitControls`
- Tab content: opportunities (default), market embed, snipes, manual sales
- Pass `rankMode` from searchParams to `getOpportunities` → `rankOpportunities`

- [ ] **Step 4: Update navigation**

In `SiteNav.tsx`, replace Market + Opportunities links with single "Profit" → `/profit`.

Update home `FEATURES` array similarly.

- [ ] **Step 5: Add redirects**

`src/app/opportunities/page.tsx`:

```typescript
import { redirect } from "next/navigation";
export default function OpportunitiesRedirect({ searchParams }) {
  const qs = new URLSearchParams(searchParams as Record<string, string>).toString();
  redirect(`/profit${qs ? `?${qs}` : ""}`);
}
```

Same pattern for `/market` → `/profit?tab=market`.

- [ ] **Step 6: Commit**

```bash
git add src/app/profit src/components/profit src/components/SiteNav.tsx src/app/page.tsx src/app/opportunities/page.tsx src/app/market/page.tsx
git commit -m "feat: unified Profit Dashboard at /profit"
```

---

## Phase 3: Background Scanner

### Task 5: Scan jobs schema and scanner module

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/db/ensure.ts`
- Create: `src/lib/market/scanner.ts`

- [ ] **Step 1: Add `scan_jobs` table to schema.ts**

```typescript
export const scanJobs = sqliteTable("scan_jobs", {
  id: text("id").primaryKey(),
  league: text("league").notNull(),
  itemClass: text("item_class"),
  status: text("status").notNull(),
  combosProbed: integer("combos_probed").default(0),
  samplesAdded: integer("samples_added").default(0),
  startedAt: integer("started_at").notNull(),
  finishedAt: integer("finished_at"),
  error: text("error"),
});
```

- [ ] **Step 2: Implement `runIncrementalScan` in scanner.ts**

```typescript
export async function runIncrementalScan(opts: {
  league: string;
  itemClass?: string | null;
  probeBudget: number;
  onProgress?: (msg: string) => void;
}): Promise<{ probed: number; sampled: number }> {
  // 1. If samples stale, call sampleMarket for class
  // 2. getComboStats → pick top unprobed combos
  // 3. probeCombo up to probeBudget
  // 4. Write scan_jobs row
}
```

Reuse `sampleMarket` from `sampler.ts` and `probeCombo` from `probes.ts`.

- [ ] **Step 3: Create API route `src/app/api/market/scan/route.ts`**

POST body: `{ league, itemClass?, mode: "full" | "incremental" }`  
Returns `{ probed, sampled, jobId }`  
Uses existing progress job pattern from `api/market/sample/route.ts`.

- [ ] **Step 4: Wire background toggle in ProfitControls**

When enabled, `useEffect` interval 5 min → fetch POST `/api/market/scan?mode=incremental`.

- [ ] **Step 5: Raise opportunity budgets in opportunities.ts**

```typescript
const MAX_COMBOS_TO_SOLVE = 12;
const PROBE_VERIFY_BUDGET = 8;
```

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts src/db/ensure.ts src/lib/market/scanner.ts src/app/api/market/scan/route.ts src/lib/market/opportunities.ts src/components/profit/ProfitControls.tsx
git commit -m "feat: background market scanner with incremental probes"
```

---

### Task 6: CLI scan script

**Files:**
- Create: `scripts/scan-market.ts`
- Modify: `package.json`

- [ ] **Step 1: Add script**

```typescript
// scripts/scan-market.ts
import { runIncrementalScan } from "../src/lib/market/scanner";
const league = process.argv[2] ?? "Standard";
runIncrementalScan({ league, probeBudget: 50 }).then(console.log);
```

- [ ] **Step 2: Add npm script**

```json
"market:scan": "tsx scripts/scan-market.ts"
```

- [ ] **Step 3: Commit**

```bash
git add scripts/scan-market.ts package.json
git commit -m "feat: CLI market scan for nightly cron"
```

---

## Phase 4: Method Simulation Expansion

### Task 7: Flagship Essence+Desecrate+Double-Exalt sim method

**Files:**
- Modify: `src/lib/solver/simulate.ts`
- Modify: `src/lib/solver/registry.ts`
- Modify: `src/lib/market/opportunities.ts`

- [ ] **Step 1: Add `essence-desec-double-exalt` to SimMethodId and SIM_METHODS**

- [ ] **Step 2: Implement sim steps in simulate.ts**

Sequence: essence lock → desecrate reveal (pick best matching desec mod from pool) → omen double-exalt fill.

Follow patterns from existing `desecrate-omen-exalt` and `essence-omen-exalt` handlers in `simulateMethod`.

- [ ] **Step 3: Add spec builder in registry.ts**

`buildSimSpecs` returns spec when essence + bone + omen prerequisites met.

- [ ] **Step 4: Add to CANDIDATE_METHODS (first position)**

- [ ] **Step 5: Add test in tests/solver.test.ts**

Verify method runs without throw on Ring + life/res combo fixture.

- [ ] **Step 6: Commit**

```bash
git add src/lib/solver/simulate.ts src/lib/solver/registry.ts src/lib/market/opportunities.ts tests/solver.test.ts
git commit -m "feat: simulate flagship essence-desec-double-exalt method"
```

---

### Task 8: Fractured-finish method (buy cost included)

**Files:**
- Modify: `src/lib/solver/simulate.ts`
- Modify: `src/lib/solver/registry.ts`

- [ ] **Step 1: Add `fractured-finish` SimMethodId**

Sim assumes fractured key mod present; steps = annul junk → essence/crystallisation finish.

- [ ] **Step 2: In opportunities builder, add fractured base purchase cost from getBasePrice when method is fractured-finish**

- [ ] **Step 3: Commit**

```bash
git add src/lib/solver/simulate.ts src/lib/solver/registry.ts src/lib/market/opportunities.ts
git commit -m "feat: fractured-finish method with base purchase cost"
```

---

## Phase 5: Polish & Verification

### Task 9: User preferences and filters

**Files:**
- Create: `src/lib/market/profitPrefs.ts`
- Modify: `src/components/profit/ProfitControls.tsx`
- Modify: `src/lib/market/opportunities.ts`

- [ ] **Step 1: Implement profitPrefs load/save (localStorage)**

- [ ] **Step 2: Filter opportunities by minConfidence, maxBatchCost, hideHighBrick**

- [ ] **Step 3: Commit**

```bash
git add src/lib/market/profitPrefs.ts src/components/profit/ProfitControls.tsx src/lib/market/opportunities.ts
git commit -m "feat: profit preferences and opportunity filters"
```

---

### Task 10: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`  
Expected: ALL PASS

- [ ] **Step 2: Run production build**

Run: `npm run build`  
Expected: SUCCESS

- [ ] **Step 3: Manual acceptance checklist**

1. `/profit` loads with rank toggle defaulting to profit/hour
2. Background scan toggle triggers progress bar
3. `/opportunities` redirects to `/profit`
4. Single-plan shows ROI + profit/hour
5. Flagship method appears in opportunity results for essence-viable combos

- [ ] **Step 4: Update README.md**

Add Profit Dashboard section and `npm run market:scan` to scripts table.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: document Profit Dashboard and market scan"
```

---

## Spec Coverage Checklist

| Spec requirement | Task |
|------------------|------|
| Unified EV formula | Task 1, 2, 3 |
| Profit/hour + ROI + profit/craft toggle | Task 2, 4 |
| Profit Dashboard | Task 4 |
| Background scanner | Task 5, 6 |
| Expanded method sim | Task 7, 8 |
| Single-plan profit upgrade | Task 3 |
| User preferences | Task 9 |
| Redirects from old routes | Task 4 |
| Tests | Task 1, 7, 10 |

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-14-profit-craft-implementation.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
