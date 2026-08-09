"use client";

import { useEffect, useState } from "react";
import Wordmark from "@/app/components/wordmark";
import { DocEnd, DocMeta, DocRule, HashQuads, TamperSeal } from "@/app/components/seal";
import { DOC, DOC_PRINT_CSS, isoUtc, shortHash } from "@/lib/documents/palette";
import type { ReceiptResponse } from "@/app/api/consent/receipt/[acceptanceId]/route";
import type { ReceiptUse } from "@/lib/consent/receipt";

function UseTable({
  rows,
  tone,
  emptyLabel,
  showLedger,
}: {
  rows: ReceiptUse[];
  tone: string;
  emptyLabel: string;
  showLedger: boolean;
}) {
  if (rows.length === 0) {
    return (
      <p style={{ fontFamily: DOC.sans, fontSize: 12, fontStyle: "italic", color: DOC.muted, margin: "4px 0 0" }}>
        {emptyLabel}
      </p>
    );
  }

  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <tbody>
        {rows.map((u) => (
          <tr key={u.id} className="doc-keep">
            <td
              style={{
                padding: "9px 12px 9px 0",
                borderBottom: `1px solid ${DOC.rule}`,
                borderLeft: `3px solid ${tone}`,
                paddingLeft: 12,
                verticalAlign: "top",
              }}
            >
              <p
                style={{
                  fontFamily: DOC.sans,
                  fontSize: 13,
                  fontWeight: 600,
                  color: DOC.ink,
                  margin: 0,
                }}
              >
                {u.name}
                {u.regimeTag && (
                  <span style={{ fontFamily: DOC.mono, fontSize: 9.5, color: DOC.muted, marginLeft: 7 }}>
                    {u.regimeTag}
                  </span>
                )}
                {u.sensitive && (
                  <span
                    className="uppercase"
                    style={{
                      fontFamily: DOC.sans,
                      fontSize: 8,
                      fontWeight: 700,
                      letterSpacing: "0.1em",
                      color: DOC.ochre,
                      background: DOC.ochreTint,
                      borderRadius: 3,
                      padding: "2px 5px",
                      marginLeft: 7,
                    }}
                  >
                    Extra care
                  </span>
                )}
              </p>
              <p style={{ fontFamily: DOC.sans, fontSize: 11.5, color: DOC.text, margin: "3px 0 0", lineHeight: 1.55 }}>
                {u.description}
              </p>
              {showLedger && u.ledger && (
                <p
                  style={{
                    fontFamily: DOC.mono,
                    fontSize: 9,
                    color: DOC.faint,
                    margin: "5px 0 0",
                    letterSpacing: "0.02em",
                  }}
                >
                  <span style={{ color: DOC.muted }}>#{u.ledger.seq}</span>{" "}
                  <span style={{ color: tone }}>{shortHash(u.ledger.hash)}</span>{" "}
                  {u.ledger.chainKey}
                </p>
              )}
            </td>
            <td
              style={{
                padding: "9px 0",
                borderBottom: `1px solid ${DOC.rule}`,
                textAlign: "right",
                verticalAlign: "top",
                whiteSpace: "nowrap",
                fontFamily: DOC.mono,
                fontSize: 10,
                color: DOC.muted,
              }}
            >
              {showLedger && u.grantedAt ? isoUtc(u.grantedAt).slice(0, 10) : ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ReceiptClient({ acceptanceId }: { acceptanceId: string }) {
  const [data, setData] = useState<ReceiptResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/consent/receipt/${acceptanceId}`)
      .then(async (r) => {
        if (r.status === 401) {
          window.location.href = `/api/auth/refresh?next=/consent/receipt/${acceptanceId}`;
          return null;
        }
        const d = (await r.json()) as ReceiptResponse & { error?: string };
        if (!r.ok) throw new Error(d.error ?? `Failed to load receipt (${r.status})`);
        return d;
      })
      .then((d) => {
        if (d) setData(d);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Error"))
      .finally(() => setLoading(false));
  }, [acceptanceId]);

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-64">
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>Loading receipt…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8 mx-auto" style={{ maxWidth: 640 }}>
        <p className="text-sm" style={{ color: "var(--color-danger)" }}>{error ?? "Receipt not found"}</p>
      </div>
    );
  }

  const r = data.receipt;
  const grantedCount = r.granted.length;
  const withheldCount = r.withheld.length;

  return (
    <div style={{ background: "var(--color-bg)", minHeight: "100vh" }}>
      <div className="mx-auto px-5 py-10" style={{ maxWidth: 760 }}>
        {/* ── Screen nav ── */}
        <div className="no-print mb-6 flex items-center justify-end">
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium border transition"
            style={{ borderColor: "var(--color-border)", color: "var(--color-ink)", borderRadius: "var(--radius)" }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 6 2 18 2 18 9" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
            Print / Export PDF
          </button>
        </div>

        {/* ── The document ── */}
        <div
          className="doc-body border"
          style={{ borderColor: DOC.rule, background: DOC.paper, fontFamily: DOC.sans }}
        >
          <div className="px-10 pt-10 pb-8">
            <div className="flex items-start justify-between gap-6 mb-8">
              <Wordmark variant="lock" style={{ fontSize: 11 }} />
              <div className="text-right" style={{ fontFamily: DOC.mono, fontSize: 9.5, color: DOC.muted }}>
                <p style={{ margin: 0 }}>{r.reference}</p>
                <p style={{ margin: 0 }}>{isoUtc(data.generatedAt)}</p>
              </div>
            </div>

            <p
              className="uppercase"
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.28em",
                color: DOC.brick,
                margin: "0 0 8px",
              }}
            >
              Consent receipt
            </p>
            <h1
              style={{
                fontFamily: DOC.serif,
                fontSize: 30,
                fontWeight: 600,
                letterSpacing: "-0.015em",
                lineHeight: 1.15,
                color: DOC.ink,
                margin: "0 0 6px",
              }}
            >
              {r.performerName}
            </h1>
            <p style={{ fontSize: 13, color: DOC.text, margin: "0 0 24px", maxWidth: "52ch", lineHeight: 1.6 }}>
              A record of the uses of {r.performerName}&apos;s biometric likeness consented to
              on <strong style={{ color: DOC.ink }}>{r.productionName}</strong>, and the uses
              withheld, as confirmed on {isoUtc(r.attestedAt)}.
            </p>

            <DocMeta
              items={[
                { label: "Production", value: r.productionName },
                { label: "Production company", value: r.companyName },
                { label: "Performer", value: r.performerEmail ?? r.performerName, mono: Boolean(r.performerEmail) },
                {
                  label: "Confirmed by",
                  value: r.onBehalf
                    ? `${r.acceptedByEmail ?? "agent"} (agent, on behalf)`
                    : (r.acceptedByEmail ?? r.performerName),
                  mono: Boolean(r.acceptedByEmail),
                },
                { label: "Confirmed at", value: isoUtc(r.attestedAt), mono: true },
                { label: "Document version", value: r.documentVersion, mono: true },
                { label: "Uses consented to", value: `${grantedCount} of ${grantedCount + withheldCount}` },
                { label: "Receipt ref", value: r.reference, mono: true },
              ]}
            />
          </div>

          {/* ── Granted ── */}
          <div className="px-10 pb-7">
            <DocRule label={`Consented to (${grantedCount})`} tone={DOC.olive} />
            <UseTable
              rows={r.granted}
              tone={DOC.olive}
              showLedger
              emptyLabel="No uses were consented to. Consent was refused in full."
            />
          </div>

          {/* ── Withheld — the half that matters in a dispute ── */}
          <div className="px-10 pb-7">
            <DocRule label={`Withheld (${withheldCount})`} tone={DOC.ink} />
            <p style={{ fontSize: 11, color: DOC.muted, margin: "0 0 10px", lineHeight: 1.6, maxWidth: "72ch" }}>
              The uses below were <strong style={{ color: DOC.ink }}>not</strong> consented to.
              They are listed explicitly so that the absence of consent is a matter of record
              rather than something to be inferred.
            </p>
            <UseTable
              rows={r.withheld}
              tone={DOC.faint}
              showLedger={false}
              emptyLabel="Nothing was withheld — every use on the document was consented to."
            />
          </div>

          {/* ── Attestation ── */}
          <div className="px-10 pb-7">
            <DocRule label="Attestation" />
            <blockquote
              className="doc-keep"
              style={{
                margin: 0,
                padding: "14px 18px",
                borderLeft: `3px solid ${DOC.brick}`,
                background: DOC.inset,
                fontFamily: DOC.serif,
                fontSize: 14,
                lineHeight: 1.65,
                color: DOC.ink,
              }}
            >
              &ldquo;{r.attestation}&rdquo;
            </blockquote>
            <p style={{ fontSize: 11, color: DOC.muted, margin: "10px 0 0", lineHeight: 1.6 }}>
              Confirmed by affirmation rather than signature. The wording shown above is version{" "}
              {r.documentVersion} of the consent document, which is the version that was displayed
              at the time of confirmation.
            </p>
          </div>

          {/* ── Evidence ── */}
          <div className="px-10 pb-7">
            <DocRule label="Evidence" />
            <DocMeta
              columns={2}
              items={[
                { label: "Acceptance ID", value: r.id, mono: true },
                { label: "Confirmed at (UTC)", value: isoUtc(r.attestedAt), mono: true },
                { label: "Source IP (SHA-256)", value: r.ipHash ? shortHash(r.ipHash, 16) : "not recorded", mono: true },
                {
                  label: "User agent (SHA-256)",
                  value: r.userAgentHash ? shortHash(r.userAgentHash, 16) : "not recorded",
                  mono: true,
                },
              ]}
            />
            <p style={{ fontSize: 10.5, color: DOC.muted, margin: "10px 0 0", lineHeight: 1.6, maxWidth: "72ch" }}>
              The source IP address and browser user-agent string are stored only as SHA-256
              digests; the underlying values are not retained. A party holding a candidate value
              can hash it and compare, but the digests alone do not reveal it.
            </p>

            {r.chained && r.granted.some((u) => u.ledger) && (
              <div className="mt-5">
                <p
                  className="uppercase"
                  style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", color: DOC.muted, margin: "0 0 6px" }}
                >
                  Ledger entries for this consent
                </p>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <tbody>
                    {r.granted
                      .filter((u) => u.ledger)
                      .map((u) => (
                        <tr key={u.id} className="doc-keep">
                          <td
                            style={{
                              padding: "6px 10px 6px 0",
                              borderBottom: `1px solid ${DOC.rule}`,
                              fontFamily: DOC.sans,
                              fontSize: 11,
                              color: DOC.ink,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {u.name}
                          </td>
                          <td
                            style={{
                              padding: "6px 10px 6px 0",
                              borderBottom: `1px solid ${DOC.rule}`,
                              fontFamily: DOC.mono,
                              fontSize: 10,
                              color: DOC.muted,
                              whiteSpace: "nowrap",
                            }}
                          >
                            #{u.ledger!.seq}
                          </td>
                          <td style={{ padding: "6px 0", borderBottom: `1px solid ${DOC.rule}` }}>
                            <HashQuads hash={u.ledger!.hash} size={9.5} color={DOC.text} />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Seal ── */}
          <div className="px-10 pb-7">
            {data.sealHash && data.verifyUrl ? (
              <TamperSeal
                sealHash={data.sealHash}
                verifyUrl={data.verifyUrl}
                summary={`${r.chainKeys.length} chain${r.chainKeys.length === 1 ? "" : "s"} · ${
                  r.granted.filter((u) => u.ledger).length
                } sealed grant${r.granted.filter((u) => u.ledger).length === 1 ? "" : "s"}`}
                intact
              />
            ) : (
              <div
                className="doc-keep p-4"
                style={{
                  border: `1px solid ${DOC.rule}`,
                  borderLeft: `3px solid ${DOC.ochre}`,
                  borderRadius: 6,
                  background: DOC.ochreTint,
                }}
              >
                <p
                  className="uppercase"
                  style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.2em", color: DOC.ochre, margin: "0 0 8px" }}
                >
                  Ledger entry pending
                </p>
                <p style={{ fontSize: 11.5, color: DOC.text, margin: 0, lineHeight: 1.6 }}>
                  This consent was given before an ImageVault account existed for {r.performerName},
                  so it is recorded as a dated document artifact but has not yet been written to the
                  hash-chained ledger. It is written to the ledger when the account is created, and a
                  sealed copy of this receipt with an independent verification address is issued at
                  that point. The uses recorded above do not change.
                </p>
              </div>
            )}
          </div>

          {/* ── Withdrawal notice ── */}
          <div
            className="doc-keep px-10 py-7"
            style={{ borderTop: `1px solid ${DOC.rule}`, background: DOC.inset }}
          >
            <p
              className="uppercase"
              style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.2em", color: DOC.ink, margin: "0 0 8px" }}
            >
              Right to withdraw
            </p>
            <p style={{ fontSize: 10.5, lineHeight: 1.7, color: DOC.text, margin: 0 }}>
              Consent recorded above may be withdrawn at any time. That right arises under Article
              7(3) of the UK GDPR and under section 39 of the SAG-AFTRA agreement. Withdrawal stops
              new uses from the point it is recorded; it does not retrospectively make unlawful any
              use that was within scope while the consent was in force. Withdrawal is itself
              recorded to the ledger, so both the grant and its withdrawal remain part of the
              permanent record. To withdraw, sign in to ImageVault and open the consent document for
              this production, or write to the production company named above.
            </p>

            <div
              className="mt-5 pt-4 flex items-center justify-between gap-4 flex-wrap"
              style={{ borderTop: `1px solid ${DOC.rule}` }}
            >
              <Wordmark variant="lock" style={{ fontSize: 9 }} />
              <p style={{ fontFamily: DOC.mono, fontSize: 9.5, color: DOC.muted, margin: 0 }}>{r.reference}</p>
            </div>

            <div className="mt-4">
              <DocEnd label="End of receipt" />
            </div>
          </div>
        </div>
      </div>

      <style>{DOC_PRINT_CSS}</style>
    </div>
  );
}
