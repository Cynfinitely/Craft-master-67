"use client";

import type { MaterialTier } from "@/lib/materials/source";
import type { MaterialView } from "./MaterialsBrowser";

const TIER_COLUMNS: MaterialTier[] = [
  "Lesser",
  "Normal",
  "Greater",
  "Perfect",
];

const TIER_STYLES: Record<MaterialTier, string> = {
  Lesser: "bg-zinc-700/60 text-zinc-200",
  Normal: "bg-sky-900/50 text-sky-200",
  Greater: "bg-violet-900/50 text-violet-200",
  Perfect: "bg-amber-800/50 text-amber-200",
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

function TierCell({ m }: { m: MaterialView | undefined }) {
  if (!m) {
    return <td className="px-2 py-2 text-center text-forge-gold/25">—</td>;
  }
  const summary = effectSummary(m);
  return (
    <td className="px-2 py-2 align-top">
      <div
        className="group relative rounded border border-forge-border/40 bg-forge-panel2/40 px-2 py-1.5"
        title={summary || m.name}
      >
        <div className="text-xs font-medium text-rarity-currency leading-tight">
          {m.name.replace(/^(Lesser |Greater |Perfect )/, "")}
        </div>
        <div className="mt-0.5 text-[10px] font-semibold text-forge-gold/70">
          {formatPrice(m.priceExalted)}
        </div>
        {summary ? (
          <div className="pointer-events-none absolute left-0 top-full z-10 mt-1 hidden max-w-xs rounded border border-forge-border bg-forge-panel p-2 text-[10px] text-forge-gold/80 shadow-lg group-hover:block">
            {summary}
          </div>
        ) : null}
      </div>
    </td>
  );
}

export function EssenceMatrixTable({
  rows,
  prices,
}: {
  rows: {
    family: string;
    tiers: Partial<
      Record<
        MaterialTier,
        { apiId: string; name: string; effect: string[]; priceExalted: number | null }
      >
    >;
  }[];
  prices: Map<string, number | null>;
}) {
  if (rows.length === 0) return null;
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-forge-gold/70">
        Essences{" "}
        <span className="text-forge-gold/30">({rows.length} families)</span>
      </h2>
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead>
            <tr className="border-b border-forge-border text-forge-gold/55">
              <th className="sticky left-0 bg-forge-panel px-3 py-2 font-semibold">
                Family
              </th>
              {TIER_COLUMNS.map((t) => (
                <th key={t} className="px-2 py-2 text-center font-semibold">
                  <span
                    className={`inline-block rounded px-1.5 py-0.5 text-[10px] uppercase ${TIER_STYLES[t]}`}
                  >
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
                {TIER_COLUMNS.map((tier) => {
                  const raw = row.tiers[tier];
                  const m: MaterialView | undefined = raw
                    ? ({
                        apiId: raw.apiId,
                        name: raw.name,
                        label: "Essences",
                        tier,
                        effect: raw.effect,
                        description: null,
                        iconUrl: null,
                        stackSize: null,
                        maxStackSize: null,
                        priceExalted: raw.priceExalted ?? prices.get(raw.apiId) ?? null,
                      } as MaterialView)
                    : undefined;
                  return <TierCell key={tier} m={m} />;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function CurrencyTierTable({
  rows,
  prices,
}: {
  rows: {
    family: string;
    tiers: Partial<
      Record<
        MaterialTier,
        { apiId: string; name: string; effect: string[]; priceExalted: number | null }
      >
    >;
  }[];
  prices: Map<string, number | null>;
}) {
  if (rows.length === 0) return null;
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-forge-gold/70">
        Tiered currency
      </h2>
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead>
            <tr className="border-b border-forge-border text-forge-gold/55">
              <th className="sticky left-0 bg-forge-panel px-3 py-2 font-semibold">
                Orb family
              </th>
              {TIER_COLUMNS.map((t) => (
                <th key={t} className="px-2 py-2 text-center font-semibold">
                  <span
                    className={`inline-block rounded px-1.5 py-0.5 text-[10px] uppercase ${TIER_STYLES[t]}`}
                  >
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
                {TIER_COLUMNS.map((tier) => {
                  const raw = row.tiers[tier];
                  const m: MaterialView | undefined = raw
                    ? ({
                        apiId: raw.apiId,
                        name: raw.name,
                        label: "Currency",
                        tier,
                        effect: raw.effect,
                        description: null,
                        iconUrl: null,
                        stackSize: null,
                        maxStackSize: null,
                        priceExalted: raw.priceExalted ?? prices.get(raw.apiId) ?? null,
                      } as MaterialView)
                    : undefined;
                  return <TierCell key={tier} m={m} />;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
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
        <span className="text-forge-gold/30">
          ({count ?? items.length})
        </span>
      </h2>
      <div className="panel overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-forge-border text-forge-gold/55">
              <th className="px-3 py-2 font-semibold">Name</th>
              <th className="px-3 py-2 font-semibold">Effect</th>
              <th className="px-3 py-2 text-right font-semibold">Price</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-forge-border/30">
            {items.map((m) => (
              <tr key={m.apiId} className="hover:bg-forge-panel2/30">
                <td className="px-3 py-2 font-medium text-rarity-currency">
                  {m.name}
                </td>
                <td className="max-w-md px-3 py-2 text-forge-gold/75">
                  {effectSummary(m) || "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-forge-gold/80">
                  {formatPrice(m.priceExalted)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
          <summary className="cursor-pointer list-none px-4 py-2.5 text-sm font-semibold text-forge-gold/80 hover:text-forge-goldbright [&::-webkit-details-marker]:hidden">
            <span className="mr-2 text-forge-gold/40 group-open:rotate-90 inline-block transition-transform">
              ▸
            </span>
            {g.label}{" "}
            <span className="text-forge-gold/30">({g.items.length})</span>
          </summary>
          <div className="border-t border-forge-border/50 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-forge-border/40 text-forge-gold/55">
                  <th className="px-4 py-2 font-semibold">Name</th>
                  <th className="px-3 py-2 font-semibold">Effect</th>
                  <th className="px-3 py-2 text-right font-semibold">Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-forge-border/30">
                {g.items.map((m) => (
                  <tr key={m.apiId} className="hover:bg-forge-panel2/30">
                    <td className="px-4 py-2 font-medium text-rarity-currency">
                      {m.name}
                    </td>
                    <td className="max-w-md px-3 py-2 text-forge-gold/75">
                      {effectSummary(m) || "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-forge-gold/80">
                      {formatPrice(m.priceExalted)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </div>
  );
}
