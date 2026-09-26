"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function MassControls({ techniques }: { techniques: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const method = params.get("method") ?? "auto";
  const n = params.get("n") ?? "50";

  const push = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    router.push(`${pathname}?${next.toString()}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex w-full min-w-0 items-center gap-1.5 sm:w-auto">
        <label className="shrink-0 text-xs text-forge-gold/80">Technique</label>
        <select
          className="input min-w-0 sm:w-auto"
          value={method}
          onChange={(e) => push({ method: e.target.value === "auto" ? null : e.target.value })}
        >
          <option value="auto">Let the brain pick (cheapest)</option>
          {techniques.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-forge-gold/80">Bases in the batch</label>
        <input
          type="number"
          min={1}
          max={10000}
          className="input w-24 text-center"
          defaultValue={n}
          key={`n-${n}`}
          onBlur={(e) => push({ n: e.target.value || "50" })}
          onKeyDown={(e) => {
            if (e.key === "Enter") push({ n: (e.target as HTMLInputElement).value || "50" });
          }}
        />
      </div>
    </div>
  );
}
