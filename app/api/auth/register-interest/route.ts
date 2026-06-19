import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email/send";
import { registerInterestEmail } from "@/lib/email/templates";
import { ADMIN_EMAILS } from "@/lib/auth/adminEmails";

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

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { name, email, company, companyType, phone, message } = body as Record<string, string>;

  if (!name?.trim() || !email?.trim() || !company?.trim() || !companyType?.trim()) {
    return NextResponse.json({ error: "Please fill in all required fields." }, { status: 400 });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }

  if (!COMPANY_TYPES.includes(companyType as typeof COMPANY_TYPES[number])) {
    return NextResponse.json({ error: "Invalid company type." }, { status: 400 });
  }

  const submittedAt = Math.floor(Date.now() / 1000);

  const { subject, html } = registerInterestEmail({
    name: name.trim(),
    email: email.trim(),
    company: company.trim(),
    companyType,
    phone: phone?.trim() || undefined,
    message: message?.trim() || undefined,
    submittedAt,
  });

  void (async () => {
    await sendEmail({
      to: ADMIN_EMAILS as unknown as string[],
      subject,
      html,
    });
  })();

  return NextResponse.json({ success: true });
}
