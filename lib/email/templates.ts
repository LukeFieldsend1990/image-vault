/**
 * Email HTML templates for Image Vault transactional emails.
 * United Agents aesthetic: minimal, black/white, typography-led, red accent.
 */

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
    <p class="header-label">United Agents</p>
    <p class="header-title">Image Vault</p>
    <div class="accent"></div>
  </div>
  <div class="body">${content}</div>
  <div class="footer">
    <p>This is an automated notification from Image Vault. Do not reply to this email.</p>
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
  totalSizeBytes: number;
  vaultUrl: string;
}

export function uploadCompleteEmail(p: UploadCompleteParams): { subject: string; html: string } {
  const fmt = (b: number) =>
    b >= 1e12 ? (b / 1e12).toFixed(2) + " TB"
    : b >= 1e9 ? (b / 1e9).toFixed(2) + " GB"
    : b >= 1e6 ? (b / 1e6).toFixed(1) + " MB"
    : (b / 1e3).toFixed(1) + " KB";

  return {
    subject: `Upload complete — ${p.packageName}`,
    html: layout(`
      <p>Your scan package has finished uploading and is now ready.</p>
      <div class="kv">
        <div class="kv-row"><span class="kv-key">Package</span><span class="kv-val">${p.packageName}</span></div>
        <div class="kv-row"><span class="kv-key">Files</span><span class="kv-val">${p.fileCount} file${p.fileCount !== 1 ? "s" : ""}</span></div>
        <div class="kv-row"><span class="kv-key">Total size</span><span class="kv-val">${fmt(p.totalSizeBytes)}</span></div>
        <div class="kv-row"><span class="kv-key">Status</span><span class="kv-val"><span class="badge badge-approved">Ready</span></span></div>
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
      <p>Review and approve or deny this request in Image Vault.</p>
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
  role: "licensee" | "talent";
  viewUrl: string;
}

export function packageAttachedEmail(p: PackageAttachedParams): { subject: string; html: string } {
  const body = p.role === "licensee"
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
      <a class="btn" href="${p.viewUrl}">Open in Image Vault</a>
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

export interface InviteEmailParams {
  to: string;
  inviterEmail: string;
  role: "talent" | "rep" | "licensee";
  message: string | null;
  signupUrl: string;
  expiresAt: number; // unix timestamp
}

const ROLE_LABELS: Record<"talent" | "rep" | "licensee", string> = {
  talent: "Talent",
  rep: "Representative",
  licensee: "Licensee",
};

export function inviteEmail(p: InviteEmailParams): { subject: string; html: string } {
  const roleLabel = ROLE_LABELS[p.role];
  return {
    subject: `You've been invited to Image Vault`,
    html: layout(`
      <p>You have been invited to join Image Vault as a <strong>${roleLabel}</strong>.</p>
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
    subject: "Password reset — Image Vault",
    html: layout(`
      <p>We received a request to reset your Image Vault password.</p>
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
