import Link from "next/link";
import Wordmark from "@/app/components/wordmark";

export default function MarketingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-screen flex-col" style={{ background: "var(--color-bg)" }}>
      {/* ── Header ── */}
      <header
        className="sticky top-0 z-50 border-b"
        style={{
          borderColor: "var(--color-border)",
          background: "rgba(255,255,255,0.92)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
        }}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/product" aria-label="ImageVault">
            <Wordmark variant="display" tone="ink" style={{ fontSize: "1.15rem" }} />
          </Link>

          <nav className="hidden items-center gap-8 md:flex">
            {[
              ["Platform", "#platform"],
              ["Features", "#features"],
              ["Security", "#security"],
              ["How it works", "#how-it-works"],
            ].map(([label, href]) => (
              <a
                key={href}
                href={href}
                className="text-xs font-medium tracking-wide uppercase transition hover:opacity-60"
                style={{ color: "var(--color-muted)" }}
              >
                {label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-4">
            <Link
              href="/login"
              className="text-xs font-medium tracking-wide uppercase transition hover:opacity-60"
              style={{ color: "var(--color-ink)" }}
            >
              Sign in
            </Link>
            <Link
              href="/register-interest"
              className="btn-accent px-4 py-2 text-xs font-medium tracking-wide uppercase text-white transition"
            >
              Request access
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      {/* ── Footer ── */}
      <footer className="border-t" style={{ borderColor: "var(--color-border)" }}>
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-12 md:flex-row md:items-center md:justify-between">
          <div>
            <Wordmark variant="display" tone="ink" style={{ fontSize: "1.05rem" }} />
            <p className="mt-2 text-xs" style={{ color: "var(--color-muted)" }}>
              The gate, not the safe.
            </p>
          </div>
          <div className="flex items-center gap-8">
            <Link
              href="/login"
              className="text-xs transition hover:opacity-60"
              style={{ color: "var(--color-muted)" }}
            >
              Sign in
            </Link>
            <Link
              href="/register-interest"
              className="text-xs transition hover:opacity-60"
              style={{ color: "var(--color-muted)" }}
            >
              Request access
            </Link>
            <span className="text-xs" style={{ color: "var(--color-muted)" }}>
              &copy; {new Date().getFullYear()} Image Vault
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
