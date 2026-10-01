"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { MaterialTier } from "@/lib/materials/source";
import {
  CurrencyTierTable,
  EssenceMatrixTable,
  LeagueAccordion,
  MaterialListTable,
} from "./MaterialsTable";

export type MaterialTierView = MaterialTier;

export interface MaterialView {
  apiId: string;
  name: string;
  label: string;
  tier: MaterialTier | null;
  effect: string[];
  description: string | null;
  iconUrl: string | null;
  stackSize: number | null;
  maxStackSize: number | null;
  priceExalted: number | null;
}

export interface MaterialGroup {
  label: string;
  items: MaterialView[];
}

export interface TierCellData {
  apiId: string;
  name: string;
  effect: string[];
  priceExalted: number | null;
}

export interface MaterialsCatalog {
  essenceRows: {
    family: string;
    tiers: Partial<Record<MaterialTier, TierCellData>>;
  }[];
  currencyRows: {
    family: string;
    tiers: Partial<Record<MaterialTier, TierCellData>>;
  }[];
  currencyMisc: MaterialView[];
  omens: MaterialView[];
  runes: MaterialView[];
  soulCores: MaterialView[];
  leagueGroups: MaterialGroup[];
  gemsGroups: MaterialGroup[];
}

type TabId = "essentials" | "league" | "gems";

const DEFAULT_TAB: TabId = "essentials";

function isTabId(v: string | null): v is TabId {
  return v === "essentials" || v === "league" || v === "gems";
}

const TABS: { value: TabId; label: string }[] = [
  { value: "essentials", label: "Crafting essentials" },
  { value: "league", label: "League materials" },
  { value: "gems", label: "Gems & other" },
];

function matchesSearch(m: MaterialView, needle: string): boolean {
  return (
    m.name.toLowerCase().includes(needle) ||
    m.effect.some((e) => e.toLowerCase().includes(needle)) ||
    (m.description?.toLowerCase().includes(needle) ?? false)
  );
}

function filterItems(items: MaterialView[], needle: string): MaterialView[] {
  if (!needle) return items;
  return items.filter((m) => matchesSearch(m, needle));
}

function filterGroups(
  groups: MaterialGroup[],
  needle: string,
): MaterialGroup[] {
  if (!needle) return groups;
  return groups
    .map((g) => ({
      label: g.label,
      items: g.items.filter((m) => matchesSearch(m, needle)),
    }))
    .filter((g) => g.items.length > 0);
}

/**
 * Material browser. With `syncUrl`, the search query and tab are read from and
 * written to the URL (`?q=…&tab=…`) so a filtered view can be shared or
 * restored; that variant uses useSearchParams and must sit inside Suspense.
 */
export function MaterialsBrowser({
  catalog,
  syncUrl = false,
}: {
  catalog: MaterialsCatalog;
  syncUrl?: boolean;
}) {
  return syncUrl ? (
    <UrlSyncedBrowser catalog={catalog} />
  ) : (
    <BrowserView catalog={catalog} initialQ="" initialTab={DEFAULT_TAB} />
  );
}

function UrlSyncedBrowser({ catalog }: { catalog: MaterialsCatalog }) {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  return (
    <BrowserView
      catalog={catalog}
      initialQ={searchParams.get("q") ?? ""}
      initialTab={isTabId(tabParam) ? tabParam : DEFAULT_TAB}
      syncUrl
    />
  );
}

