import { NextResponse, type NextRequest } from "next/server";

/**
 * Per-request Content-Security-Policy with a nonce (scripts must carry it).
 * Authorization is NOT done here: every page and server action checks the
 * session and permissions on the server itself (defence in depth).
 */
/** Paths the console's own host (ADMIN_URL) serves besides /admin. */
const ADMIN_HOST_PATHS = /^\/(admin|auth\/telegram|api\/health|tg(\/|$)|_next|icons|favicon|apple-icon|icon|manifest|admin\.webmanifest|sw\.js)/;

/**
 * Console on its own address (ADMIN_URL, e.g. admin.itoppos.uz): there only the
 * console (and what it needs) is served; on the clinic address /admin redirects
 * there. Convenience routing only - every console page still checks the
 * SuperAdmin session itself.
 */
function adminHostRedirect(request: NextRequest): NextResponse | null {
  const adminUrl = process.env.ADMIN_URL;
  if (!adminUrl || process.env.LOCAL_MODE === "1") return null;
  let admin: URL;
  try {
    admin = new URL(adminUrl);
  } catch {
    return null;
  }
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(",")[0]!.trim().toLowerCase();
  const path = request.nextUrl.pathname;
  if (host === admin.host.toLowerCase()) {
    return ADMIN_HOST_PATHS.test(path) ? null : NextResponse.redirect(new URL("/admin", admin));
  }
  if (path === "/admin" || path.startsWith("/admin/")) return NextResponse.redirect(new URL(`${path}${request.nextUrl.search}`, admin));
  return null;
}

export function proxy(request: NextRequest) {
  const moved = adminHostRedirect(request);
  if (moved) return moved;
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  // Single-computer installation (`npm run local`): the app is opened over plain
  // http://127.0.0.1 on that computer (a secure context for browsers), so HTTPS must
  // not be forced there. Internet deployments never set LOCAL_MODE.
  const forceHttps = !isDev && process.env.LOCAL_MODE !== "1";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes are needed by React/Next internals; style injection is low-risk compared with script.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "worker-src 'self'",
    "manifest-src 'self'",
    ...(forceHttps ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  if (forceHttps && process.env.NODE_ENV === "production") response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|icons|favicon.ico|sw.js|manifest.webmanifest).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
