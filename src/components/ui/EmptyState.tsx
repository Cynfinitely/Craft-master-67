/** Centered placeholder for "nothing here yet" / "no results" panels. */
export function EmptyState({
  title,
  children,
  action,
  className = "",
}: {
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`panel px-4 py-8 text-center sm:px-8 ${className}`}>
      {title ? <p className="font-semibold text-forge-goldbright">{title}</p> : null}
      {children ? (
        <div className={`mx-auto max-w-prose text-sm text-forge-muted ${title ? "mt-1" : ""}`}>
          {children}
        </div>
      ) : null}
      {action ? <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}
