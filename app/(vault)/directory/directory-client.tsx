"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";

// ── Types ───────────────────────────────────────────────────────────────────

interface TalentRow {
  id: string;
  email: string;
  fullName: string | null;
  profileImageUrl: string | null;
  packageCount: number;
}

interface StructuredTag {
  tag: string;
  category: string;
  status: string;
}

interface PackageResult {
  id: string;
  name: string;
  description: string | null;
  talentId: string;
  status: string;
  coverImageKey: string | null;
  totalSizeBytes: number | null;
  createdAt: number;
  tags: string | null;
  structuredTags: StructuredTag[];
  talentName?: string | null;
  matchType: "keyword" | "semantic" | "both";
  relevanceScore: number | null;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function DirectoryClient() {
  const [talent, setTalent] = useState<TalentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search state
  const [query, setQuery] = useState("");
  const [keywordResults, setKeywordResults] = useState<PackageResult[]>([]);
  const [semanticResults, setSemanticResults] = useState<PackageResult[]>([]);
  const [searchingKeyword, setSearchingKeyword] = useState(false);
  const [searchingSemantic, setSearchingSemantic] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Load talent directory
  useEffect(() => {
    fetch("/api/talent")
      .then((r) => r.json() as Promise<{ talent?: TalentRow[] }>)
      .then((d) => setTalent(d.talent ?? []))
      .catch(() => setError("Failed to load directory"))
      .finally(() => setLoading(false));
  }, []);

  // Debounced search
  const doSearch = useCallback((q: string) => {
    if (!q.trim()) {
      setKeywordResults([]);
      setSemanticResults([]);
      return;
    }

    const encoded = encodeURIComponent(q.trim());

    // Phase 1: keyword search (fast)
    setSearchingKeyword(true);
    fetch(`/api/vault/packages/search?q=${encoded}&limit=20`)
      .then((r) => r.json() as Promise<{ packages: PackageResult[] }>)
      .then((d) => {
        const results = d.packages.map((p) => ({
          ...p,
          matchType: "keyword" as const,
          relevanceScore: null,
        }));
        setKeywordResults(results);

        // Phase 2: semantic search (exclude keyword IDs)
        setSearchingSemantic(true);
        const excludeIds = results.map((p) => p.id).join(",");
        return fetch(
          `/api/vault/packages/search/semantic?q=${encoded}&limit=20&exclude=${excludeIds}`
        );
      })
      .then((r) => {
        if (!r) return;
        return r.json() as Promise<{ packages: PackageResult[] }>;
      })
      .then((d) => {
        if (d) setSemanticResults(d.packages);
      })
      .catch(() => {
        // semantic search failure is non-fatal
      })
      .finally(() => {
        setSearchingKeyword(false);
        setSearchingSemantic(false);
      });
  }, []);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 300);
  };

  const hasQuery = query.trim().length > 0;
  const hasResults = keywordResults.length > 0 || semanticResults.length > 0;
  const isSearching = searchingKeyword || searchingSemantic;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6">
        <h1
          className="text-xl font-semibold tracking-tight"
          style={{ color: "var(--color-ink)" }}
        >
          Talent Directory
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
          Browse available talent or search packages by description.
        </p>
      </div>

      {/* Search bar */}
      <div className="mb-8">
        <input
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="Search packages — try 'full body scan for Unreal' or 'studio-lit head closeup'"
          className="w-full rounded border px-4 py-2.5 text-sm outline-none transition focus:ring-1"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-surface)",
            color: "var(--color-ink)",
          }}
        />
      </div>

      {/* Search results */}
      {hasQuery && (
        <div className="mb-10">
          {/* Keyword results */}
          {keywordResults.length > 0 && (
            <div className="mb-6">
              <h2
                className="mb-3 text-xs font-medium uppercase tracking-widest"
                style={{ color: "var(--color-muted)" }}
              >
                Keyword matches
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {keywordResults.map((pkg) => (
                  <PackageCard key={pkg.id} pkg={pkg} />
                ))}
              </div>
            </div>
          )}

          {/* Semantic results */}
          {semanticResults.length > 0 && (
            <div className="mb-6">
              <h2
                className="mb-3 text-xs font-medium uppercase tracking-widest"
                style={{ color: "var(--color-muted)" }}
              >
                Related packages
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {semanticResults.map((pkg) => (
                  <PackageCard key={pkg.id} pkg={pkg} />
                ))}
              </div>
            </div>
          )}

          {/* Loading / empty states */}
          {searchingKeyword && keywordResults.length === 0 && (
            <p className="text-sm" style={{ color: "var(--color-muted)" }}>
              Searching...
            </p>
          )}
          {!searchingKeyword && searchingSemantic && keywordResults.length === 0 && (
            <p className="text-sm" style={{ color: "var(--color-muted)" }}>
              Searching for related packages...
            </p>
          )}
          {!isSearching && !hasResults && (
            <p className="text-sm" style={{ color: "var(--color-muted)" }}>
              No packages found. Try different search terms or browse talent below.
            </p>
          )}

          {/* Separator */}
          <hr className="mt-6" style={{ borderColor: "var(--color-border)" }} />
        </div>
      )}

      {/* Talent directory */}
      <div>
        {!hasQuery && (
          <h2
            className="mb-4 text-xs font-medium uppercase tracking-widest"
            style={{ color: "var(--color-muted)" }}
          >
            All talent
          </h2>
        )}

        {loading && (
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>
            Loading...
          </p>
        )}
        {error && (
          <p className="text-sm" style={{ color: "var(--color-danger)" }}>
            {error}
          </p>
        )}

        {!loading && !error && talent.length === 0 && (
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>
            No talent available at this time.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {talent.map((t) => (
            <Link
              key={t.id}
              href={`/talent/${t.id}`}
              className="block rounded border p-5 transition hover:shadow-sm"
              style={{
                borderColor: "var(--color-border)",
                background: "var(--color-surface)",
              }}
            >
              {t.profileImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={t.profileImageUrl}
                  alt={t.fullName ?? t.email}
                  className="mb-3 h-10 w-10 rounded-full object-cover"
                />
              ) : (
                <div
                  className="mb-3 flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold"
                  style={{ background: "var(--color-ink)", color: "#fff" }}
                >
                  {(t.fullName ?? t.email)[0].toUpperCase()}
                </div>
              )}
              <p
                className="truncate text-sm font-medium"
                style={{ color: "var(--color-ink)" }}
              >
                {t.fullName ?? t.email}
              </p>
              <p className="mt-1 text-xs" style={{ color: "var(--color-muted)" }}>
                {t.packageCount} scan package
                {t.packageCount !== 1 ? "s" : ""} available
              </p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Package result card ─────────────────────────────────────────────────────

function PackageCard({ pkg }: { pkg: PackageResult }) {
  // Show top 3 accepted tags as pills
  const topTags = pkg.structuredTags
    .filter((t) => t.status === "accepted")
    .slice(0, 3);

  // Parse user tags for display
  let userTags: string[] = [];
  if (pkg.tags) {
    try {
      userTags = JSON.parse(pkg.tags);
    } catch {
      /* skip */
    }
  }

  const displayTags = [
    ...topTags.map((t) => t.tag),
    ...userTags.slice(0, Math.max(0, 3 - topTags.length)),
  ].slice(0, 3);

  return (
    <Link
      href={`/talent/${pkg.talentId}`}
      className="block rounded border p-4 transition hover:shadow-sm"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-surface)",
      }}
    >
      <p
        className="truncate text-sm font-medium"
        style={{ color: "var(--color-ink)" }}
      >
        {pkg.name}
      </p>
      {pkg.talentName && (
        <p className="mt-0.5 text-xs" style={{ color: "var(--color-muted)" }}>
          {pkg.talentName}
        </p>
      )}
      {pkg.description && (
        <p
          className="mt-1 line-clamp-2 text-xs"
          style={{ color: "var(--color-muted)" }}
        >
          {pkg.description}
        </p>
      )}

      {/* Tag pills */}
      {displayTags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {displayTags.map((tag) => (
            <span
              key={tag}
              className="rounded px-1.5 py-0.5 text-[10px]"
              style={{
                background: "var(--color-bg)",
                color: "var(--color-muted)",
                border: "1px solid var(--color-border)",
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Match type indicator */}
      {pkg.matchType === "semantic" && (
        <p
          className="mt-2 text-[10px] uppercase tracking-wide"
          style={{ color: "var(--color-accent, #c0392b)" }}
        >
          Related
        </p>
      )}
    </Link>
  );
}
