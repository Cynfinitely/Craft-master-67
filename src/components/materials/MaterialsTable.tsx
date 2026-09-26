"use client";

import { useState } from "react";
import type { MaterialTier } from "@/lib/materials/source";
import type { MaterialView } from "./MaterialsBrowser";

const TIER_COLUMNS: MaterialTier[] = [
  "Lesser",
  "Normal",
  "Greater",
  "Perfect",
];

const TIER_STYLES: Record<MaterialTier, string> = {
  Lesser: "bg-forge-panel2 text-forge-gold/70",
  Normal: "bg-forge-rust/20 text-forge-goldbright",
  Greater: "bg-forge-gold/15 text-forge-goldbright",
  Perfect: "bg-forge-rust/35 text-forge-goldbright",
};

function formatPrice(p: number | null): string {
  if (p == null) return "—";
  if (p >= 1000) return `${(p / 1000).toFixed(1)}k ex`;
  if (p >= 10) return `${Math.round(p)} ex`;
  if (p >= 1) return `${p.toFixed(1)} ex`;
  return `${p.toFixed(2)} ex`;
}

function effectSummary(m: MaterialView): string {
  if (m.effect.length > 0) return m.effect[0];
  return m.description ?? "";
}

type TierRow = {
  family: string;
  tiers: Partial<
    Record<
      MaterialTier,
      { apiId: string; name: string; effect: string[]; priceExalted: number | null }
    >
  >;
};

function toView(
  row: TierRow,
  tier: MaterialTier,
  label: string,
  prices: Map<string, number | null>,
): MaterialView | undefined {
  const raw = row.tiers[tier];
  if (!raw) return undefined;
  return {
    apiId: raw.apiId,
    name: raw.name,
    label,
    tier,
    effect: raw.effect,
    description: null,
    iconUrl: null,
    stackSize: null,
    maxStackSize: null,
    priceExalted: raw.priceExalted ?? prices.get(raw.apiId) ?? null,
  } as MaterialView;
}

/** Tier chip; tapping reveals the effect inline so it works without hover. */
function TierChip({ m, tier }: { m: MaterialView | undefined; tier?: MaterialTier }) {
  const [open, setOpen] = useState(false);
  if (!m) {
    return <div className="px-2 py-1.5 text-center text-forge-gold/25">—</div>;
  }
  const summary = effectSummary(m);
  return (
    <button
      type="button"
      className="block w-full rounded border border-forge-border/40 bg-forge-panel2/40 px-2 py-1.5 text-left disabled:cursor-default"
      title={summary || m.name}
      aria-expanded={summary ? open : undefined}
      disabled={!summary}
      onClick={() => setOpen((v) => !v)}
    >
      {tier ? (
        <span className={`mb-1 inline-block rounded px-1 text-[9px] uppercase ${TIER_STYLES[tier]}`}>
          {tier}
        </span>
      ) : null}
      <span className="block text-xs font-medium leading-tight text-rarity-currency">
        {m.name.replace(/^(Lesser |Greater |Perfect )/, "")}
      </span>
      <span className="mt-0.5 block text-[10px] font-semibold text-forge-gold/70">
        {formatPrice(m.priceExalted)}
      </span>
      {open && summary ? (
        <span className="mt-1 block border-t border-forge-border/40 pt-1 text-[11px] text-forge-gold/80">
          {summary}
        </span>
      ) : null}
    </button>
  );
}

