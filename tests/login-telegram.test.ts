import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loginClinicUser, validateClinicSession } from "@/server/auth/clinic-auth";
import { createPlatformUser, loginPlatformUser, validatePlatformSession } from "@/server/auth/platform-auth";
import { beginTelegramFlow, finishTelegramFlow } from "@/server/auth/telegram-login";
import { TELEGRAM_ISSUER, openFlow, sealFlow, verifyIdToken, type Fetch, type FlowState, type KeyResolver } from "@/server/auth/telegram-oidc";
import { createStaffWithPassword, listStaff } from "@/server/clinic/admin";
import { setMemberPassword } from "@/server/clinic/members";
import { resetEnvCache } from "@/server/env";
import { acceptInvitation } from "@/server/tenancy/invitations";
import { provisionClinic } from "@/server/tenancy/provisioning";
import { META, PASSWORD, clinicWithOwner, platformActor, uniq } from "./helpers/fixtures";

// Synthetic bot credentials and keys only; nothing here talks to Telegram.
const CLIENT_ID = "1234567890";
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
const keys: KeyResolver = async (kid) => (kid === "rsa-1" ? rsa.publicKey : kid === "ec-1" ? ec.publicKey : null);
const now = () => Math.floor(Date.now() / 1000);

function idToken(claims: Record<string, unknown>, opts: { alg?: string; kid?: string; key?: KeyObject } = {}) {
  const alg = opts.alg ?? "RS256";
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const body = `${enc({ alg, kid: opts.kid ?? "rsa-1", typ: "JWT" })}.${enc({ iss: TELEGRAM_ISSUER, aud: CLIENT_ID, iat: now(), exp: now() + 3600, ...claims })}`;
  const sig =
    alg === "ES256"
      ? sign("sha256", Buffer.from(body), { key: opts.key ?? ec.privateKey, dsaEncoding: "ieee-p1363" })
      : sign("sha256", Buffer.from(body), opts.key ?? rsa.privateKey);
  return `${body}.${sig.toString("base64url")}`;
}

/** Stands in for oauth.telegram.org/token: returns an id_token for the given Telegram user id. */
const tokenEndpoint = (id: number): Fetch => async () => Response.json({ access_token: "synthetic", token_type: "Bearer", expires_in: 3600, id_token: idToken({ sub: `s${id}`, id }) });
const newTgId = () => Math.floor(Math.random() * 1e12) + 1;

describe("Telegram id_token verification", () => {
  it("accepts a token signed by Telegram's key for our bot", async () => {
    await expect(verifyIdToken(idToken({ sub: "x", id: 111 }), CLIENT_ID, keys)).resolves.toEqual({ id: 111n });
    await expect(verifyIdToken(idToken({ sub: "y", id: 222 }, { alg: "ES256", kid: "ec-1" }), CLIENT_ID, keys)).resolves.toEqual({ id: 222n });
    // Without the Telegram user id (profile scope) the token is useless to us.
    await expect(verifyIdToken(idToken({ sub: "z" }), CLIENT_ID, keys)).rejects.toThrow();
  });

  it("refuses other bots, other issuers, expired, tampered, unsigned and unknown-key tokens", async () => {
    await expect(verifyIdToken(idToken({ sub: "1", id: 1, aud: "999" }), CLIENT_ID, keys)).rejects.toThrow();
    await expect(verifyIdToken(idToken({ sub: "1", id: 1, iss: "https://evil.test" }), CLIENT_ID, keys)).rejects.toThrow();
    await expect(verifyIdToken(idToken({ sub: "1", id: 1, exp: now() - 3600 }), CLIENT_ID, keys)).rejects.toThrow();
    const [h, , s] = idToken({ sub: "1", id: 1 }).split(".");
    const forged = Buffer.from(JSON.stringify({ iss: TELEGRAM_ISSUER, aud: CLIENT_ID, sub: "2", id: 2, exp: now() + 60 })).toString("base64url");
    await expect(verifyIdToken(`${h}.${forged}.${s}`, CLIENT_ID, keys)).rejects.toThrow();
    const none = `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${forged}.`;
    await expect(verifyIdToken(none, CLIENT_ID, keys)).rejects.toThrow();
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    await expect(verifyIdToken(idToken({ sub: "1", id: 1 }, { key: other.privateKey }), CLIENT_ID, keys)).rejects.toThrow();
    await expect(verifyIdToken(idToken({ sub: "1", id: 1 }, { kid: "unknown" }), CLIENT_ID, keys)).rejects.toThrow();
  });
});

