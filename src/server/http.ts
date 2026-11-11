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
