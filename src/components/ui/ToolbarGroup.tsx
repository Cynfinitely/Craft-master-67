export function ToolbarGroup({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex min-w-0 flex-wrap items-center gap-2 ${className}`}
    >
      {children}
    </div>
  );
}
