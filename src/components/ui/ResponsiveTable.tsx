import type { ReactNode } from "react";

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Classes for both the `<th>` and `<td>` in table mode. */
  className?: string;
  /** Shown as the card title on phones instead of as a labelled row. */
  primary?: boolean;
  /** Omitted from the phone card. */
  hideOnMobile?: boolean;
  /** Omitted from the table (use for a combined phone-only card title). */
  hideOnDesktop?: boolean;
  align?: "left" | "right";
}

/**
 * Stacked cards below `sm`, a regular table from `sm` up. Both render from the
 * same column definitions so the two layouts never drift apart.
 */
export function ResponsiveTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  minWidth,
  rowClassName,
  caption,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  empty?: ReactNode;
  /** Minimum table width from `sm` up (e.g. "40rem"); the wrapper scrolls. */
  minWidth?: string;
  rowClassName?: (row: T) => string;
  caption?: string;
}) {
  if (rows.length === 0) {
    return empty ? <div className="py-4 text-sm text-forge-gold/80">{empty}</div> : null;
  }
  const primary = columns.find((c) => c.primary);
  const detail = columns.filter((c) => !c.primary && !c.hideOnMobile);
  const tableColumns = columns.filter((c) => !c.hideOnDesktop);

  return (
    <>
      <ul className="space-y-2 sm:hidden" aria-label={caption}>
        {rows.map((row, i) => (
          <li key={rowKey(row, i)} className={`panel-inset p-3 ${rowClassName?.(row) ?? ""}`}>
            {primary ? (
              <div className="mb-2 min-w-0 break-words text-sm font-semibold text-forge-goldbright">
                {primary.cell(row)}
              </div>
            ) : null}
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
              {detail.map((c) => (
                <div key={c.key} className="contents">
                  <dt className="text-xs text-forge-gold/75">{c.header}</dt>
                  <dd className="min-w-0 break-words text-right text-forge-goldbright">{c.cell(row)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>

      <div className="table-scroll hidden sm:block">
        <table className="w-full text-sm" style={minWidth ? { minWidth } : undefined}>
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead>
            <tr className="border-b border-forge-border text-left text-xs uppercase tracking-wide text-forge-gold/80">
              {tableColumns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={`px-2 py-2 font-semibold ${c.align === "right" ? "text-right" : ""} ${c.className ?? ""}`}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={rowKey(row, i)}
                className={`border-b border-forge-border/50 align-top ${rowClassName?.(row) ?? ""}`}
              >
                {tableColumns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-2 py-2 ${c.align === "right" ? "text-right tabular-nums" : ""} ${c.className ?? ""}`}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
