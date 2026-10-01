import type { BaseDetail } from "@/lib/data/types";
import { cleanModText } from "@/lib/data/format";

export function BaseHeader({
  base,
  implicitTexts,
  itemLevel,
  children,
}: {
  base: BaseDetail;
  implicitTexts?: Map<string, string | null>;
  itemLevel?: number;
  children?: React.ReactNode;
}) {
  const req = base.requirements ?? {};
  const reqEntries = Object.entries(req).filter(([, v]) => v && v > 0);

  return (
    <div className="panel p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="break-words text-xl font-semibold text-rarity-normal">
            {base.name}
          </h2>
          <p className="text-sm text-forge-muted">
            {base.itemClass}
            {itemLevel ? (
              <span className="num ml-2">· item level {itemLevel}</span>
            ) : null}
          </p>
        </div>
        {children}
      </div>

      {base.implicits.length > 0 ? (
        <ul
          aria-label="Implicit modifiers"
          className="panel-inset num mt-3 px-3 py-2 text-sm text-forge-gold"
        >
          {base.implicits.map((id) => (
            <li key={id}>{cleanModText(implicitTexts?.get(id) ?? id)}</li>
          ))}
        </ul>
      ) : null}

      {reqEntries.length > 0 ? (
        <p className="num mt-3 text-xs text-forge-muted">
          Requires{" "}
          {reqEntries
            .map(([k, v]) => `${v} ${k[0].toUpperCase()}${k.slice(1)}`)
            .join(", ")}
        </p>
      ) : null}

      {base.tags.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1">
          {base.tags.map((t) => (
            <span key={t} className="tag-chip">
              {t}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
