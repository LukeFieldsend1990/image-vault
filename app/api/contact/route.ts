import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email/send";
import { contactEnquiryEmail } from "@/lib/email/templates";
import { CONTACT_RECIPIENTS } from "@/lib/inbound/contact-forward";

/**
 * The /contact form delivers enquiries to CONTACT_RECIPIENTS. Mail sent directly
 * to contact@imagevault.ai reaches the same inboxes via the Resend inbound
 * webhook (see lib/inbound/contact-forward.ts) — one shared recipient list.
 */

const MAX_MESSAGE = 5000;
const MAX_FIELD = 200;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { name, email, subject, message, company } = body as Record<string, string>;

  // Honeypot — bots fill hidden fields; humans never see "company" on this form.
  if (company && company.trim()) {
    return NextResponse.json({ success: true });
  }

  if (!name?.trim() || !email?.trim() || !message?.trim()) {
    return NextResponse.json({ error: "Please fill in all required fields." }, { status: 400 });
  }

  if (name.trim().length > MAX_FIELD || (subject && subject.trim().length > MAX_FIELD)) {
    return NextResponse.json({ error: "One or more fields are too long." }, { status: 400 });
  }

  if (message.trim().length > MAX_MESSAGE) {
    return NextResponse.json({ error: "Your message is too long." }, { status: 400 });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }

  const { subject: emailSubject, html } = contactEnquiryEmail({
    name: name.trim(),
    email: email.trim(),
    subject: subject?.trim() || undefined,
    message: message.trim(),
    submittedAt: Math.floor(Date.now() / 1000),
  });

  void (async () => {
    await sendEmail({
      to: CONTACT_RECIPIENTS,
      subject: emailSubject,
      html,
    });
  })();

  return NextResponse.json({ success: true });
}
