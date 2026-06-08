export function SiteFooter() {
  return (
    <footer className="border-t border-forge-border bg-forge-panel/60">
      <div className="mx-auto w-full max-w-6xl px-4 py-4 text-xs text-forge-gold/50">
        <p>
          This product isn&apos;t affiliated with or endorsed by Grinding Gear
          Games in any way.
        </p>
        <p className="mt-1">
          Game data sourced from the community{" "}
          <a
            className="underline hover:text-forge-gold"
            href="https://github.com/repoe-fork/repoe"
            target="_blank"
            rel="noreferrer"
          >
            repoe-fork
          </a>{" "}
          export. Price data from{" "}
          <a
            className="underline hover:text-forge-gold"
            href="https://poe2scout.com/"
            target="_blank"
            rel="noreferrer"
          >
            poe2scout
          </a>
          . Crafting odds are approximate.
        </p>
      </div>
    </footer>
  );
}
