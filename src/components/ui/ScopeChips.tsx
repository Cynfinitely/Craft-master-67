"use client";

export interface ScopeOption {
  id: string;
  label: string;
  /** Last time this unit was scanned (ms), shown as an age. */
  at?: number | null;
}

function age(at: number | null | undefined): string {
  if (!at) return "never";
  const mins = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

/**
 * Multi-select chips for scoping a scan to some units. An empty selection
 * means "all". Each chip shows how long ago that unit was last scanned.
 */
export function ScopeChips({
  label,
  options,
  selected,
  onChange,
  disabled = false,
}: {
  label: string;
  options: ScopeOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const all = selected.length === 0 || selected.length === options.length;
  const toggle = (id: string) => {
    const base = all ? [] : selected;
    const next = base.includes(id) ? base.filter((s) => s !== id) : [...base, id];
    onChange(next.length === options.length ? [] : next);
  };
  const chip = (active: boolean) =>
    `tap inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-50 ${
      active
        ? "border-forge-gold bg-forge-gold/15 text-forge-goldbright"
        : "border-forge-border text-forge-gold/75 hover:border-forge-gold/50 hover:text-forge-gold"
    }`;

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`${label} scope`}>
      <span className="mr-1 text-[11px] uppercase tracking-wide text-forge-gold/70">{label}</span>
      <button
        type="button"
        className={chip(all)}
        aria-pressed={all}
        disabled={disabled}
        onClick={() => onChange([])}
      >
        All
      </button>
      {options.map((o) => {
        const active = !all && selected.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            className={chip(active)}
            aria-pressed={active}
            disabled={disabled}
            onClick={() => toggle(o.id)}
            title={o.at ? `Last scanned ${new Date(o.at).toLocaleString()}` : "Never scanned"}
          >
            <span>{o.label}</span>
            <span className="text-[10px] text-forge-gold/60" suppressHydrationWarning>
              {age(o.at)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
