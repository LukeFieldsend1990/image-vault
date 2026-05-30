"use client";

import { useCallback, useEffect, useState } from "react";

interface Licence {
  id: string;
  projectName: string;
  productionCompany: string;
  licenceType: string | null;
  status: string;
  permitAiTraining: boolean;
}

interface ConsentRecord {
  id: string;
  useType: string;
  territory: string | null;
  language: string | null;
  validFrom: number | null;
  validTo: number | null;
  status: "granted" | "revoked" | "expired";
}

const sectionHeader = "text-xs font-medium tracking-widest uppercase";
const card = "rounded p-4";
const cardStyle = {
  border: "1px solid var(--color-border)",
  background: "var(--color-surface)",
};

function StatusPill({ status }: { status: string }) {
  const granted = status === "granted";
  return (
    <span
      className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded"
      style={{
        color: granted ? "var(--color-accent)" : "var(--color-muted)",
        border: "1px solid var(--color-border)",
      }}
    >
      {status}
    </span>
  );
}

export default function ComplianceClient() {
  const [licences, setLicences] = useState<Licence[]>([]);
  const [consents, setConsents] = useState<Record<string, ConsentRecord[]>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const loadConsent = useCallback(async (licenceId: string) => {
    const res = await fetch(`/api/compliance/consent?licenceId=${encodeURIComponent(licenceId)}`);
    if (!res.ok) return;
    const data = (await res.json()) as { records: ConsentRecord[] };
    setConsents((prev) => ({ ...prev, [licenceId]: data.records }));
  }, []);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/licences");
      if (res.ok) {
        const rows = (await res.json()) as { licences?: Licence[] } | Licence[];
        const list = Array.isArray(rows) ? rows : (rows.licences ?? []);
        setLicences(list);
        await Promise.all(list.map((l) => loadConsent(l.id)));
      }
      setLoading(false);
    })();
  }, [loadConsent]);

  async function grant(licence: Licence, form: GrantForm) {
    setBusy(licence.id);
    try {
      await fetch("/api/compliance/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          licenceId: licence.id,
          useType: form.useType || licence.licenceType || "commercial",
          territory: form.territory || undefined,
          language: form.language || undefined,
          scriptedAlterations: form.scriptedAlterations,
        }),
      });
      await loadConsent(licence.id);
    } finally {
      setBusy(null);
    }
  }

  async function revoke(licenceId: string, recordId: string) {
    setBusy(recordId);
    try {
      await fetch("/api/compliance/consent", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId }),
      });
      await loadConsent(licenceId);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold" style={{ color: "var(--color-text)" }}>
          Consent &amp; Compliance
        </h1>
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          What you have consented to, per licence. Each grant and revocation is a signed, time-stamped
          entry in your compliance ledger (SAG-AFTRA Article 39.B / 39.D).
        </p>
      </header>

      {loading ? (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          Loading licences…
        </p>
      ) : licences.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          No licences yet — consent options appear here once you have a licence.
        </p>
      ) : (
        licences.map((licence) => (
          <div key={licence.id} className={card} style={cardStyle}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-medium" style={{ color: "var(--color-text)" }}>
                  {licence.projectName}
                </p>
                <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                  {licence.productionCompany} · {licence.licenceType ?? "—"} · {licence.status}
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              <p className={sectionHeader} style={{ color: "var(--color-muted)" }}>
                Consents
              </p>
              {(consents[licence.id] ?? []).length === 0 ? (
                <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                  No consent recorded yet.
                </p>
              ) : (
                <ul className="space-y-1">
                  {(consents[licence.id] ?? []).map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center justify-between text-sm py-1"
                      style={{ color: "var(--color-text)" }}
                    >
                      <span>
                        {c.useType}
                        {c.language ? ` · dub: ${c.language}` : ""}
                        {c.territory ? ` · ${c.territory}` : ""}
                      </span>
                      <span className="flex items-center gap-3">
                        <StatusPill status={c.status} />
                        {c.status === "granted" && (
                          <button
                            onClick={() => revoke(licence.id, c.id)}
                            disabled={busy === c.id}
                            className="text-xs underline disabled:opacity-50"
                            style={{ color: "var(--color-accent)" }}
                          >
                            Revoke
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <GrantRow licence={licence} busy={busy === licence.id} onGrant={grant} />
          </div>
        ))
      )}
    </div>
  );
}

interface GrantForm {
  useType: string;
  territory: string;
  language: string;
  scriptedAlterations: boolean;
}

function GrantRow({
  licence,
  busy,
  onGrant,
}: {
  licence: Licence;
  busy: boolean;
  onGrant: (licence: Licence, form: GrantForm) => void;
}) {
  const [form, setForm] = useState<GrantForm>({
    useType: licence.licenceType ?? "",
    territory: "",
    language: "",
    scriptedAlterations: false,
  });

  const input = "text-sm rounded px-2 py-1";
  const inputStyle = {
    border: "1px solid var(--color-border)",
    background: "var(--color-bg)",
    color: "var(--color-text)",
  };

  return (
    <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--color-border)" }}>
      <p className={sectionHeader + " mb-2"} style={{ color: "var(--color-muted)" }}>
        Grant consent
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={input}
          style={inputStyle}
          placeholder={licence.licenceType ?? "use type"}
          value={form.useType}
          onChange={(e) => setForm({ ...form, useType: e.target.value })}
        />
        <input
          className={input}
          style={inputStyle}
          placeholder="territory (e.g. worldwide)"
          value={form.territory}
          onChange={(e) => setForm({ ...form, territory: e.target.value })}
        />
        <input
          className={input}
          style={inputStyle}
          placeholder="dub language (optional)"
          value={form.language}
          onChange={(e) => setForm({ ...form, language: e.target.value })}
        />
        <label className="flex items-center gap-1 text-xs" style={{ color: "var(--color-muted)" }}>
          <input
            type="checkbox"
            checked={form.scriptedAlterations}
            onChange={(e) => setForm({ ...form, scriptedAlterations: e.target.checked })}
          />
          scripted alterations
        </label>
        <button
          onClick={() => onGrant(licence, form)}
          disabled={busy}
          className="text-xs px-3 py-1 rounded disabled:opacity-50"
          style={{ background: "var(--color-accent)", color: "#fff" }}
        >
          {busy ? "Saving…" : "Grant"}
        </button>
      </div>
    </div>
  );
}
