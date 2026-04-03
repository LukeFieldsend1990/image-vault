"use client";

import { useState, useRef, useEffect, useCallback } from "react";

export interface AutocompleteOption {
  id: string;
  label: string;
  sublabel?: string;
}

interface AutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (option: AutocompleteOption) => void;
  onCreateNew?: (value: string) => void;
  fetchOptions: (query: string) => Promise<AutocompleteOption[]>;
  placeholder?: string;
  label?: string;
  required?: boolean;
  createLabel?: string; // e.g. "Create new production"
  className?: string;
}

export function Autocomplete({
  value,
  onChange,
  onSelect,
  onCreateNew,
  fetchOptions,
  placeholder,
  label,
  required,
  createLabel = "Create new",
  className,
}: AutocompleteProps) {
  const [options, setOptions] = useState<AutocompleteOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const inputClass = "w-full rounded border px-3 py-2 text-sm outline-none focus:ring-1 transition";
  const inputStyle = { borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" };

  const doSearch = useCallback(
    async (q: string) => {
      if (q.length < 2) {
        setOptions([]);
        setOpen(false);
        return;
      }
      setLoading(true);
      try {
        const results = await fetchOptions(q);
        setOptions(results);
        setOpen(true);
        setActiveIndex(-1);
      } catch {
        setOptions([]);
      } finally {
        setLoading(false);
      }
    },
    [fetchOptions]
  );

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    onChange(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(v), 300);
  }

  function handleSelect(option: AutocompleteOption) {
    onChange(option.label);
    onSelect(option);
    setOpen(false);
    setActiveIndex(-1);
  }

  function handleCreateNew() {
    if (onCreateNew) onCreateNew(value);
    setOpen(false);
    setActiveIndex(-1);
  }

  // Total items: options + create-new if applicable
  const showCreate = onCreateNew && value.trim().length >= 2 && !options.some((o) => o.label.toLowerCase() === value.trim().toLowerCase());
  const totalItems = options.length + (showCreate ? 1 : 0);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown" && value.length >= 2) {
        doSearch(value);
        return;
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i < totalItems - 1 ? i + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i > 0 ? i - 1 : totalItems - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < options.length) {
        handleSelect(options[activeIndex]);
      } else if (activeIndex === options.length && showCreate) {
        handleCreateNew();
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={containerRef} className={`relative ${className ?? ""}`}>
      {label && (
        <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--color-text)" }}>
          {label} {required && "*"}
        </label>
      )}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (value.length >= 2 && options.length > 0) setOpen(true); }}
          placeholder={placeholder}
          className={inputClass}
          style={inputStyle}
          autoComplete="off"
        />
        {loading && (
          <span
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs"
            style={{ color: "var(--color-muted)" }}
          >
            ...
          </span>
        )}
      </div>

      {open && totalItems > 0 && (
        <div
          className="absolute z-50 mt-1 w-full overflow-hidden rounded border shadow-lg"
          style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}
        >
          {options.map((option, i) => (
            <button
              key={option.id}
              type="button"
              onClick={() => handleSelect(option)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition"
              style={{
                background: i === activeIndex ? "var(--color-surface)" : "transparent",
                color: "var(--color-text)",
              }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <span className="flex-shrink-0 text-xs" style={{ color: "var(--color-muted)" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="7" width="20" height="15" rx="2" />
                  <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
                </svg>
              </span>
              <span className="flex-1 truncate">
                <span className="font-medium">{option.label}</span>
                {option.sublabel && (
                  <span className="ml-1.5 text-xs" style={{ color: "var(--color-muted)" }}>
                    {option.sublabel}
                  </span>
                )}
              </span>
            </button>
          ))}

          {showCreate && (
            <button
              type="button"
              onClick={handleCreateNew}
              className="flex w-full items-center gap-2 border-t px-3 py-2 text-left text-sm transition"
              style={{
                background: activeIndex === options.length ? "var(--color-surface)" : "transparent",
                color: "var(--color-accent)",
                borderColor: "var(--color-border)",
              }}
              onMouseEnter={() => setActiveIndex(options.length)}
            >
              <span className="flex-shrink-0 text-xs">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </span>
              <span>{createLabel} &ldquo;{value.trim()}&rdquo;</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
