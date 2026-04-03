import { describe, it, expect } from "vitest";
import {
  uploadCompleteEmail,
  downloadRequestEmail,
  licenceRequestedEmail,
  licenceApprovedEmail,
  licenceDeniedEmail,
  licenceRevokedEmail,
  inviteEmail,
  scanBookingConfirmedEmail,
  scanBookingCancelledEmail,
  passwordResetEmail,
  downloadCompleteEmail,
} from "@/lib/email/templates";

describe("email templates", () => {
  it("uploadCompleteEmail includes package name and file count", () => {
    const result = uploadCompleteEmail({
      talentEmail: "talent@test.com",
      packageName: "My Scan",
      fileCount: 42,
      totalSizeBytes: 5_000_000_000,
      vaultUrl: "https://vault.test/dashboard",
    });
    expect(result.subject).toContain("My Scan");
    expect(result.html).toContain("My Scan");
    expect(result.html).toContain("42 files");
    expect(result.html).toContain("5.00 GB");
    expect(result.html).toContain("https://vault.test/dashboard");
  });

  it("uploadCompleteEmail formats sizes correctly", () => {
    const kb = uploadCompleteEmail({ talentEmail: "", packageName: "", fileCount: 1, totalSizeBytes: 1500, vaultUrl: "" });
    expect(kb.html).toContain("1.5 KB");

    const mb = uploadCompleteEmail({ talentEmail: "", packageName: "", fileCount: 1, totalSizeBytes: 2_500_000, vaultUrl: "" });
    expect(mb.html).toContain("2.5 MB");

    const tb = uploadCompleteEmail({ talentEmail: "", packageName: "", fileCount: 1, totalSizeBytes: 1_500_000_000_000, vaultUrl: "" });
    expect(tb.html).toContain("1.50 TB");
  });

  it("uploadCompleteEmail singular file", () => {
    const r = uploadCompleteEmail({ talentEmail: "", packageName: "", fileCount: 1, totalSizeBytes: 1000, vaultUrl: "" });
    expect(r.html).toContain("1 file");
    expect(r.html).not.toContain("1 files");
  });

  it("downloadRequestEmail includes project and licensee info", () => {
    const result = downloadRequestEmail({
      talentEmail: "talent@test.com",
      licenseeEmail: "licensee@prod.com",
      projectName: "Big Film",
      packageName: "Head Scan",
      authoriseUrl: "https://vault.test/authorise/123",
    });
    expect(result.subject).toContain("Big Film");
    expect(result.html).toContain("licensee@prod.com");
    expect(result.html).toContain("Head Scan");
    expect(result.html).toContain("https://vault.test/authorise/123");
  });

  it("licenceRequestedEmail includes all key details", () => {
    const result = licenceRequestedEmail({
      talentEmail: "talent@test.com",
      licenseeEmail: "licensee@test.com",
      projectName: "Game X",
      productionCompany: "Studio Y",
      intendedUse: "Character double",
      packageName: "Full Scan",
      validFrom: 1700000000,
      validTo: 1710000000,
      reviewUrl: "https://vault.test/review/1",
    });
    expect(result.subject).toContain("Game X");
    expect(result.html).toContain("Studio Y");
    expect(result.html).toContain("Character double");
    expect(result.html).toContain("Full Scan");
  });

  it("licenceApprovedEmail includes download URL", () => {
    const result = licenceApprovedEmail({
      licenseeEmail: "licensee@test.com",
      projectName: "Project Z",
      packageName: "Scan A",
      validFrom: 1700000000,
      validTo: 1710000000,
      downloadUrl: "https://vault.test/download/1",
    });
    expect(result.subject).toContain("Project Z");
    expect(result.html).toContain("Approved");
    expect(result.html).toContain("https://vault.test/download/1");
  });

  it("licenceDeniedEmail includes reason when provided", () => {
    const withReason = licenceDeniedEmail({
      licenseeEmail: "licensee@test.com",
      projectName: "Proj",
      packageName: "Scan",
      reason: "Not suitable for this use case",
    });
    expect(withReason.html).toContain("Not suitable for this use case");

    const noReason = licenceDeniedEmail({
      licenseeEmail: "licensee@test.com",
      projectName: "Proj",
      packageName: "Scan",
      reason: null,
    });
    expect(noReason.html).not.toContain("Reason");
  });

  it("licenceRevokedEmail shows revoked status", () => {
    const result = licenceRevokedEmail({
      licenseeEmail: "licensee@test.com",
      projectName: "Old Proj",
      packageName: "Scan B",
    });
    expect(result.subject).toContain("Old Proj");
    expect(result.html).toContain("Revoked");
  });

  it("inviteEmail includes role label and signup URL", () => {
    const result = inviteEmail({
      to: "new@test.com",
      inviterEmail: "admin@test.com",
      role: "talent",
      message: "Welcome aboard!",
      signupUrl: "https://vault.test/signup?token=abc",
      expiresAt: 1700000000,
    });
    expect(result.subject).toContain("invited");
    expect(result.html).toContain("Talent");
    expect(result.html).toContain("admin@test.com");
    expect(result.html).toContain("Welcome aboard!");
    expect(result.html).toContain("https://vault.test/signup?token=abc");
  });

  it("inviteEmail omits message when null", () => {
    const result = inviteEmail({
      to: "new@test.com",
      inviterEmail: "admin@test.com",
      role: "rep",
      message: null,
      signupUrl: "https://vault.test/signup?token=abc",
      expiresAt: 1700000000,
    });
    expect(result.html).toContain("Representative");
    expect(result.html).not.toContain("<em>");
  });

  it("scanBookingConfirmedEmail includes location and time", () => {
    const result = scanBookingConfirmedEmail({
      talentEmail: "talent@test.com",
      talentName: "John",
      locationName: "Pinewood",
      city: "London",
      address: "123 Studio Lane",
      startTime: 1700000000,
      durationMins: 90,
      bookingUrl: "https://vault.test/bookings",
    });
    expect(result.subject).toContain("Pinewood");
    expect(result.html).toContain("London");
    expect(result.html).toContain("123 Studio Lane");
    expect(result.html).toContain("90 minutes");
    expect(result.html).toContain("Confirmed");
  });

  it("scanBookingCancelledEmail shows cancelled status", () => {
    const result = scanBookingCancelledEmail({
      talentEmail: "talent@test.com",
      locationName: "Leavesden",
      city: "London",
      startTime: 1700000000,
      durationMins: 60,
    });
    expect(result.subject).toContain("Leavesden");
    expect(result.html).toContain("Cancelled");
  });

  it("passwordResetEmail includes reset URL and expiry", () => {
    const result = passwordResetEmail({
      resetUrl: "https://vault.test/reset?token=xyz",
      expiresInMinutes: 30,
    });
    expect(result.subject).toContain("Password reset");
    expect(result.html).toContain("https://vault.test/reset?token=xyz");
    expect(result.html).toContain("30 minutes");
  });

  it("downloadCompleteEmail has different intro for licensee vs talent", () => {
    const licensee = downloadCompleteEmail({
      recipientEmail: "licensee@test.com",
      isLicensee: true,
      projectName: "Film X",
      packageName: "Scan",
      licenseeEmail: "licensee@test.com",
      fileCount: 5,
      ip: "1.2.3.4",
      downloadedAt: 1700000000,
    });
    expect(licensee.html).toContain("securely transferred");
    expect(licensee.html).toContain("1.2.3.4");

    const talent = downloadCompleteEmail({
      recipientEmail: "talent@test.com",
      isLicensee: false,
      projectName: "Film X",
      packageName: "Scan",
      licenseeEmail: "licensee@test.com",
      fileCount: 5,
      ip: null,
      downloadedAt: 1700000000,
    });
    expect(talent.html).toContain("chain of custody");
    expect(talent.html).not.toContain("IP address");
  });

  it("all templates produce valid HTML with layout wrapper", () => {
    const templates = [
      uploadCompleteEmail({ talentEmail: "", packageName: "P", fileCount: 1, totalSizeBytes: 1000, vaultUrl: "" }),
      passwordResetEmail({ resetUrl: "", expiresInMinutes: 30 }),
      licenceRevokedEmail({ licenseeEmail: "", projectName: "P", packageName: "S" }),
    ];
    for (const t of templates) {
      expect(t.html).toContain("<!DOCTYPE html>");
      expect(t.html).toContain("Image Vault");
      expect(t.html).toContain("United Agents");
      expect(t.html).toContain("</html>");
    }
  });
});