describe("Telegram flow state cookie", () => {
  const flow: FlowState = { state: "abc123", verifier: "v", kind: "clinic", mode: "login", exp: now() + 600 };
  it("opens only with the matching state, before expiry, untampered", () => {
    const sealed = sealFlow(flow);
    expect(openFlow(sealed, "abc123")).toMatchObject({ kind: "clinic", mode: "login" });
    expect(openFlow(sealed, "other")).toBeNull();
    expect(openFlow(sealed, "abc123", now() + 3600)).toBeNull();
    expect(openFlow(`${sealed.slice(0, -2)}xx`, "abc123")).toBeNull();
    expect(openFlow(undefined, "abc123")).toBeNull();
  });
});

describe("sign-in with Telegram", () => {
  beforeEach(() => {
    process.env.TELEGRAM_LOGIN_CLIENT_ID = CLIENT_ID;
    process.env.TELEGRAM_LOGIN_CLIENT_SECRET = "synthetic-secret";
    resetEnvCache();
  });
  afterEach(() => {
    delete process.env.TELEGRAM_LOGIN_CLIENT_ID;
    delete process.env.TELEGRAM_LOGIN_CLIENT_SECRET;
    resetEnvCache();
  });

  const flowFor = (kind: "clinic" | "admin", mode: "login" | "link", owner?: { userId: string; sessionId: string }): FlowState => ({
    state: "s",
    verifier: "v",
    kind,
    mode,
    ...(owner ?? {}),
    exp: now() + 600,
  });

  it("is off until the bot is configured, and link mode needs a signed-in account", async () => {
    delete process.env.TELEGRAM_LOGIN_CLIENT_ID;
    resetEnvCache();
    expect(await beginTelegramFlow("clinic", "login", null, undefined, META)).toEqual({ ok: false, code: "disabled" });
    process.env.TELEGRAM_LOGIN_CLIENT_ID = CLIENT_ID;
    resetEnvCache();
    const r = await beginTelegramFlow("clinic", "login", null, undefined, META);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const u = new URL(r.url);
      expect(u.origin).toBe("https://oauth.telegram.org");
      expect(u.searchParams.get("client_id")).toBe(CLIENT_ID);
      expect(u.searchParams.get("code_challenge_method")).toBe("S256");
      expect(u.searchParams.get("redirect_uri")).toBe("http://localhost:3000/auth/telegram/callback");
    }
    await expect(beginTelegramFlow("clinic", "link", null, undefined, META)).rejects.toThrow("errors.forbidden");
  });

  it("clinic staff: unknown Telegram is refused; after linking it signs in; one Telegram per account", async () => {
    const o = await clinicWithOwner(await platformActor());
    const sub = newTgId();
    const notLinked = await finishTelegramFlow(flowFor("clinic", "login"), "code-1", META, { fetch: tokenEndpoint(sub), keys });
    expect(notLinked).toMatchObject({ outcome: "error", code: "not_linked" });

    const owner = { userId: o.ctx.principal.user.id, sessionId: o.ctx.principal.sessionId };
    expect(await finishTelegramFlow(flowFor("clinic", "link", owner), "code-2", META, { fetch: tokenEndpoint(sub), keys })).toEqual({ outcome: "linked", kind: "clinic" });

    const signedIn = await finishTelegramFlow(flowFor("clinic", "login"), "code-3", META, { fetch: tokenEndpoint(sub), keys });
    expect(signedIn.outcome).toBe("signed_in");
    if (signedIn.outcome !== "signed_in") return;
    const p = await validateClinicSession(signedIn.token);
    expect(p?.user.id).toBe(owner.userId);
    expect(p?.user.telegramLinked).toBe(true);

    // The same Telegram account cannot be linked to a second ITop Med account.
    const other = await clinicWithOwner(await platformActor());
    const taken = await finishTelegramFlow(flowFor("clinic", "link", { userId: other.ctx.principal.user.id, sessionId: other.ctx.principal.sessionId }), "code-4", META, { fetch: tokenEndpoint(sub), keys });
    expect(taken).toMatchObject({ outcome: "error", code: "taken" });

    // A link started from a session that has since ended is refused.
    const gone = await finishTelegramFlow(flowFor("clinic", "link", { userId: owner.userId, sessionId: "0".repeat(64) }), "code-5", META, { fetch: tokenEndpoint(newTgId()), keys });
    expect(gone).toMatchObject({ outcome: "error", code: "failed" });
  });

  it("a forged token never signs anyone in", async () => {
    const forger: Fetch = async () => Response.json({ id_token: idToken({ sub: "1", id: 1 }, { key: generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey }) });
    expect(await finishTelegramFlow(flowFor("clinic", "login"), "code", META, { fetch: forger, keys })).toMatchObject({ outcome: "error", code: "failed" });
  });

  it("a new password from the administrator also removes the member's Telegram sign-in", async () => {
    const o = await clinicWithOwner(await platformActor());
    const username = uniq("nurse");
    await createStaffWithPassword(o.ctx, { fullName: "Synthetic Nurse", email: `${uniq("n")}@clinic.test`, username, roleKeys: ["nurse"], password: PASSWORD }, META);
    const login = await loginClinicUser(username, PASSWORD, META);
    if (!login.ok) throw new Error("login failed");
    const nurse = (await validateClinicSession(login.token))!;
    const sub = newTgId();
    await finishTelegramFlow(flowFor("clinic", "link", { userId: nurse.user.id, sessionId: nurse.sessionId }), "c", META, { fetch: tokenEndpoint(sub), keys });
    expect((await finishTelegramFlow(flowFor("clinic", "login"), "c", META, { fetch: tokenEndpoint(sub), keys })).outcome).toBe("signed_in");

    const m = (await listStaff(o.ctx)).members.find((x) => x.user.username === username)!;
    await setMemberPassword(o.ctx, m.id, { password: "Synthetic-New-2026x" }, META);
    expect(await finishTelegramFlow(flowFor("clinic", "login"), "c", META, { fetch: tokenEndpoint(sub), keys })).toMatchObject({ outcome: "error", code: "not_linked" });
  });

  it("console staff link and sign in with Telegram too", async () => {
    const username = uniq("support");
    await createPlatformUser({ email: `${uniq("s")}@itopmed.test`, username, fullName: "Synthetic Support", password: PASSWORD, role: "SUPPORT" });
    const login = await loginPlatformUser(username, PASSWORD, META);
    if (!login.ok) throw new Error("login failed");
    const p = (await validatePlatformSession(login.token))!;
    const sub = newTgId();
    expect(await finishTelegramFlow(flowFor("admin", "link", { userId: p.user.id, sessionId: p.sessionId }), "c", META, { fetch: tokenEndpoint(sub), keys })).toEqual({ outcome: "linked", kind: "admin" });
    const r = await finishTelegramFlow(flowFor("admin", "login"), "c", META, { fetch: tokenEndpoint(sub), keys });
    expect(r.outcome).toBe("signed_in");
    if (r.outcome === "signed_in") expect((await validatePlatformSession(r.token))?.user.id).toBe(p.user.id);
  });
});

