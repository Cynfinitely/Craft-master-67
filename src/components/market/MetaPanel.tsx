"use client";

import { useCallback, useState } from "react";
import Link from "next/link";

export interface MetaItemView {
  id: number;
  itemClass: string;
  baseId: string | null;
  baseName: string | null;
  groups: string[];
  labels: string[];
  sourceLabel: string | null;
}

/**
 * Meta demand import: paste a PoB2 build code (poe.ninja → build → "Copy PoB
 * code") or raw item text; rare gear is resolved to bases + mod combos and
 * stored as demand targets for probing, opportunities and sniping.
 */
export function MetaPanel({
  league,
  itemClass,
  initialItems,
}: {
  league: string;
  itemClass: string | null;
  initialItems: MetaItemView[];
}) {
  const [items, setItems] = useState<MetaItemView[]>(initialItems);
  const [text, setText] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [specNotice, setSpecNotice] = useState<string | null>(null);
  const [createdSpec, setCreatedSpec] = useState<{
    id: number;
    itemClass: string;
  } | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await fetch(
        `/api/meta?league=${encodeURIComponent(league)}${
          itemClass ? `&class=${encodeURIComponent(itemClass)}` : ""
        }`,
      );
      const body = await r.json();
      if (r.ok) setItems(body.items ?? []);
    } catch {
      /* keep current list */
    }
  }, [league, itemClass]);

  const runImport = async () => {
    if (text.trim().length < 20) {
      setError("Paste a PoB build code or item text first.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    setWarnings([]);
    try {
      const r = await fetch("/api/meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "import",
          league,
          text,
          sourceLabel: source.trim() || undefined,
        }),
      });
      const body = await r.json();
      if (!r.ok) {
        setError(body.error ?? "Import failed");
        return;
      }
      setNotice(
        `Imported ${body.added} rare item(s) from ${body.totalBlocks} block(s).`,
      );
      setWarnings(body.warnings ?? []);
      setText("");
      await reload();
    } catch {
      setError("Import failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await fetch("/api/meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id }),
      });
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch {
      /* reload shows the truth */
    }
  };

  const makeSpec = async (item: MetaItemView) => {
    setSpecNotice(null);
    setCreatedSpec(null);
    try {
      const r = await fetch("/api/market/snipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          league,
          itemClass: item.itemClass,
          baseId: item.baseId,
          name: `Meta: ${item.labels.slice(0, 3).join(" + ")}${
            item.labels.length > 3 ? " +…" : ""
          }`.slice(0, 80),
          mods: item.groups.slice(0, 6).map((group) => ({ group })),
        }),
      });
      const body = await r.json();
      if (!r.ok) {
        setSpecNotice(body.error ?? "Failed to create snipe spec");
        return;
      }
      const spec = body.spec as { id: number; name: string } | undefined;
      setSpecNotice(
        `Snipe spec "${spec?.name}" created for ${item.itemClass}.`,
      );
      if (spec?.id) {
        setCreatedSpec({ id: spec.id, itemClass: item.itemClass });
      }
    } catch {
      setSpecNotice("Failed to create snipe spec");
    }
  };

  const snipeHref = createdSpec
    ? `/opportunities?view=snipes&class=${encodeURIComponent(createdSpec.itemClass)}&spec=${createdSpec.id}`
    : null;

  return (
    <div className="panel">
      <div className="border-b border-forge-border px-4 py-2.5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-forge-gold/70">
          Meta demand (imported builds)
        </h3>
        <p className="mt-0.5 text-[11px] text-forge-gold/45">
          Paste a PoB2 build code (poe.ninja → a popular build → Copy PoB
          code) or raw item text. The rare gear it wears becomes demand
          targets: probed for prices, boosted in opportunities, snipeable in
          one click.
        </p>
      </div>
      <div className="space-y-3 p-4">
        <textarea
          rows={3}
          placeholder="Paste a PoB build code or item text (blocks starting with Rarity:)…"
          className="w-full rounded border border-forge-border bg-forge-panel2 px-2.5 py-1.5 text-xs text-forge-gold placeholder:text-forge-gold/30"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder="Source label (e.g. 'Deadeye LA #3 ladder')"
            className="min-w-56 flex-1 rounded border border-forge-border bg-forge-panel2 px-2.5 py-1.5 text-xs text-forge-gold placeholder:text-forge-gold/30"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
          <button
            type="button"
            className="rounded border border-forge-gold/40 px-3 py-1.5 text-xs text-forge-gold transition-colors hover:bg-forge-panel2 hover:text-forge-goldbright disabled:opacity-50"
            disabled={busy}
            onClick={runImport}
          >
            {busy ? "Importing…" : "Import build gear"}
          </button>
        </div>
        {error ? <p className="text-xs text-forge-rust">{error}</p> : null}
        {notice ? (
          <p className="text-xs text-emerald-300/90">{notice}</p>
        ) : null}
        {warnings.map((w, i) => (
          <p key={i} className="text-xs text-amber-300/70">
            {w}
          </p>
        ))}
        {specNotice ? (
          <p className="text-xs text-emerald-300/90">
            {specNotice}{" "}
            {snipeHref ? (
              <Link
                href={snipeHref}
                className="underline hover:text-emerald-200"
              >
                open Snipe &amp; finish →
              </Link>
            ) : null}
          </p>
        ) : null}

        {items.length > 0 ? (
          <ul className="divide-y divide-forge-border/40">
            {items.map((item) => (
              <li key={item.id} className="py-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-forge-gold/55">
                      <span className="font-semibold text-forge-goldbright">
                        {item.baseName ?? item.itemClass}
                      </span>{" "}
                      · {item.itemClass}
                      {item.sourceLabel ? ` · ${item.sourceLabel}` : ""}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {item.labels.map((label, i) => (
                        <span
                          key={`${item.id}-${i}`}
                          className="rounded border border-forge-border bg-forge-panel2/60 px-1.5 py-0.5 text-xs text-forge-gold/85"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <button
                      type="button"
                      className="rounded border border-forge-gold/40 px-2 py-0.5 text-xs text-forge-gold transition-colors hover:bg-forge-panel2 hover:text-forge-goldbright"
                      onClick={() => makeSpec(item)}
                    >
                      Snipe this
                    </button>
                    <button
                      type="button"
                      className="rounded border border-forge-rust/40 px-2 py-0.5 text-xs text-forge-rust/80 transition-colors hover:bg-forge-rust/10"
                      onClick={() => remove(item.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-forge-gold/40">
            No meta items yet{itemClass ? ` for ${itemClass}` : ""}.
          </p>
        )}
      </div>
    </div>
  );
}
