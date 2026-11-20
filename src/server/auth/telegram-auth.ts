import "server-only";
import { createHash, createHmac } from "node:crypto";
import { decryptField, encryptField, safeEqual } from "../security/crypto";

/**
 * Website sign-in with the Telegram Login Widget
 * (https://core.telegram.org/widgets/login), the same way as before OIDC: it
 * needs only the bot's token and its domain (@BotFather > /setdomain).
 *
 * The widget (iframe from oauth.telegram.org) runs in `data-auth-url` mode: after
 * the person confirms in Telegram, the widget script sends OUR page to our
 * callback with Telegram's signed fields in the query. The signature
 * (HMAC-SHA-256 keyed with SHA-256(bot token)) is checked before the Telegram
 * user id in it is trusted. Only that id is used; name, username and photo are
 * ignored and never stored.
 */

export type TelegramLoginKind = "clinic" | "admin";
export type TelegramLoginMode = "login" | "link";

/** Signed fields older than this are refused (the person has just confirmed). */
export const WIDGET_MAX_AGE_S = 10 * 60;

/** Our own query parameters on the callback URL; every other parameter is Telegram's. */
export const OWN_PARAMS = new Set(["kind", "mode", "slug", "next", "state"]);

/**
 * Verifies the Login Widget fields (`hash` + every other Telegram field) with the
 * bot token. Returns the Telegram user id, or null when the signature, the age or
 * the id is wrong.
 */
export function verifyWidgetAuth(fields: Record<string, string>, botToken: string, nowS = Math.floor(Date.now() / 1000)): bigint | null {
  const hash = fields.hash;
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  const keys = Object.keys(fields).filter((k) => k !== "hash");
  if (keys.length > 20) return null;
  let size = 0;
  for (const k of keys) {
    if (!/^[a-z_]{1,32}$/.test(k)) return null;
    size += fields[k]!.length;
  }
  if (size > 4096) return null;
  const check = keys
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");
  const secret = createHash("sha256").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(check).digest("hex");
  if (!safeEqual(expected, hash)) return null;
  const authDate = Number(fields.auth_date);
  if (!Number.isInteger(authDate) || authDate > nowS + 60 || nowS - authDate > WIDGET_MAX_AGE_S) return null;
  return parseTelegramId(fields.id);
}

/** Splits the callback query into our parameters and Telegram's signed fields. */
export function splitCallbackQuery(q: URLSearchParams): { own: Record<string, string>; telegram: Record<string, string> } {
  const own: Record<string, string> = {};
  const telegram: Record<string, string> = {};
  for (const [k, v] of q) (OWN_PARAMS.has(k) ? own : telegram)[k] = v;
  return { own, telegram };
}

// ───────────── Link flow state (short-lived, encrypted cookie) ─────────────

export interface FlowState {
  /** Random value repeated in the widget's callback URL. */
  state: string;
  kind: TelegramLoginKind;
  mode: "link";
  /** The signed-in account and session that started it. */
  userId: string;
  sessionId: string;
  /** Clinic whose bot the person links through; absent = the central bot (console). */
  slug?: string;
  /** Unix seconds. */
  exp: number;
}

export const FLOW_TTL_S = 10 * 60;
const FLOW_CONTEXT = "telegram-link-flow";

export function sealFlow(f: FlowState): string {
  return encryptField(JSON.stringify(f), FLOW_CONTEXT);
}

/** Null when the cookie is missing, tampered with, expired, or does not match the returned state. */
export function openFlow(sealed: string | undefined | null, returnedState: string | null, nowS = Math.floor(Date.now() / 1000)): FlowState | null {
  if (!sealed || !returnedState || sealed.length > 4096) return null;
  let f: FlowState;
  try {
    f = JSON.parse(decryptField(sealed, FLOW_CONTEXT)) as FlowState;
  } catch {
    return null;
  }
  if (typeof f.state !== "string" || !safeEqual(f.state, returnedState)) return null;
  if (typeof f.exp !== "number" || f.exp < nowS) return null;
  if (f.kind !== "clinic" && f.kind !== "admin") return null;
  if (f.mode !== "link" || typeof f.userId !== "string" || typeof f.sessionId !== "string") return null;
  if (f.slug !== undefined && !/^[a-z0-9-]{3,48}$/.test(f.slug)) return null;
  return f;
}

/** A Telegram user id (positive integer, at most 2^53) or null. */
export function parseTelegramId(v: unknown): bigint | null {
  const s = typeof v === "number" && Number.isSafeInteger(v) ? String(v) : typeof v === "string" ? v : "";
  if (!/^[1-9][0-9]{0,15}$/.test(s)) return null;
  const n = BigInt(s);
  return n <= 9007199254740991n ? n : null;
}
