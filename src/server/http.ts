import "server-only";
import { headers } from "next/headers";
import type { RequestMeta } from "./auth/platform-auth";

/**
 * Client metadata for audit and rate limiting. In production the app runs
 * behind a trusted reverse proxy that sets X-Forwarded-For; the left-most
 * address is only trustworthy because that proxy overwrites the header.
 */
export async function requestMeta(): Promise<RequestMeta> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  const ip = fwd ? fwd.split(",")[0]!.trim() : h.get("x-real-ip");
  return { ip: ip ?? null, userAgent: h.get("user-agent"), requestId: h.get("x-request-id") };
}

/**
 * Cross-site request check for POST downloads (route handlers do not get the
 * built-in check of server actions). Accepted origins: the configured APP_URL,
 * the URL the request arrived on, and the address the browser actually used
 * as reported by our own proxy (Nginx or the local app's proxy set
 * X-Forwarded-Host / X-Forwarded-Proto; a browser cannot set them cross-site).
 * Without an Origin header (old browsers, same-origin navigations) the
 * SameSite session cookie is the protection.
 */
export function isSameOriginRequest(request: Request, appUrl: string): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const allowed = new Set<string>([new URL(appUrl).origin, new URL(request.url).origin]);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) {
    const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? new URL(request.url).protocol.replace(":", "");
    allowed.add(`${proto}://${host}`);
  }
  return allowed.has(origin);
}
