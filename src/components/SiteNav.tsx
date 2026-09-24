"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

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
          ? "bg-forge-panel2 text-forge-goldbright"
          : "text-forge-gold/70 hover:bg-forge-panel2 hover:text-forge-goldbright"
      }`}
    >
      {label}
    </Link>
  );
}

export function SiteNav() {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  return (
    <header
      className="border-b border-forge-border bg-forge-panel/80 backdrop-blur [--nav-height:3.25rem]"
      style={{ minHeight: "var(--nav-height)" }}
    >
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

        <div className="hidden flex-1 flex-wrap items-center gap-1 md:flex xl:gap-x-4">
          {NAV_GROUPS.map((group) => (
            <div
              key={group.label}
              className="flex flex-wrap items-center gap-1 xl:mr-1"
            >
              <span className="hidden px-1 text-[10px] font-semibold uppercase tracking-wide text-forge-gold/35 xl:inline">
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
          className="btn ml-auto md:hidden"
          aria-expanded={drawerOpen}
          aria-label={drawerOpen ? "Close menu" : "Open menu"}
          onClick={() => setDrawerOpen((o) => !o)}
        >
          {drawerOpen ? "Close" : "Menu"}
        </button>
      </nav>

      {drawerOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="nav-drawer fixed inset-x-0 top-[var(--nav-height)] z-50 max-h-[calc(100vh-var(--nav-height))] overflow-y-auto border-b border-forge-border md:hidden">
            {NAV_GROUPS.map((group) => (
              <div key={group.label} className="border-b border-forge-border/50 px-4 py-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-forge-gold/40">
                  {group.label}
                </p>
                <div className="flex flex-col gap-1">
                  {group.links.map((link) => (
                    <NavLink
                      key={link.href}
                      href={link.href}
                      label={link.label}
                      active={isActive(pathname, link.href)}
                      onNavigate={() => setDrawerOpen(false)}
                      className="block w-full text-left"
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </header>
  );
}
