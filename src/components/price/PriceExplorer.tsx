"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { PoeLeague, PriceData, PricedItem } from "@/lib/pricing/poe2scout";

function fmt(n: number): string {
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (n >= 10) return n.toFixed(1);
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(3);
}

export function PriceExplorer({
  leagues,
  data,
  focus,
}: {
  leagues: PoeLeague[];
  data: PriceData;
  focus?: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState(focus ?? "");
  const [cart, setCart] = useState<Record<string, number>>({});

  const byName = useMemo(
    () => new Map(data.items.map((i) => [i.name, i])),
    [data.items],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return data.items;
    return data.items.filter((i) => i.name.toLowerCase().includes(needle));
  }, [q, data.items]);

  const toDivine = (exalted: number) =>
    data.divinePrice > 0 ? exalted / data.divinePrice : 0;

  const addToCart = (item: PricedItem, delta = 1) => {
    setCart((c) => {
      const next = { ...c };
      const v = (next[item.name] ?? 0) + delta;
      if (v <= 0) delete next[item.name];
      else next[item.name] = v;
      return next;
    });
  };

  const cartEntries = Object.entries(cart);
  const totalExalted = cartEntries.reduce((sum, [name, qty]) => {
    const item = byName.get(name);
    return sum + (item ? item.priceExalted * qty : 0);
  }, 0);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_minmax(280px,360px)]">
      <div className="space-y-3">
        <div className="panel flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
          <select
            className="input sm:max-w-[16rem]"
            value={data.league}
            onChange={(e) =>
              router.push(`/price?league=${encodeURIComponent(e.target.value)}`)
            }
          >
            {leagues.map((l) => (
              <option key={l.value} value={l.value}>
                {l.value}
                {l.isCurrent ? " (current)" : ""}
              </option>
            ))}
          </select>
          <input
            className="input"
            placeholder="Search currency (e.g. divine, chaos)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        {data.stale ? (
          <div className="panel border-forge-rust/60 bg-forge-rust/10 p-3 text-xs text-forge-goldbright/80">
            Showing the last cached prices — live data could not be refreshed.
          </div>
        ) : null}

        <div className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-forge-border px-4 py-2 text-xs text-forge-gold/50">
            <span>
              {filtered.length} items · prices in Exalted Orbs · 1 Divine ≈{" "}
              {fmt(data.divinePrice)} Exalted
            </span>
          </div>
          <div className="max-h-[64vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-forge-panel text-left text-xs text-forge-gold/50">
                <tr>
                  <th className="px-4 py-2 font-medium">Currency</th>
                  <th className="px-2 py-2 text-right font-medium">Exalted</th>
                  <th className="px-2 py-2 text-right font-medium">Divine</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-forge-border/40">
                {filtered.map((i) => {
                  const highlight =
                    focus && i.name.toLowerCase() === focus.toLowerCase();
                  return (
                    <tr
                      key={`${i.category}:${i.apiId}`}
                      className={highlight ? "bg-forge-rust/15" : ""}
                    >
                      <td className="px-4 py-1.5 text-forge-goldbright/90">
                        {i.name}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-forge-gold/80">
                        {fmt(i.priceExalted)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-forge-gold/50">
                        {toDivine(i.priceExalted) >= 0.01
                          ? fmt(toDivine(i.priceExalted))
                          : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <button
                          type="button"
                          className="rounded border border-forge-border px-1.5 text-xs text-forge-gold/70 hover:border-forge-gold/60 hover:text-forge-goldbright"
                          onClick={() => addToCart(i)}
                          title="Add to cost calculator"
                        >
                          +
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="panel p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-forge-gold/70">
            Cost calculator
          </h2>
          <p className="mt-1 text-xs text-forge-gold/50">
            Add currencies and quantities to estimate a crafting budget.
          </p>

          {cartEntries.length === 0 ? (
            <p className="mt-4 text-sm text-forge-gold/40">
              Use the + buttons to add currency here.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {cartEntries.map(([name, qty]) => {
                const item = byName.get(name);
                return (
                  <li
                    key={name}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span className="flex-1 text-forge-goldbright/90">
                      {name}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="rounded border border-forge-border px-1.5 text-forge-gold/70 hover:text-forge-goldbright"
                        onClick={() => item && addToCart(item, -1)}
                      >
                        −
                      </button>
                      <span className="w-8 text-center tabular-nums">{qty}</span>
                      <button
                        type="button"
                        className="rounded border border-forge-border px-1.5 text-forge-gold/70 hover:text-forge-goldbright"
                        onClick={() => item && addToCart(item, 1)}
                      >
                        +
                      </button>
                    </div>
                    <span className="w-16 text-right tabular-nums text-forge-gold/60">
                      {item ? fmt(item.priceExalted * qty) : "?"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {cartEntries.length > 0 ? (
            <div className="mt-4 border-t border-forge-border pt-3 text-sm">
              <div className="flex justify-between">
                <span className="text-forge-gold/60">Total (Exalted)</span>
                <span className="font-semibold text-forge-goldbright tabular-nums">
                  {fmt(totalExalted)}
                </span>
              </div>
              <div className="mt-1 flex justify-between">
                <span className="text-forge-gold/60">Total (Divine)</span>
                <span className="text-forge-gold/80 tabular-nums">
                  {fmt(toDivine(totalExalted))}
                </span>
              </div>
              <button
                type="button"
                className="btn mt-3 w-full"
                onClick={() => setCart({})}
              >
                Clear
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
