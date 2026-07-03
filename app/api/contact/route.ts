import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email/send";
import { contactEnquiryEmail } from "@/lib/email/templates";

/**
 * Recipients for the public contact form. Enquiries submitted at /contact are
 * delivered to both addresses — the functional equivalent of forwarding
 * contact@imagevault.ai to these mailboxes.
 *
 * NB: true inbound forwarding of the contact@imagevault.ai mailbox (i.e. someone
 * emailing that address directly) is configured separately via Cloudflare Email
 * Routing at the DNS level, not in application code.
 */
const CONTACT_RECIPIENTS = [
  "lukefieldsend@googlemail.com",
  "Martin.davison@gmail.com",
];

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
