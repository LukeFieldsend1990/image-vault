import type { Metadata } from "next";
import ContactForm from "./contact-form";

export const metadata: Metadata = {
  title: "Contact — ImageVault",
  description:
    "Get in touch with the ImageVault team. Questions about likeness licensing, access, or security — we'll be in touch.",
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="mb-3 text-xs font-medium tracking-widest uppercase"
      style={{ color: "var(--color-accent)" }}
    >
      {children}
    </p>
  );
}

export default function ContactPage() {
  return (
    <section className="mx-auto max-w-6xl px-6 pt-14 pb-20 md:pt-20">
      <div className="grid gap-12 md:grid-cols-2 md:gap-16">
        {/* ── Left: intro ── */}
        <div className="max-w-md">
          <SectionLabel>Contact</SectionLabel>
          <h1
            className="text-4xl font-semibold leading-tight tracking-tight md:text-5xl"
            style={{ color: "var(--color-ink)" }}
          >
            Get in touch.
          </h1>
          <p
            className="mt-6 text-base leading-relaxed"
            style={{ color: "var(--color-muted)" }}
          >
            Questions about likeness licensing, access for your production company,
            or how ImageVault keeps talent in control — send us a note and we&apos;ll
            be in touch.
          </p>

          <div className="mt-10">
            <p
              className="text-xs font-medium tracking-widest uppercase"
              style={{ color: "var(--color-muted)" }}
            >
              Email
            </p>
            <a
              href="mailto:contact@imagevault.ai"
              className="mt-2 inline-block text-sm underline underline-offset-2 transition hover:opacity-60"
              style={{ color: "var(--color-ink)" }}
            >
              contact@imagevault.ai
            </a>
          </div>
        </div>

        {/* ── Right: form ── */}
        <div>
          <ContactForm />
        </div>
      </div>
    </section>
  );
}