function BrowserView({
  catalog,
  initialQ,
  initialTab,
  syncUrl = false,
}: {
  catalog: MaterialsCatalog;
  initialQ: string;
  initialTab: TabId;
  syncUrl?: boolean;
}) {
  const [q, setQ] = useState(initialQ);
  const [tab, setTab] = useState<TabId>(initialTab);
  const router = useRouter();
  const pathname = usePathname();

  // Mirror q (debounced) and tab into the URL without adding history entries.
  useEffect(() => {
    if (!syncUrl) return;
    const t = setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const trimmed = q.trim();
      if (trimmed) params.set("q", trimmed);
      else params.delete("q");
      if (tab !== DEFAULT_TAB) params.set("tab", tab);
      else params.delete("tab");
      const next = params.toString();
      if (next === window.location.search.replace(/^\?/, "")) return;
      router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
    }, 300);
    return () => clearTimeout(t);
  }, [q, tab, syncUrl, router, pathname]);

  const needle = q.trim().toLowerCase();

  const priceMap = useMemo(() => {
    const entries: [string, number | null][] = [];
    for (const row of catalog.essenceRows) {
      for (const m of Object.values(row.tiers)) {
        if (m) entries.push([m.apiId, m.priceExalted]);
      }
    }
    for (const row of catalog.currencyRows) {
      for (const m of Object.values(row.tiers)) {
        if (m) entries.push([m.apiId, m.priceExalted]);
      }
    }
    return new Map(entries);
  }, [catalog]);

  const filtered = useMemo(() => {
    const essenceRows = needle
      ? catalog.essenceRows.filter((row) => {
          const familyMatch = row.family.toLowerCase().includes(needle);
          const tierMatch = Object.values(row.tiers).some(
            (m) =>
              m &&
              (m.name.toLowerCase().includes(needle) ||
                m.effect.some((e) => e.toLowerCase().includes(needle))),
          );
          return familyMatch || tierMatch;
        })
      : catalog.essenceRows;

    const currencyRows = needle
      ? catalog.currencyRows.filter((row) => {
          const familyMatch = row.family.toLowerCase().includes(needle);
          const tierMatch = Object.values(row.tiers).some((m) =>
            m?.name.toLowerCase().includes(needle),
          );
          return familyMatch || tierMatch;
        })
      : catalog.currencyRows;

    return {
      essenceRows,
      currencyRows,
      currencyMisc: filterItems(catalog.currencyMisc, needle),
      omens: filterItems(catalog.omens, needle),
      runes: filterItems(catalog.runes, needle),
      soulCores: filterItems(catalog.soulCores, needle),
      leagueGroups: filterGroups(catalog.leagueGroups, needle),
      gemsGroups: filterGroups(catalog.gemsGroups, needle),
    };
  }, [catalog, needle]);

  const tabCount = useMemo(() => {
    if (tab === "essentials") {
      // Tier rows hold one material per present tier; count the materials.
      const tierItems = (rows: MaterialsCatalog["essenceRows"]) =>
        rows.reduce((n, row) => n + Object.values(row.tiers).filter(Boolean).length, 0);
      return (
        tierItems(filtered.essenceRows) +
        tierItems(filtered.currencyRows) +
        filtered.currencyMisc.length +
        filtered.omens.length +
        filtered.runes.length +
        filtered.soulCores.length
      );
    }
    if (tab === "league") {
      return filtered.leagueGroups.reduce((n, g) => n + g.items.length, 0);
    }
    return filtered.gemsGroups.reduce((n, g) => n + g.items.length, 0);
  }, [filtered, tab]);

  return (
    <div className="space-y-4">
      <div className="panel flex flex-col gap-2 p-4 sm:flex-row">
        <Field label="Search materials" srOnlyLabel className="w-full">
          <input
            type="search"
            className="input"
            placeholder="Search materials (e.g. life, fire resistance, exalted)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </Field>
      </div>

      <SegmentedControl
        value={tab}
        onChange={setTab}
        options={TABS}
        label="Material category"
        shortLabels={{
          essentials: "Essentials",
          league: "League",
          gems: "Gems",
        }}
      />

      <p role="status" aria-live="polite" className="text-xs text-forge-muted">
        <span className="num">{tabCount}</span>{" "}
        {tabCount === 1 ? "material" : "materials"} in view
      </p>

      {tab === "essentials" ? (
        <div className="space-y-6">
          <EssenceMatrixTable rows={filtered.essenceRows} prices={priceMap} />
          <CurrencyTierTable rows={filtered.currencyRows} prices={priceMap} />
          <MaterialListTable
            title="Other currency"
            items={filtered.currencyMisc}
          />
          <MaterialListTable title="Omens" items={filtered.omens} />
          <MaterialListTable title="Runes" items={filtered.runes} />
          <MaterialListTable title="Soul cores" items={filtered.soulCores} />
          {tabCount === 0 ? (
            <EmptyState title="No materials match your search">
              Try a different name or effect, or check the other categories.
            </EmptyState>
          ) : null}
        </div>
      ) : tab === "league" ? (
        filtered.leagueGroups.length === 0 ? (
          <EmptyState title="No league materials match your search">
            Try a different name or effect, or check the other categories.
          </EmptyState>
        ) : (
          <LeagueAccordion groups={filtered.leagueGroups} query={needle} />
        )
      ) : filtered.gemsGroups.length === 0 ? (
        <EmptyState title="No gems or other items match your search">
          Try a different name or effect, or check the other categories.
        </EmptyState>
      ) : (
        <LeagueAccordion groups={filtered.gemsGroups} query={needle} />
      )}
    </div>
  );
}
