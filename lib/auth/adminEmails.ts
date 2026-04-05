/**
 * Hardcoded admin whitelist.
 *
 * Deliberately NOT read from an env var — if a Cloudflare login is
 * compromised, an attacker cannot escalate to admin by editing a secret.
 * To change the list, commit a code change and redeploy.
 */
export const ADMIN_EMAILS: readonly string[] = [
  "lukefieldsend@googlemail.com",
  "martindavison@gmail.com",
];

export function isAdmin(email: string | undefined | null): boolean {
  return !!email && ADMIN_EMAILS.includes(email);
}
