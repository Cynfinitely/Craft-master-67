"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type CraftMode = "base" | "recommend" | "paste";

export function CraftControls({
  classes,
  mode,
}: {
  classes: { category: string; classes: string[] }[];
  mode: CraftMode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [q, setQ] = useState(params.get("q") ?? "");
  const firstRender = useRef(true);

  const push = (updates: Record<string, string | null>) => {
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
    const handle = setTimeout(() => push({ q: q || null }), 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const itemClass = params.get("class") ?? "";
  const ilvl = params.get("ilvl") ?? "82";

  const switchMode = (m: CraftMode) => {
    // Reset selection-specific params when switching modes.
    const next = new URLSearchParams(params.toString());
    next.set("mode", m);
    next.delete("base");
    next.delete("groups");
    router.push(`${pathname}?${next.toString()}`);
  };

  const tab = (m: CraftMode, label: string) => (
    <button
      type="button"
      onClick={() => switchMode(m)}
      className={`flex-1 rounded px-3 py-1.5 text-sm transition-colors ${
        mode === m
          ? "bg-forge-rust/30 text-forge-goldbright"
          : "text-forge-gold/70 hover:text-forge-goldbright"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="flex gap-1 rounded-md border border-forge-border bg-forge-panel2 p-1">
        {tab("base", "From a base")}
        {tab("recommend", "Recommend a base")}
        {tab("paste", "Paste item")}
      </div>

      {mode === "paste" ? null : (
      <div className="flex flex-col gap-2 sm:flex-row">
        {mode === "base" ? (
          <input
            className="input"
            placeholder="Search base items"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        ) : null}
        <select
          className="input"
          value={itemClass}
          onChange={(e) =>
            push({ class: e.target.value || null, base: null, groups: null })
          }
        >
          <option value="">
            {mode === "recommend" ? "Choose an item class…" : "All item classes"}
          </option>
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
            onChange={(e) => push({ ilvl: e.target.value || "82" })}
          />
        </div>
      </div>
      )}
    </div>
  );
}
