import { LOCALE_COOKIE, isLocale } from "@/i18n/config";
import { cookies } from "next/headers";
import { setAdminSessionCookie, setClinicSessionCookie, takeTelegramFlowCookie } from "@/server/auth/cookies";
import { finishTelegramFlow, telegramReturnPath } from "@/server/auth/telegram-login";
import { openFlow } from "@/server/auth/telegram-oidc";
import { requestMeta } from "@/server/http";

/**
 * Telegram sends the browser back here with ?code&state. Public by nature (the
 * person is signing in): the encrypted flow cookie set by /auth/telegram/start
 * must match `state`, the code is exchanged with our client secret and the
 * id_token is verified against Telegram's keys before anything is trusted.
 */
export const dynamic = "force-dynamic";

/**
 * The last hop is a page on our own origin rather than a 30x: a redirect chain
 * that began on oauth.telegram.org is cross-site, and browsers then withhold
 * SameSite=Strict cookies (the console session) on the next page.
 */
function land(path: string) {
  const safe = path.startsWith("/") && !path.startsWith("//") ? path : "/";
  const href = safe.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url=${href}"><title>ITop Med</title></head><body><p><a href="${href}">ITop Med</a></p></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } },
  );
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const flow = openFlow(await takeTelegramFlowCookie(), q.get("state"));
  if (!flow) return land("/login?tg=failed");
  const code = q.get("code");
  // The person pressed "Cancel" on Telegram's page (or Telegram reported an error).
  if (!code) return land(telegramReturnPath(flow.kind, flow.mode, "cancelled", flow.next, flow.slug));

  const r = await finishTelegramFlow(flow, code, await requestMeta());
  if (r.outcome === "error") return land(telegramReturnPath(r.kind, r.mode, r.code, r.next, r.slug));
  if (r.outcome === "linked") return land(telegramReturnPath(r.kind, "link", "linked"));

  if (r.kind === "admin") await setAdminSessionCookie(r.token);
  else await setClinicSessionCookie(r.token);
  if (isLocale(r.locale)) (await cookies()).set(LOCALE_COOKIE, r.locale, { path: "/", maxAge: 31536000, sameSite: "lax" });
  return land(telegramReturnPath(r.kind, "login", "ok", r.next));
}
