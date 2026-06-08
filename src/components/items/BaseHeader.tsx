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
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-rarity-normal">
            {base.name}
          </h2>
          <p className="text-sm text-forge-gold/60">
            {base.itemClass}
            {itemLevel ? (
              <span className="ml-2 text-forge-gold/40">
                · item level {itemLevel}
              </span>
            ) : null}
          </p>
        </div>
        {children}
      </div>

      {base.implicits.length > 0 ? (
        <div className="mt-3 rounded border border-forge-border/60 bg-forge-bg/40 px-3 py-2 text-sm text-affix-prefix/90">
          {base.implicits.map((id) => (
            <div key={id}>
              {cleanModText(implicitTexts?.get(id) ?? id)}
            </div>
          ))}
        </div>
      ) : null}

      {reqEntries.length > 0 ? (
        <p className="mt-3 text-xs text-forge-gold/50">
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
