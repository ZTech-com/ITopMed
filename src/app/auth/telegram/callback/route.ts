import { LOCALE_COOKIE, isLocale } from "@/i18n/config";
import { cookies } from "next/headers";
import { safeNext } from "@/lib/safe-next";
import { setAdminSessionCookie, setClinicSessionCookie, takeTelegramFlowCookie } from "@/server/auth/cookies";
import { openFlow, splitCallbackQuery, type TelegramLoginKind, type TelegramLoginMode } from "@/server/auth/telegram-auth";
import { completeTelegramWidget, telegramReturnPath } from "@/server/auth/telegram-login";
import { requestMeta } from "@/server/http";

/**
 * Telegram's Login Widget sends our own page here with its signed fields
 * (id, auth_date, hash, ...). Public by nature (the person is signing in): the
 * fields are verified with the bot's token before anything is trusted; linking
 * additionally needs the encrypted flow cookie set by /auth/telegram/start.
 * Always answers with a redirect, so the signed fields leave the address bar.
 */
export const dynamic = "force-dynamic";

function go(path: string) {
  const safe = path.startsWith("/") && !path.startsWith("//") ? path : "/";
  return new Response(null, { status: 303, headers: { Location: safe, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

export async function GET(request: Request) {
  const { own, telegram } = splitCallbackQuery(new URL(request.url).searchParams);
  const kind: TelegramLoginKind = own.kind === "admin" ? "admin" : "clinic";
  const mode: TelegramLoginMode = own.mode === "link" ? "link" : "login";
  const slug = kind === "clinic" && own.slug && /^[a-z0-9-]{3,48}$/.test(own.slug) ? own.slug : undefined;
  const next = kind === "clinic" && mode === "login" ? (safeNext(own.next ?? null) ?? undefined) : undefined;
  const flow = mode === "link" ? openFlow(await takeTelegramFlowCookie(), own.state ?? null) : null;

  const r = await completeTelegramWidget({ kind, mode, slug, next, fields: telegram, flow }, await requestMeta());
  if (r.outcome === "error") return go(telegramReturnPath(r.kind, r.mode, r.code, r.next, r.slug));
  if (r.outcome === "linked") return go(telegramReturnPath(r.kind, "link", "linked"));

  if (r.kind === "admin") await setAdminSessionCookie(r.token);
  else await setClinicSessionCookie(r.token);
  if (isLocale(r.locale)) (await cookies()).set(LOCALE_COOKIE, r.locale, { path: "/", maxAge: 31536000, sameSite: "lax" });
  return go(telegramReturnPath(r.kind, "login", "ok", r.next));
}
