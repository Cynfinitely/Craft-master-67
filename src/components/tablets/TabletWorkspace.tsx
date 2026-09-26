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
import { ResponsiveTable } from "@/components/ui/ResponsiveTable";
import { waitForJob } from "@/lib/jobs/clientWait";

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
    // Browsers block pop-ups opened after an await, so open the tab during the click.
    const tab = window.open("about:blank", "_blank");
    try {
      const res = await fetch("/api/tablets/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id }),
      });
      const data = (await res.json()) as { tradeUrl?: string; jobId?: string; error?: string };
      if (!res.ok && !data.jobId) throw new Error(data.error ?? "Trade search failed");
      let url = data.tradeUrl;
      if (!url && data.jobId) {
        setTradeError("Trade search queued in the market worker…");
        const job = await waitForJob(data.jobId);
        url = (job.result as { tradeUrl?: string } | undefined)?.tradeUrl;
        if (job.status !== "done" || !url) throw new Error(job.message || "Trade search failed");
        setTradeError(null);
      }
      if (!url) throw new Error("Trade search failed");
      setLinks((prev) => ({ ...prev, [row.id]: url! }));
      if (tab) tab.location.href = url;
      else window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      tab?.close();
      setTradeError(err instanceof Error ? err.message : "Trade search failed");
    } finally {
      setOpeningId(null);
    }
  };

  const selectedCount = visible.filter((r) => selected.has(r.id)).length;

  return (
    <div className="space-y-4">
      <div className="panel space-y-3 p-3 sm:p-4 md:sticky md:top-[calc(var(--nav-height)+0.5rem)] md:z-10">
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
          <span className="text-[11px] text-forge-gold/80">
            {visible.length} combination{visible.length === 1 ? "" : "s"} on {tablet.name}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-primary" disabled={!packed.regex} onClick={copy}>
            {copied ? "Copied" : "Copy regex"}
          </button>
          <span className="text-[11px] text-forge-gold/80">
            {packed.regex.length}/{STASH_REGEX_LIMIT}
            {selectedCount > 0
              ? ` · ${packed.included} of ${selectedCount} selected`
              : ""}
          </span>
        </div>
        {packed.regex ? (
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded border border-forge-border bg-forge-panel2 p-3 text-xs text-forge-goldbright">
            {packed.regex}
          </pre>
        ) : (
          <p className="text-xs text-forge-gold/80">
            Select combinations worth at least {minAmount || "0"} {currency}. The regex matches any of them in your stash.
          </p>
        )}
      </div>

      <div className="panel p-4">
        {visible.length === 0 ? (
          <p className="text-sm text-forge-gold/80">
            No confirmed combinations for {tablet.name} at this price. A price is shown only after at least 3 listings agree. Refresh prices, or lower the minimum.
          </p>
        ) : (
          <ResponsiveTable<TabletComboView>
            caption={`Confirmed combinations on ${tablet.name}`}
            rows={visible}
            rowKey={(row) => row.id}
            columns={[
              {
                key: "card",
                header: "Combination",
                primary: true,
                hideOnDesktop: true,
                cell: (row) => (
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-5 w-5 shrink-0"
                      checked={selected.has(row.id)}
                      onChange={() => toggle(row.id)}
                    />
                    <span className="min-w-0">
                      {row.prefixes.map((m) => m.label).join(" · ") || "—"}
                      <span className="block text-xs font-normal text-forge-gold/80">
                        {row.suffixes.map((m) => m.label).join(" · ") || "—"}
                      </span>
                    </span>
                  </label>
                ),
              },
              {
                key: "include",
                header: <span className="sr-only">Include</span>,
                hideOnMobile: true,
                className: "w-8",
                cell: (row) => (
                  <input
                    type="checkbox"
                    aria-label={`Include ${row.prefixes.map((m) => m.label).join(", ")}`}
                    checked={selected.has(row.id)}
                    onChange={() => toggle(row.id)}
                  />
                ),
              },
              {
                key: "prefixes",
                header: "Prefixes",
                hideOnMobile: true,
                className: "text-forge-goldbright",
                cell: (row) => row.prefixes.map((m) => m.label).join(" · ") || "—",
              },
              {
                key: "suffixes",
                header: "Suffixes",
                hideOnMobile: true,
                cell: (row) => row.suffixes.map((m) => m.label).join(" · ") || "—",
              },
              {
                key: "chaos",
                header: "Chaos",
                align: "right",
                cell: (row) => fmtChaos(row.floorPriceExalted, chaosExalted),
              },
              {
                key: "divine",
                header: "Divine",
                align: "right",
                cell: (row) => fmtDiv(row.floorPriceExalted, divineExalted),
              },
              {
                key: "listings",
                header: "Listings",
                align: "right",
                cell: (row) => row.listingCount ?? "—",
              },
              {
                key: "trade",
                header: "Trade",
                cell: (row) => (
                  <button
                    type="button"
                    className="tap text-forge-goldbright underline disabled:opacity-50"
                    disabled={openingId === row.id}
                    onClick={() => openTrade(row)}
                  >
                    {openingId === row.id ? "Opening…" : "Open"}
                  </button>
                ),
              },
            ]}
          />
        )}
        {tradeError ? <p className="mt-2 text-xs text-forge-rust">{tradeError}</p> : null}
      </div>
    </div>
  );
}
