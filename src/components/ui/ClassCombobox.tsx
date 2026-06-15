"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export interface ClassCategory {
  category: string;
  classes: string[];
}

export function ClassCombobox({
  categories,
  value,
  onChange,
  placeholder = "Choose an item class…",
  className = "",
}: {
  categories: ClassCategory[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);

  const flat = useMemo(
    () =>
      categories.flatMap((cat) =>
        cat.classes.map((c) => ({ category: cat.category, className: c })),
      ),
    [categories],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return flat;
    return flat.filter(
      (row) =>
        row.className.toLowerCase().includes(needle) ||
        row.category.toLowerCase().includes(needle),
    );
  }, [flat, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const row of filtered) {
      const list = map.get(row.category) ?? [];
      list.push(row.className);
      map.set(row.category, list);
    }
    return [...map.entries()];
  }, [filtered]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  const select = (className: string) => {
    onChange(className);
    setOpen(false);
    setQuery("");
  };

  const clear = () => {
    onChange("");
    setOpen(false);
    setQuery("");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setHighlight((h) => Math.min(h + 1, Math.max(0, filtered.length - 1)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[highlight]) select(filtered[highlight].className);
      return;
    }
  };

  let flatIndex = -1;

  return (
    <div ref={rootRef} className={`relative min-w-0 flex-1 ${className}`}>
      <div className="relative">
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          className="input pr-8"
          placeholder={value || placeholder}
          value={open ? query : value}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            setQuery("");
          }}
          onKeyDown={onKeyDown}
        />
        {value ? (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-forge-gold/40 hover:text-forge-goldbright"
            aria-label="Clear item class"
            onClick={clear}
          >
            ×
          </button>
        ) : null}
      </div>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="combobox-panel absolute z-30 mt-1 max-h-60 w-full overflow-y-auto py-1"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-forge-gold/50">No classes found.</li>
          ) : (
            grouped.map(([category, classes]) => (
              <li key={category}>
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-forge-gold/40">
                  {category}
                </div>
                <ul>
                  {classes.map((c) => {
                    flatIndex += 1;
                    const idx = flatIndex;
                    const active = idx === highlight;
                    return (
                      <li key={c} role="option" aria-selected={value === c}>
                        <button
                          type="button"
                          className={`w-full px-3 py-1.5 text-left text-sm transition-colors ${
                            active || value === c
                              ? "bg-forge-panel2 text-forge-goldbright"
                              : "text-forge-gold/80 hover:bg-forge-panel2/60"
                          }`}
                          onMouseEnter={() => setHighlight(idx)}
                          onClick={() => select(c)}
                        >
                          {c}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
