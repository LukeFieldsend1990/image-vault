"use client";

import { useState } from "react";

const CATEGORIES = [
  { value: "", label: "All categories" },
  { value: "download", label: "Download" },
  { value: "licence", label: "Licence" },
  { value: "auth", label: "Auth" },
  { value: "bridge", label: "Bridge" },
  { value: "vault", label: "Vault" },
  { value: "invite", label: "Invite" },
  { value: "admin", label: "Admin" },
];

interface Props {
  endpoint?: string;
  showCategoryFilter?: boolean;
}

export default function AuditExportButton({
  endpoint = "/api/admin/audit/export",
  showCategoryFilter = false,
}: Props) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [usersInput, setUsersInput] = useState("");
  const [category, setCategory] = useState("");

  function handleExport() {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const trimmed = usersInput.trim();
    if (trimmed) params.set("users", trimmed);
    if (category) params.set("category", category);

    const a = document.createElement("a");
    a.href = `${endpoint}?${params.toString()}`;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  const inputStyle = {
    borderColor: "var(--color-border)",
    background: "var(--color-surface)",
    color: "var(--color-text)",
  } as React.CSSProperties;

  return (
    <div
      className="rounded border p-4 mt-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <p
        className="text-[10px] uppercase tracking-widest font-semibold mb-3"
        style={{ color: "var(--color-muted)" }}
      >
        Export to CSV
      </p>

      <div className="flex flex-wrap gap-3 items-end">
        {/* Date range */}
        <div>
          <label
            className="block text-[10px] uppercase tracking-widest mb-1"
            style={{ color: "var(--color-muted)" }}
          >
            From
          </label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="text-xs rounded border px-2 py-1.5"
            style={inputStyle}
          />
        </div>

        <div>
          <label
            className="block text-[10px] uppercase tracking-widest mb-1"
            style={{ color: "var(--color-muted)" }}
          >
            To
          </label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="text-xs rounded border px-2 py-1.5"
            style={inputStyle}
          />
        </div>

        {/* User filter */}
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <label
            className="block text-[10px] uppercase tracking-widest mb-1"
            style={{ color: "var(--color-muted)" }}
          >
            Filter by users (comma-separated emails)
          </label>
          <input
            type="text"
            value={usersInput}
            onChange={(e) => setUsersInput(e.target.value)}
            placeholder="user@example.com, other@example.com"
            className="w-full text-xs rounded border px-2 py-1.5"
            style={inputStyle}
          />
        </div>

        {/* Category filter (optional) */}
        {showCategoryFilter && (
          <div>
            <label
              className="block text-[10px] uppercase tracking-widest mb-1"
              style={{ color: "var(--color-muted)" }}
            >
              Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="text-xs rounded border px-2 py-1.5"
              style={inputStyle}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <button
          onClick={handleExport}
          className="text-xs font-semibold px-4 py-1.5 rounded whitespace-nowrap"
          style={{
            background: "var(--color-ink)",
            color: "var(--color-bg)",
          }}
        >
          Download CSV
        </button>
      </div>
    </div>
  );
}
