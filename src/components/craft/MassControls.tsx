"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId } from "react";

export function MassControls({ techniques }: { techniques: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const methodId = useId();
  const countId = useId();

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

  /** Commit the batch size only when it actually changed (avoids re-running the simulation on blur). */
  const commitCount = (raw: string) => {
    const v = raw || "50";
    if (v !== n) push({ n: v });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex w-full min-w-0 items-center gap-1.5 sm:w-auto">
        <label htmlFor={methodId} className="label shrink-0">
          Technique
        </label>
        <select
          id={methodId}
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
        <label htmlFor={countId} className="label">
          Bases in the batch
        </label>
        <input
          id={countId}
          type="number"
          min={1}
          max={10000}
          inputMode="numeric"
          className="num input w-24 text-center"
          defaultValue={n}
          key={`n-${n}`}
          onBlur={(e) => commitCount(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitCount((e.target as HTMLInputElement).value);
          }}
        />
      </div>
    </div>
  );
}
