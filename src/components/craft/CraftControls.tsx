"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { InfoTip } from "@/components/InfoTip";
import { ClassCombobox } from "@/components/ui/ClassCombobox";
import { FilterFieldRow } from "@/components/ui/FilterFieldRow";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

type CraftMode = "base" | "recommend" | "paste" | "mass";
/** Finish mode is reached from a pasted item; it shows under the Paste tab. */
type PageMode = CraftMode | "finish";

const MODE_OPTIONS: { value: CraftMode; label: string }[] = [
  { value: "base", label: "From a base" },
  { value: "recommend", label: "Recommend a base" },
  { value: "mass", label: "Mass craft" },
  { value: "paste", label: "Paste item" },
];

export function CraftControls({
  classes,
  mode,
}: {
  classes: { category: string; classes: string[] }[];
  mode: PageMode;
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
    const handle = setTimeout(
      () => push({ q: q || null, base: null }),
      300,
    );
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const itemClass = params.get("class") ?? "";
  const ilvl = params.get("ilvl") ?? "82";

  const switchMode = (m: CraftMode) => {
    const next = new URLSearchParams(params.toString());
    next.set("mode", m);
    next.delete("base");
    next.delete("groups");
    next.delete("current");
    router.push(`${pathname}?${next.toString()}`);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <SegmentedControl
            value={mode === "finish" ? "paste" : mode}
            onChange={switchMode}
            options={MODE_OPTIONS}
            shortLabels={{
              base: "Base",
              recommend: "Recommend",
              mass: "Mass",
              paste: "Paste",
            }}
          />
        </div>
        <InfoTip
          label="Crafting planner"
          summary="Pick a mode, filter bases, then stage modifiers before building a plan."
          detail={[
            "From a base: the brain ranks every technique for your goal.",
            "Recommend: pick desired mods and get ranked base suggestions.",
            "Mass craft: one pass of a technique over a batch of bases.",
            "Paste item: plan an item again, or finish the pasted item itself.",
            "Modifier picks are staged — nothing runs until you press the action button.",
          ]}
        />
      </div>

      {mode === "paste" || mode === "finish" ? null : (
        <FilterFieldRow>
          {mode === "base" || mode === "mass" ? (
            <input
              className="input"
              placeholder="Search base items"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          ) : null}
          <ClassCombobox
            categories={classes}
            value={itemClass}
            onChange={(v) =>
              push({ class: v || null, base: null, groups: null })
            }
          />
          <div className="flex shrink-0 items-center gap-1.5">
            <label className="text-xs text-forge-gold/80">iLvl</label>
            <input
              type="number"
              min={1}
              max={100}
              className="input w-16 text-center"
              defaultValue={ilvl}
              key={ilvl}
              onBlur={(e) => {
                if (e.target.value !== ilvl) push({ ilvl: e.target.value || "82" });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const v = (e.target as HTMLInputElement).value;
                  if (v !== ilvl) push({ ilvl: v || "82" });
                }
              }}
            />
          </div>
        </FilterFieldRow>
      )}
    </div>
  );
}
