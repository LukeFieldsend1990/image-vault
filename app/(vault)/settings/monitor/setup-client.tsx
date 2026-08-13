"use client";

import { useCallback, useState } from "react";

type Kind = "letter" | "id";

interface Initial {
  fullName: string;
  letterUploadedAt: number | null;
  idUploadedAt: number | null;
  enforcementAuthorizationOnFile: boolean;
  reviewStatus: string; // self_declared | verified | rejected
}

interface State {
  letterUploadedAt: number | null;
  idUploadedAt: number | null;
  enforcementAuthorizationOnFile: boolean;
}

function when(unix: number | null): string {
  if (!unix) return "";
  return new Date(unix * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function SetupClient({ initial }: { initial: Initial }) {
  const [state, setState] = useState<State>({
    letterUploadedAt: initial.letterUploadedAt,
    idUploadedAt: initial.idUploadedAt,
    enforcementAuthorizationOnFile: initial.enforcementAuthorizationOnFile,
  });
  const [busy, setBusy] = useState<Kind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const upload = useCallback(async (kind: Kind, file: File) => {
    setBusy(kind);
    setError(null);
    setMessage(null);
    try {
      const form = new FormData();
      form.append("kind", kind);
      form.append("file", file);
      const res = await fetch("/api/monitor/setup", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        uploadedAt?: number;
        enforcementAuthorizationOnFile?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Upload failed");
        return;
      }
      setState((s) => ({
        ...s,
        letterUploadedAt: kind === "letter" ? data.uploadedAt ?? s.letterUploadedAt : s.letterUploadedAt,
        idUploadedAt: kind === "id" ? data.uploadedAt ?? s.idUploadedAt : s.idUploadedAt,
        enforcementAuthorizationOnFile: data.enforcementAuthorizationOnFile ?? s.enforcementAuthorizationOnFile,
      }));
      setMessage(kind === "letter" ? "Signed authorisation letter received." : "ID document received.");
    } finally {
      setBusy(null);
    }
  }, []);

  const bothOnFile = !!state.letterUploadedAt && !!state.idUploadedAt;

  return (
    <div className="space-y-6">
      {/* ── Overall status ── */}
      <div
        className="rounded p-4"
        style={{
          border: "1px solid var(--color-border)",
          background: state.enforcementAuthorizationOnFile ? "var(--color-surface)" : "var(--color-bg)",
        }}
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs" style={{ color: "var(--color-muted)" }}>
              Enforcement authorisation
            </div>
            <div
              className="mt-1 text-lg font-semibold"
              style={{
                color: state.enforcementAuthorizationOnFile ? "var(--color-ink)" : "var(--color-muted)",
              }}
            >
              {state.enforcementAuthorizationOnFile ? "On file" : "Incomplete"}
            </div>
            {state.enforcementAuthorizationOnFile && initial.reviewStatus === "self_declared" && (
              <div className="mt-1 text-xs" style={{ color: "var(--color-muted)" }}>
                Self-declared — a member of the team will confirm your paperwork before it&apos;s used at
                scale. Reports can still be sent in the meantime.
              </div>
            )}
          </div>
          <div
            className="text-xs px-2 py-1 rounded"
            style={{
              background: state.enforcementAuthorizationOnFile ? "var(--color-accent)" : "var(--color-surface)",
              color: state.enforcementAuthorizationOnFile ? "white" : "var(--color-muted)",
              border: state.enforcementAuthorizationOnFile ? "none" : "1px solid var(--color-border)",
            }}
          >
            {state.enforcementAuthorizationOnFile ? "Send report enabled" : "Send report disabled"}
          </div>
        </div>
      </div>

      {(error || message) && (
        <div
          className="text-xs px-3 py-2 rounded"
          style={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            color: error ? "var(--color-accent)" : "var(--color-muted)",
          }}
        >
          {error ?? message}
        </div>
      )}

      {/* ── Signed authorisation letter ── */}
      <UploadCard
        kind="letter"
        title="Signed authorisation letter"
        description={
          <>
            A signed letter naming ImageVault as your designated agent for platform reports. We
            attach this to every takedown request so the reviewer can verify representation. PDF
            preferred; images accepted.
          </>
        }
        uploadedAt={state.letterUploadedAt}
        busy={busy === "letter"}
        onUpload={(file) => void upload("letter", file)}
        talentName={initial.fullName}
      />

      {/* ── Government ID ── */}
      <UploadCard
        kind="id"
        title="Government-issued ID"
        description={
          <>
            A scan or photo of your passport or driving licence. Meta&apos;s impersonation flow requires
            proof that the reporter (or their agent) is the impersonated person. Only used for
            takedown filings; not shared outside the enforcement pipeline.
          </>
        }
        uploadedAt={state.idUploadedAt}
        busy={busy === "id"}
        onUpload={(file) => void upload("id", file)}
        talentName={initial.fullName}
      />

      {bothOnFile && (
        <div className="text-xs" style={{ color: "var(--color-muted)" }}>
          Both documents on file. You can now request takedowns from{" "}
          <a href="/vault/monitor" className="underline underline-offset-2" style={{ color: "var(--color-accent)" }}>
            /vault/monitor
          </a>{" "}
          and the &quot;Send report&quot; action becomes available to the enforcement team.
        </div>
      )}
    </div>
  );
}

function UploadCard({
  kind,
  title,
  description,
  uploadedAt,
  busy,
  onUpload,
  talentName,
}: {
  kind: Kind;
  title: string;
  description: React.ReactNode;
  uploadedAt: number | null;
  busy: boolean;
  onUpload: (file: File) => void;
  talentName: string;
}) {
  return (
    <div
      className="rounded p-4"
      style={{
        border: "1px solid var(--color-border)",
        background: "var(--color-surface)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold" style={{ color: "var(--color-ink)" }}>
              {title}
            </h2>
            {uploadedAt && (
              <span
                className="text-xs px-2 py-0.5 rounded"
                style={{
                  background: "var(--color-accent)",
                  color: "white",
                }}
              >
                On file
              </span>
            )}
          </div>
          <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
            {description}
          </p>
          {uploadedAt && (
            <p className="mt-2 text-xs" style={{ color: "var(--color-muted)" }}>
              Received {when(uploadedAt)} for {talentName}. Uploading again replaces the previous
              file.
            </p>
          )}
        </div>
      </div>

      <div className="mt-3">
        <label
          className="inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded cursor-pointer"
          style={{
            border: "1px solid var(--color-border)",
            background: busy ? "var(--color-bg)" : "var(--color-surface)",
            color: "var(--color-ink)",
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? "Uploading…" : uploadedAt ? "Replace document" : "Upload document"}
          <input
            type="file"
            accept="application/pdf,image/*"
            style={{ display: "none" }}
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUpload(file);
              // Reset value so re-selecting the same file re-triggers change
              e.currentTarget.value = "";
            }}
          />
        </label>
      </div>
    </div>
  );
}
