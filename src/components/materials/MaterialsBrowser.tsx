"use client";

import { useMemo, useState } from "react";

export type MaterialTier = "Lesser" | "Normal" | "Greater" | "Perfect";

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

const TIER_STYLES: Record<MaterialTier, string> = {
  Lesser: "bg-zinc-700/60 text-zinc-200",
  Normal: "bg-sky-900/50 text-sky-200",
  Greater: "bg-violet-900/50 text-violet-200",
  Perfect: "bg-amber-800/50 text-amber-200",
};

function formatPrice(p: number | null): string | null {
  if (p == null) return null;
  if (p >= 1000) return `${(p / 1000).toFixed(1)}k ex`;
  if (p >= 10) return `${Math.round(p)} ex`;
  if (p >= 1) return `${p.toFixed(1)} ex`;
  return `${p.toFixed(2)} ex`;
}

/**
 * Minimum modifier level a tiered currency guarantees (PoE2 "Rise of the
 * Abyssal"): Greater = 35 / Perfect = 50 for Exalt/Chaos/Regal; Greater = 55 /
 * Perfect = 70 for Transmute/Augment; Perfect essences = 50; Ancient bones = 40.
 */
function minModLevel(name: string): number | null {
  const greater = /\bgreater\b/i.test(name);
  const perfect = /\bperfect\b/i.test(name);
  const transAug = /transmutation|augmentation/i.test(name);
  if (/\bancient\b/i.test(name) && /jawbone|rib|collarbone|cranium/i.test(name))
    return 40;
  if (perfect && /essence/i.test(name)) return 50;
  if (greater) return transAug ? 55 : 35;
  if (perfect) return transAug ? 70 : 50;
  return null;
}

function MaterialCard({ m }: { m: MaterialView }) {
  const price = formatPrice(m.priceExalted);
  return (
    <div className="panel flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          {m.iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={m.iconUrl}
              alt=""
              width={32}
              height={32}
              className="mt-0.5 h-8 w-8 shrink-0"
              loading="lazy"
            />
          ) : null}
          <div>
            <h3 className="font-semibold leading-tight text-rarity-currency">
              {m.name}
            </h3>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {m.tier ? (
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${TIER_STYLES[m.tier]}`}
                >
                  {m.tier}
                </span>
              ) : null}
              {minModLevel(m.name) != null ? (
                <span className="rounded bg-violet-900/50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-200">
                  min mod lvl {minModLevel(m.name)}
                </span>
              ) : null}
              {m.maxStackSize ? (
                <span className="text-[10px] text-forge-gold/40">
                  stack {m.maxStackSize}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        {price ? (
          <span className="shrink-0 rounded bg-forge-black/40 px-2 py-0.5 text-xs font-semibold text-rarity-currency">
            {price}
          </span>
        ) : null}
      </div>

      {m.effect.length > 0 ? (
        <ul className="space-y-0.5 text-sm text-forge-goldbright/90">
          {m.effect.map((line, i) => (
            <li key={i} className={i === 0 ? "" : "pl-2 text-forge-gold/70"}>
              {line}
            </li>
          ))}
        </ul>
      ) : m.description ? (
        <p className="text-sm text-forge-goldbright/90">{m.description}</p>
      ) : null}
    </div>
  );
}

export function MaterialsBrowser({ groups }: { groups: MaterialGroup[] }) {
  const [q, setQ] = useState("");
  const [label, setLabel] = useState<string>("all");

  const labels = useMemo(() => groups.map((g) => g.label), [groups]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return groups
      .filter((g) => label === "all" || g.label === label)
      .map((g) => ({
        label: g.label,
        items: g.items.filter((m) => {
          if (!needle) return true;
          return (
            m.name.toLowerCase().includes(needle) ||
            m.effect.some((e) => e.toLowerCase().includes(needle)) ||
            (m.description?.toLowerCase().includes(needle) ?? false)
          );
        }),
      }))
      .filter((g) => g.items.length > 0);
  }, [groups, q, label]);

  const total = useMemo(
    () => filtered.reduce((n, g) => n + g.items.length, 0),
    [filtered],
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
        <select
          className="input sm:max-w-[18rem]"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        >
          <option value="all">All categories</option>
          {labels.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <p className="text-xs text-forge-gold/40">{total} materials</p>

      {filtered.length === 0 ? (
        <div className="panel p-8 text-center text-forge-gold/50">
          No materials match your search.
        </div>
      ) : (
        filtered.map((g) => (
          <section key={g.label}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-forge-gold/70">
              {g.label}{" "}
              <span className="text-forge-gold/30">({g.items.length})</span>
            </h2>
            <div className="grid gap-3 md:grid-cols-2">
              {g.items.map((m) => (
                <MaterialCard key={m.apiId} m={m} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
