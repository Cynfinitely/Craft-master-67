"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Popover } from "@/components/ui/Popover";

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
  label = "Item class",
  id,
}: {
  categories: ClassCategory[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  /** Accessible name when no visible <label> points at `id`. */
  label?: string;
  id?: string;
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

  const dismiss = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

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

  useEffect(() => {
    if (!open) return;
    document.getElementById(`${listId}-${highlight}`)?.scrollIntoView({ block: "nearest" });
  }, [highlight, open, listId]);

  let flatIndex = -1;

  return (
    <div className={`relative min-w-0 flex-1 ${className}`}>
      <div ref={rootRef} className="relative">
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-label={id ? undefined : label}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={open && filtered[highlight] ? `${listId}-${highlight}` : undefined}
          className="input pr-11"
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
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-lg text-forge-muted hover:text-forge-goldbright"
            aria-label="Clear item class"
            onClick={clear}
          >
            ×
          </button>
        ) : null}
      </div>
      <Popover open={open} onClose={dismiss} anchorRef={rootRef} matchWidth maxHeight={320}>
        <div id={listId} role="listbox" aria-label={label} className="py-1">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-forge-muted">No classes match “{query}”.</p>
          ) : (
            grouped.map(([category, classes]) => (
              <div key={category} role="group" aria-labelledby={`${listId}-g-${category}`}>
                <div
                  id={`${listId}-g-${category}`}
                  className="px-3 py-1 text-2xs font-semibold uppercase tracking-wide text-forge-muted"
                >
                  {category}
                </div>
                {classes.map((c) => {
                  flatIndex += 1;
                  const idx = flatIndex;
                  const active = idx === highlight;
                  const selected = value === c;
                  return (
                    <div
                      key={c}
                      id={`${listId}-${idx}`}
                      role="option"
                      aria-selected={selected}
                      className={`flex cursor-pointer items-center justify-between px-3 py-1.5 text-sm transition-colors max-md:py-2.5 ${
                        active ? "bg-forge-panel2 text-forge-goldbright" : "text-forge-gold"
                      } ${selected ? "font-semibold" : ""}`}
                      onMouseEnter={() => setHighlight(idx)}
                      // Keep focus in the input so typing and arrow keys keep working.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => select(c)}
                    >
                      {c}
                      {selected ? <span aria-hidden>✓</span> : null}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </Popover>
    </div>
  );
}
