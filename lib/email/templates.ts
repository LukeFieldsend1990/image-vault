/**
 * Email HTML templates for ImageVault transactional emails.
 * Minimal, black/white, typography-led, red accent.
 */

import { isIndustryRole } from "@/lib/auth/roles";

function formatDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// ── Shared layout wrapper ────────────────────────────────────────────────────

function layout(content: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  body { margin: 0; padding: 0; background: #f4f4f4; font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; }
  .wrap { max-width: 540px; margin: 40px auto; background: #ffffff; border: 1px solid #e5e5e5; }
  .header { background: #0a0a0a; padding: 24px 32px; }
  .header-label { font-size: 9px; letter-spacing: 0.2em; text-transform: uppercase; color: rgba(255,255,255,0.4); margin: 0 0 2px; }
  .header-title { font-size: 14px; font-weight: 500; color: #ffffff; margin: 0; letter-spacing: 0.04em; }
  .accent { display: inline-block; width: 20px; height: 2px; background: #c0392b; margin-top: 8px; }
  .body { padding: 32px; }
  .body p { font-size: 14px; line-height: 1.6; color: #333333; margin: 0 0 16px; }
  .body p.muted { color: #888888; font-size: 13px; }
  .kv { border: 1px solid #eeeeee; border-radius: 4px; overflow: hidden; margin: 20px 0; }
  .kv-row { display: flex; border-bottom: 1px solid #eeeeee; }
  .kv-row:last-child { border-bottom: none; }
  .kv-key { padding: 10px 14px; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: #999999; background: #fafafa; width: 130px; flex-shrink: 0; font-weight: 600; }
  .kv-val { padding: 10px 14px; font-size: 13px; color: #222222; }
  .btn { display: inline-block; margin-top: 8px; padding: 11px 22px; background: #0a0a0a; color: #ffffff; text-decoration: none; font-size: 13px; font-weight: 500; border-radius: 3px; letter-spacing: 0.02em; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 2px; font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; }
  .badge-approved { background: rgba(22,101,52,0.1); color: #166534; }
  .badge-denied { background: rgba(153,27,27,0.1); color: #991b1b; }
  .badge-revoked { background: rgba(107,114,128,0.12); color: #6b7280; }
  .badge-pending { background: rgba(217,119,6,0.1); color: #d97706; }
  .footer { padding: 20px 32px; border-top: 1px solid #eeeeee; }
  .footer p { font-size: 11px; color: #bbbbbb; margin: 0; line-height: 1.5; }
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <p class="header-title">ImageVault</p>
    <div class="accent"></div>
  </div>
  <div class="body">${content}</div>
  <div class="footer">
    <p>This is an automated notification from ImageVault. Do not reply to this email.</p>
  </div>
</div>
</body>
</html>`;
}

// ── Templates ────────────────────────────────────────────────────────────────

export interface UploadCompleteParams {
  talentEmail: string;
  packageName: string;
  fileCount: number;
  failedCount?: number;
  totalSizeBytes: number;
  vaultUrl: string;
}

export function uploadCompleteEmail(p: UploadCompleteParams): { subject: string; html: string } {
  const fmt = (b: number) =>
    b >= 1e12 ? (b / 1e12).toFixed(2) + " TB"
    : b >= 1e9 ? (b / 1e9).toFixed(2) + " GB"
    : b >= 1e6 ? (b / 1e6).toFixed(1) + " MB"
    : (b / 1e3).toFixed(1) + " KB";

  const hasFailures = (p.failedCount ?? 0) > 0;
  const statusBadge = hasFailures
    ? `<span class="badge badge-pending">Partial</span>`
    : `<span class="badge badge-approved">Ready</span>`;
  const failureRow = hasFailures
    ? `<div class="kv-row"><span class="kv-key">Failed</span><span class="kv-val" style="color:#c0392b">${p.failedCount} file${p.failedCount !== 1 ? "s" : ""} failed — retry from the vault</span></div>`
    : "";
  const intro = hasFailures
    ? `<p>Your scan package upload has finished. ${p.fileCount} file${p.fileCount !== 1 ? "s" : ""} uploaded successfully; ${p.failedCount} failed.</p>`
    : `<p>Your scan package has finished uploading and is now ready.</p>`;

  return {
    subject: hasFailures
      ? `Upload finished with errors — ${p.packageName}`
      : `Upload complete — ${p.packageName}`,
    html: layout(`
      ${intro}
      <div class="kv">
        <div class="kv-row"><span class="kv-key">Package</span><span class="kv-val">${p.packageName}</span></div>
        <div class="kv-row"><span class="kv-key">Files</span><span class="kv-val">${p.fileCount} file${p.fileCount !== 1 ? "s" : ""}</span></div>
        ${failureRow}
        <div class="kv-row"><span class="kv-key">Total size</span><span class="kv-val">${fmt(p.totalSizeBytes)}</span></div>
        <div class="kv-row"><span class="kv-key">Status</span><span class="kv-val">${statusBadge}</span></div>
      </div>
      <a class="btn" href="${p.vaultUrl}">View vault</a>
    `),
  };
}

export interface DownloadRequestParams {
  talentEmail: string;
  licenseeEmail: string;
  projectName: string;
  packageName: string;
  authoriseUrl: string;
}

export function downloadRequestEmail(p: DownloadRequestParams): { subject: string; html: string } {
  return {
    subject: `Action required — download authorisation for ${p.projectName}`,
    html: layout(`
      <p>A licensee is waiting for your authorisation to complete a dual-custody download. Please verify your identity to release the download.</p>
      <div class="kv">
        <div class="kv-row"><span class="kv-key">Project</span><span class="kv-val">${p.projectName}</span></div>
        <div class="kv-row"><span class="kv-key">Package</span><span class="kv-val">${p.packageName}</span></div>
        <div class="kv-row"><span class="kv-key">Licensee</span><span class="kv-val">${p.licenseeEmail}</span></div>
        <div class="kv-row"><span class="kv-key">Status</span><span class="kv-val"><span class="badge badge-pending">Awaiting your approval</span></span></div>
      </div>
      <p>This request will expire in 1 hour.</p>
      <a class="btn" href="${p.authoriseUrl}">Authorise download</a>
    `),
  };
}

export interface LicenceRequestedParams {
  talentEmail: string;
  licenseeEmail: string;
  projectName: string;
  productionCompany: string;
  intendedUse: string;
  packageName: string;
  validFrom: number;
  validTo: number;
  reviewUrl: string;
}

export function licenceRequestedEmail(p: LicenceRequestedParams): { subject: string; html: string } {
  return {
    subject: `New licence request — ${p.projectName}`,
    html: layout(`
      <p>A new licence request has been submitted for your scan package.</p>
      <div class="kv">
        <div class="kv-row"><span class="kv-key">Project</span><span class="kv-val">${p.projectName}</span></div>
        <div class="kv-row"><span class="kv-key">Company</span><span class="kv-val">${p.productionCompany}</span></div>
        <div class="kv-row"><span class="kv-key">Package</span><span class="kv-val">${p.packageName}</span></div>
        <div class="kv-row"><span class="kv-key">Requestor</span><span class="kv-val">${p.licenseeEmail}</span></div>
        <div class="kv-row"><span class="kv-key">Intended use</span><span class="kv-val">${p.intendedUse}</span></div>
        <div class="kv-row"><span class="kv-key">Valid period</span><span class="kv-val">${formatDate(p.validFrom)} – ${formatDate(p.validTo)}</span></div>
      </div>
      <p>Review and approve or deny this request in ImageVault.</p>
      <a class="btn" href="${p.reviewUrl}">Review request</a>
    `),
  };
}

export interface PlaceholderLicenceCreatedParams {
  licenseeEmail: string;
  projectName: string;
  productionCompany: string;
  validFrom: number;
  validTo: number;
  viewUrl: string;
}

export function placeholderLicenceCreatedEmail(p: PlaceholderLicenceCreatedParams): { subject: string; html: string } {
  return {
    subject: `Licence confirmed — ${p.projectName}`,
    html: layout(`
      <p>A licence has been set up for your production. Scans are not yet available and will be attached once the capture session is complete.</p>
      <div class="kv">
        <div class="kv-row"><span class="kv-key">Project</span><span class="kv-val">${p.projectName}</span></div>
        <div class="kv-row"><span class="kv-key">Company</span><span class="kv-val">${p.productionCompany}</span></div>
        <div class="kv-row"><span class="kv-key">Status</span><span class="kv-val">Awaiting scan capture</span></div>
        <div class="kv-row"><span class="kv-key">Valid period</span><span class="kv-val">${formatDate(p.validFrom)} – ${formatDate(p.validTo)}</span></div>
      </div>
      <p>You will receive a further notification once the scan package has been uploaded and the licence is ready for talent approval.</p>
      <a class="btn" href="${p.viewUrl}">View licence</a>
    `),
  };
}

export interface PackageAttachedParams {
  recipientEmail: string;
  projectName: string;
  packageName: string;
  role: "industry" | "licensee" | "talent";
  viewUrl: string;
}

export function packageAttachedEmail(p: PackageAttachedParams): { subject: string; html: string } {
  const body = isIndustryRole(p.role)
    ? `<p>The scan package for your licence has been uploaded and attached. The licence is now awaiting talent approval.</p>`
    : `<p>A scan package has been attached to an awaiting licence. Please review and approve when ready.</p>`;
  return {
    subject: `Scans uploaded — ${p.projectName}`,
    html: layout(`
      ${body}
      <div class="kv">
        <div class="kv-row"><span class="kv-key">Project</span><span class="kv-val">${p.projectName}</span></div>
        <div class="kv-row"><span class="kv-key">Package</span><span class="kv-val">${p.packageName}</span></div>
      </div>
      <a class="btn" href="${p.viewUrl}">Open in ImageVault</a>
    `),
  };
}

export interface LicenceApprovedParams {
  licenseeEmail: string;
  projectName: string;
  packageName: string;
  validFrom: number;
  validTo: number;
  downloadUrl: string;
}

export function licenceApprovedEmail(p: LicenceApprovedParams): { subject: string; html: string } {
  return {
    subject: `Licence approved — ${p.projectName}`,
    html: layout(`
      <p>Your licence request has been approved. You may now initiate a dual-custody download.</p>
      <div class="kv">
        <div class="kv-row"><span class="kv-key">Project</span><span class="kv-val">${p.projectName}</span></div>
        <div class="kv-row"><span class="kv-key">Package</span><span class="kv-val">${p.packageName}</span></div>
        <div class="kv-row"><span class="kv-key">Status</span><span class="kv-val"><span class="badge badge-approved">Approved</span></span></div>
        <div class="kv-row"><span class="kv-key">Valid period</span><span class="kv-val">${formatDate(p.validFrom)} – ${formatDate(p.validTo)}</span></div>
      </div>
      <a class="btn" href="${p.downloadUrl}">Download files</a>
    `),
  };
}

export interface LicenceDeniedParams {
  licenseeEmail: string;
  projectName: string;
  packageName: string;
  reason?: string | null;
}

export function licenceDeniedEmail(p: LicenceDeniedParams): { subject: string; html: string } {
  return {
    subject: `Licence request not approved — ${p.projectName}`,
    html: layout(`
      <p>Your licence request was reviewed and has not been approved at this time.</p>
      <div class="kv">
        <div class="kv-row"><span class="kv-key">Project</span><span class="kv-val">${p.projectName}</span></div>
        <div class="kv-row"><span class="kv-key">Package</span><span class="kv-val">${p.packageName}</span></div>
        <div class="kv-row"><span class="kv-key">Status</span><span class="kv-val"><span class="badge badge-denied">Not approved</span></span></div>
        ${p.reason ? `<div class="kv-row"><span class="kv-key">Reason</span><span class="kv-val">${p.reason}</span></div>` : ""}
      </div>
      <p class="muted">If you believe this decision was made in error, please contact the talent's representative directly.</p>
    `),
  };
}

export interface LicenceRevokedParams {
  licenseeEmail: string;
  projectName: string;
  packageName: string;
}

export function licenceRevokedEmail(p: LicenceRevokedParams): { subject: string; html: string } {
  return {
    subject: `Licence revoked — ${p.projectName}`,
    html: layout(`
      <p>A previously approved licence has been revoked. Any active download sessions for this licence have been terminated.</p>
      <div class="kv">
        <div class="kv-row"><span class="kv-key">Project</span><span class="kv-val">${p.projectName}</span></div>
        <div class="kv-row"><span class="kv-key">Package</span><span class="kv-val">${p.packageName}</span></div>
        <div class="kv-row"><span class="kv-key">Status</span><span class="kv-val"><span class="badge badge-revoked">Revoked</span></span></div>
      </div>
      <p class="muted">Please cease all use of any previously downloaded assets under this licence. Contact the rights holder if you have questions.</p>
    `),
  };
}

export interface RepEndedRepresentationParams {
  talentName: string | null;
  repEmail: string;
  endedAt: number; // unix timestamp
}

export function repEndedRepresentationEmail(p: RepEndedRepresentationParams): { subject: string; html: string } {
  const greeting = p.talentName ? `Hi ${p.talentName},` : "Hello,";
  return {
    subject: "A representative has ended their delegation",
    html: layout(`
      <p>${greeting}</p>
      <p><strong>${p.repEmail}</strong> has ended their representation of your account. They no longer have access to act on your behalf, view your vault, or manage your licences.</p>
      <div class="kv">
        <div class="kv-row"><span class="kv-key">Representative</span><span class="kv-val">${p.repEmail}</span></div>
        <div class="kv-row"><span class="kv-key">Ended</span><span class="kv-val">${formatDate(p.endedAt)}</span></div>
        <div class="kv-row"><span class="kv-key">Status</span><span class="kv-val"><span class="badge badge-revoked">Ended</span></span></div>
      </div>
      <p class="muted">If you'd like to add a new representative, you can do so from your account settings under Delegation.</p>
    `),
  };
}

export interface InviteEmailParams {
  to: string;
  inviterEmail: string;
  role: "talent" | "rep" | "industry" | "licensee" | "compliance";
  message: string | null;
  signupUrl: string;
  expiresAt: number; // unix timestamp
}

const ROLE_LABELS: Record<"talent" | "rep" | "industry" | "licensee" | "compliance", string> = {
  talent: "Talent",
  rep: "Representative",
  industry: "Industry",
  licensee: "Licensee",
  compliance: "Compliance (Union / Regulator / Insurer)",
};

export function inviteEmail(p: InviteEmailParams): { subject: string; html: string } {
  const roleLabel = ROLE_LABELS[p.role];
  return {
    subject: `You've been invited to ImageVault`,
    html: layout(`
      <p>You have been invited to join ImageVault as a <strong>${roleLabel}</strong>.</p>
      <div class="kv">
        <div class="kv-row"><span class="kv-key">Invited by</span><span class="kv-val">${p.inviterEmail}</span></div>
        <div class="kv-row"><span class="kv-key">Account type</span><span class="kv-val">${roleLabel}</span></div>
        <div class="kv-row"><span class="kv-key">Expires</span><span class="kv-val">${formatDate(p.expiresAt)}</span></div>
      </div>
      ${p.message ? `<p><em>${p.message}</em></p>` : ""}
      <p>Click the button below to create your account. This invite link expires in 7 days.</p>
      <a class="btn" href="${p.signupUrl}">Accept invitation</a>
    `),
  };
}

export interface AgentInviteEmailParams {
  to: string;
  agencyName: string;
  inviterEmail: string;
  isFirstAdmin: boolean; // true = first agency admin (owner); false = a regular agent
  onboardingUrl: string;
  expiresAt: number; // unix timestamp
}

export function agentInviteEmail(p: AgentInviteEmailParams): { subject: string; html: string } {
  const roleWord = p.isFirstAdmin ? "administrator" : "agent";
  return {
    subject: `You've been invited to ${p.agencyName} on ImageVault`,
    html: layout(`
      <p>You've been invited to join <strong>${p.agencyName}</strong> as an ${roleWord} on ImageVault.</p>
      <div class="kv">
        <div class="kv-row"><span class="kv-key">Agency</span><span class="kv-val">${p.agencyName}</span></div>
        <div class="kv-row"><span class="kv-key">Invited by</span><span class="kv-val">${p.inviterEmail}</span></div>
        <div class="kv-row"><span class="kv-key">Role</span><span class="kv-val">${p.isFirstAdmin ? "Agency administrator" : "Agent"}</span></div>
        <div class="kv-row"><span class="kv-key">Expires</span><span class="kv-val">${formatDate(p.expiresAt)}</span></div>
      </div>
      <p>As an agent you'll act on behalf of the performers your agency represents — reviewing and resolving the requests that route to your inbox.</p>
      <p>Setting up takes a couple of minutes: choose a password, turn on two-factor authentication, and accept the agent terms. This invite link expires in 7 days.</p>
      <a class="btn" href="${p.onboardingUrl}">Begin agent setup</a>
    `),
  };
}

export interface ScanBookingConfirmedParams {
  talentEmail: string;
  talentName: string;
  locationName: string;
  city: string;
  address: string;
  startTime: number; // unix
  durationMins: number;
  bookingUrl: string;
}

export function scanBookingConfirmedEmail(p: ScanBookingConfirmedParams): { subject: string; html: string } {
  const dt = new Date(p.startTime * 1000);
  const dateStr = dt.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const timeStr = dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const endTime = new Date((p.startTime + p.durationMins * 60) * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  return {
    subject: `Scan session confirmed — ${p.locationName}, ${dt.toLocaleDateString("en-GB", { day: "numeric", month: "long" })}`,
    html: layout(`
      <p>Your scan session at ${p.locationName} is confirmed. We look forward to seeing you.</p>
      <div class="kv">
        <div class="kv-row"><span class="kv-key">Location</span><span class="kv-val">${p.locationName}, ${p.city}</span></div>
        <div class="kv-row"><span class="kv-key">Address</span><span class="kv-val">${p.address}</span></div>
        <div class="kv-row"><span class="kv-key">Date</span><span class="kv-val">${dateStr}</span></div>
        <div class="kv-row"><span class="kv-key">Time</span><span class="kv-val">${timeStr} – ${endTime}</span></div>
        <div class="kv-row"><span class="kv-key">Duration</span><span class="kv-val">${p.durationMins} minutes</span></div>
        <div class="kv-row"><span class="kv-key">Status</span><span class="kv-val"><span class="badge badge-approved">Confirmed</span></span></div>
      </div>
      <p>Please arrive <strong>10 minutes before</strong> your slot. Wear close-fitting, neutral-coloured clothing and avoid jewellery for best results.</p>
      <p>Your scan package will be uploaded to your vault within 24 hours of the session.</p>
      <a class="btn" href="${p.bookingUrl}">View my bookings</a>
    `),
  };
}

export interface ScanBookingCancelledParams {
  talentEmail: string;
  locationName: string;
  city: string;
  startTime: number;
  durationMins: number;
}

export function scanBookingCancelledEmail(p: ScanBookingCancelledParams): { subject: string; html: string } {
  const dt = new Date(p.startTime * 1000);
  const dateStr = dt.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const timeStr = dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  return {
    subject: `Scan session cancelled — ${p.locationName}, ${dt.toLocaleDateString("en-GB", { day: "numeric", month: "long" })}`,
    html: layout(`
      <p>Your scan session has been cancelled. The slot has been released.</p>
      <div class="kv">
        <div class="kv-row"><span class="kv-key">Location</span><span class="kv-val">${p.locationName}, ${p.city}</span></div>
        <div class="kv-row"><span class="kv-key">Date</span><span class="kv-val">${dateStr}</span></div>
        <div class="kv-row"><span class="kv-key">Time</span><span class="kv-val">${timeStr}</span></div>
        <div class="kv-row"><span class="kv-key">Status</span><span class="kv-val"><span class="badge badge-revoked">Cancelled</span></span></div>
      </div>
      <p class="muted">To book a new session, visit your bookings page.</p>
    `),
  };
}

export interface PasswordResetParams {
  resetUrl: string;
  expiresInMinutes: number;
}

export function passwordResetEmail(p: PasswordResetParams): { subject: string; html: string } {
  return {
    subject: "Password reset — ImageVault",
    html: layout(`
      <p>We received a request to reset your ImageVault password.</p>
      <p>Click the button below to choose a new password. This link expires in ${p.expiresInMinutes} minutes.</p>
      <a class="btn" href="${p.resetUrl}">Reset password</a>
      <p class="muted" style="margin-top: 24px;">If you didn't request this, you can safely ignore this email. Your password will not be changed.</p>
    `),
  };
}

export interface DownloadCompleteParams {
  recipientEmail: string;
  isLicensee: boolean;
  projectName: string;
  packageName: string;
  licenseeEmail: string;
  fileCount: number;
  ip: string | null;
  downloadedAt: number;
}

export function downloadCompleteEmail(p: DownloadCompleteParams): { subject: string; html: string } {
  const intro = p.isLicensee
    ? `Your dual-custody download is complete. The files listed below have been securely transferred.`
    : `A licensee has completed a dual-custody download from your scan package. This event has been logged to the chain of custody.`;

  return {
    subject: `Download complete — ${p.projectName}`,
    html: layout(`
      <p>${intro}</p>
      <div class="kv">
        <div class="kv-row"><span class="kv-key">Project</span><span class="kv-val">${p.projectName}</span></div>
        <div class="kv-row"><span class="kv-key">Package</span><span class="kv-val">${p.packageName}</span></div>
        <div class="kv-row"><span class="kv-key">Licensee</span><span class="kv-val">${p.licenseeEmail}</span></div>
        <div class="kv-row"><span class="kv-key">Files</span><span class="kv-val">${p.fileCount} file${p.fileCount !== 1 ? "s" : ""}</span></div>
        <div class="kv-row"><span class="kv-key">Date &amp; time</span><span class="kv-val">${formatDate(p.downloadedAt)}</span></div>
        ${p.ip ? `<div class="kv-row"><span class="kv-key">IP address</span><span class="kv-val" style="font-family:monospace">${p.ip}</span></div>` : ""}
      </div>
      <p class="muted">This record forms part of the chain of custody for this package.</p>
    `),
  };
}

// ── Scrub attestation (P0.4 / P0.5) ──────────────────────────────────────────

export interface LicenceEndedAttestationParams {
  licenseeEmail: string;
  projectName: string;
  packageName: string;
  endReason: "expired" | "revoked";
  scrubDeadline: number; // unix timestamp
  attestUrl: string;
}

export function licenceEndedAttestationEmail(
  p: LicenceEndedAttestationParams,
): { subject: string; html: string } {
  const reasonLabel = p.endReason === "revoked" ? "Revoked" : "Expired";
  return {
    subject: `Action required: confirm data deletion — ${p.projectName}`,
    html: layout(`
      <p>A licence you held has ended. Under the terms of the licence you must delete all copies of the scan data from your systems and confirm that deletion here.</p>
      <div class="kv">
        <div class="kv-row"><span class="kv-key">Project</span><span class="kv-val">${p.projectName}</span></div>
        <div class="kv-row"><span class="kv-key">Package</span><span class="kv-val">${p.packageName}</span></div>
        <div class="kv-row"><span class="kv-key">Status</span><span class="kv-val"><span class="badge badge-revoked">${reasonLabel}</span></span></div>
        <div class="kv-row"><span class="kv-key">Confirm by</span><span class="kv-val">${formatDate(p.scrubDeadline)}</span></div>
      </div>
      <p>Submitting the attestation requires 2FA and lists the devices that held copies. Failure to respond by the deadline is recorded and escalated to the rights holder.</p>
      <a class="btn" href="${p.attestUrl}">Confirm deletion</a>
    `),
  };
}

export interface AttestationSubmittedParams {
  recipientEmail: string;
  projectName: string;
  packageName: string;
  licenseeEmail: string;
  attestedAt: number;
  devicesCount: number;
}

export function attestationSubmittedEmail(
  p: AttestationSubmittedParams,
): { subject: string; html: string } {
  return {
    subject: `Deletion attestation received — ${p.projectName}`,
    html: layout(`
      <p>The licensee has attested that all copies of the scan data have been deleted from their systems.</p>
      <div class="kv">
        <div class="kv-row"><span class="kv-key">Project</span><span class="kv-val">${p.projectName}</span></div>
        <div class="kv-row"><span class="kv-key">Package</span><span class="kv-val">${p.packageName}</span></div>
        <div class="kv-row"><span class="kv-key">Licensee</span><span class="kv-val">${p.licenseeEmail}</span></div>
        <div class="kv-row"><span class="kv-key">Attested at</span><span class="kv-val">${formatDate(p.attestedAt)}</span></div>
        <div class="kv-row"><span class="kv-key">Devices</span><span class="kv-val">${p.devicesCount} device${p.devicesCount !== 1 ? "s" : ""} listed</span></div>
        <div class="kv-row"><span class="kv-key">Status</span><span class="kv-val"><span class="badge badge-approved">Closed</span></span></div>
      </div>
      <p class="muted">The full attestation record is retained as part of the chain of custody for this package.</p>
    `),
  };
}

export interface AttestationExtendedParams {
  licenseeEmail: string;
  projectName: string;
  packageName: string;
  newDeadline: number;
  additionalDays: number;
  reason: string;
}

export function attestationExtendedEmail(
  p: AttestationExtendedParams,
): { subject: string; html: string } {
  return {
    subject: `Attestation deadline extended — ${p.projectName}`,
    html: layout(`
      <p>An administrator has extended the deadline for your deletion attestation.</p>
      <div class="kv">
        <div class="kv-row"><span class="kv-key">Project</span><span class="kv-val">${p.projectName}</span></div>
        <div class="kv-row"><span class="kv-key">Package</span><span class="kv-val">${p.packageName}</span></div>
        <div class="kv-row"><span class="kv-key">Extended by</span><span class="kv-val">${p.additionalDays} day${p.additionalDays !== 1 ? "s" : ""}</span></div>
        <div class="kv-row"><span class="kv-key">New deadline</span><span class="kv-val">${formatDate(p.newDeadline)}</span></div>
        <div class="kv-row"><span class="kv-key">Reason</span><span class="kv-val">${p.reason}</span></div>
      </div>
      <p class="muted">You still need to submit the attestation before the new deadline to close this licence cleanly.</p>
    `),
  };
}

// ── Clone packages admin notification ────────────────────────────────────────

export interface ClonePackagesEmailParams {
  triggeredBy: string;
  sourceEmail: string;
  targetEmail: string;
  ranAt: number;
  packages: number;
  files: number;
  tags: number;
  filesFailed: number;
}

// ── Production cast onboarding ────────────────────────────────────────────────

export interface ProductionCastInviteEmailParams {
  recipientEmail: string;
  productionName: string;
  companyName: string;
  coordinatorEmail: string;
  characterName?: string;
  intendedUse: string;
  validFrom: number;
  validTo: number;
  signupUrl: string;
  repMessage?: string;
}

export function productionCastInviteEmail(p: ProductionCastInviteEmailParams): { subject: string; html: string } {
  const characterRow = p.characterName
    ? `<div class="kv-row"><span class="kv-key">Character</span><span class="kv-val">${p.characterName}</span></div>`
    : "";
  const repMessageBlock = p.repMessage
    ? `<blockquote style="margin: 16px 0; padding: 12px 16px; border-left: 3px solid #c0392b; background: #fdf5f4; color: #333; font-style: italic; border-radius: 2px;">${p.repMessage}</blockquote>`
    : "";
  return {
    subject: `You've been invited to join the cast of ${p.productionName}`,
    html: layout(`
      <p>You've been invited to join the cast of <strong>${p.productionName}</strong> by ${p.companyName}.</p>
      ${repMessageBlock}
      <p>By accepting this invite and approving the licence request, you consent to your scan being used for this production.</p>
      <div class="kv">
        <div class="kv-row"><span class="kv-key">Production</span><span class="kv-val">${p.productionName}</span></div>
        <div class="kv-row"><span class="kv-key">Company</span><span class="kv-val">${p.companyName}</span></div>
        ${characterRow}
        <div class="kv-row"><span class="kv-key">Invited by</span><span class="kv-val">${p.coordinatorEmail}</span></div>
        <div class="kv-row"><span class="kv-key">Intended use</span><span class="kv-val">${p.intendedUse}</span></div>
        <div class="kv-row"><span class="kv-key">Valid period</span><span class="kv-val">${formatDate(p.validFrom)} – ${formatDate(p.validTo)}</span></div>
      </div>
      <p>Create your ImageVault account to accept this invitation, upload your scan package, and manage licence approvals.</p>
      <a class="btn" href="${p.signupUrl}">Accept invitation</a>
      <p class="muted" style="margin-top: 24px;">You can review and decline the licence request at any time from your account. Your likeness data is always under your control.</p>
    `),
  };
}

export interface InsurerInviteEmailParams {
  recipientEmail: string;
  productionName: string;
  companyName: string;
  coordinatorEmail: string;
  /** Set when inviting a brand-new account; otherwise link to the evidence area. */
  signupUrl?: string;
  evidenceUrl?: string;
}

export function insurerInviteEmail(p: InsurerInviteEmailParams): { subject: string; html: string } {
  const isNewAccount = Boolean(p.signupUrl);
  const ctaUrl = p.signupUrl ?? p.evidenceUrl ?? "";
  const ctaLabel = isNewAccount ? "Create your account" : "View production";
  return {
    subject: `You've been granted oversight of ${p.productionName} on ImageVault`,
    html: layout(`
      <p>${p.companyName} has added you as an <strong>insurer</strong> on the production <strong>${p.productionName}</strong>.</p>
      <p>You now have read-only oversight of this production's likeness consent and custody evidence — scoped to this production only. You cannot access scan files or any other production.</p>
      <div class="kv">
        <div class="kv-row"><span class="kv-key">Production</span><span class="kv-val">${p.productionName}</span></div>
        <div class="kv-row"><span class="kv-key">Company</span><span class="kv-val">${p.companyName}</span></div>
        <div class="kv-row"><span class="kv-key">Granted by</span><span class="kv-val">${p.coordinatorEmail}</span></div>
        <div class="kv-row"><span class="kv-key">Access</span><span class="kv-val">Read-only evidence, this production</span></div>
      </div>
      ${
        isNewAccount
          ? `<p>Create your ImageVault account to view the production's compliance evidence and underwriting view.</p>`
          : `<p>Sign in to view the production's compliance evidence and underwriting view.</p>`
      }
      <a class="btn" href="${ctaUrl}">${ctaLabel}</a>
      <p class="muted" style="margin-top: 24px;">Access is revocable by the production at any time, typically when the policy ends.</p>
    `),
  };
}

export interface ProductionCastLinkedEmailParams {
  recipientEmail: string;
  productionName: string;
  companyName: string;
  coordinatorEmail: string;
  characterName?: string;
  intendedUse: string;
  proposedFee?: number;
  reviewUrl: string;
  repMessage?: string;
}

export function productionCastLinkedEmail(p: ProductionCastLinkedEmailParams): { subject: string; html: string } {
  const characterRow = p.characterName
    ? `<div class="kv-row"><span class="kv-key">Character</span><span class="kv-val">${p.characterName}</span></div>`
    : "";
  const feeRow = p.proposedFee != null
    ? `<div class="kv-row"><span class="kv-key">Proposed fee</span><span class="kv-val">£${(p.proposedFee / 100).toFixed(2)}</span></div>`
    : "";
  const repMessageBlock = p.repMessage
    ? `<blockquote style="margin: 16px 0; padding: 12px 16px; border-left: 3px solid #c0392b; background: #fdf5f4; color: #333; font-style: italic; border-radius: 2px;">${p.repMessage}</blockquote>`
    : "";
  return {
    subject: `New licence request from ${p.productionName}`,
    html: layout(`
      <p>A licence request has been submitted for your scan package from the production <strong>${p.productionName}</strong>.</p>
      ${repMessageBlock}
      <div class="kv">
        <div class="kv-row"><span class="kv-key">Production</span><span class="kv-val">${p.productionName}</span></div>
        <div class="kv-row"><span class="kv-key">Company</span><span class="kv-val">${p.companyName}</span></div>
        ${characterRow}
        <div class="kv-row"><span class="kv-key">Requested by</span><span class="kv-val">${p.coordinatorEmail}</span></div>
        <div class="kv-row"><span class="kv-key">Intended use</span><span class="kv-val">${p.intendedUse}</span></div>
        ${feeRow}
        <div class="kv-row"><span class="kv-key">Status</span><span class="kv-val"><span class="badge badge-pending">Awaiting your approval</span></span></div>
      </div>
      <p>Review the licence request in ImageVault. You can attach your scan package and approve or deny the request.</p>
      <a class="btn" href="${p.reviewUrl}">Review licence request</a>
      <p class="muted" style="margin-top: 24px;">You remain in full control of your likeness data. You can revoke access at any time.</p>
    `),
  };
}

export interface ProductionRoleClaimedEmailParams {
  recipientEmail: string;
  talentName: string;
  productionName: string;
  characterName?: string;
  reviewUrl: string;
}

// Sent to the production company when a talent organically joins ImageVault and
// claims a role that was reserved for them (Path D self-heal). We never expose
// the talent's contact details here — only that the role was claimed.
export function productionRoleClaimedEmail(p: ProductionRoleClaimedEmailParams): { subject: string; html: string } {
  const characterRow = p.characterName
    ? `<div class="kv-row"><span class="kv-key">Role</span><span class="kv-val">${p.characterName}</span></div>`
    : "";
  return {
    subject: `${p.talentName} claimed their role in ${p.productionName}`,
    html: layout(`
      <p><strong>${p.talentName}</strong> just joined ImageVault and claimed the role you reserved for them in <strong>${p.productionName}</strong>.</p>
      <div class="kv">
        <div class="kv-row"><span class="kv-key">Performer</span><span class="kv-val">${p.talentName}</span></div>
        <div class="kv-row"><span class="kv-key">Production</span><span class="kv-val">${p.productionName}</span></div>
        ${characterRow}
        <div class="kv-row"><span class="kv-key">Status</span><span class="kv-val"><span class="badge badge-pending">Ready to license</span></span></div>
      </div>
      <p>You can now send them a licence request from the production page.</p>
      <a class="btn" href="${p.reviewUrl}">Open production</a>
    `),
  };
}

export interface CastRepInviteEmailParams {
  recipientEmail: string;
  productionName: string;
  companyName: string;
  actorName?: string;
  characterName?: string;
  signupUrl: string;
  existing: boolean; // true → existing rep (link to roster); false → new rep (signup)
  rosterUrl: string;
}

// Sent to a representing agent when a production reserves a role for their client
// (Path C). Existing reps get a link to their roster; new reps get a signup link.
export function castRepInviteEmail(p: CastRepInviteEmailParams): { subject: string; html: string } {
  const who = p.actorName ?? "your client";
  const characterRow = p.characterName
    ? `<div class="kv-row"><span class="kv-key">Role</span><span class="kv-val">${p.characterName}</span></div>`
    : "";
  return {
    subject: `${p.productionName} reserved a role for ${who}`,
    html: layout(`
      <p><strong>${p.companyName}</strong> has reserved a role on <strong>${p.productionName}</strong> for ${who} and asked you, as their representation, to help connect them.</p>
      <div class="kv">
        <div class="kv-row"><span class="kv-key">Production</span><span class="kv-val">${p.productionName}</span></div>
        <div class="kv-row"><span class="kv-key">Company</span><span class="kv-val">${p.companyName}</span></div>
        <div class="kv-row"><span class="kv-key">Performer</span><span class="kv-val">${who}</span></div>
        ${characterRow}
      </div>
      <p>${p.existing
        ? "Open your roster to confirm your client's email or link them directly."
        : "Join ImageVault to confirm your client's email and connect them to this role."}</p>
      <a class="btn" href="${p.existing ? p.rosterUrl : p.signupUrl}">${p.existing ? "Open my roster" : "Join ImageVault"}</a>
    `),
  };
}

export interface InclusionFlaggedEmailParams {
  recipientEmail: string;
  licenceCode: string;
  projectName: string;
  priorLicenceCount: number;
  priorDownloadCount: number;
  reviewUrl: string;
}

// Sent to admins when a licence is marked "production-included" despite the
// package/talent already having prior usage on the platform. We never block —
// this surfaces the claim for a human decision.
export function inclusionFlaggedEmail(p: InclusionFlaggedEmailParams): { subject: string; html: string } {
  return {
    subject: `[Review] Production-included claim flagged — ${p.projectName}`,
    html: layout(`
      <p>A licence was marked as <strong>production-included</strong> (£0 fee, not a re-licence), but the package/talent already has prior usage through ImageVault. No action was blocked — review and decide whether to act.</p>
      <div class="kv">
        <div class="kv-row"><span class="kv-key">Licence</span><span class="kv-val">${p.licenceCode}</span></div>
        <div class="kv-row"><span class="kv-key">Production</span><span class="kv-val">${p.projectName}</span></div>
        <div class="kv-row"><span class="kv-key">Prior licences</span><span class="kv-val">${p.priorLicenceCount}</span></div>
        <div class="kv-row"><span class="kv-key">Prior downloads</span><span class="kv-val">${p.priorDownloadCount}</span></div>
      </div>
      <a class="btn" href="${p.reviewUrl}">Review inclusion claims</a>
    `),
  };
}

export interface VendorProductionInviteEmailParams {
  recipientEmail: string;
  productionName: string;
  companyName: string;
  vendorTypeLabel: string;
  existing: boolean;     // true → existing org notified; false → new vendor signup
  signupUrl: string;
  productionUrl: string;
}

// Sent when a production company attaches a vendor org to a production. Existing
// vendors are notified; new vendors get a signup link. Attachment alone never
// grants scan access — that stays a per-licence, audit-gated step.
export function vendorProductionInviteEmail(p: VendorProductionInviteEmailParams): { subject: string; html: string } {
  return {
    subject: `${p.companyName} added you to ${p.productionName}`,
    html: layout(`
      <p><strong>${p.companyName}</strong> has added your organisation to <strong>${p.productionName}</strong> as a ${p.vendorTypeLabel}.</p>
      <div class="kv">
        <div class="kv-row"><span class="kv-key">Production</span><span class="kv-val">${p.productionName}</span></div>
        <div class="kv-row"><span class="kv-key">Engaged by</span><span class="kv-val">${p.companyName}</span></div>
        <div class="kv-row"><span class="kv-key">Your role</span><span class="kv-val">${p.vendorTypeLabel}</span></div>
      </div>
      <p>${p.existing
        ? "You're now listed on the production. Access to scan data is granted per licence and requires a passed environment audit."
        : "Join ImageVault to be set up on the production. Access to scan data is granted per licence and requires a passed environment audit."}</p>
      <a class="btn" href="${p.existing ? p.productionUrl : p.signupUrl}">${p.existing ? "View production" : "Join ImageVault"}</a>
    `),
  };
}

export interface ConciergeProductionInviteEmailParams {
  recipientEmail: string;
  productionName: string;
  companyName: string;
  castCount: number;
  signupUrl: string;
}

// Sent when an ImageVault admin has pre-built a production and invites the
// industry user to take it over — they arrive to a mostly-set-up project.
export function conciergeProductionInviteEmail(p: ConciergeProductionInviteEmailParams): { subject: string; html: string } {
  const castRow = p.castCount > 0
    ? `<div class="kv-row"><span class="kv-key">Cast reserved</span><span class="kv-val">${p.castCount}</span></div>`
    : "";
  return {
    subject: `Your production ${p.productionName} is ready on ImageVault`,
    html: layout(`
      <p>We've set up <strong>${p.productionName}</strong> for <strong>${p.companyName}</strong> on ImageVault so you can hit the ground running.</p>
      <div class="kv">
        <div class="kv-row"><span class="kv-key">Production</span><span class="kv-val">${p.productionName}</span></div>
        <div class="kv-row"><span class="kv-key">Company</span><span class="kv-val">${p.companyName}</span></div>
        ${castRow}
      </div>
      <p>Create your account to take ownership — your production, cast roster and default terms are already in place. Just review, add any emails you have, and send your licence requests.</p>
      <a class="btn" href="${p.signupUrl}">Set up your account</a>
    `),
  };
}

export function clonePackagesEmail(p: ClonePackagesEmailParams): { subject: string; html: string } {
  const dt = new Date(p.ranAt * 1000).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });
  return {
    subject: `[Admin] Clone packages operation ran — ${p.sourceEmail} → ${p.targetEmail}`,
    html: layout(`
      <p>A clone packages operation was triggered by an administrator. Review the details below.</p>
      <div class="kv">
        <div class="kv-row"><span class="kv-key">Triggered by</span><span class="kv-val">${p.triggeredBy}</span></div>
        <div class="kv-row"><span class="kv-key">Source</span><span class="kv-val">${p.sourceEmail}</span></div>
        <div class="kv-row"><span class="kv-key">Target</span><span class="kv-val">${p.targetEmail}</span></div>
        <div class="kv-row"><span class="kv-key">Ran at</span><span class="kv-val">${dt}</span></div>
        <div class="kv-row"><span class="kv-key">Packages</span><span class="kv-val">${p.packages}</span></div>
        <div class="kv-row"><span class="kv-key">Files copied</span><span class="kv-val">${p.files}</span></div>
        <div class="kv-row"><span class="kv-key">Tags copied</span><span class="kv-val">${p.tags}</span></div>
        ${p.filesFailed > 0 ? `<div class="kv-row"><span class="kv-key">Files failed</span><span class="kv-val"><span class="badge badge-denied">${p.filesFailed} failed</span></span></div>` : ""}
      </div>
      <p class="muted">This operation is rate-limited to once per UTC day. R2 objects were physically copied — both accounts are now independent.</p>
    `),
  };
}

export interface RegisterInterestParams {
  name: string;
  email: string;
  company: string;
  companyType: string;
  phone?: string;
  message?: string;
  submittedAt: number;
}

export function registerInterestEmail(p: RegisterInterestParams): { subject: string; html: string } {
  const dt = new Date(p.submittedAt * 1000).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });
  return {
    subject: `[ImageVault] New access request — ${p.name} (${p.company})`,
    html: layout(`
      <p>A new access request has been submitted via the ImageVault registration page.</p>
      <div class="kv">
        <div class="kv-row"><span class="kv-key">Name</span><span class="kv-val">${p.name}</span></div>
        <div class="kv-row"><span class="kv-key">Email</span><span class="kv-val">${p.email}</span></div>
        <div class="kv-row"><span class="kv-key">Company</span><span class="kv-val">${p.company}</span></div>
        <div class="kv-row"><span class="kv-key">Company type</span><span class="kv-val">${p.companyType}</span></div>
        ${p.phone ? `<div class="kv-row"><span class="kv-key">Phone</span><span class="kv-val">${p.phone}</span></div>` : ""}
        ${p.message ? `<div class="kv-row"><span class="kv-key">Message</span><span class="kv-val">${p.message}</span></div>` : ""}
        <div class="kv-row"><span class="kv-key">Submitted</span><span class="kv-val">${dt}</span></div>
      </div>
      <p class="muted">Reply directly to this email to follow up with the applicant.</p>
    `),
  };
}

export interface ContactEnquiryParams {
  name: string;
  email: string;
  subject?: string;
  message: string;
  submittedAt: number;
}

export function contactEnquiryEmail(p: ContactEnquiryParams): { subject: string; html: string } {
  const dt = new Date(p.submittedAt * 1000).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });
  // Public, unauthenticated form — treat every field as untrusted and escape it.
  const name = escapeHtml(p.name);
  const email = escapeHtml(p.email);
  const subjectLine = p.subject ? escapeHtml(p.subject) : "";
  const message = escapeHtml(p.message).replace(/\n/g, "<br />");
  return {
    subject: `[ImageVault] Contact enquiry${subjectLine ? ` — ${subjectLine}` : ""} from ${name}`,
    html: layout(`
      <p>A new enquiry has been submitted via the ImageVault contact page.</p>
      <div class="kv">
        <div class="kv-row"><span class="kv-key">Name</span><span class="kv-val">${name}</span></div>
        <div class="kv-row"><span class="kv-key">Email</span><span class="kv-val">${email}</span></div>
        ${subjectLine ? `<div class="kv-row"><span class="kv-key">Subject</span><span class="kv-val">${subjectLine}</span></div>` : ""}
        <div class="kv-row"><span class="kv-key">Message</span><span class="kv-val">${message}</span></div>
        <div class="kv-row"><span class="kv-key">Submitted</span><span class="kv-val">${dt}</span></div>
      </div>
      <p class="muted">Reply directly to <a href="mailto:${email}">${email}</a> to follow up with the sender.</p>
    `),
  };
}

export interface ContactForwardParams {
  fromAddress: string;
  subject?: string;
  body: string;
  receivedAt: number;
}

export function contactForwardEmail(p: ContactForwardParams): { subject: string; html: string } {
  const dt = new Date(p.receivedAt * 1000).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });
  // Forwarded from an external, unauthenticated sender — escape every field.
  const from = escapeHtml(p.fromAddress);
  const subjectText = p.subject?.trim() || "(no subject)";
  const subjectLine = escapeHtml(subjectText);
  const body = escapeHtml(p.body).replace(/\n/g, "<br />");
  return {
    subject: `[ImageVault] Contact — ${subjectText} from ${p.fromAddress}`,
    html: layout(`
      <p>A message was sent to <strong>contact@imagevault.ai</strong> and forwarded to you. Reply directly to this email to reach the sender.</p>
      <div class="kv">
        <div class="kv-row"><span class="kv-key">From</span><span class="kv-val">${from}</span></div>
        <div class="kv-row"><span class="kv-key">Subject</span><span class="kv-val">${subjectLine}</span></div>
        <div class="kv-row"><span class="kv-key">Received</span><span class="kv-val">${dt}</span></div>
      </div>
      <p>${body}</p>
    `),
  };
}

// ── Security alert (ambient security agent) ─────────────────────────────────

/**
 * Escape untrusted text for HTML interpolation. The security agent's verdict
 * is LLM output derived from attacker-influenced event fields, so unlike the
 * other templates (trusted platform data) escaping is mandatory here.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface SecurityAlertEmailParams {
  severity: "critical" | "high" | "medium";
  headline: string;
  narrative: string;
  eventType: string;
  entityLabel: string;
  recommendedActions: Array<{ tool: string; reason: string }>;
  toolCallCount: number;
  degraded?: boolean;
  adminMcpUrl: string;
  occurredAt: number;
}

export function securityAlertEmail(p: SecurityAlertEmailParams): { subject: string; html: string } {
  const severityBadge =
    p.severity === "critical"
      ? `<span class="badge badge-denied">Critical</span>`
      : p.severity === "high"
        ? `<span class="badge badge-pending">High</span>`
        : `<span class="badge badge-revoked">Medium</span>`;

  const actionsList = p.recommendedActions.length
    ? `<p><strong>Recommended actions</strong> (run via your MCP client — each requires your TOTP code):</p>
       <ul style="font-size:13px;color:#333;line-height:1.6;margin:0 0 16px;padding-left:18px;">
         ${p.recommendedActions
           .map((a) => `<li><code>${escapeHtml(a.tool)}</code> — ${escapeHtml(a.reason)}</li>`)
           .join("")}
       </ul>`
    : "";

  const investigatedNote = p.degraded
    ? "Automated investigation was unavailable — this is a template alert from the trigger data."
    : `The security agent investigated this event with ${p.toolCallCount} read-only tool call${p.toolCallCount !== 1 ? "s" : ""} (see /admin/mcp activity).`;

  return {
    subject: `[Security] ${p.severity.toUpperCase()}: ${p.headline}`,
    html: layout(`
      <p><strong>${escapeHtml(p.headline)}</strong></p>
      <div class="kv">
        <div class="kv-row"><span class="kv-key">Severity</span><span class="kv-val">${severityBadge}</span></div>
        <div class="kv-row"><span class="kv-key">Event</span><span class="kv-val">${escapeHtml(p.eventType.replace(/_/g, " "))}</span></div>
        <div class="kv-row"><span class="kv-key">Entity</span><span class="kv-val">${escapeHtml(p.entityLabel)}</span></div>
        <div class="kv-row"><span class="kv-key">When</span><span class="kv-val">${formatDate(p.occurredAt)}</span></div>
      </div>
      <p>${escapeHtml(p.narrative)}</p>
      ${actionsList}
      <p class="muted">${investigatedNote} Corrective action is never taken automatically.</p>
      <a class="btn" href="${p.adminMcpUrl}">Review MCP activity</a>
    `),
  };
}

// ── Rep representation enquiry (TMDB cast outreach) ─────────────────────────

export interface RepRepresentationEnquiryParams {
  repEmail: string;
  actorName: string;
  characterName?: string;
  productionName: string;
  companyName: string;
  coordinatorEmail: string;
  rosterUrl: string;
}

export function repRepresentationEnquiryEmail(p: RepRepresentationEnquiryParams): { subject: string; html: string } {
  const characterRow = p.characterName
    ? `<div class="kv-row"><span class="kv-key">Character</span><span class="kv-val">${p.characterName}</span></div>`
    : "";
  return {
    subject: `Representation enquiry — ${p.actorName} / ${p.productionName}`,
    html: layout(`
      <p>We are building the cast list for <strong>${p.productionName}</strong> on ImageVault and are trying to reach <strong>${p.actorName}</strong>.</p>
      <p>If you represent ${p.actorName}, we'd like to set them up on the platform so they can upload their scan package and manage licence approvals for this production.</p>
      <div class="kv">
        <div class="kv-row"><span class="kv-key">Actor</span><span class="kv-val">${p.actorName}</span></div>
        <div class="kv-row"><span class="kv-key">Production</span><span class="kv-val">${p.productionName}</span></div>
        <div class="kv-row"><span class="kv-key">Company</span><span class="kv-val">${p.companyName}</span></div>
        ${characterRow}
        <div class="kv-row"><span class="kv-key">Coordinator</span><span class="kv-val">${p.coordinatorEmail}</span></div>
      </div>
      <p>If you represent this actor, visit your ImageVault roster to link them. Once linked they'll receive an invitation to join the production.</p>
      <a class="btn" href="${p.rosterUrl}">Go to my roster</a>
      <p class="muted" style="margin-top: 24px;">If you do not represent ${p.actorName}, no action is needed — please disregard this message.</p>
    `),
  };
}

export interface ScanTransferReceivedParams {
  fromOrgName: string;
  lookLabel: string;
  forTalentName?: string;
  viewUrl: string;
}

// To talent/rep: a capture company has delivered a scan awaiting acceptance.
export function scanTransferReceivedEmail(p: ScanTransferReceivedParams): { subject: string; html: string } {
  return {
    subject: `Scan delivery awaiting your acceptance — ${p.lookLabel}`,
    html: layout(`
      <p>${escapeHtml(p.fromOrgName)} has delivered a scan package${p.forTalentName ? ` for ${escapeHtml(p.forTalentName)}` : ""}. It is held pending your acceptance — nothing enters the vault until you accept.</p>
      <div class="kv">
        <div class="kv-row"><span class="kv-key">From</span><span class="kv-val">${escapeHtml(p.fromOrgName)}</span></div>
        <div class="kv-row"><span class="kv-key">Look</span><span class="kv-val">${escapeHtml(p.lookLabel)}</span></div>
      </div>
      <a class="btn" href="${p.viewUrl}">Review delivery</a>
    `),
  };
}

export interface ScanTransferDecisionParams {
  lookLabel: string;
  decision: "accepted" | "rejected";
  decidedByLabel?: string;
  viewUrl: string;
}

// To the capture org: the target talent/rep accepted or rejected the delivery.
export function scanTransferDecisionEmail(p: ScanTransferDecisionParams): { subject: string; html: string } {
  const accepted = p.decision === "accepted";
  return {
    subject: `Scan delivery ${p.decision} — ${p.lookLabel}`,
    html: layout(`
      <p>Your scan delivery was <strong>${p.decision}</strong>${p.decidedByLabel ? ` by ${escapeHtml(p.decidedByLabel)}` : ""}.${accepted ? " The package is now in the talent's vault." : " The staged package has been discarded."}</p>
      <div class="kv">
        <div class="kv-row"><span class="kv-key">Look</span><span class="kv-val">${escapeHtml(p.lookLabel)}</span></div>
        <div class="kv-row"><span class="kv-key">Outcome</span><span class="kv-val">${p.decision}</span></div>
      </div>
      <a class="btn" href="${p.viewUrl}">View transfers</a>
    `),
  };
}

export interface ConsentRequestEmailParams {
  performerName: string;
  productionName: string;
  companyName: string;
  /** Tokenised public link to the consent document — no account required to read. */
  consentUrl: string;
  /**
   * Sent to the performer's representation rather than the performer themselves.
   * Switches salutation and copy so the rep knows it's being reviewed on their
   * client's behalf.
   */
  recipientIsRep?: boolean;
}

export function consentRequestEmail(p: ConsentRequestEmailParams): { subject: string; html: string } {
  if (p.recipientIsRep) {
    return {
      subject: `Consent needed for ${p.performerName} — ${p.productionName}`,
      html: layout(`
        <p>Hi,</p>
        <p><strong>${p.companyName}</strong> would like to scan <strong>${p.performerName}</strong>'s likeness for the production <strong>${p.productionName}</strong>, and needs consent first. You're receiving this as their representation.</p>
        <p>We've prepared a short, plain-English consent document. It explains exactly what's being captured, what each use means, and lets you consent only to the uses you're comfortable with — on your client's behalf, or by forwarding it to them.</p>
        <div class="kv">
          <div class="kv-row"><span class="kv-key">Performer</span><span class="kv-val">${p.performerName}</span></div>
          <div class="kv-row"><span class="kv-key">Production</span><span class="kv-val">${p.productionName}</span></div>
          <div class="kv-row"><span class="kv-key">Company</span><span class="kv-val">${p.companyName}</span></div>
          <div class="kv-row"><span class="kv-key">Status</span><span class="kv-val"><span class="badge badge-pending">Awaiting consent</span></span></div>
        </div>
        <a class="btn" href="${p.consentUrl}">Read &amp; confirm consent</a>
        <p class="muted" style="margin-top: 24px;">No account needed to read it. The link is unique to this request — feel free to forward it to your client if they'd prefer to confirm directly.</p>
      `),
    };
  }
  return {
    subject: `Your consent is needed for ${p.productionName}`,
    html: layout(`
      <p>Hi ${p.performerName},</p>
      <p><strong>${p.companyName}</strong> would like to scan your likeness for the production <strong>${p.productionName}</strong>, and needs your consent first.</p>
      <p>We've prepared a short, plain-English consent document. It explains exactly what's being captured, what each use means, and lets you consent only to the uses you're comfortable with — you decide.</p>
      <div class="kv">
        <div class="kv-row"><span class="kv-key">Production</span><span class="kv-val">${p.productionName}</span></div>
        <div class="kv-row"><span class="kv-key">Company</span><span class="kv-val">${p.companyName}</span></div>
        <div class="kv-row"><span class="kv-key">Status</span><span class="kv-val"><span class="badge badge-pending">Awaiting your consent</span></span></div>
      </div>
      <a class="btn" href="${p.consentUrl}">Read &amp; confirm consent</a>
      <p class="muted" style="margin-top: 24px;">No account needed to read it. You can confirm now, and later create a free ImageVault account to take direct control of your data.</p>
    `),
  };
}

export interface ConsentConfirmedEmailParams {
  recipientEmail: string;
  performerName: string;
  productionName: string;
  /** Number of use categories consented to, and the total offered. */
  consentedCount: number;
  totalCount: number;
  reviewUrl: string;
}

export function consentConfirmedEmail(p: ConsentConfirmedEmailParams): { subject: string; html: string } {
  return {
    subject: `${p.performerName} confirmed consent for ${p.productionName}`,
    html: layout(`
      <p><strong>${p.performerName}</strong> has confirmed consent for <strong>${p.productionName}</strong>.</p>
      <div class="kv">
        <div class="kv-row"><span class="kv-key">Performer</span><span class="kv-val">${p.performerName}</span></div>
        <div class="kv-row"><span class="kv-key">Production</span><span class="kv-val">${p.productionName}</span></div>
        <div class="kv-row"><span class="kv-key">Consented uses</span><span class="kv-val">${p.consentedCount} of ${p.totalCount}</span></div>
        <div class="kv-row"><span class="kv-key">Status</span><span class="kv-val"><span class="badge badge-approved">Consent recorded</span></span></div>
      </div>
      <p>The consent is recorded with an audit trail. You can proceed within the scope they've consented to.</p>
      <a class="btn" href="${p.reviewUrl}">View in ImageVault</a>
    `),
  };
}

// ── Likeness monitor hit alert ───────────────────────────────────────────────

export interface LikenessHitAlertParams {
  talentName: string;
  hits: Array<{
    platform: string;
    contentUrl: string;
    authorHandle: string;
    confidence: number;
    riskLevel: string;
    rationale: string | null;
  }>;
  monitorUrl: string;
}

export function likenessHitAlertEmail(p: LikenessHitAlertParams): { subject: string; html: string } {
  const riskBadge = (level: string) =>
    level === "critical" || level === "high"
      ? `<span class="badge badge-denied">${escapeHtml(level)}</span>`
      : level === "medium"
        ? `<span class="badge badge-pending">${escapeHtml(level)}</span>`
        : `<span class="badge badge-revoked">${escapeHtml(level)}</span>`;

  const hitBlocks = p.hits
    .map(
      (h) => `
      <div class="kv">
        <div class="kv-row"><span class="kv-key">Platform</span><span class="kv-val">${escapeHtml(h.platform)}</span></div>
        <div class="kv-row"><span class="kv-key">Account</span><span class="kv-val">${escapeHtml(h.authorHandle)}</span></div>
        <div class="kv-row"><span class="kv-key">Confidence</span><span class="kv-val">${h.confidence}% likeness match</span></div>
        <div class="kv-row"><span class="kv-key">Risk</span><span class="kv-val">${riskBadge(h.riskLevel)}</span></div>
        <div class="kv-row"><span class="kv-key">Content</span><span class="kv-val"><a href="${h.contentUrl}" style="color:#c0392b;">${escapeHtml(h.contentUrl)}</a></span></div>
        ${h.rationale ? `<div class="kv-row"><span class="kv-key">Analysis</span><span class="kv-val">${escapeHtml(h.rationale)}</span></div>` : ""}
      </div>`
    )
    .join("");

  const count = p.hits.length;
  return {
    subject: `[Likeness Alert] ${count} new hit${count === 1 ? "" : "s"} detected for ${p.talentName}`,
    html: layout(`
      <p><strong>Your likeness monitor flagged ${count === 1 ? "a new item" : `${count} new items`}.</strong></p>
      <p>Automated detectors matched content against ${escapeHtml(p.talentName)}'s verified identity anchors, and the AI adjudicator confirmed ${count === 1 ? "it" : "them"} as likely unauthorised synthetic usage. Nothing has been actioned yet — review each hit and choose whether to request a takedown or dismiss it.</p>
      ${hitBlocks}
      <p class="muted">Links above lead to third-party platforms. Detection combines perceptual hashing, face-embedding similarity and geometry-fingerprint correlation from your vaulted scan packages.</p>
      <a class="btn" href="${p.monitorUrl}">Review in Likeness Monitor</a>
    `),
  };
}
