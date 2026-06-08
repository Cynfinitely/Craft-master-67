"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/items", label: "Items & Mods" },
  { href: "/materials", label: "Materials" },
  { href: "/craft", label: "Crafting Planner" },
  { href: "/price", label: "Price Check" },
  { href: "/plans", label: "Saved" },
];

export function SiteNav() {
  const pathname = usePathname();

  return (
    <header className="border-b border-forge-border bg-forge-panel/80 backdrop-blur">
      <nav className="mx-auto flex w-full max-w-6xl items-center gap-1 px-4 py-3">
        <Link
          href="/"
          className="mr-4 flex items-center gap-2 text-forge-goldbright"
        >
          <span className="text-lg font-bold tracking-wide">PoE2</span>
          <span className="hidden text-sm text-forge-gold/70 sm:inline">
            Crafting Helper
          </span>
        </Link>
        <div className="flex flex-wrap items-center gap-1">
          {LINKS.slice(1).map((link) => {
            const active =
              pathname === link.href ||
              (link.href !== "/" && pathname.startsWith(link.href));
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-forge-panel2 text-forge-goldbright"
                    : "text-forge-gold/70 hover:bg-forge-panel2 hover:text-forge-goldbright"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </header>
  );
}
