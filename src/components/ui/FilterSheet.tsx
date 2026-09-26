"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";

/**
 * Filters that stay inline on desktop. Below `lg`, once `collapsed` is set
 * (e.g. a result is already selected), they fold into a one-line summary that
 * opens the same controls in a bottom sheet, so results sit at the top.
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
  const close = useCallback(() => setOpen(false), []);
  const pathname = usePathname();
  const params = useSearchParams();
  const query = params.toString();

  useEffect(() => {
    setOpen(false);
  }, [pathname, query]);

  if (!collapsed) return <>{children}</>;

  return (
    <>
      <div className="lg:hidden">
        <button
          type="button"
          className="panel flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2 text-left"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          <span className="min-w-0">
            <span className="block text-[10px] font-semibold uppercase tracking-wide text-forge-gold/70">
              {title}
            </span>
            <span className="block truncate text-sm text-forge-goldbright">{summary}</span>
          </span>
          <span className="btn shrink-0">Change</span>
        </button>
      </div>
      <div className="hidden space-y-3 lg:block">{children}</div>
      <Sheet open={open} onClose={close} title={title} side="bottom">
        <div className="space-y-3 p-4">{children}</div>
      </Sheet>
    </>
  );
}
