import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email/send";
import { registerInterestEmail } from "@/lib/email/templates";
import { ADMIN_EMAILS } from "@/lib/auth/adminEmails";
import { CONTACT_FROM } from "@/lib/inbound/contact-forward";

const COMPANY_TYPES = [
  "Production Company",
  "Studio",
  "Network / Broadcaster",
  "Independent Producer",
  "Post-Production",
  "VFX / Visual Effects",
  "Games / Interactive",
  "Advertising Agency",
  "Other",
] as const;

const PROFESSIONS = [
  "Actor",
  "Stunt Performer",
  "Voice Artist",
  "Musician / Recording Artist",
  "Model",
  "Athlete",
  "Other",
] as const;

const SCAN_STATUS = [
  "Yes — I have scan packages from past productions",
  "No — I haven't been scanned yet",
  "Not sure",
] as const;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const {
    role, name, email, phone, message,
    company, companyType,
    profession, representation, existingScans,
  } = body as Record<string, string>;

  // Older clients sent no role — those were always production requests.
  const audience = role === "talent" ? "talent" : "production";

  if (!name?.trim() || !email?.trim()) {
    return NextResponse.json({ error: "Please fill in all required fields." }, { status: 400 });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }

  if (audience === "production") {
    if (!company?.trim() || !companyType?.trim()) {
      return NextResponse.json({ error: "Please fill in all required fields." }, { status: 400 });
    }
    if (!COMPANY_TYPES.includes(companyType as typeof COMPANY_TYPES[number])) {
      return NextResponse.json({ error: "Invalid company type." }, { status: 400 });
    }
  } else {
    if (!profession?.trim() || !existingScans?.trim()) {
      return NextResponse.json({ error: "Please fill in all required fields." }, { status: 400 });
    }
    if (!PROFESSIONS.includes(profession as typeof PROFESSIONS[number])) {
      return NextResponse.json({ error: "Invalid profession." }, { status: 400 });
    }
    if (!SCAN_STATUS.includes(existingScans as typeof SCAN_STATUS[number])) {
      return NextResponse.json({ error: "Invalid scan status." }, { status: 400 });
    }
  }

  const submittedAt = Math.floor(Date.now() / 1000);

  const { subject, html } = registerInterestEmail({
    role: audience,
    name: name.trim(),
    email: email.trim(),
    phone: phone?.trim() || undefined,
    message: message?.trim() || undefined,
    submittedAt,
    ...(audience === "production"
      ? { company: company.trim(), companyType }
      : {
          profession,
          representation: representation?.trim() || undefined,
          existingScans,
        }),
  });

  // Mirror the contact form: send from the verified imagevault.ai sender and set
  // Reply-To to the applicant so the team can reply straight back to them.
  void (async () => {
    await sendEmail({
      to: ADMIN_EMAILS as unknown as string[],
      from: CONTACT_FROM,
      replyTo: email.trim(),
      subject,
      html,
    });
  })();

  return NextResponse.json({ success: true });
}
