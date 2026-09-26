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
  {
    label: "Market",
    links: [
      { href: "/profit", label: "Profit" },
      { href: "/price", label: "Price Check" },
      { href: "/gems", label: "Gem Corruption" },
      { href: "/tablets", label: "Tablets" },
      { href: "/runs", label: "Runs" },
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
      className={`rounded-md px-3 py-1.5 text-sm transition-colors ${className} ${
        active
          ? "bg-forge-rust/15 text-forge-goldbright ring-1 ring-forge-rust/45"
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
      <nav className="mx-auto flex w-full max-w-6xl items-center gap-2 px-4 py-3 sm:px-6 lg:px-8 xl:max-w-7xl 2xl:max-w-[1400px]">
        <Link
          href="/"
          className="mr-2 flex shrink-0 items-center gap-2 text-forge-goldbright"
        >
          <span className="text-lg font-bold tracking-wide">PoE2</span>
          <span className="hidden text-sm text-forge-gold/70 sm:inline">
            Crafting Helper
          </span>
        </Link>

        <div className="hidden min-w-0 flex-1 flex-wrap items-center gap-1 md:flex xl:gap-x-4">
          {NAV_GROUPS.map((group) => (
            <div
              key={group.label}
              className="flex flex-wrap items-center gap-1 xl:mr-1"
            >
              <span className="hidden px-1 text-[10px] font-semibold uppercase tracking-wide text-forge-gold/80 xl:inline">
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
          aria-label="Open menu"
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
        <nav aria-label="Main">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="border-b border-forge-border/50 px-4 py-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-forge-gold/80">
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
