"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";

const NAV_GROUPS = [
  {
    label: "Browse",
    links: [
      { href: "/items", label: "Items & Mods" },
      { href: "/materials", label: "Materials" },
    ],
  },
  {
    label: "Plan",
    links: [
      { href: "/craft", label: "Crafting Planner" },
      { href: "/plans", label: "Saved" },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || (href !== "/" && pathname.startsWith(href));
}

function NavLink({
  href,
  label,
  active,
  onNavigate,
  className = "",
}: {
  href: string;
  label: string;
  active: boolean;
  onNavigate?: () => void;
  className?: string;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`rounded-md px-3 py-1.5 text-sm transition-colors ${className} ${
        active
          ? "bg-forge-rust/15 font-semibold text-forge-goldbright ring-1 ring-forge-rust/45"
          : "text-forge-gold hover:bg-forge-panel2 hover:text-forge-goldbright"
      }`}
    >
      {label}
    </Link>
  );
}

export function SiteNav() {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = () => mq.matches && setDrawerOpen(false);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [drawerOpen]);

  return (
    <header className="sticky top-0 z-50 border-b border-forge-border bg-forge-panel shadow-sm">
      <a
        href="#main"
        className="btn sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-[60]"
      >
        Skip to content
      </a>
      <nav aria-label="Main" className="container-shell flex items-center gap-2 py-3">
        <Link
          href="/"
          className="mr-2 flex shrink-0 items-center gap-2 text-forge-goldbright"
          aria-label="PoE2 Crafting Helper — home"
        >
          <span className="text-lg font-bold tracking-wide">PoE2</span>
          <span className="hidden text-sm text-forge-muted sm:inline">
            Crafting Helper
          </span>
        </Link>

        <div className="hidden min-w-0 flex-1 flex-wrap items-center gap-1 md:flex xl:gap-x-4">
          {NAV_GROUPS.map((group) => (
            <div
              key={group.label}
              className="flex flex-wrap items-center gap-1 xl:mr-1"
            >
              <span className="hidden px-1 text-2xs font-semibold uppercase tracking-wide text-forge-muted xl:inline">
                {group.label}
              </span>
              {group.links.map((link) => (
                <NavLink
                  key={link.href}
                  href={link.href}
                  label={link.label}
                  active={isActive(pathname, link.href)}
                />
              ))}
            </div>
          ))}
        </div>

        <button
          type="button"
          className="btn tap ml-auto md:hidden"
          aria-expanded={drawerOpen}
          aria-haspopup="dialog"
          onClick={() => setDrawerOpen(true)}
        >
          <span aria-hidden className="flex flex-col gap-[3px]">
            <span className="block h-0.5 w-4 rounded bg-current" />
            <span className="block h-0.5 w-4 rounded bg-current" />
            <span className="block h-0.5 w-4 rounded bg-current" />
          </span>
          Menu
        </button>
      </nav>

      <Sheet open={drawerOpen} onClose={closeDrawer} title="Menu" side="right">
        <nav aria-label="Main (mobile)">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="border-b border-forge-border/50 px-4 py-3">
              <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-forge-muted">
                {group.label}
              </p>
              <div className="flex flex-col gap-1">
                {group.links.map((link) => (
                  <NavLink
                    key={link.href}
                    href={link.href}
                    label={link.label}
                    active={isActive(pathname, link.href)}
                    onNavigate={closeDrawer}
                    className="flex min-h-11 w-full items-center text-left text-base"
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>
      </Sheet>
    </header>
  );
}
