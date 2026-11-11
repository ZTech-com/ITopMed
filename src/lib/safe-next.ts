/**
 * Post-login redirect targets are restricted to a small allow-list of
 * same-origin paths (prevents open redirects via ?next=).
 */
const ALLOWED = /^\/(invite\/[a-z2-7]{20,64}|c\/[a-z0-9-]{3,48}(\/[a-z0-9/_-]*)?)$/;

export function safeNext(value: unknown): string | null {
  return typeof value === "string" && ALLOWED.test(value) ? value : null;
}
