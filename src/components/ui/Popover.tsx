"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const GUTTER = 8;

interface Position {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

/**
 * Floating panel anchored to `anchorRef`, portaled to `document.body` so it is
 * never clipped by an `overflow` ancestor. Flips above the anchor when there
 * is more room there and stays inside the viewport horizontally.
 */
export function Popover({
  open,
  onClose,
  anchorRef,
  children,
  matchWidth = false,
  width = 288,
  maxHeight = 360,
  className = "",
  id,
  role,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement>;
  children: React.ReactNode;
  matchWidth?: boolean;
  width?: number;
  maxHeight?: number;
  className?: string;
  id?: string;
  role?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Position | null>(null);

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(matchWidth ? r.width : width, vw - GUTTER * 2);
    const left = Math.min(Math.max(GUTTER, r.left), vw - w - GUTTER);
    const below = vh - r.bottom - GUTTER;
    const above = r.top - GUTTER;
    const flip = below < Math.min(maxHeight, 200) && above > below;
    const room = Math.max(120, Math.min(maxHeight, flip ? above : below) - 4);
    const panelH = panelRef.current?.offsetHeight ?? room;
    const top = flip ? Math.max(GUTTER, r.top - 4 - Math.min(panelH, room)) : r.bottom + 4;
    setPos({ top, left, width: w, maxHeight: room });
  }, [anchorRef, matchWidth, width, maxHeight]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
    const raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => place();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("resize", onScroll);
    window.addEventListener("scroll", onScroll, true);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, place, onClose, anchorRef]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={panelRef}
      id={id}
      role={role}
      className={`fixed z-[90] overflow-y-auto overscroll-contain rounded-md border border-forge-border bg-forge-panel shadow-lg ${className}`}
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width: pos?.width,
        maxHeight: pos?.maxHeight,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
