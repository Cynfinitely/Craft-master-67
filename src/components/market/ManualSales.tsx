"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ManualSale } from "@/lib/market/manual";

export function ManualSales({
  league,
  itemClass,
  sales,
}: {
  league: string;
  itemClass: string | null;
  sales: ManualSale[];
}) {
  const router = useRouter();
  const [baseType, setBaseType] = useState("");
  const [price, setPrice] = useState("");
  const [mods, setMods] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parsedClass, setParsedClass] = useState<string | null>(null);
  const [parsedIlvl, setParsedIlvl] = useState<number | null>(null);

  const parseItem = async () => {
    if (!pasteText.trim()) return;
    setParsing(true);
    setError(null);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: pasteText, parseOnly: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not parse the item");
      const resolved = data.resolved as {
        baseName: string | null;
        itemClass: string | null;
        itemLevel: number;
        matched: { group: string }[];
        warnings: string[];
      };
      if (!resolved.baseName) {
        throw new Error(resolved.warnings[0] ?? "Could not match the base.");
      }
      setBaseType(resolved.baseName);
      setMods(resolved.matched.map((m) => m.group).join(", "));
      setParsedClass(resolved.itemClass);
      setParsedIlvl(resolved.itemLevel);
      if (resolved.warnings.length) setError(resolved.warnings.join(" "));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not parse the item.");
    } finally {
      setParsing(false);
    }
  };

  const submit = async () => {
    const priceNum = Number.parseFloat(price);
    const groups = mods
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!baseType.trim() || !Number.isFinite(priceNum) || priceNum <= 0 || !groups.length) {
      setError("Base, a positive price (in Exalted), and at least one mod are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/market/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          league,
          itemClass: parsedClass ?? itemClass,
          baseType: baseType.trim(),
          ilvl: parsedIlvl,
          priceExalted: priceNum,
          groups,
          note: note.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to save");
      }
      setBaseType("");
      setPrice("");
      setMods("");
      setNote("");
      setPasteText("");
      setParsedClass(null);
      setParsedIlvl(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    await fetch(`/api/market/manual?id=${id}`, { method: "DELETE" });
    router.refresh();
  };

  return (
    <div className="panel p-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-forge-gold/70">
        Manual sale records
      </h3>
      <p className="mt-1 text-xs text-forge-gold/50">
        Record items you actually sold — realized prices feed the sale
        estimates and Opportunities ranking. Paste the in-game item text
        (Ctrl+C on the item) and the base + mods fill themselves.
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <textarea
          className="input min-h-[72px] flex-1 font-mono text-xs"
          placeholder={"Paste item text here (Ctrl+C on the item in game)…"}
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
        />
        <button
          type="button"
          className="btn shrink-0 self-start disabled:opacity-50"
          disabled={parsing || !pasteText.trim()}
          onClick={parseItem}
        >
          {parsing ? "Parsing…" : "Parse item"}
        </button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <input
          className="input"
          placeholder="Base type (e.g. Commander Greathelm)"
          value={baseType}
          onChange={(e) => setBaseType(e.target.value)}
        />
        <input
          className="input"
          placeholder="Sale price (Exalted)"
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        <input
          className="input"
          placeholder="Mods (comma separated)"
          value={mods}
          onChange={(e) => setMods(e.target.value)}
        />
        <div className="flex gap-2">
          <input
            className="input flex-1"
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-primary shrink-0 disabled:opacity-50"
            disabled={busy}
            onClick={submit}
          >
            Add
          </button>
        </div>
      </div>
      {error ? <p className="mt-2 text-xs text-forge-rust">{error}</p> : null}

      {sales.length > 0 ? (
        <ul className="mt-3 divide-y divide-forge-border/40">
          {sales.slice(0, 20).map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 py-1.5 text-xs">
              <span className="text-forge-gold/80">
                {s.baseType}
                <span className="ml-2 text-forge-gold/50">
                  {s.groups.join(", ")}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <span className="font-semibold text-rarity-currency">
                  {s.priceExalted} ex
                </span>
                <button
                  type="button"
                  className="text-forge-rust/80 hover:text-forge-rust"
                  onClick={() => remove(s.id)}
                >
                  delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
