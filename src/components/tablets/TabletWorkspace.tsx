"use client";

import { useMemo, useState } from "react";
import type { TabletAffix, TabletCatalogEntry } from "@/lib/tablets/logic";
import {
  buildStashRegex,
  comboMeetsMinimum,
  thresholdToExalted,
  type PriceCurrency,
} from "@/lib/tablets/logic";
import type { TabletComboView } from "@/lib/tablets/view";

function fmtEx(value: number | null): string {
  if (value == null) return "—";
  const abs = Math.abs(value);
  if (abs >= 1000) return `${(value / 1000).toFixed(1)}k ex`;
  if (abs >= 100) return `${Math.round(value)} ex`;
  if (abs >= 10) return `${value.toFixed(1)} ex`;
  return `${value.toFixed(2)} ex`;
}

function fmtDiv(value: number | null, divinePrice: number): string {
  if (value == null || divinePrice <= 0) return "—";
  return `${(value / divinePrice).toFixed(2)} div`;
}

function AffixList({
  title,
  affixes,
  checked,
  onToggle,
}: {
  title: string;
  affixes: TabletAffix[];
  checked: Set<string>;
  onToggle: (group: string) => void;
}) {
  return (
    <fieldset className="min-w-0 flex-1">
      <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-forge-gold/50">
        {title}
      </legend>
      <ul className="max-h-64 space-y-1 overflow-y-auto pr-1">
        {affixes.map((affix) => (
          <li key={affix.group}>
            <label className="flex cursor-pointer items-start gap-2 text-xs text-forge-gold/80">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={checked.has(affix.group)}
                onChange={() => onToggle(affix.group)}
              />
              <span>
                <span className="font-medium text-forge-goldbright">{affix.label}</span>
                {affix.text && affix.text !== affix.label ? (
                  <span className="mt-0.5 block text-[11px] text-forge-gold/45">
                    {affix.text}
                  </span>
                ) : null}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

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
  const [minAmount, setMinAmount] = useState("");
  const [currency, setCurrency] = useState<PriceCurrency>("divine");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [regex, setRegex] = useState("");
  const [copied, setCopied] = useState(false);

  const minExalted = thresholdToExalted(
    Number(minAmount),
    currency,
    { chaosExalted, divineExalted },
  );

  const visible = useMemo(
    () =>
      rows
        .filter((r) => comboMeetsMinimum(r.floorPriceExalted, minExalted))
        .sort((a, b) => (b.floorPriceExalted ?? -1) - (a.floorPriceExalted ?? -1)),
    [rows, minExalted],
  );

  const toggle = (group: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
    setRegex("");
    setCopied(false);
  };

  const generate = () => {
    const selected = [...tablet.prefixes, ...tablet.suffixes].filter((a) =>
      checked.has(a.group),
    );
    setRegex(buildStashRegex(selected.map((a) => a.text || a.label)));
    setCopied(false);
  };

  const copy = async () => {
    if (!regex) return;
    try {
      await navigator.clipboard.writeText(regex);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="panel space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-forge-gold/70">
            Minimum price
            <input
              className="input mt-1 block w-28"
              inputMode="decimal"
              placeholder="0"
              value={minAmount}
              onChange={(e) => setMinAmount(e.target.value)}
            />
          </label>
          <label className="text-xs text-forge-gold/70">
            Currency
            <select
              className="input mt-1 block"
              value={currency}
              onChange={(e) => setCurrency(e.target.value as PriceCurrency)}
            >
              <option value="chaos">chaos</option>
              <option value="exalted">exalted</option>
              <option value="divine">divine</option>
            </select>
          </label>
          <p className="pb-2 text-[11px] text-forge-gold/40">
            {Number(minAmount) > 0
              ? `Showing combinations worth at least ${minAmount} ${currency} (${fmtEx(minExalted)}).`
              : "Showing every priced combination."}
          </p>
        </div>

        {visible.length === 0 ? (
          <p className="text-sm text-forge-gold/50">
            No combinations for {tablet.name} yet. Run a scan, or lower the minimum price.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wide text-forge-gold/40">
                <tr>
                  <th className="py-2 pr-3">Prefixes</th>
                  <th className="py-2 pr-3">Suffixes</th>
                  <th className="py-2 pr-3">Floor</th>
                  <th className="py-2 pr-3">Divine</th>
                  <th className="py-2 pr-3">Listings</th>
                  <th className="py-2">Trade</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.id} className="border-t border-forge-border/60">
                    <td className="py-2 pr-3 text-forge-goldbright">
                      {row.prefixes.map((m) => m.label).join(" · ") || "—"}
                    </td>
                    <td className="py-2 pr-3">
                      {row.suffixes.map((m) => m.label).join(" · ") || "—"}
                    </td>
                    <td className="py-2 pr-3">{fmtEx(row.floorPriceExalted)}</td>
                    <td className="py-2 pr-3">{fmtDiv(row.floorPriceExalted, divineExalted)}</td>
                    <td className="py-2 pr-3">{row.listingCount ?? "—"}</td>
                    <td className="py-2">
                      {row.tradeUrl ? (
                        <a
                          className="text-forge-goldbright underline"
                          href={row.tradeUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open
                        </a>
                      ) : row.status === "pending_floor" ? (
                        "queued"
                      ) : row.status === "error" ? (
                        row.errorMessage || "error"
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel space-y-3 p-4">
        <div className="flex flex-col gap-4 sm:flex-row">
          <AffixList
            title="Prefixes"
            affixes={tablet.prefixes}
            checked={checked}
            onToggle={toggle}
          />
          <AffixList
            title="Suffixes"
            affixes={tablet.suffixes}
            checked={checked}
            onToggle={toggle}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-primary" onClick={generate}>
            Generate regex
          </button>
          <button
            type="button"
            className="btn"
            disabled={!regex}
            onClick={copy}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <span className="text-[11px] text-forge-gold/40">
            Paste into the in-game stash search. It matches tablets that have every checked mod.
          </span>
        </div>
        {regex ? (
          <pre className="overflow-x-auto rounded bg-black/30 p-3 text-xs text-forge-goldbright">
            {regex}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
