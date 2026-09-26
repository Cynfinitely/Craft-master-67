"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let lockCount = 0;

function lockScroll() {
  lockCount += 1;
  if (lockCount === 1) {
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
  }
}

function unlockScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.documentElement.style.overflow = "";
    document.body.style.overflow = "";
  }
}

/**
 * Viewport-level overlay panel. Rendered into `document.body` so no ancestor
 * transform/filter/backdrop-filter can trap its `position: fixed`.
 */
export function Sheet({
  open,
  onClose,
  title,
  side = "right",
  children,
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  side?: "right" | "left" | "bottom";
  children: React.ReactNode;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    lockScroll();
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      unlockScroll();
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  const placement =
    side === "bottom"
      ? "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-xl border-t"
      : side === "left"
        ? "inset-y-0 left-0 w-[min(22rem,88vw)] border-r"
        : "inset-y-0 right-0 w-[min(22rem,88vw)] border-l";

  return createPortal(
    <div className="fixed inset-0 z-[100]" role="presentation">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close"
        className="absolute inset-0 h-full w-full cursor-default bg-black/55"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`absolute flex flex-col overflow-hidden border-forge-border bg-forge-panel shadow-2xl ${placement} ${className}`}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-center justify-between gap-2 border-b border-forge-border px-4 py-2">
          <p className="text-sm font-semibold text-forge-goldbright">{title}</p>
          <button type="button" className="btn tap" onClick={onClose} aria-label={`Close ${title}`}>
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