function TierMatrix({
  title,
  familyLabel,
  itemLabel,
  rows,
  prices,
}: {
  title: React.ReactNode;
  familyLabel: string;
  itemLabel: string;
  rows: TierRow[];
  prices: Map<string, number | null>;
}) {
  if (rows.length === 0) return null;
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-forge-gold/70">
        {title}
      </h2>

      <ul className="space-y-2 sm:hidden">
        {rows.map((row) => (
          <li key={row.family} className="panel p-3">
            <p className="mb-2 text-sm font-semibold text-forge-goldbright">{row.family}</p>
            <div className="grid grid-cols-2 gap-2">
              {TIER_COLUMNS.map((tier) => (
                <TierChip key={tier} tier={tier} m={toView(row, tier, itemLabel, prices)} />
              ))}
            </div>
          </li>
        ))}
      </ul>

      <div className="panel hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead>
            <tr className="border-b border-forge-border text-forge-gold/55">
              <th className="sticky left-0 bg-forge-panel px-3 py-2 font-semibold">{familyLabel}</th>
              {TIER_COLUMNS.map((t) => (
                <th key={t} className="px-2 py-2 text-center font-semibold">
                  <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] uppercase ${TIER_STYLES[t]}`}>
                    {t}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-forge-border/30">
            {rows.map((row) => (
              <tr key={row.family} className="hover:bg-forge-panel2/30">
                <td className="sticky left-0 bg-forge-panel px-3 py-2 font-medium text-forge-goldbright">
                  {row.family}
                </td>
                {TIER_COLUMNS.map((tier) => (
                  <td key={tier} className="px-2 py-2 align-top">
                    <TierChip m={toView(row, tier, itemLabel, prices)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function EssenceMatrixTable({
  rows,
  prices,
}: {
  rows: TierRow[];
  prices: Map<string, number | null>;
}) {
  return (
    <TierMatrix
      title={
        <>
          Essences <span className="text-forge-gold/80">({rows.length} families)</span>
        </>
      }
      familyLabel="Family"
      itemLabel="Essences"
      rows={rows}
      prices={prices}
    />
  );
}

export function CurrencyTierTable({
  rows,
  prices,
}: {
  rows: TierRow[];
  prices: Map<string, number | null>;
}) {
  return (
    <TierMatrix
      title="Tiered currency"
      familyLabel="Orb family"
      itemLabel="Currency"
      rows={rows}
      prices={prices}
    />
  );
}

function MaterialRows({ items, firstCellPad = "px-3" }: { items: MaterialView[]; firstCellPad?: string }) {
  return (
    <table className="w-full text-left text-xs">
      <thead>
        <tr className="border-b border-forge-border/40 text-forge-gold/55">
          <th className={`${firstCellPad} py-2 font-semibold`}>Name</th>
          <th className="hidden px-3 py-2 font-semibold sm:table-cell">Effect</th>
          <th className="px-3 py-2 text-right font-semibold">Price</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-forge-border/30">
        {items.map((m) => (
          <tr key={m.apiId} className="align-top hover:bg-forge-panel2/30">
            <td className={`${firstCellPad} py-2`}>
              <span className="font-medium text-rarity-currency">{m.name}</span>
              <span className="mt-0.5 block text-[11px] text-forge-gold/75 sm:hidden">
                {effectSummary(m) || "—"}
              </span>
            </td>
            <td className="hidden max-w-md px-3 py-2 text-forge-gold/75 sm:table-cell">
              {effectSummary(m) || "—"}
            </td>
            <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-forge-gold/80">
              {formatPrice(m.priceExalted)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function MaterialListTable({
  title,
  items,
  count,
}: {
  title: string;
  items: MaterialView[];
  count?: number;
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-forge-gold/70">
        {title}{" "}
        <span className="text-forge-gold/80">({count ?? items.length})</span>
      </h2>
      <div className="panel overflow-x-auto">
        <MaterialRows items={items} />
      </div>
    </section>
  );
}

export function LeagueAccordion({
  groups,
}: {
  groups: { label: string; items: MaterialView[] }[];
}) {
  if (groups.length === 0) return null;
  return (
    <div className="space-y-2">
      {groups.map((g) => (
        <details key={g.label} className="panel group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center px-4 py-2.5 text-sm font-semibold text-forge-gold/80 hover:text-forge-goldbright [&::-webkit-details-marker]:hidden">
            <span className="mr-2 inline-block text-forge-gold/80 transition-transform group-open:rotate-90">
              ▸
            </span>
            {g.label}{" "}
            <span className="ml-1 text-forge-gold/80">({g.items.length})</span>
          </summary>
          <div className="overflow-x-auto border-t border-forge-border/50">
            <MaterialRows items={g.items} firstCellPad="px-4" />
          </div>
        </details>
      ))}
    </div>
  );
}
