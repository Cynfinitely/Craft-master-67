import type { GemCorruptionResultRow } from "@/db/schema";

/** Real-currency listings needed before a floor counts as a liquid market price
 * (mirrors LIQUID_MIN_LISTINGS in the scanner). Below this the gem is "thin". */
const LIQUID_MIN_LISTINGS = 3;

function isLiquidPriced(row: GemCorruptionResultRow): boolean {
  return (
    row.status === "priced" &&
    row.floorPriceExalted != null &&
    (row.listingCount ?? 0) >= LIQUID_MIN_LISTINGS
  );
}

function isThinPriced(row: GemCorruptionResultRow): boolean {
  return (
    row.status === "priced" &&
    row.floorPriceExalted != null &&
    (row.listingCount ?? 0) < LIQUID_MIN_LISTINGS
  );
}

function fmtEx(value: number | null | undefined): string {
  if (value == null) return "—";
  const abs = Math.abs(value);
  if (abs >= 1000) return `${(value / 1000).toFixed(1)}k ex`;
  if (abs >= 100) return `${Math.round(value)} ex`;
  if (abs >= 10) return `${value.toFixed(1)} ex`;
  return `${value.toFixed(2)} ex`;
}

function fmtDiv(value: number | null | undefined, divinePrice: number): string {
  if (value == null || divinePrice <= 0) return "—";
  return `${(value / divinePrice).toFixed(2)} div`;
}

function sortGemRows(rows: GemCorruptionResultRow[]): GemCorruptionResultRow[] {
  const tier = (row: GemCorruptionResultRow) => {
    if (row.status === "error") return 4;
    if (row.status === "no_listings") return 3;
    if (row.status === "pending") return 2;
    if (isThinPriced(row)) return 1; // priced but illiquid (single whale)
    return 0; // priced + liquid
  };

  return [...rows].sort((a, b) => {
    const dt = tier(a) - tier(b);
    if (dt !== 0) return dt;

    const af = a.floorPriceExalted ?? a.corruptedPriceExalted;
    const bf = b.floorPriceExalted ?? b.corruptedPriceExalted;
    if (af != null && bf != null) return bf - af;
    if (af != null) return -1;
    if (bf != null) return 1;
    return a.gemType.localeCompare(b.gemType);
  });
}

const LEGACY_ERROR_HINT =
  "PoE2 trade API rate limit or timeout (legacy scan — will retry)";

function errorNote(row: GemCorruptionResultRow): string | null {
  if (row.status !== "error") return null;
  return row.errorMessage?.trim() || LEGACY_ERROR_HINT;
}

function StatusBadge({
  status,
  errorMessage,
}: {
  status: string | null;
  errorMessage?: string | null;
}) {
  if (status === "pending") {
    return (
      <span className="animate-pulse rounded bg-affix-suffix/15 px-1.5 py-0.5 text-[10px] text-affix-suffix">
        queued
      </span>
    );
  }
  if (status === "no_listings") {
    return (
      <span className="rounded bg-forge-panel2 px-1.5 py-0.5 text-[10px] text-forge-gold/50">
        no listings
      </span>
    );
  }
  if (status === "error") {
    const label = errorMessage?.trim() || "retry pending";
    return (
      <span
        className="max-w-[220px] truncate rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] text-amber-200/90"
        title={errorMessage?.trim() || LEGACY_ERROR_HINT}
      >
        {label.length > 40 ? `${label.slice(0, 37)}…` : label}
      </span>
    );
  }
  return null;
}

