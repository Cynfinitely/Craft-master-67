import Link from "next/link";
import type { BaseSummary } from "@/lib/data/types";

/** Matches the default `limit` of searchBases() in src/lib/data/queries.ts. */
const DEFAULT_RESULT_LIMIT = 60;

export function BasePickerList({
  results,
  selectedBaseId,
  itemClass,
  query,
  buildBaseHref,
  maxHeight = "70vh",
  resultLimit = DEFAULT_RESULT_LIMIT,
}: {
  results: BaseSummary[];
  selectedBaseId?: string;
  itemClass?: string;
  query?: string;
  buildBaseHref: (baseId: string) => string;
  maxHeight?: string;
  /** Search cap; when reached the count tells the user to refine. */
  resultLimit?: number;
}) {
  const capped = results.length >= resultLimit;

  return (
    <div className="panel overflow-y-auto" style={{ maxHeight }}>
      <div className="flex flex-wrap items-center gap-2 border-b border-forge-border/50 px-4 py-2">
        <span role="status" className="num text-xs text-forge-muted">
          {capped
            ? `Showing the first ${resultLimit} — refine your search`
            : `${results.length} base${results.length === 1 ? "" : "s"}`}
        </span>
        {itemClass ? <span className="tag-chip">{itemClass}</span> : null}
        {query?.trim() ? (
          <span className="tag-chip">&ldquo;{query.trim()}&rdquo;</span>
        ) : null}
      </div>
      <ul aria-label="Matching bases" className="divide-y divide-forge-border/50">
        {results.map((b) => {
          const active = b.id === selectedBaseId;
          return (
            <li key={b.id}>
              <Link
                href={buildBaseHref(b.id)}
                aria-current={active ? "true" : undefined}
                className={`flex items-center justify-between gap-2 border-l-2 px-4 py-2 text-sm transition-colors max-md:min-h-11 ${
                  active
                    ? "border-forge-rust bg-forge-panel2 font-semibold text-forge-goldbright"
                    : "border-transparent text-forge-gold hover:bg-forge-panel2 hover:text-forge-goldbright"
                }`}
              >
                <span className="min-w-0 truncate">{b.name}</span>
                <span className="shrink-0 text-2xs font-normal text-forge-muted">
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
