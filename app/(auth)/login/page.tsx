export default function LoginPage() {
  return (
    <div className="flex min-h-screen">
      {/* ── Left panel ── */}
      <div className="flex flex-1 flex-col justify-between px-12 py-12 lg:px-16">
        {/* Wordmark */}
        <div>
          <span className="text-xs font-semibold tracking-[0.2em] uppercase text-[--color-muted]">
            United Agents
          </span>
          <span className="mx-2 text-xs text-[--color-border]">/</span>
          <span className="text-xs font-semibold tracking-[0.2em] uppercase text-[--color-ink]">
            Image Vault
          </span>
        </div>

        {/* Form block */}
        <div className="w-full max-w-sm">
          <h1 className="mb-1 text-3xl font-semibold tracking-tight text-[--color-ink]">
            Sign in
          </h1>
          <p className="mb-10 text-sm text-[--color-muted]">
            Access your secure likeness vault.
          </p>

          <form className="space-y-5" action="#" method="POST">
            {/* Email */}
            <div>
              <label
                htmlFor="email"
                className="block text-xs font-medium tracking-wide uppercase text-[--color-muted] mb-1.5"
              >
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@unitedagents.co.uk"
                className="block w-full border border-[--color-border] bg-white px-4 py-3 text-sm text-[--color-ink] placeholder-[--color-border] outline-none transition focus:border-[--color-ink]"
                style={{ borderRadius: "var(--radius)" }}
              />
            </div>

            {/* Password */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="password"
                  className="block text-xs font-medium tracking-wide uppercase text-[--color-muted]"
                >
                  Password
                </label>
                <a
                  href="/forgot-password"
                  className="text-xs text-[--color-muted] hover:text-[--color-ink] transition"
                >
                  Forgot password?
                </a>
              </div>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                placeholder="••••••••••••"
                className="block w-full border border-[--color-border] bg-white px-4 py-3 text-sm text-[--color-ink] placeholder-[--color-border] outline-none transition focus:border-[--color-ink]"
                style={{ borderRadius: "var(--radius)" }}
              />
            </div>

            {/* Submit */}
            <button
              type="submit"
              className="mt-2 w-full bg-[--color-ink] px-4 py-3.5 text-sm font-medium tracking-wide text-white transition hover:bg-zinc-800 active:bg-zinc-900"
              style={{ borderRadius: "var(--radius)" }}
            >
              Sign in
            </button>
          </form>

          <p className="mt-8 text-xs text-[--color-muted]">
            Don&apos;t have an account?{" "}
            <a
              href="/request-access"
              className="font-medium text-[--color-ink] underline underline-offset-2"
            >
              Request access
            </a>
          </p>
        </div>

        {/* Footer */}
        <p className="text-xs text-[--color-muted]">
          &copy; {new Date().getFullYear()} United Agents. All rights reserved.
        </p>
      </div>

      {/* ── Right panel ── */}
      <div
        className="hidden lg:flex lg:w-[45%] flex-col justify-between p-16"
        style={{ background: "var(--color-sidebar)" }}
      >
        <div />

        <div>
          <p
            className="text-3xl font-light leading-snug tracking-tight"
            style={{ color: "var(--color-sidebar-fg)" }}
          >
            Your likeness.
            <br />
            Your terms.
          </p>
          <p
            className="mt-4 text-sm leading-relaxed"
            style={{ color: "var(--color-sidebar-muted)" }}
          >
            A private, encrypted vault for talent to store, manage, and
            license high-fidelity likeness scans — with full control over
            who accesses them and when.
          </p>
        </div>

        <div
          className="text-xs"
          style={{ color: "var(--color-sidebar-muted)" }}
        >
          <span className="font-medium" style={{ color: "var(--color-sidebar-fg)" }}>
            End-to-end encrypted.
          </span>{" "}
          Files are encrypted in your browser before upload. The platform never
          holds your plaintext data.
        </div>
      </div>
    </div>
  );
}