export function GemCorruptionTable({
  rows,
  divinePrice,
}: {
  rows: GemCorruptionResultRow[];
  divinePrice: number;
}) {
  if (rows.length === 0) {
    return (
      <div className="panel p-8 text-center text-forge-gold/50">
        <p>No 21/20 gem prices yet.</p>
        <p className="mt-2 text-xs text-forge-gold/40">
          Click &ldquo;Scan all gems&rdquo; above — it finds the handful of gems
          worth corrupting and prices their floors automatically (~1–3 min, no
          extra terminal).
        </p>
      </div>
    );
  }

  const sorted = sortGemRows(rows);
  const priced = sorted.filter(
    (r) => r.status === "priced" && r.floorPriceExalted != null,
  );
  const liquidCount = sorted.filter(isLiquidPriced).length;
  const thinCount = sorted.filter(isThinPriced).length;
  const errorCount = sorted.filter((r) => r.status === "error").length;
  const pendingCount = sorted.filter((r) => r.status === "pending").length;

  return (
    <div className="space-y-2">
      <p className="text-xs text-forge-gold/50">
        Ranked by cheapest corrupted level-21 / 20%-quality listing (exalted
        equivalent) — highest floor = most profitable to corrupt and sell.{" "}
        {liquidCount} liquid of {priced.length} priced gems.
      </p>
      {thinCount > 0 ? (
        <p className="text-[11px] text-amber-200/70">
          {thinCount} gem{thinCount === 1 ? "" : "s"} have fewer than{" "}
          {LIQUID_MIN_LISTINGS} listings (marked <span className="font-medium">thin</span>) —
          treat those floors as a single seller&apos;s ask, not a market price.
        </p>
      ) : null}
      {pendingCount > 0 ? (
        <p className="text-[11px] text-affix-suffix/80">
          {pendingCount} gem{pendingCount === 1 ? "" : "s"} still queued —
          floors are being priced now.
        </p>
      ) : null}
      {errorCount > 0 ? (
        <p className="text-[11px] text-forge-gold/40">
          {errorCount} gem{errorCount === 1 ? "" : "s"} failed a trade lookup
          (usually rate limit or timeout). They retry automatically — see the
          Note column for details.
        </p>
      ) : null}
      <div className="panel table-scroll overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="sticky top-0 bg-forge-panel text-left text-xs uppercase tracking-wide text-forge-gold/50">
            <tr className="border-b border-forge-border">
              <th className="px-3 py-2">Gem</th>
              <th className="px-3 py-2">Note</th>
              <th className="px-3 py-2 text-right">Floor (div)</th>
              <th className="px-3 py-2 text-right">Floor (ex)</th>
              <th className="px-3 py-2 text-right">Median</th>
              <th className="px-3 py-2 text-center">Listings</th>
              <th className="px-3 py-2 text-center">Sample</th>
              <th className="px-3 py-2 text-center">Trade</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-forge-border/40">
            {sorted.map((r) => (
              <tr key={r.id} className="hover:bg-forge-panel2/40">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-forge-goldbright">
                      {r.gemType}
                    </span>
                    <StatusBadge
                      status={r.status}
                      errorMessage={errorNote(r)}
                    />
                    {isThinPriced(r) ? (
                      <span
                        className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] text-amber-200/90"
                        title={`Only ${r.listingCount ?? 0} listing(s) — price may not be reliable`}
                      >
                        thin
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="max-w-[240px] px-3 py-2 text-[11px] text-forge-gold/45">
                  {errorNote(r) ??
                    (r.status === "no_listings"
                      ? "No 21/20 listings online"
                      : r.status === "pending"
                        ? "Queued — pricing floor shortly…"
                        : "—")}
                </td>
                <td className="px-3 py-2 text-right font-semibold text-forge-goldbright">
                  {fmtDiv(r.floorPriceExalted, divinePrice)}
                </td>
                <td className="px-3 py-2 text-right text-rarity-rare">
                  {fmtEx(r.floorPriceExalted)}
                </td>
                <td className="px-3 py-2 text-right text-forge-gold/70">
                  {fmtEx(r.medianPriceExalted)}
                </td>
                <td
                  className={`px-3 py-2 text-center ${
                    isThinPriced(r) ? "text-amber-200/80" : "text-forge-gold/60"
                  }`}
                >
                  {r.listingCount ?? r.corruptedListings ?? "—"}
                </td>
                <td className="px-3 py-2 text-center text-forge-gold/50">
                  {r.sampleCount ?? "—"}
                </td>
                <td className="px-3 py-2 text-center">
                  {r.tradeUrl || r.tradeUrlCorrupted ? (
                    <a
                      href={r.tradeUrl ?? r.tradeUrlCorrupted ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-affix-suffix text-xs hover:underline"
                    >
                      trade
                    </a>
                  ) : (
                    <span className="text-forge-gold/30">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
