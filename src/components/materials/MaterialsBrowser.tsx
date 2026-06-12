"use client";

import { useMemo, useState } from "react";
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

const TABS: { id: TabId; label: string }[] = [
  { id: "essentials", label: "Crafting essentials" },
  { id: "league", label: "League materials" },
  { id: "gems", label: "Gems & other" },
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

export function MaterialsBrowser({ catalog }: { catalog: MaterialsCatalog }) {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<TabId>("essentials");

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
      return (
        filtered.essenceRows.length +
        filtered.currencyRows.length +
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

  const tabBtn = (id: TabId, label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`flex-1 rounded px-3 py-1.5 text-sm transition-colors ${
        tab === id
          ? "bg-forge-rust/30 text-forge-goldbright"
          : "text-forge-gold/70 hover:text-forge-goldbright"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="panel flex flex-col gap-2 p-4 sm:flex-row">
        <input
          className="input"
          placeholder="Search materials (e.g. life, fire resistance, exalted)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="flex gap-1 rounded-md border border-forge-border bg-forge-panel2 p-1">
        {TABS.map((t) => tabBtn(t.id, t.label))}
      </div>

      <p className="text-xs text-forge-gold/40">{tabCount} materials in view</p>

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
            <div className="panel p-8 text-center text-forge-gold/50">
              No materials match your search.
            </div>
          ) : null}
        </div>
      ) : tab === "league" ? (
        filtered.leagueGroups.length === 0 ? (
          <div className="panel p-8 text-center text-forge-gold/50">
            No league materials match your search.
          </div>
        ) : (
          <LeagueAccordion groups={filtered.leagueGroups} />
        )
      ) : filtered.gemsGroups.length === 0 ? (
        <div className="panel p-8 text-center text-forge-gold/50">
          No gems or other items match your search.
        </div>
      ) : (
        <LeagueAccordion groups={filtered.gemsGroups} />
      )}
    </div>
  );
}
