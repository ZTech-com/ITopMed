import { cookies } from "next/headers";
import { LOCALE_COOKIE, isLocale } from "@/i18n/config";
import { setAdminSessionCookie, setClinicSessionCookie, setPatientSessionCookie } from "@/server/auth/cookies";
import { resolveWebApp } from "@/server/auth/telegram-webapp";
import { env } from "@/server/env";
import { isSameOriginRequest, requestMeta } from "@/server/http";

/**
 * Mini App sign-in (the central bot's "Open" button → /tg → here).
 * Public by nature: the credential is Telegram's signed initData, verified with
 * the bot token in resolveWebApp. Same-origin only, so another site cannot sign
 * a visitor into someone else's account (login CSRF).
 */
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (!isSameOriginRequest(request, env().APP_URL)) return json({ status: "error", reason: "invalid" }, 403);
  let body: { initData?: unknown; choice?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ status: "error", reason: "invalid" }, 400);
  }
  const initData = typeof body.initData === "string" ? body.initData : "";
  const choice = typeof body.choice === "string" && body.choice.length <= 64 ? body.choice : null;
  const r = await resolveWebApp(initData, choice, await requestMeta());
  if (r.status !== "signed_in") return json(r);

  if (r.target === "admin") await setAdminSessionCookie(r.token);
  else if (r.target === "clinic") await setClinicSessionCookie(r.token);
  else await setPatientSessionCookie(r.token);
  if (isLocale(r.locale)) (await cookies()).set(LOCALE_COOKIE, r.locale, { path: "/", maxAge: 31536000, sameSite: "lax" });
  // The session token stays in the HttpOnly cookie; the page only learns where to go.
  return json({ status: "signed_in", go: r.go });
}