describe("login names", () => {
  it("staff sign in with the login chosen on the invitation, not with their email", async () => {
    const actor = await platformActor();
    const ownerEmail = `${uniq("owner")}@login.test`;
    const r = await provisionClinic(
      actor,
      { name: "Synthetic Login", slug: uniq("login"), contactEmail: "a@login.test", defaultLocale: "en", timezone: "UTC", planCode: "starter", ownerFullName: "Synthetic Owner", ownerEmail },
      META,
    );
    await expect(acceptInvitation(r.inviteToken, { fullName: "Synthetic Owner", username: "Bad Login!", password: PASSWORD, confirmPassword: PASSWORD }, META)).rejects.toThrow();
    const username = uniq("dr.owner");
    await acceptInvitation(r.inviteToken, { fullName: "Synthetic Owner", username, password: PASSWORD, confirmPassword: PASSWORD }, META);
    expect((await loginClinicUser(username, PASSWORD, META)).ok).toBe(true);
    expect((await loginClinicUser(ownerEmail, PASSWORD, META)).ok).toBe(false);
  });

  it("a login name can be used by one clinic account only", async () => {
    const o = await clinicWithOwner(await platformActor());
    const username = uniq("reception");
    await createStaffWithPassword(o.ctx, { fullName: "Synthetic One", email: `${uniq("a")}@clinic.test`, username, roleKeys: ["receptionist"], password: PASSWORD }, META);
    await expect(
      createStaffWithPassword(o.ctx, { fullName: "Synthetic Two", email: `${uniq("b")}@clinic.test`, username, roleKeys: ["receptionist"], password: PASSWORD }, META),
    ).rejects.toThrow("errors.usernameTaken");
  });
});
