import Link from "next/link";
import type { BaseSummary } from "@/lib/data/types";

export function BasePickerList({
  results,
  selectedBaseId,
  itemClass,
  query,
  buildBaseHref,
  maxHeight = "70vh",
}: {
  results: BaseSummary[];
  selectedBaseId?: string;
  itemClass?: string;
  query?: string;
  buildBaseHref: (baseId: string) => string;
  maxHeight?: string;
}) {
  return (
    <div
      className="panel overflow-y-auto"
      style={{ maxHeight }}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-forge-border/50 px-4 py-2">
        <span className="text-xs text-forge-gold/50">
          {results.length} base{results.length === 1 ? "" : "s"}
        </span>
        {itemClass ? <span className="tag-chip">{itemClass}</span> : null}
        {query?.trim() ? (
          <span className="tag-chip">&ldquo;{query.trim()}&rdquo;</span>
        ) : null}
      </div>
      <ul className="divide-y divide-forge-border/50">
        {results.map((b) => {
          const active = b.id === selectedBaseId;
          return (
            <li key={b.id}>
              <Link
                href={buildBaseHref(b.id)}
                className={`flex items-center justify-between gap-2 px-4 py-2 text-sm transition-colors ${
                  active
                    ? "bg-forge-panel2 text-forge-goldbright"
                    : "text-forge-gold/80 hover:bg-forge-panel2/60"
                }`}
              >
                <span className="min-w-0 truncate">{b.name}</span>
                <span className="shrink-0 text-[11px] text-forge-gold/40">
                  {b.itemClass}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
