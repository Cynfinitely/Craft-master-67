/** Loading placeholder for whole pages (variant "page") or one section. */
export function PageSkeleton({
  label,
  variant = "page",
}: {
  label: string;
  variant?: "page" | "section";
}) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="space-y-4">
      {variant === "page" ? (
        <>
          <div className="space-y-2">
            <div className="h-7 w-full max-w-56 animate-pulse rounded bg-forge-panel2" />
            <div className="h-4 w-full max-w-80 animate-pulse rounded bg-forge-panel2/70" />
          </div>
          <div className="panel animate-pulse p-4">
            <div className="h-9 w-full max-w-md rounded bg-forge-panel2" />
          </div>
        </>
      ) : null}
      <div className="panel animate-pulse space-y-3 p-4">
        <div className="h-4 w-2/3 rounded bg-forge-panel2" />
        <div className="h-4 w-1/2 rounded bg-forge-panel2" />
        <div className="h-4 w-3/5 rounded bg-forge-panel2" />
        <div className="h-4 w-2/5 rounded bg-forge-panel2" />
      </div>
      <p className="text-center text-xs text-forge-muted">{label}</p>
    </div>
  );
}
