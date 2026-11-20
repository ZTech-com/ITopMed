import "server-only";
import { createHash, createPublicKey, randomBytes, verify as verifySignature, type JsonWebKey, type KeyObject } from "node:crypto";
import { decryptField, encryptField, safeEqual } from "../security/crypto";

/**
 * Log In with Telegram — the OpenID Connect Authorization Code flow with PKCE
 * (https://core.telegram.org/bots/telegram-login). Done entirely on the server:
 * no third-party script on our pages, and the browser never sees the client
 * secret. The id_token is verified against Telegram's published keys (JWKS)
 * before anything in it is trusted.
 */
export const TELEGRAM_ISSUER = "https://oauth.telegram.org";
const AUTH_ENDPOINT = `${TELEGRAM_ISSUER}/auth`;
const TOKEN_ENDPOINT = `${TELEGRAM_ISSUER}/token`;
const JWKS_ENDPOINT = `${TELEGRAM_ISSUER}/.well-known/jwks.json`;
const HTTP_TIMEOUT_MS = 8000;
/** Tolerated clock difference between this server and Telegram. */
const CLOCK_SKEW_S = 60;

export type TelegramLoginKind = "clinic" | "admin";
export type TelegramLoginMode = "login" | "link";

export interface TelegramConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

const b64url = (buf: Buffer) => buf.toString("base64url");

/** PKCE (RFC 7636, S256). */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
}

export function authorizationUrl(cfg: TelegramConfig, state: string, codeChallenge: string): string {
  const u = new URL(AUTH_ENDPOINT);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", cfg.redirectUri);
  u.searchParams.set("response_type", "code");
  // "profile" carries the Telegram user id (the same id the bot's Mini App reports).
  // Only that id is stored; name, username and photo are ignored.
  u.searchParams.set("scope", "openid profile");
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

// ───────────── Flow state (short-lived, encrypted cookie) ─────────────

export interface FlowState {
  /** Random value echoed by Telegram (CSRF protection). */
  state: string;
  verifier: string;
  kind: TelegramLoginKind;
  mode: TelegramLoginMode;
  /** Link mode: the signed-in account and session that started it. */
  userId?: string;
  sessionId?: string;
  next?: string;
  /** Clinic whose own bot runs this flow (/login/<slug>); absent = the central bot (console). */
  slug?: string;
  /** Unix seconds. */
  exp: number;
}

export const FLOW_TTL_S = 10 * 60;
const FLOW_CONTEXT = "telegram-login-flow";

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
  if (f.mode !== "login" && f.mode !== "link") return null;
  if (f.slug !== undefined && !/^[a-z0-9-]{3,48}$/.test(f.slug)) return null;
  return f;
}

