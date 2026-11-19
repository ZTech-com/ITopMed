import { safeNext } from "@/lib/safe-next";
import { setTelegramFlowCookie } from "@/server/auth/cookies";
import { getClinicPrincipal, getPlatformPrincipal } from "@/server/auth/guards";
import { beginTelegramFlow, telegramReturnPath } from "@/server/auth/telegram-login";
import { FLOW_TTL_S, type TelegramLoginKind, type TelegramLoginMode } from "@/server/auth/telegram-oidc";
import { requestMeta } from "@/server/http";

/**
 * Starts "Log In with Telegram" (OpenID Connect, PKCE) and sends the browser to
 * oauth.telegram.org. Sign-in mode is public by nature; link mode requires the
 * signed-in account (checked below with the same session guards as pages).
 */
export const dynamic = "force-dynamic";

function go(location: string) {
  return new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const kind: TelegramLoginKind = q.get("kind") === "admin" ? "admin" : "clinic";
  const mode: TelegramLoginMode = q.get("mode") === "link" ? "link" : "login";
  const next = kind === "clinic" && mode === "login" ? (safeNext(q.get("next")) ?? undefined) : undefined;

  let owner: { userId: string; sessionId: string } | null = null;
  if (mode === "link") {
    const p = kind === "admin" ? await getPlatformPrincipal() : await getClinicPrincipal();
    if (!p) return go(kind === "admin" ? "/admin/login" : "/login");
    owner = { userId: p.user.id, sessionId: p.sessionId };
  }

  const r = await beginTelegramFlow(kind, mode, owner, next, await requestMeta());
  if (!r.ok) return go(telegramReturnPath(kind, mode, r.code, next));
  await setTelegramFlowCookie(r.sealed, FLOW_TTL_S);
  return go(r.url);
}
