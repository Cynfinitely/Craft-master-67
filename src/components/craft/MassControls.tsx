"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

const METHODS = [
  { id: "alch-spam", name: "Alchemy spam" },
  { id: "alch-chaos", name: "Alchemy + Chaos cycles" },
  { id: "transmute-regal-exalt", name: "Transmute → Regal → Exalt" },
  { id: "perfect-seed", name: "Perfect Transmute + Augment seed" },
  { id: "essence-exalt", name: "Essence + Exalt slams" },
];

export function MassControls() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const method = params.get("method") ?? "alch-spam";
  const n = params.get("n") ?? "50";
  const chaos = params.get("chaos") ?? "10";

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
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-forge-gold/60">Method</label>
        <select
          className="input"
          value={method}
          onChange={(e) => push({ method: e.target.value })}
        >
          {METHODS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-forge-gold/60">Bases to buy</label>
        <input
          type="number"
          min={1}
          max={5000}
          className="input w-24 text-center"
          defaultValue={n}
          key={`n-${n}`}
          onBlur={(e) => push({ n: e.target.value || "50" })}
          onKeyDown={(e) => {
            if (e.key === "Enter")
              push({ n: (e.target as HTMLInputElement).value || "50" });
          }}
        />
      </div>
      {method === "alch-chaos" ? (
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-forge-gold/60">Chaos per base</label>
          <input
            type="number"
            min={0}
            max={100}
            className="input w-20 text-center"
            defaultValue={chaos}
            key={`c-${chaos}`}
            onBlur={(e) => push({ chaos: e.target.value || "10" })}
            onKeyDown={(e) => {
              if (e.key === "Enter")
                push({ chaos: (e.target as HTMLInputElement).value || "10" });
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
