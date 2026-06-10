/** Shared loading skeleton for pages backed by slow trade/price lookups. */
export function PageSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="h-7 w-56 animate-pulse rounded bg-forge-panel2" />
        <div className="h-4 w-80 animate-pulse rounded bg-forge-panel2/70" />
      </div>
      <div className="panel animate-pulse p-4">
        <div className="h-9 w-full max-w-md rounded bg-forge-panel2" />
      </div>
      <div className="panel animate-pulse space-y-3 p-4">
        <div className="h-4 w-2/3 rounded bg-forge-panel2" />
        <div className="h-4 w-1/2 rounded bg-forge-panel2" />
        <div className="h-4 w-3/5 rounded bg-forge-panel2" />
        <div className="h-4 w-2/5 rounded bg-forge-panel2" />
      </div>
      <p className="text-center text-xs text-forge-gold/45">{label}</p>
    </div>
  );
}
