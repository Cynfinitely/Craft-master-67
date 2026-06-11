"use client";

import { useEffect, useMemo, useState } from "react";

export interface SpecSummary {
  id: number;
  name: string;
  itemClass: string;
  baseId: string | null;
  mods: { group: string; minLevel?: number }[];
}

interface BuilderMod {
  group: string;
  label: string;
  side: "prefix" | "suffix";
  desecratedOnly: boolean;
  mapped: boolean;
  tiers: number[];
}

interface BuilderData {
  mods: BuilderMod[];
  bases: { id: string; name: string }[];
}

interface Selection {
  group: string;
  minLevel: number;
}

/**
 * Custom snipe target builder: pick up to 3 prefixes + 3 suffixes (with
 * optional tier floors) and an optional base; save as a spec the scanner can
 * hunt partials for.
 */
export function SnipeBuilder({
  itemClass,
  league,
  specs,
  scanning,
  onSpecsChanged,
  onScan,
}: {
  itemClass: string;
  league: string;
  specs: SpecSummary[];
  scanning: boolean;
  onSpecsChanged: () => void;
  onScan: (specId: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<BuilderData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Selection[]>([]);
  const [baseId, setBaseId] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Lazy-load the mod pool only when the builder is opened.
  useEffect(() => {
    if (!open || data) return;
    let cancelled = false;
    fetch(
      `/api/market/snipe?class=${encodeURIComponent(itemClass)}&league=${encodeURIComponent(league)}&builder=1`,
    )
      .then(async (r) => {
        const body = await r.json();
        if (cancelled) return;
        if (!r.ok) setLoadError(body.error ?? "Failed to load mod pool");
        else setData({ mods: body.mods ?? [], bases: body.bases ?? [] });
      })
      .catch(() => {
        if (!cancelled) setLoadError("Failed to load mod pool");
      });
    return () => {
      cancelled = true;
    };
  }, [open, data, itemClass, league]);

  // Reset the draft when the class changes.
  useEffect(() => {
    setData(null);
    setSelected([]);
    setBaseId("");
    setName("");
    setFilter("");
    setSaveError(null);
  }, [itemClass]);

  const byGroup = useMemo(
    () => new Map((data?.mods ?? []).map((m) => [m.group, m])),
    [data],
  );
  const sideCount = (side: "prefix" | "suffix") =>
    selected.filter((s) => byGroup.get(s.group)?.side === side).length;

  const toggle = (mod: BuilderMod) => {
    setSaveError(null);
    setSelected((prev) => {
      if (prev.some((s) => s.group === mod.group)) {
        return prev.filter((s) => s.group !== mod.group);
      }
      if (sideCount(mod.side) >= 3) return prev;
      return [...prev, { group: mod.group, minLevel: 0 }];
    });
  };

  const setTier = (group: string, minLevel: number) => {
    setSelected((prev) =>
      prev.map((s) => (s.group === group ? { ...s, minLevel } : s)),
    );
  };

  const autoName = useMemo(() => {
    const labels = selected
      .map((s) => byGroup.get(s.group)?.label ?? s.group)
      .slice(0, 3);
    return labels.length
      ? `${itemClass}: ${labels.join(" + ")}${selected.length > 3 ? " +…" : ""}`
      : "";
  }, [selected, byGroup, itemClass]);

  const save = async (thenScan: boolean) => {
    if (selected.length < 2) {
      setSaveError("Pick at least 2 mods (one to require, one to finish).");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const r = await fetch("/api/market/snipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          league,
          itemClass,
          baseId: baseId || null,
          name: (name.trim() || autoName).slice(0, 80),
          mods: selected.map((s) =>
            s.minLevel > 0
              ? { group: s.group, minLevel: s.minLevel }
              : { group: s.group },
          ),
        }),
      });
      const body = await r.json();
      if (!r.ok) {
        setSaveError(body.error ?? "Failed to save spec");
        return;
      }
      setSelected([]);
      setName("");
      onSpecsChanged();
      if (thenScan && body.spec?.id) onScan(body.spec.id);
    } catch {
      setSaveError("Failed to save spec");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await fetch("/api/market/snipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id }),
      });
      onSpecsChanged();
    } catch {
      /* refresh shows the truth */
    }
  };

  const modList = (side: "prefix" | "suffix") => {
    const f = filter.trim().toLowerCase();
    return (data?.mods ?? []).filter(
      (m) =>
        m.side === side &&
        (f === "" || m.label.toLowerCase().includes(f)),
    );
  };

  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-semibold text-forge-goldbright">
            Custom snipe target
          </span>
          <p className="text-xs text-forge-gold/55">
            Define the exact item you want (up to 3 prefixes + 3 suffixes,
            optional tier floors) — the scanner hunts listings one finishable
            mod short of it.
          </p>
        </div>
        <button
          type="button"
          className="rounded border border-forge-gold/40 px-2.5 py-1 text-xs text-forge-gold transition-colors hover:bg-forge-panel2 hover:text-forge-goldbright"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Close builder" : "Build target"}
        </button>
      </div>

      {specs.length > 0 ? (
        <div className="mt-3 space-y-1.5">
          {specs.map((s) => (
            <div
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded border border-forge-border bg-forge-panel2/40 px-2.5 py-1.5"
            >
              <div className="min-w-0">
                <span className="text-sm text-forge-gold/90">{s.name}</span>
                <span className="ml-2 text-[11px] text-forge-gold/45">
                  {s.mods.length} mods
                </span>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <button
                  type="button"
                  className="rounded border border-forge-gold/40 px-2 py-0.5 text-xs text-forge-gold transition-colors hover:bg-forge-panel2 hover:text-forge-goldbright disabled:opacity-50"
                  disabled={scanning}
                  onClick={() => onScan(s.id)}
                >
                  Scan
                </button>
                <button
                  type="button"
                  className="rounded border border-forge-rust/40 px-2 py-0.5 text-xs text-forge-rust/80 transition-colors hover:bg-forge-rust/10"
                  onClick={() => remove(s.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {open ? (
        loadError ? (
          <p className="mt-3 text-sm text-forge-rust">{loadError}</p>
        ) : !data ? (
          <p className="mt-3 text-sm text-forge-gold/50">Loading mod pool…</p>
        ) : (
          <div className="mt-3 space-y-3">
            {selected.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {selected.map((s) => {
                  const mod = byGroup.get(s.group);
                  return (
                    <span
                      key={s.group}
                      className="flex items-center gap-1.5 rounded border border-emerald-700/60 bg-emerald-900/30 px-1.5 py-0.5 text-xs text-emerald-300"
                    >
                      {mod?.label ?? s.group}
                      {mod && mod.tiers.length > 1 ? (
                        <select
                          className="rounded border border-forge-border bg-forge-panel2 px-1 py-0 text-[11px] text-forge-gold"
                          value={s.minLevel}
                          onChange={(e) =>
                            setTier(s.group, Number(e.target.value))
                          }
                        >
                          <option value={0}>any tier</option>
                          {mod.tiers.map((t, i) => (
                            <option key={t} value={t}>
                              T{i + 1}+ (lvl {t})
                            </option>
                          ))}
                        </select>
                      ) : null}
                      <button
                        type="button"
                        className="text-emerald-300/70 hover:text-emerald-200"
                        onClick={() => toggle(mod!)}
                        aria-label="remove"
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
              </div>
            ) : null}

            <input
              type="text"
              placeholder="Filter mods (e.g. resistance, life, spirit)…"
              className="w-full rounded border border-forge-border bg-forge-panel2 px-2.5 py-1.5 text-sm text-forge-gold placeholder:text-forge-gold/30"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              {(["prefix", "suffix"] as const).map((side) => (
                <div key={side}>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-forge-gold/50">
                    {side === "prefix" ? "Prefixes" : "Suffixes"} (
                    {sideCount(side)}/3)
                  </div>
                  <div className="max-h-56 space-y-0.5 overflow-y-auto rounded border border-forge-border bg-forge-panel2/30 p-1.5">
                    {modList(side).map((m) => {
                      const isSel = selected.some((s) => s.group === m.group);
                      const disabled =
                        !isSel && sideCount(side) >= 3;
                      return (
                        <button
                          key={m.group}
                          type="button"
                          disabled={disabled}
                          onClick={() => toggle(m)}
                          className={`flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left text-xs transition-colors ${
                            isSel
                              ? "bg-emerald-900/40 text-emerald-300"
                              : disabled
                                ? "text-forge-gold/25"
                                : "text-forge-gold/80 hover:bg-forge-panel2"
                          }`}
                        >
                          <span className="min-w-0 truncate">{m.label}</span>
                          <span className="flex shrink-0 gap-1">
                            {m.desecratedOnly ? (
                              <span className="rounded bg-purple-900/50 px-1 text-[10px] text-purple-300">
                                desecrated
                              </span>
                            ) : null}
                            {!m.mapped ? (
                              <span
                                className="rounded bg-forge-rust/20 px-1 text-[10px] text-forge-rust"
                                title="No trade-stat mapping — can be the finished mod, but can't be used as a search filter."
                              >
                                unsearchable
                              </span>
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-xs text-forge-gold/55">
                Base (optional)
                <select
                  className="rounded border border-forge-border bg-forge-panel2 px-2 py-1.5 text-sm text-forge-gold"
                  value={baseId}
                  onChange={(e) => setBaseId(e.target.value)}
                >
                  <option value="">Any base</option>
                  {data.bases.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-forge-gold/55">
                Name
                <input
                  type="text"
                  placeholder={autoName || "My target item"}
                  className="rounded border border-forge-border bg-forge-panel2 px-2.5 py-1.5 text-sm text-forge-gold placeholder:text-forge-gold/30"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="rounded border border-forge-gold/40 px-3 py-1.5 text-sm text-forge-gold transition-colors hover:bg-forge-panel2 hover:text-forge-goldbright disabled:opacity-50"
                disabled={saving || scanning || selected.length < 2}
                onClick={() => save(true)}
              >
                {saving ? "Saving…" : "Save & scan"}
              </button>
              <button
                type="button"
                className="rounded border border-forge-border px-3 py-1.5 text-sm text-forge-gold/70 transition-colors hover:bg-forge-panel2 disabled:opacity-50"
                disabled={saving || selected.length < 2}
                onClick={() => save(false)}
              >
                Save only
              </button>
            </div>
            {saveError ? (
              <p className="text-xs text-forge-rust">{saveError}</p>
            ) : null}
          </div>
        )
      ) : null}
    </div>
  );
}
