import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loginClinicUser, validateClinicSession } from "@/server/auth/clinic-auth";
import { createPlatformUser, loginPlatformUser, validatePlatformSession } from "@/server/auth/platform-auth";
import { requestTelegramPasswordReset, resetPassword } from "@/server/auth/password-reset";
import { mailboxRoot } from "@/server/local/paths";
import { completeTelegramWidget, widgetBot } from "@/server/auth/telegram-login";
import { openFlow, sealFlow, splitCallbackQuery, verifyWidgetAuth, type FlowState } from "@/server/auth/telegram-auth";
import { createStaffWithPassword, listStaff } from "@/server/clinic/admin";
import { setMemberPassword } from "@/server/clinic/members";
import { connectClinicBot } from "@/server/telegram/clinic-bot";
import { resetEnvCache } from "@/server/env";
import { acceptInvitation } from "@/server/tenancy/invitations";
import { provisionClinic } from "@/server/tenancy/provisioning";
import { META, PASSWORD, clinicWithOwner, platformActor, uniq } from "./helpers/fixtures";

// Synthetic bot tokens only; nothing here talks to Telegram.
const now = () => Math.floor(Date.now() / 1000);
const tokenFor = (botId: string) => `${botId}:${"A".repeat(35)}`;
const newTgId = () => Math.floor(Math.random() * 1e12) + 1;

/** What Telegram's Login Widget hands our callback, signed with the given bot token. */
function widgetFields(id: number, botToken: string, extra: Record<string, string> = {}): Record<string, string> {
  const fields: Record<string, string> = { id: String(id), first_name: uniq("Synthetic"), auth_date: String(now()), ...extra };
  const check = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");
  const hash = createHmac("sha256", createHash("sha256").update(botToken).digest()).update(check).digest("hex");
  return { ...fields, hash };
}

describe("Telegram Login Widget signature", () => {
  const token = tokenFor("1234567890");
  it("accepts fields signed with our bot's token", () => {
    expect(verifyWidgetAuth(widgetFields(111, token), token)).toBe(111n);
    expect(verifyWidgetAuth(widgetFields(222, token, { username: "synthetic_user", photo_url: "https://t.me/i/userpic/320/x.jpg" }), token)).toBe(222n);
  });

  it("refuses other bots, tampered, stale and malformed fields", () => {
    expect(verifyWidgetAuth(widgetFields(1, tokenFor("999999")), token)).toBeNull();
    expect(verifyWidgetAuth({ ...widgetFields(1, token), id: "2" }, token)).toBeNull();
    expect(verifyWidgetAuth(widgetFields(1, token, { auth_date: String(now() - 3600) }), token)).toBeNull();
    expect(verifyWidgetAuth(widgetFields(1, token, { auth_date: String(now() + 3600) }), token)).toBeNull();
    const unsigned: Record<string, string> = widgetFields(1, token);
    delete unsigned.hash;
    expect(verifyWidgetAuth(unsigned, token)).toBeNull();
    expect(verifyWidgetAuth(widgetFields(0, token), token)).toBeNull();
  });

  it("separates our own callback parameters from Telegram's signed fields", () => {
    const q = new URLSearchParams({ kind: "clinic", mode: "login", slug: "demo", next: "/c/demo", id: "5", auth_date: "1", hash: "x" });
    expect(splitCallbackQuery(q)).toEqual({ own: { kind: "clinic", mode: "login", slug: "demo", next: "/c/demo" }, telegram: { id: "5", auth_date: "1", hash: "x" } });
  });
});

describe("Telegram link flow cookie", () => {
  const flow: FlowState = { state: "abc123", kind: "clinic", mode: "link", userId: "u", sessionId: "s", exp: now() + 600 };
  it("opens only with the matching state, before expiry, untampered", () => {
    const sealed = sealFlow(flow);
    expect(openFlow(sealed, "abc123")).toMatchObject({ kind: "clinic", mode: "link" });
    expect(openFlow(sealed, "other")).toBeNull();
    expect(openFlow(sealed, "abc123", now() + 3600)).toBeNull();
    expect(openFlow(`${sealed.slice(0, -2)}xx`, "abc123")).toBeNull();
    expect(openFlow(undefined, "abc123")).toBeNull();
  });
});

