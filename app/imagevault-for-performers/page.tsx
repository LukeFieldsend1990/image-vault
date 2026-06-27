import Link from "next/link";

export const metadata = {
  title: "ImageVault for performers",
  description: "What ImageVault is, and what changes if you register and take control of your biometric data.",
};

function Section({ num, heading, children }: { num: string; heading: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <p className="text-xs font-mono uppercase tracking-wider mb-1" style={{ color: "var(--color-muted)" }}>Section {num}</p>
      <h2 className="text-lg font-medium mb-2" style={{ color: "var(--color-text)", fontFamily: "var(--font-display, inherit)" }}>{heading}</h2>
      <div className="space-y-2.5 text-sm" style={{ color: "var(--color-muted)", lineHeight: 1.65 }}>{children}</div>
    </section>
  );
}

export default function PerformerExplainerPage() {
  return (
    <div style={{ background: "var(--color-bg)", minHeight: "100vh" }}>
      <div className="mx-auto px-5 py-10" style={{ maxWidth: 720 }}>
        <header className="mb-7">
          <p className="text-xs font-medium tracking-widest uppercase mb-2" style={{ color: "var(--color-muted)" }}>For performers</p>
          <h1 className="text-2xl font-medium mb-3" style={{ color: "var(--color-text)", fontFamily: "var(--font-display, inherit)", lineHeight: 1.2 }}>
            What is ImageVault, and what changes if I register?
          </h1>
          <p className="text-sm" style={{ color: "var(--color-muted)", lineHeight: 1.6 }}>
            This page explains what ImageVault is and what happens if you decide to register and take direct control of your biometric data.
          </p>
        </header>

        <div className="rounded-xl p-5 mb-8" style={{ border: `1px solid var(--color-accent)`, background: "rgba(192,57,43,0.04)" }}>
          <p className="text-xs font-medium tracking-widest uppercase mb-2" style={{ color: "var(--color-muted)" }}>The short version</p>
          <p className="text-sm" style={{ color: "var(--color-text)", lineHeight: 1.6 }}>
            ImageVault is a platform where <strong>you</strong>, not the production, control who can use your biometric data. Registration is
            free, optional, and gives you direct visibility and control over every production that holds your data.
          </p>
        </div>

        <Section num="1" heading="What ImageVault is">
          <p>ImageVault is an independent platform built for biometric data in the film and television industry. It exists because scans of performers are now standard practice on most productions, and there hasn&apos;t been a way for performers themselves to control what happens to that data after the scan.</p>
          <p>We&apos;re independent of any agency, studio, or production company. We don&apos;t represent you, we don&apos;t take a commission on your work, and we don&apos;t sell or train AI models on your data.</p>
        </Section>

        <Section num="2" heading="What changes if you register">
          <p>Right now, because you haven&apos;t yet registered, the production you&apos;ve signed for is the temporary controller of your data. If you register, that changes:</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
            <div className="rounded-lg p-4" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
              <p className="text-xs font-medium tracking-widest uppercase mb-2" style={{ color: "var(--color-muted)" }}>Without ImageVault</p>
              <ul className="list-disc pl-4 space-y-1 text-sm" style={{ color: "var(--color-muted)" }}>
                <li>Production holds your data temporarily.</li>
                <li>You see what they hold only by asking.</li>
                <li>You consent to each production separately.</li>
                <li>Withdrawing consent goes through the production.</li>
              </ul>
            </div>
            <div className="rounded-lg p-4" style={{ border: `1px solid var(--color-accent)`, background: "rgba(192,57,43,0.04)" }}>
              <p className="text-xs font-medium tracking-widest uppercase mb-2" style={{ color: "var(--color-accent)" }}>With ImageVault</p>
              <ul className="list-disc pl-4 space-y-1 text-sm" style={{ color: "var(--color-text)" }}>
                <li>You hold your data. Productions request access.</li>
                <li>You see every production that holds data on you.</li>
                <li>Your agent can grant under standing instructions.</li>
                <li>You can withdraw consent yourself, instantly.</li>
              </ul>
            </div>
          </div>
        </Section>

        <Section num="3" heading="Standing instructions and how your agent fits in">
          <p>If you have an agent, they already negotiate likeness, image, and use rights on your behalf. ImageVault doesn&apos;t change that — it gives the relationship a clear structure.</p>
          <p>When you register, you set <strong style={{ color: "var(--color-text)" }}>standing instructions</strong> for each use category. For each one, you choose:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong style={{ color: "var(--color-text)" }}>Always, via my agent.</strong> Your agent can grant requests in this category without coming back to you each time.</li>
            <li><strong style={{ color: "var(--color-text)" }}>Case by case, ask me.</strong> Your agent routes the request to you for sign-off.</li>
            <li><strong style={{ color: "var(--color-text)" }}>Never.</strong> The system structurally prevents anyone from granting it.</li>
          </ul>
        </Section>

        <Section num="4" heading="Claiming data from past productions">
          <p>If productions have scanned you before, your data may already be sitting in production-held vaults. When you register, ImageVault shows you every vault that exists for you. You can claim them and bring them under your control.</p>
          <p>Claiming doesn&apos;t undo access already granted within the scope you originally consented to. But going forward, all new access requests come to you and your agent.</p>
        </Section>

        <Section num="5" heading="What it costs">
          <p>Registration is free for performers. Productions and agencies pay for the platform. We don&apos;t sell your data, we don&apos;t train AI models on it, and we don&apos;t take a percentage of any work you do.</p>
        </Section>

        <div className="rounded-xl p-6" style={{ border: "2px solid var(--color-text)", background: "var(--color-bg)" }}>
          <h2 className="text-xl font-medium mb-2" style={{ color: "var(--color-text)", fontFamily: "var(--font-display, inherit)" }}>Want to register?</h2>
          <p className="text-sm mb-4" style={{ color: "var(--color-muted)", lineHeight: 1.6 }}>
            Registration takes about three minutes. You&apos;ll set up an account, see any vaults that already exist for you, and decide your standing instructions.
          </p>
          <Link href="/signup" className="inline-block rounded px-4 py-2 text-sm font-medium text-white" style={{ background: "var(--color-accent)" }}>
            Register on ImageVault
          </Link>
        </div>
      </div>
    </div>
  );
}
