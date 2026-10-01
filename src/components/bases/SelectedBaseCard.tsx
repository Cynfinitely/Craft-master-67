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
          <p className="label uppercase tracking-wide">
            Selected base
          </p>
          <p className="mt-1 break-words text-base font-semibold text-rarity-normal">
            {name}
          </p>
          <p className="text-sm text-forge-muted">
            {itemClass}
            {itemLevel != null ? (
              <span className="num ml-1">· iLvl {itemLevel}</span>
            ) : null}
          </p>
        </div>
        {children}
      </div>
      <Link href={changeHref} className="btn tap mt-3 w-full">
        Change base
        <span className="sr-only"> (currently {name})</span>
      </Link>
    </div>
  );
}