describe("sign-in with Telegram", () => {
  const CENTRAL = tokenFor("2234567890");
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = CENTRAL;
    resetEnvCache();
  });
  afterEach(() => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    resetEnvCache();
  });

  const linkFlow = (kind: "clinic" | "admin", owner: { userId: string; sessionId: string }, slug?: string): FlowState => ({
    state: "s",
    kind,
    mode: "link",
    ...owner,
    ...(slug ? { slug } : {}),
    exp: now() + 600,
  });
  /** A clinic with its own bot (a fresh synthetic token per clinic). */
  const clinicWithBot = async () => {
    const o = await clinicWithOwner(await platformActor());
    const token = tokenFor(String(Math.floor(Math.random() * 1e9) + 1e9));
    await connectClinicBot(await platformActor(), o.tenantId, { token }, META);
    return { ...o, token };
  };
  const login = (slug: string, fields: Record<string, string>) => completeTelegramWidget({ kind: "clinic", mode: "login", slug, fields }, META);
  const link = (flow: FlowState, fields: Record<string, string>) => completeTelegramWidget({ kind: flow.kind, mode: "link", slug: flow.slug, fields, flow }, META);

  it("needs the clinic's own bot; no button without the real Bot API; linking needs the flow", async () => {
    // Simulated Telegram transport (tests, local installations): no widget anywhere.
    expect(await widgetBot("admin")).toBeNull();
    expect(await widgetBot("clinic", "no-such-clinic")).toBeNull();
    expect(await completeTelegramWidget({ kind: "clinic", mode: "login", slug: "no-such-clinic", fields: widgetFields(1, CENTRAL) }, META)).toMatchObject({ outcome: "error", code: "disabled" });
    const o = await clinicWithBot();
    expect(await link(linkFlow("clinic", { userId: "x", sessionId: "y" }, o.slug), widgetFields(newTgId(), o.token))).toMatchObject({ outcome: "error", code: "failed" });
    expect(await completeTelegramWidget({ kind: "clinic", mode: "link", slug: o.slug, fields: widgetFields(newTgId(), o.token), flow: null }, META)).toMatchObject({
      outcome: "error",
      code: "failed",
    });
  });

  it("clinic staff: unknown Telegram is refused; after linking it signs in; one Telegram per account", async () => {
    const o = await clinicWithBot();
    const tg = newTgId();
    expect(await login(o.slug, widgetFields(tg, o.token))).toMatchObject({ outcome: "error", code: "not_linked" });

    const owner = { userId: o.ctx.principal.user.id, sessionId: o.ctx.principal.sessionId };
    expect(await link(linkFlow("clinic", owner, o.slug), widgetFields(tg, o.token))).toEqual({ outcome: "linked", kind: "clinic" });

    const fields = widgetFields(tg, o.token);
    const signedIn = await login(o.slug, fields);
    expect(signedIn.outcome).toBe("signed_in");
    if (signedIn.outcome !== "signed_in") return;
    const p = await validateClinicSession(signedIn.token);
    expect(p?.user.id).toBe(owner.userId);
    expect(p?.user.telegramLinked).toBe(true);
    expect(signedIn.next).toBe(`/c/${o.slug}`);
    // The same signed answer is accepted once only.
    expect(await login(o.slug, fields)).toMatchObject({ outcome: "error", code: "failed" });

    // The same Telegram account cannot be linked to a second ITop Med account.
    const other = await clinicWithOwner(await platformActor());
    const taken = await link(linkFlow("clinic", { userId: other.ctx.principal.user.id, sessionId: other.ctx.principal.sessionId }, o.slug), widgetFields(tg, o.token));
    expect(taken).toMatchObject({ outcome: "error", code: "taken" });

    // Another clinic's bot does not sign this clinic's staff in, and its signature does not fit this clinic.
    const elsewhere = await clinicWithBot();
    expect(await login(elsewhere.slug, widgetFields(tg, elsewhere.token))).toMatchObject({ outcome: "error", code: "not_linked" });
    expect(await login(o.slug, widgetFields(tg, elsewhere.token))).toMatchObject({ outcome: "error", code: "failed" });

    // A link started from a session that has since ended is refused.
    const gone = await link(linkFlow("clinic", { userId: owner.userId, sessionId: "0".repeat(64) }, o.slug), widgetFields(newTgId(), o.token));
    expect(gone).toMatchObject({ outcome: "error", code: "failed" });
  });

  it("a forged signature never signs anyone in", async () => {
    const o = await clinicWithBot();
    const owner = { userId: o.ctx.principal.user.id, sessionId: o.ctx.principal.sessionId };
    const tg = newTgId();
    await link(linkFlow("clinic", owner, o.slug), widgetFields(tg, o.token));
    expect(await login(o.slug, { ...widgetFields(tg, o.token), hash: "0".repeat(64) })).toMatchObject({ outcome: "error", code: "failed" });
    expect(await login(o.slug, widgetFields(tg, tokenFor("1111111111")))).toMatchObject({ outcome: "error", code: "failed" });
  });

  it("a new password from the administrator also removes the member's Telegram sign-in", async () => {
    const o = await clinicWithBot();
    const username = uniq("nurse");
    await createStaffWithPassword(o.ctx, { fullName: "Synthetic Nurse", email: `${uniq("n")}@clinic.test`, username, roleKeys: ["nurse"], password: PASSWORD }, META);
    const pw = await loginClinicUser(username, PASSWORD, META);
    if (!pw.ok) throw new Error("login failed");
    const nurse = (await validateClinicSession(pw.token))!;
    const tg = newTgId();
    await link(linkFlow("clinic", { userId: nurse.user.id, sessionId: nurse.sessionId }, o.slug), widgetFields(tg, o.token));
    expect((await login(o.slug, widgetFields(tg, o.token))).outcome).toBe("signed_in");

    const m = (await listStaff(o.ctx)).members.find((x) => x.user.username === username)!;
    await setMemberPassword(o.ctx, m.id, { password: "Synthetic-New-2026x" }, META);
    expect(await login(o.slug, widgetFields(tg, o.token))).toMatchObject({ outcome: "error", code: "not_linked" });
  });

  it("the central bot (/login) signs in the staff of any clinic without a clinic address", async () => {
    const o = await clinicWithBot();
    const tg = newTgId();
    const central = (fields: Record<string, string>) => completeTelegramWidget({ kind: "clinic", mode: "login", fields }, META);
    expect(await central(widgetFields(tg, CENTRAL))).toMatchObject({ outcome: "error", code: "not_linked" });
    // Linking through the central bot (no clinic in the flow).
    const owner = { userId: o.ctx.principal.user.id, sessionId: o.ctx.principal.sessionId };
    expect(await link(linkFlow("clinic", owner), widgetFields(tg, CENTRAL))).toEqual({ outcome: "linked", kind: "clinic" });
    const r = await central(widgetFields(tg, CENTRAL));
    expect(r).toMatchObject({ outcome: "signed_in", kind: "clinic", next: `/c/${o.slug}` });
    // The same Telegram account also works with the clinic's own bot (Telegram ids are the same in every bot).
    expect((await login(o.slug, widgetFields(tg, o.token))).outcome).toBe("signed_in");
    // A clinic bot's signature is not the central bot's.
    expect(await central(widgetFields(tg, o.token))).toMatchObject({ outcome: "error", code: "failed" });
  });

  it("the console uses its own bot when TELEGRAM_ADMIN_BOT_TOKEN is set", async () => {
    const ADMIN = tokenFor("3234567890");
    process.env.TELEGRAM_ADMIN_BOT_TOKEN = ADMIN;
    resetEnvCache();
    try {
      const username = uniq("support");
      await createPlatformUser({ email: `${uniq("s")}@itopmed.test`, username, fullName: "Synthetic Support", password: PASSWORD, role: "SUPPORT" });
      const pw = await loginPlatformUser(username, PASSWORD, META);
      if (!pw.ok) throw new Error("login failed");
      const p = (await validatePlatformSession(pw.token))!;
      const tg = newTgId();
      expect(await link(linkFlow("admin", { userId: p.user.id, sessionId: p.sessionId }), widgetFields(tg, CENTRAL))).toMatchObject({ outcome: "error", code: "failed" });
      expect(await link(linkFlow("admin", { userId: p.user.id, sessionId: p.sessionId }), widgetFields(tg, ADMIN))).toEqual({ outcome: "linked", kind: "admin" });
      expect((await completeTelegramWidget({ kind: "admin", mode: "login", fields: widgetFields(tg, ADMIN) }, META)).outcome).toBe("signed_in");
    } finally {
      delete process.env.TELEGRAM_ADMIN_BOT_TOKEN;
      resetEnvCache();
    }
  });

  it("a forgotten password is reset with the login only, through the clinic's bot, never by email", async () => {
    const o = await clinicWithBot();
    const username = uniq("nurse");
    await createStaffWithPassword(o.ctx, { fullName: "Synthetic Nurse", email: `${uniq("n")}@clinic.test`, username, roleKeys: ["nurse"], password: PASSWORD }, META);
    const pw = await loginClinicUser(username, PASSWORD, META);
    if (!pw.ok) throw new Error("login failed");
    const nurse = (await validateClinicSession(pw.token))!;
    const tg = newTgId();
    const outbox = () => {
      const dir = path.join(mailboxRoot(), "telegram");
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).filter((f) => f.endsWith(`_chat-${tg}.txt`)).map((f) => fs.readFileSync(path.join(dir, f), "utf8"));
    };

    // Telegram not linked yet: nothing is sent (the same answer is shown to the person).
    await requestTelegramPasswordReset(username, META);
    expect(outbox()).toEqual([]);
    // Unknown login: nothing is sent either.
    await requestTelegramPasswordReset(uniq("nobody"), META);
    expect(outbox()).toEqual([]);

    await link(linkFlow("clinic", { userId: nurse.user.id, sessionId: nurse.sessionId }, o.slug), widgetFields(tg, o.token));
    // No clinic address: the clinic (and its bot) comes from the account.
    await requestTelegramPasswordReset(username.toUpperCase(), META);
    const sent = outbox();
    expect(sent).toHaveLength(1);
    const token = /\/reset-password\/([a-z2-7]+)/.exec(sent[0]!)?.[1];
    expect(token).toBeTruthy();
    const NEW = "Synthetic-Telegram-2026x";
    await resetPassword(token!, { password: NEW, confirmPassword: NEW }, META);
    expect((await loginClinicUser(username, PASSWORD, META)).ok).toBe(false);
    expect((await loginClinicUser(username, NEW, META)).ok).toBe(true);
  });

  it("console staff link and sign in through the central bot", async () => {
    const username = uniq("support");
    await createPlatformUser({ email: `${uniq("s")}@itopmed.test`, username, fullName: "Synthetic Support", password: PASSWORD, role: "SUPPORT" });
    const pw = await loginPlatformUser(username, PASSWORD, META);
    if (!pw.ok) throw new Error("login failed");
    const p = (await validatePlatformSession(pw.token))!;
    const tg = newTgId();
    expect(await link(linkFlow("admin", { userId: p.user.id, sessionId: p.sessionId }), widgetFields(tg, CENTRAL))).toEqual({ outcome: "linked", kind: "admin" });
    const r = await completeTelegramWidget({ kind: "admin", mode: "login", fields: widgetFields(tg, CENTRAL) }, META);
    expect(r.outcome).toBe("signed_in");
    if (r.outcome === "signed_in") expect((await validatePlatformSession(r.token))?.user.id).toBe(p.user.id);
    // A clinic bot's signature is not the console's.
    const o = await clinicWithBot();
    expect(await completeTelegramWidget({ kind: "admin", mode: "login", fields: widgetFields(tg, o.token) }, META)).toMatchObject({ outcome: "error", code: "failed" });
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
