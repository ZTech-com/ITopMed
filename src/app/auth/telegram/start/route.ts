import { setTelegramFlowCookie } from "@/server/auth/cookies";
import { getClinicPrincipal, getPlatformPrincipal } from "@/server/auth/guards";
import { FLOW_TTL_S, sealFlow, type TelegramLoginKind } from "@/server/auth/telegram-auth";
import { widgetBot } from "@/server/auth/telegram-login";
import { randomToken } from "@/server/security/crypto";

/**
 * Starts LINKING Telegram to the signed-in account (checked below with the same
 * session guards as pages): remembers who is linking in a short-lived encrypted
 * cookie, then opens /auth/telegram/link with Telegram's button. Sign-in needs no
 * start: the login pages show the button directly.
 */
export const dynamic = "force-dynamic";

function go(location: string) {
  return new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const kind: TelegramLoginKind = q.get("kind") === "admin" ? "admin" : "clinic";
  const security = kind === "admin" ? "/admin/security" : "/account/security";
  const rawSlug = q.get("slug");
  const slug = kind === "clinic" && rawSlug && /^[a-z0-9-]{3,48}$/.test(rawSlug) ? rawSlug : undefined;

  const p = kind === "admin" ? await getPlatformPrincipal() : await getClinicPrincipal();
  if (!p) return go(kind === "admin" ? "/admin/login" : "/login");
  if (!(await widgetBot(kind, slug))) return go(`${security}?tg=disabled`);

  const state = randomToken();
  await setTelegramFlowCookie(
    sealFlow({ state, kind, mode: "link", userId: p.user.id, sessionId: p.sessionId, ...(slug ? { slug } : {}), exp: Math.floor(Date.now() / 1000) + FLOW_TTL_S }),
    FLOW_TTL_S,
  );
  const next = new URLSearchParams({ kind, state, ...(slug ? { slug } : {}) });
  return go(`/auth/telegram/link?${next.toString()}`);
}
