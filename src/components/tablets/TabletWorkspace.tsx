"use client";

import { useEffect, useMemo, useState } from "react";
import type { TabletCatalogEntry } from "@/lib/tablets/logic";
import {
  comboIsConfirmed,
  comboMeetsMinimum,
  packComboRegex,
  STASH_REGEX_LIMIT,
  thresholdToExalted,
  type PriceCurrency,
} from "@/lib/tablets/logic";
import type { TabletComboView } from "@/lib/tablets/view";

function fmtChaos(value: number | null, chaosExalted: number): string {
  if (value == null || chaosExalted <= 0) return "—";
  const chaos = value / chaosExalted;
  if (chaos >= 100) return `${Math.round(chaos)}c`;
  if (chaos >= 10) return `${chaos.toFixed(1)}c`;
  return `${chaos.toFixed(2)}c`;
}

function fmtDiv(value: number | null, divinePrice: number): string {
  if (value == null || divinePrice <= 0) return "—";
  return `${(value / divinePrice).toFixed(2)} div`;
}

const PRESETS: { id: string; label: string; amount: string; currency: PriceCurrency }[] = [
  { id: "5c", label: "5c", amount: "5", currency: "chaos" },
  { id: "10c", label: "10c", amount: "10", currency: "chaos" },
  { id: "1d", label: "1 div", amount: "1", currency: "divine" },
];

