"use client";

import { useState } from "react";
import type { CraftPlan } from "@/lib/solver/types";
import { PlanView } from "./PlanView";

interface ResolvedMod {
  name: string | null;
  kind: "prefix" | "suffix";
  group: string;
  tierLevel: number;
  value: string;
  desecrated: boolean;
}

interface ResolvedItem {
  ok: boolean;
  baseId: string | null;
  baseName: string | null;
  itemClass: string | null;
  itemLevel: number;
  desiredGroups: string[];
  matched: ResolvedMod[];
  warnings: string[];
  requiresDesecration: boolean;
  requiresRuneforging: boolean;
}

const SAMPLE = `Item Class: Boots
Rarity: Rare
Pandemonium Span
Runeforged Cinched Boots
--------
Quality: +20% (augmented)
Evasion Rating: 827 (augmented)
Runic Ward: 50 (augmented)
--------
Requires: Level 65, 86 Dex
--------
Item Level: 82
--------
{ Prefix Modifier "Phantasm's" (Tier: 3) — Evasion }
72(68-79)% increased Evasion Rating
{ Prefix Modifier "Hellion's" (Tier: 1) — Speed }
35% increased Movement Speed
{ Suffix Modifier "of Archaeology" (Tier: 1) }
18(15-18)% increased Rarity of Items found
{ Desecrated Suffix Modifier "of Flexure" (Tier: 1) — Evasion }
Gain Deflection Rating equal to 21(21-23)% of Evasion Rating`;

export function PasteImport() {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<ResolvedItem | null>(null);
  const [plan, setPlan] = useState<CraftPlan | null>(null);

  const submit = async () => {
    setLoading(true);
    setError(null);
    setResolved(null);
    setPlan(null);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to parse item");
      setResolved(data.resolved as ResolvedItem);
      setPlan((data.plan as CraftPlan) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to parse item");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="panel p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-forge-gold/70">
            Paste an item (in-game Ctrl+C)
          </h2>
          <button
            type="button"
            className="text-xs text-forge-gold/50 underline hover:text-forge-goldbright"
            onClick={() => setText(SAMPLE)}
          >
            Load sample
          </button>
        </div>
        <textarea
          className="input mt-2 h-48 w-full resize-y font-mono text-xs"
          placeholder="Hover an item in-game, press Ctrl+C, then paste here…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            className="btn"
            onClick={submit}
            disabled={loading || !text.trim()}
          >
            {loading ? "Analyzing…" : "Find crafting paths"}
          </button>
          {resolved?.baseName ? (
            <span className="text-sm text-forge-gold/60">
              Matched base:{" "}
              <span className="text-rarity-normal">{resolved.baseName}</span> ·
              iLvl {resolved.itemLevel}
            </span>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="panel border-forge-rust/60 bg-forge-rust/10 p-4 text-sm text-forge-goldbright/90">
          {error}
        </div>
      ) : null}

      {resolved ? (
        <div className="panel p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-forge-gold/70">
            Detected modifiers
          </h3>
          {resolved.matched.length ? (
            <ul className="mt-2 space-y-1 text-sm">
              {resolved.matched.map((m) => (
                <li key={m.group} className="flex items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                      m.kind === "prefix"
                        ? "bg-affix-prefix/15 text-affix-prefix"
                        : "bg-affix-suffix/15 text-affix-suffix"
                    }`}
                  >
                    {m.kind}
                  </span>
                  <span className="text-forge-gold/80">{m.value}</span>
                  <span className="text-[11px] text-forge-gold/40">
                    mod lvl {m.tierLevel}
                  </span>
                  {m.desecrated ? (
                    <span className="rounded bg-violet-900/60 px-1.5 py-0.5 text-[10px] font-semibold text-violet-200">
                      desecrated
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-forge-gold/50">
              No modifiers could be matched to the data.
            </p>
          )}

          {(resolved.requiresDesecration || resolved.requiresRuneforging) && (
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {resolved.requiresDesecration ? (
                <span className="rounded border border-violet-700/50 bg-violet-900/20 px-2 py-1 text-violet-200">
                  Contains a desecrated mod — see the Desecration method below.
                </span>
              ) : null}
              {resolved.requiresRuneforging ? (
                <span className="rounded border border-sky-700/50 bg-sky-900/20 px-2 py-1 text-sky-200">
                  Has Runic Ward — added via Verisium Runeforging on the base.
                </span>
              ) : null}
            </div>
          )}

          {resolved.warnings.length ? (
            <ul className="mt-3 list-inside list-disc space-y-0.5 text-xs text-forge-gold/50">
              {resolved.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {plan ? <PlanView plan={plan} /> : null}
    </div>
  );
}
