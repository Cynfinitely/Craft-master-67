"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { InfoTip } from "@/components/InfoTip";
import { ClassCombobox } from "@/components/ui/ClassCombobox";
import { Field } from "@/components/ui/Field";
import { FilterFieldRow } from "@/components/ui/FilterFieldRow";

const DEFAULT_ILVL = "82";

export function ItemControls({
  classes,
  tags,
}: {
  classes: { category: string; classes: string[] }[];
  tags: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [q, setQ] = useState(params.get("q") ?? "");

  const setParam = (
    updates: Record<string, string | null>,
    nav: "push" | "replace" = "push",
  ) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    router[nav](`${pathname}?${next.toString()}`);
  };

  useEffect(() => {
    // Only search when the box differs from the URL (also immune to StrictMode
    // double-mounting, which used to fire a search that cleared `base`).
    if (q === (params.get("q") ?? "")) return;
    // Debounced keystrokes replace the entry so history isn't flooded.
    const handle = setTimeout(() => {
      setParam({ q: q || null, base: null }, "replace");
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const itemClass = params.get("class") ?? "";
  const ilvl = params.get("ilvl") ?? DEFAULT_ILVL;
  const tag = params.get("tag") ?? "";

  // Item level is edited locally and committed on blur/Enter so the field can
  // be cleared while typing without triggering a navigation per keystroke.
  const [ilvlDraft, setIlvlDraft] = useState(ilvl);
  useEffect(() => setIlvlDraft(ilvl), [ilvl]);

  const commitIlvl = () => {
    const n = Number.parseInt(ilvlDraft, 10);
    if (Number.isNaN(n)) {
      setIlvlDraft(ilvl);
      return;
    }
    const clamped = String(Math.min(100, Math.max(1, n)));
    setIlvlDraft(clamped);
    if (clamped !== ilvl) setParam({ ilvl: clamped });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="section-title text-xs">Filters</h2>
        <InfoTip
          label="How to browse items"
          summary="Filter bases, pick one, then explore its modifier pool."
          detail={[
            "Choose an item class or type at least 2 characters in search.",
            "Pick a base from the list — the list collapses to your selection.",
            "Use “Change base” to browse again without losing your filters.",
            "Tag filter narrows the prefix/suffix columns on the right.",
          ]}
        />
      </div>
      <Field label="Search base items" srOnlyLabel>
        <input
          type="search"
          className="input"
          placeholder="Search base items (e.g. Sapphire Ring)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </Field>
      <FilterFieldRow>
        <ClassCombobox
          categories={classes}
          value={itemClass}
          label="Item class"
          onChange={(v) => setParam({ class: v || null, base: null })}
        />
        <Field label="Item level" inline className="shrink-0">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            className="input w-16 text-center num"
            value={ilvlDraft}
            onChange={(e) => setIlvlDraft(e.target.value)}
            onBlur={commitIlvl}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitIlvl();
              }
            }}
          />
        </Field>
      </FilterFieldRow>
      <Field label="Mod tag">
        <select
          className="input"
          value={tag}
          onChange={(e) => setParam({ tag: e.target.value || null })}
        >
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}