export function TabletWorkspace({
  tablet,
  rows,
  chaosExalted,
  divineExalted,
}: {
  tablet: TabletCatalogEntry;
  rows: TabletComboView[];
  chaosExalted: number;
  divineExalted: number;
}) {
  const [preset, setPreset] = useState("5c");
  const [minAmount, setMinAmount] = useState("5");
  const [currency, setCurrency] = useState<PriceCurrency>("chaos");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [tradeError, setTradeError] = useState<string | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});

  const minExalted = thresholdToExalted(
    Number(minAmount),
    currency,
    { chaosExalted, divineExalted },
  );

  const visible = useMemo(
    () =>
      rows
        .filter(
          (r) =>
            comboIsConfirmed(r.status, r.listingCount) &&
            comboMeetsMinimum(r.floorPriceExalted, minExalted),
        )
        .sort((a, b) => (b.floorPriceExalted ?? -1) - (a.floorPriceExalted ?? -1)),
    [rows, minExalted],
  );

  const visibleKey = visible.map((r) => r.id).join("|");
  useEffect(() => {
    setSelected(new Set(visible.map((r) => r.id)));
    setCopied(false);
    // Reselect whenever the price filter changes which rows are shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey]);

  const packed = useMemo(() => {
    const chosen = visible.filter((r) => selected.has(r.id));
    const pool = [...tablet.prefixes, ...tablet.suffixes].map((a) => a.text || a.label);
    return packComboRegex(
      chosen.map((r) => [...r.prefixes, ...r.suffixes].map((m) => m.text || m.label)),
      STASH_REGEX_LIMIT,
      pool,
    );
  }, [visible, selected, tablet]);

  const applyPreset = (id: string) => {
    const hit = PRESETS.find((p) => p.id === id);
    if (!hit) return;
    setPreset(id);
    setMinAmount(hit.amount);
    setCurrency(hit.currency);
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setCopied(false);
  };

  const copy = async () => {
    if (!packed.regex) return;
    try {
      await navigator.clipboard.writeText(packed.regex);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const openTrade = async (row: TabletComboView) => {
    const known = links[row.id] || row.tradeUrl;
    if (known) {
      window.open(known, "_blank", "noopener,noreferrer");
      return;
    }
    setOpeningId(row.id);
    setTradeError(null);
    try {
      const res = await fetch("/api/tablets/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id }),
      });
      const data = (await res.json()) as { tradeUrl?: string; error?: string };
      if (!res.ok || !data.tradeUrl) {
        throw new Error(data.error ?? "Trade search failed");
      }
      setLinks((prev) => ({ ...prev, [row.id]: data.tradeUrl! }));
      window.open(data.tradeUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      setTradeError(err instanceof Error ? err.message : "Trade search failed");
    } finally {
      setOpeningId(null);
    }
  };

  const selectedCount = visible.filter((r) => selected.has(r.id)).length;

  return (
    <div className="space-y-4">
      <div className="panel sticky top-0 z-10 space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-forge-gold/70">Minimum</span>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`btn ${preset === p.id ? "btn-primary" : ""}`}
              onClick={() => applyPreset(p.id)}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            className={`btn ${preset === "custom" ? "btn-primary" : ""}`}
            onClick={() => setPreset("custom")}
          >
            Custom
          </button>
          {preset === "custom" ? (
            <>
              <input
                className="input w-24"
                inputMode="decimal"
                placeholder="0"
                value={minAmount}
                onChange={(e) => setMinAmount(e.target.value)}
              />
              <select
                className="input w-32"
                value={currency}
                onChange={(e) => setCurrency(e.target.value as PriceCurrency)}
              >
                <option value="chaos">chaos</option>
                <option value="exalted">exalted</option>
                <option value="divine">divine</option>
              </select>
            </>
          ) : null}
          <span className="text-[11px] text-forge-gold/40">
            {visible.length} combination{visible.length === 1 ? "" : "s"} on {tablet.name}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-primary" disabled={!packed.regex} onClick={copy}>
            {copied ? "Copied" : "Copy regex"}
          </button>
          <span className="text-[11px] text-forge-gold/50">
            {packed.regex.length}/{STASH_REGEX_LIMIT}
            {selectedCount > 0
              ? ` · ${packed.included} of ${selectedCount} selected`
              : ""}
          </span>
        </div>
        {packed.regex ? (
          <pre className="overflow-x-auto rounded bg-black/30 p-3 text-xs text-forge-goldbright">
            {packed.regex}
          </pre>
        ) : (
          <p className="text-xs text-forge-gold/45">
            Select combinations worth at least {minAmount || "0"} {currency}. The regex matches any of them in your stash.
          </p>
        )}
      </div>

      <div className="panel p-4">
        {visible.length === 0 ? (
          <p className="text-sm text-forge-gold/50">
            No confirmed combinations for {tablet.name} at this price. A price is shown only after at least 3 listings agree. Refresh prices, or lower the minimum.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wide text-forge-gold/40">
                <tr>
                  <th className="py-2 pr-2">
                    <span className="sr-only">Include</span>
                  </th>
                  <th className="py-2 pr-3">Prefixes</th>
                  <th className="py-2 pr-3">Suffixes</th>
                  <th className="py-2 pr-3">Chaos</th>
                  <th className="py-2 pr-3">Divine</th>
                  <th className="py-2 pr-3">Listings</th>
                  <th className="py-2">Trade</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.id} className="border-t border-forge-border/60">
                    <td className="py-2 pr-2">
                      <input
                        type="checkbox"
                        aria-label={`Include ${row.prefixes.map((m) => m.label).join(", ")}`}
                        checked={selected.has(row.id)}
                        onChange={() => toggle(row.id)}
                      />
                    </td>
                    <td className="py-2 pr-3 text-forge-goldbright">
                      {row.prefixes.map((m) => m.label).join(" · ") || "—"}
                    </td>
                    <td className="py-2 pr-3">
                      {row.suffixes.map((m) => m.label).join(" · ") || "—"}
                    </td>
                    <td className="py-2 pr-3">{fmtChaos(row.floorPriceExalted, chaosExalted)}</td>
                    <td className="py-2 pr-3">{fmtDiv(row.floorPriceExalted, divineExalted)}</td>
                    <td className="py-2 pr-3">{row.listingCount ?? "—"}</td>
                    <td className="py-2">
                      <button
                        type="button"
                        className="text-forge-goldbright underline disabled:opacity-50"
                        disabled={openingId === row.id}
                        onClick={() => openTrade(row)}
                      >
                        {openingId === row.id ? "Opening…" : "Open"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {tradeError ? <p className="mt-2 text-xs text-forge-rust">{tradeError}</p> : null}
      </div>
    </div>
  );
}
