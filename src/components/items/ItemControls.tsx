"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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

  // Debounce the free-text search.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const handle = setTimeout(() => {
      setParam({ q: q || null });
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const itemClass = params.get("class") ?? "";
  const ilvl = params.get("ilvl") ?? "82";
  const tag = params.get("tag") ?? "";

  return (
    <div className="space-y-3">
      <input
        className="input"
        placeholder="Search base items (e.g. Sapphire Ring)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="flex gap-2">
        <select
          className="input"
          value={itemClass}
          onChange={(e) => setParam({ class: e.target.value || null })}
        >
          <option value="">Choose an item class…</option>
          {classes.map((cat) => (
            <optgroup key={cat.category} label={cat.category}>
              {cat.classes.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <div className="flex shrink-0 items-center gap-1.5">
          <label className="text-xs text-forge-gold/60">iLvl</label>
          <input
            type="number"
            min={1}
            max={100}
            className="input w-16 text-center"
            value={ilvl}
            onChange={(e) => setParam({ ilvl: e.target.value || "82" })}
          />
        </div>
      </div>
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