// ───────────── Code exchange ─────────────

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export async function exchangeCode(cfg: TelegramConfig, code: string, verifier: string, fetchImpl: Fetch = fetch): Promise<string> {
  const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: cfg.redirectUri, client_id: cfg.clientId, code_verifier: verifier });
  const res = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`,
    },
    body,
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!res.ok) throw new TelegramLoginError("token_exchange");
  const json = (await res.json()) as { id_token?: unknown };
  if (typeof json.id_token !== "string") throw new TelegramLoginError("token_exchange");
  return json.id_token;
}

// ───────────── id_token verification ─────────────

export class TelegramLoginError extends Error {
  constructor(readonly reason: "token_exchange" | "bad_token" | "unknown_key" | "jwks") {
    super(`telegram login: ${reason}`);
  }
}

type Jwk = JsonWebKey & { kid?: string; alg?: string; use?: string };
export type KeyResolver = (kid: string | undefined, alg: string) => Promise<KeyObject | null>;

let jwksCache: { keys: Jwk[]; at: number } | null = null;
const JWKS_TTL_MS = 60 * 60_000;

async function loadJwks(fetchImpl: Fetch, force: boolean): Promise<Jwk[]> {
  if (!force && jwksCache && Date.now() - jwksCache.at < JWKS_TTL_MS) return jwksCache.keys;
  const res = await fetchImpl(JWKS_ENDPOINT, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  if (!res.ok) throw new TelegramLoginError("jwks");
  const json = (await res.json()) as { keys?: unknown };
  if (!Array.isArray(json.keys)) throw new TelegramLoginError("jwks");
  jwksCache = { keys: json.keys as Jwk[], at: Date.now() };
  return jwksCache.keys;
}

/** Telegram's published keys; refetched once when a token names an unknown key (key rotation). */
export function telegramKeys(fetchImpl: Fetch = fetch): KeyResolver {
  return async (kid, alg) => {
    for (const force of [false, true]) {
      const keys = await loadJwks(fetchImpl, force);
      const jwk = keys.find((k) => (kid ? k.kid === kid : true) && (!k.alg || k.alg === alg) && (!k.use || k.use === "sig"));
      if (jwk) return createPublicKey({ key: jwk, format: "jwk" });
    }
    return null;
  };
}

const ALGORITHMS: Record<string, (data: Buffer, key: KeyObject, sig: Buffer) => boolean> = {
  RS256: (d, k, s) => verifySignature("sha256", d, k, s),
  ES256: (d, k, s) => verifySignature("sha256", d, { key: k, dsaEncoding: "ieee-p1363" }, s),
  EdDSA: (d, k, s) => verifySignature(null, d, k, s),
};

export interface TelegramIdentity {
  /** Telegram user id. */
  id: bigint;
}

/** Signature (Telegram's key), issuer, audience (our bot), expiry and issue time. */
export async function verifyIdToken(idToken: string, clientId: string, resolveKey: KeyResolver, nowS = Math.floor(Date.now() / 1000)): Promise<TelegramIdentity> {
  const parts = idToken.split(".");
  if (parts.length !== 3 || idToken.length > 8192) throw new TelegramLoginError("bad_token");
  const [h, p, s] = parts as [string, string, string];
  let header: { alg?: unknown; kid?: unknown; typ?: unknown };
  let claims: { iss?: unknown; aud?: unknown; id?: unknown; exp?: unknown; iat?: unknown };
  try {
    header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  } catch {
    throw new TelegramLoginError("bad_token");
  }
  const alg = typeof header.alg === "string" ? header.alg : "";
  const check = ALGORITHMS[alg];
  if (!check) throw new TelegramLoginError("bad_token"); // also refuses "none"
  const key = await resolveKey(typeof header.kid === "string" ? header.kid : undefined, alg);
  if (!key) throw new TelegramLoginError("unknown_key");
  let valid = false;
  try {
    valid = check(Buffer.from(`${h}.${p}`), key, Buffer.from(s, "base64url"));
  } catch {
    valid = false;
  }
  if (!valid) throw new TelegramLoginError("bad_token");

  const aud = Array.isArray(claims.aud) ? claims.aud.map(String) : [String(claims.aud ?? "")];
  if (claims.iss !== TELEGRAM_ISSUER || !aud.includes(clientId)) throw new TelegramLoginError("bad_token");
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_S < nowS) throw new TelegramLoginError("bad_token");
  if (typeof claims.iat === "number" && claims.iat - CLOCK_SKEW_S > nowS) throw new TelegramLoginError("bad_token");
  const id = parseTelegramId(claims.id);
  if (!id) throw new TelegramLoginError("bad_token");
  return { id };
}

/** A Telegram user id (positive integer, at most 2^53) or null. */
export function parseTelegramId(v: unknown): bigint | null {
  const s = typeof v === "number" && Number.isSafeInteger(v) ? String(v) : typeof v === "string" ? v : "";
  if (!/^[1-9][0-9]{0,15}$/.test(s)) return null;
  const n = BigInt(s);
  return n <= 9007199254740991n ? n : null;
}

/** For tests only. */
export function resetJwksCache() {
  jwksCache = null;
}
