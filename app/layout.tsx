import type { Metadata } from "next";
// Self-hosted via fontsource so the Cloudflare Workers build never fetches
// Google Fonts. next/font/google was our previous approach; its build-time
// fetch to fonts.gstatic.com started failing on Cloudflare's build boxes on
// 2026-08-14, blocking every deploy. Self-hosting eliminates the network
// dependency entirely.
import "@fontsource-variable/hanken-grotesk";
import "@fontsource-variable/newsreader";
import "@fontsource-variable/newsreader/wght-italic.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "ImageVault",
  description:
    "Governance for performer likeness data. Consent bound to the scan; access time-limited, audited, and on the record.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
