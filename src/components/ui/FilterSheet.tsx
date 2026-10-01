"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";

/**
 * Filters that stay inline on desktop. Below `lg`, once `collapsed` is set
 * (e.g. a result is already selected), they fold into a one-line summary that
 * opens the same controls in a bottom sheet, so results sit at the top.
 * The controls are mounted exactly once, so they never hold diverging state.
 */
export function FilterSheet({
  title,
  summary,
  collapsed,
  children,
}: {
  title: string;
  summary: string;
  collapsed: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [isLg, setIsLg] = useState<boolean | null>(null);
  const close = useCallback(() => setOpen(false), []);
  const pathname = usePathname();
  const params = useSearchParams();
  const query = params.toString();

  useEffect(() => {
    setOpen(false);
  }, [pathname, query]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsLg(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  if (!collapsed) return <>{children}</>;
  if (isLg) return <div className="space-y-3">{children}</div>;

  const summaryButton = (
    <button
      type="button"
      className="panel flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2 text-left"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => setOpen(true)}
    >
      <span className="min-w-0">
        <span className="block text-2xs font-semibold uppercase tracking-wide text-forge-muted">
          {title}
        </span>
        <span className="block truncate text-sm text-forge-goldbright">{summary}</span>
      </span>
      <span className="btn shrink-0">Change</span>
    </button>
  );

  // Before hydration we don't know the viewport: CSS picks the right shell.
  if (isLg === null) {
    return (
      <>
        <div className="lg:hidden">{summaryButton}</div>
        <div className="hidden space-y-3 lg:block">{children}</div>
      </>
    );
  }

  return (
    <>
      {summaryButton}
      <Sheet open={open} onClose={close} title={title} side="bottom">
        <div className="space-y-3 p-4">{children}</div>
      </Sheet>
    </>
  );
}
