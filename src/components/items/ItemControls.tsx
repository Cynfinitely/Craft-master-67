"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { InfoTip } from "@/components/InfoTip";
import { ClassCombobox } from "@/components/ui/ClassCombobox";
import { FilterFieldRow } from "@/components/ui/FilterFieldRow";

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
  const firstRender = useRef(true);

  const setParam = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    router.push(`${pathname}?${next.toString()}`);
  };

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const handle = setTimeout(() => {
      setParam({ q: q || null, base: null });
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const itemClass = params.get("class") ?? "";
  const ilvl = params.get("ilvl") ?? "82";
  const tag = params.get("tag") ?? "";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-forge-gold/80">
          Filters
        </span>
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
      <input
        className="input"
        placeholder="Search base items (e.g. Sapphire Ring)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <FilterFieldRow>
        <ClassCombobox
          categories={classes}
          value={itemClass}
          onChange={(v) => setParam({ class: v || null, base: null })}
        />
        <div className="flex shrink-0 items-center gap-1.5">
          <label className="text-xs text-forge-gold/80">iLvl</label>
          <input
            type="number"
            min={1}
            max={100}
            className="input w-16 text-center"
            value={ilvl}
            onChange={(e) => setParam({ ilvl: e.target.value || "82" })}
          />
        </div>
      </FilterFieldRow>
      <select
        className="input"
        value={tag}
        onChange={(e) => setParam({ tag: e.target.value || null })}
      >
        <option value="">Filter mods by tag (all)</option>
        {tags.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    </div>
  );
}
