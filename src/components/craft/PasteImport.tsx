"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { CraftPlan } from "@/lib/craft/types";
import { formatCurrentMods } from "@/lib/craft/goal";
import { ActionWithInfo } from "@/components/ui/ActionWithInfo";
import { Alert } from "@/components/ui/Alert";
import { AffixMark, Badge } from "@/components/ui/Badge";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { PlanView } from "./PlanView";

interface PobItem {
  itemClass: string;
  baseId: string;
  baseName: string;
  itemLevel: number;
  groups: string[];
  labels: string[];
  unmatched: string[];
}

interface PobResult {
  items: PobItem[];
  totalBlocks: number;
  warnings: string[];
}

function finishHref(r: ResolvedItem): string | null {
  if (!r.baseId || !r.matched.length) return null;
  const current = formatCurrentMods(
    r.matched.map((m) => ({ group: m.group, side: m.kind, level: m.tierLevel, desecrated: m.desecrated || undefined })),
  );
  const p = new URLSearchParams({
    mode: "finish",
    base: r.baseId,
    ilvl: String(r.itemLevel),
    current,
    groups: r.desiredGroups.join(","),
  });
  return `/craft?${p.toString()}`;
}

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
  const [pob, setPob] = useState<PobResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const textareaId = useId();
  const hintId = useId();

  useEffect(() => () => abortRef.current?.abort(), []);

  const submit = async () => {
    // A newer submit supersedes any request still in flight.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    setResolved(null);
    setPlan(null);
    setPob(null);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to parse item");
      setResolved((data.resolved as ResolvedItem) ?? null);
      setPlan((data.plan as CraftPlan) ?? null);
      setPob((data.pob as PobResult) ?? null);
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(e instanceof Error ? e.message : "Failed to parse item");
    } finally {
      if (abortRef.current === controller) setLoading(false);
    }
  };

  const hasText = text.trim().length > 0;
  const finish = resolved ? finishHref(resolved) : null;

  return (
    <div className="space-y-4">
      <div className="panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-title">
            <label htmlFor={textareaId}>Paste an item (in-game Ctrl+C) or a PoB build code</label>
          </h2>
          {hasText && text !== SAMPLE ? (
            <ConfirmButton
              className="btn-ghost btn-sm"
              confirmLabel="Replace your text?"
              ariaLabel="Load sample item"
              onConfirm={() => setText(SAMPLE)}
            >
              Load sample
            </ConfirmButton>
          ) : (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setText(SAMPLE)}
              disabled={text === SAMPLE}
            >
              Load sample
            </button>
          )}
        </div>
        <textarea
          id={textareaId}
          aria-describedby={hintId}
          className="input mt-2 h-48 w-full resize-y font-mono text-xs"
          placeholder="Hover an item in-game, press Ctrl+C, then paste here — or paste a Path of Building code…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <p id={hintId} className="mt-1 text-2xs text-forge-muted">
          Works with item text copied in-game (hover the item, Ctrl+C) and Path of Building export codes.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <ActionWithInfo
            label="Find crafting paths"
            summary="Parses the item and plans how to craft it again from a white base."
            detail={[
              "Matches the base type and each modifier's group and tier.",
              "Then use “Finish this item” to plan adding mods to the item itself.",
              "A PoB code lists every rare item in the build with a plan link.",
            ]}
          >
            <button
              type="button"
              className="btn btn-primary"
              onClick={submit}
              disabled={loading || !hasText}
              aria-busy={loading || undefined}
            >
              {loading ? "Analyzing…" : "Find crafting paths"}
            </button>
          </ActionWithInfo>
          {resolved?.baseName ? (
            <span className="text-sm text-forge-muted">
              Matched base:{" "}
              <span className="text-rarity-normal">{resolved.baseName}</span> ·
              iLvl {resolved.itemLevel}
            </span>
          ) : null}
          {finish ? (
            <Link href={finish} className="btn">
              Finish this item
            </Link>
          ) : null}
        </div>
      </div>

      {/* Short summary for screen readers instead of announcing the whole plan. */}
      <p role="status" className="sr-only">
        {loading
          ? "Analyzing item…"
          : resolved
            ? `Found ${resolved.matched.length} modifier${resolved.matched.length === 1 ? "" : "s"} on ${resolved.baseName}.${plan ? " Crafting paths ready below." : ""}`
            : pob
              ? "Path of Building items loaded below."
              : ""}
      </p>

      <div className="space-y-4">
        {error ? (
          <Alert tone="danger" title="Couldn’t read that item">
            {error}
          </Alert>
        ) : null}

        {resolved ? (
          <div className="panel p-4">
            <h3 className="section-title">Detected modifiers</h3>
            {resolved.matched.length ? (
              <ul className="mt-2 space-y-1 text-sm">
                {resolved.matched.map((m) => (
                  <li key={m.group} className="flex flex-wrap items-center gap-2">
                    <AffixMark kind={m.kind} />
                    <span className="text-forge-goldbright">{m.value}</span>
                    <span className="num text-2xs text-forge-muted">mod lvl {m.tierLevel}</span>
                    {m.desecrated ? <Badge tone="accent">desecrated</Badge> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-forge-muted">
                No modifiers could be matched to the data.
              </p>
            )}

            {(resolved.requiresDesecration || resolved.requiresRuneforging) && (
              <div className="mt-3 space-y-2">
                {resolved.requiresDesecration ? (
                  <Alert tone="info">Contains a desecrated mod — only the desecration techniques can reach it.</Alert>
                ) : null}
                {resolved.requiresRuneforging ? (
                  <Alert tone="info">Has Runic Ward — added via Verisium Runeforging on the base.</Alert>
                ) : null}
              </div>
            )}

            {resolved.warnings.length ? (
              <ul className="mt-3 list-inside list-disc space-y-0.5 text-xs text-forge-muted">
                {resolved.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {pob ? (
          <div className="panel p-4">
            <h3 className="section-title">
              Rare items in the build ({pob.items.length} of {pob.totalBlocks})
            </h3>
            {pob.items.length ? (
              <ul className="mt-2 divide-y divide-forge-border/40">
                {pob.items.map((it, i) => (
                  <li key={`${it.baseId}-${i}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <div className="text-sm text-rarity-normal">
                        {it.baseName} <span className="text-xs text-forge-muted">({it.itemClass})</span>
                      </div>
                      <div className="text-xs text-forge-muted">{it.labels.join(" · ")}</div>
                    </div>
                    <Link
                      href={`/craft?${new URLSearchParams({
                        mode: "base",
                        base: it.baseId,
                        ilvl: String(Math.max(it.itemLevel, 1)),
                        groups: it.groups.join(","),
                      }).toString()}`}
                      className="btn"
                    >
                      Plan it
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-forge-muted">No rare items could be resolved.</p>
            )}
            {pob.warnings.length ? (
              <ul className="mt-3 list-inside list-disc space-y-0.5 text-xs text-forge-muted">
                {pob.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {plan ? <PlanView plan={plan} /> : null}
      </div>
    </div>
  );
}
