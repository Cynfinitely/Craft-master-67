import Link from "next/link";

export function SelectedBaseCard({
  name,
  itemClass,
  itemLevel,
  changeHref,
  children,
}: {
  name: string;
  itemClass: string;
  itemLevel?: number;
  changeHref: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="panel p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-forge-gold/80">
            Selected base
          </p>
          <p className="mt-1 truncate text-base font-semibold text-rarity-normal">
            {name}
          </p>
          <p className="text-sm text-forge-gold/80">
            {itemClass}
            {itemLevel != null ? (
              <span className="ml-1 text-forge-gold/80">· iLvl {itemLevel}</span>
            ) : null}
          </p>
        </div>
        {children}
      </div>
      <Link href={changeHref} className="btn mt-3 w-full">
        Change base
      </Link>
    </div>
  );
}
