import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { linkClinicTelegram } from "@/server/auth/clinic-auth";
import { createPlatformUser, linkPlatformTelegram, loginPlatformUser, validatePlatformSession } from "@/server/auth/platform-auth";
import { connectClinicBot } from "@/server/telegram/clinic-bot";
import { homeForRoles } from "@/server/auth/landing";
import { resolveWebApp, verifyInitData } from "@/server/auth/telegram-webapp";
import { createStaffWithPassword } from "@/server/clinic/admin";
import { resetEnvCache } from "@/server/env";
import { registerPatient } from "@/server/patients/patients";
import { activatePortalAccount, portalTenant, saveTelegramContact, validatePatientSession } from "@/server/portal/auth";
import { issuePortalCode } from "@/server/portal/staff";
import { ownContact } from "@/server/telegram/central-bot";
import { META, PASSWORD, clinicContext, clinicWithOwner, platformActor, uniq } from "./helpers/fixtures";

// Synthetic bot token (format only; not a real bot). All people and phones are synthetic.
const TOKEN = "1234567890:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const now = () => Math.floor(Date.now() / 1000);
const newTgId = () => Math.floor(Math.random() * 1e12) + 1;
const newPhone = () => `+99890${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;

/** Launch data exactly as Telegram signs it for a Mini App. */
function initData(user: Record<string, unknown>, opts: { authDate?: number; token?: string } = {}) {
  const fields: Record<string, string> = { auth_date: String(opts.authDate ?? now()), query_id: "AAE-synthetic", user: JSON.stringify(user) };
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(opts.token ?? TOKEN).digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

beforeAll(() => {
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
  resetEnvCache();
});
afterAll(() => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  resetEnvCache();
});

describe("Mini App launch data", () => {
  it("accepts Telegram's signature and refuses anything else", () => {
    expect(verifyInitData(initData({ id: 42 }), TOKEN)).toBe(42n);
    expect(verifyInitData(initData({ id: 42 }, { token: "999:other" }), TOKEN)).toBeNull();
    expect(verifyInitData(initData({ id: 42 }).replace("42", "43"), TOKEN)).toBeNull();
    expect(verifyInitData(initData({ id: 42 }, { authDate: now() - 3 * 86400 }), TOKEN)).toBeNull();
    expect(verifyInitData(initData({ id: 42, is_bot: true }), TOKEN)).toBeNull();
    expect(verifyInitData("", TOKEN)).toBeNull();
  });

  it("the bot accepts only a person's own phone number", () => {
    const own = { message: { chat: { id: 5, type: "private" }, from: { id: 5, is_bot: false }, contact: { phone_number: "998901112233", user_id: 5 } } };
    expect(ownContact(own)).toEqual({ tgId: 5n, phone: "998901112233" });
    expect(ownContact({ message: { ...own.message, contact: { phone_number: "998901112233", user_id: 6 } } })).toBeNull();
    expect(ownContact({ message: { ...own.message, contact: { phone_number: "998901112233" } } })).toBeNull();
    expect(ownContact({ message: { ...own.message, chat: { id: -1, type: "group" } } })).toBeNull();
  });
});

describe("who opened a clinic bot's Mini App", () => {
  /** A clinic with its own bot (token `botToken`), a receptionist and a way to add portal patients. */
  async function clinic() {
    const o = await clinicWithOwner(await platformActor());
    const botToken = `${Math.floor(Math.random() * 9e9) + 1e9}:${"B".repeat(35)}`;
    await connectClinicBot(await platformActor(), o.tenantId, { token: botToken }, META);
    const recLogin = uniq("reception");
    await createStaffWithPassword(o.ctx, { fullName: "Synthetic Reception", email: `${uniq("r")}@clinic.test`, username: recLogin, roleKeys: ["receptionist"], password: PASSWORD }, META);
    const reception = await clinicContext(recLogin, o.slug);
    const tenant = (await portalTenant(o.slug))!;
    /** A patient with an activated portal account whose login is `phone`. */
    const patient = async (phone: string) => {
      const birthDate = "1990-04-12";
      const p = await registerPatient(reception, { lastName: "Sintetik", firstName: uniq("Bemor"), birthDate, sex: "FEMALE" }, { confirmNotDuplicate: true }, META);
      if (!p.ok) throw new Error("patient");
      const { code } = await issuePortalCode(reception, p.id, { consentMethod: "PAPER_SIGNED" }, META);
      await activatePortalAccount(tenant, { code, birthDate, phone, password: "Bemor-Parol-2026x", confirmPassword: "Bemor-Parol-2026x" }, META);
    };
    const launch = (id: number) => initData({ id }, { token: botToken });
    return { o, reception, patient, launch, slug: o.slug };
  }

  it("a stranger gets the patient page; after sharing an unknown number: not found", async () => {
    const c = await clinic();
    const tg = newTgId();
    expect(await resolveWebApp(c.launch(tg), null, META, c.slug)).toEqual({ status: "patient", phoneKnown: false });
    expect(await saveTelegramContact(BigInt(tg), newPhone())).toBe(true);
    expect(await resolveWebApp(c.launch(tg), null, META, c.slug)).toEqual({ status: "patient", phoneKnown: true });
    // Launch data signed by another bot is refused.
    expect(await resolveWebApp(initData({ id: tg }), null, META, c.slug)).toEqual({ status: "error", reason: "invalid" });
  });

  it("a patient of this clinic lands in its portal; a patient of another clinic is not recognised here", async () => {
    const c = await clinic();
    const phone = newPhone();
    await c.patient(phone);
    const tg = newTgId();
    // Telegram sends the number without "+"; it is normalised.
    await saveTelegramContact(BigInt(tg), phone.slice(1));
    const r = await resolveWebApp(c.launch(tg), null, META, c.slug);
    expect(r).toMatchObject({ status: "signed_in", target: "patient", go: `/p/${c.slug}` });
    if (r.status === "signed_in") expect((await validatePatientSession(r.token))?.tenant.slug).toBe(c.slug);
    const other = await clinic();
    expect(await resolveWebApp(other.launch(tg), null, META, other.slug)).toEqual({ status: "patient", phoneKnown: true });
  });

  it("this clinic's linked staff land on the page for their role; other clinics' bots do not know them", async () => {
    const c = await clinic();
    const tg = newTgId();
    await linkClinicTelegram(c.reception.principal.user.id, c.reception.principal.sessionId, BigInt(tg), META);
    expect(await resolveWebApp(c.launch(tg), null, META, c.slug)).toMatchObject({ status: "signed_in", target: "clinic", go: `/c/${c.slug}/desk` });
    const other = await clinic();
    expect(await resolveWebApp(other.launch(tg), null, META, other.slug)).toEqual({ status: "patient", phoneKnown: false });
    expect(homeForRoles("x", ["clinic_owner", "doctor"])).toBe("/c/x");
    expect(homeForRoles("x", ["doctor"])).toBe("/c/x/my-queue");
    expect(homeForRoles("x", ["cashier"])).toBe("/c/x/billing");
  });

  it("someone who is both staff and a patient here chooses; only offered choices are accepted", async () => {
    const c = await clinic();
    const tg = newTgId();
    await linkClinicTelegram(c.reception.principal.user.id, c.reception.principal.sessionId, BigInt(tg), META);
    const phone = newPhone();
    await c.patient(phone);
    await saveTelegramContact(BigInt(tg), phone);
    const r = await resolveWebApp(c.launch(tg), null, META, c.slug);
    expect(r.status).toBe("choose");
    if (r.status !== "choose") return;
    expect(r.choices.map((x) => x.kind).sort()).toEqual(["patient", "staff"]);
    expect((await resolveWebApp(c.launch(tg), "patient:00000000-0000-7000-8000-000000000000", META, c.slug)).status).toBe("choose");
    const asPatient = r.choices.find((x) => x.kind === "patient")!;
    expect(await resolveWebApp(c.launch(tg), asPatient.key, META, c.slug)).toMatchObject({ status: "signed_in", target: "patient" });
    expect(await resolveWebApp(c.launch(tg), "staff", META, c.slug)).toMatchObject({ status: "signed_in", target: "clinic" });
  });
});

describe("the central ITop Med bot", () => {
  it("is for the founder (SuperAdmin) only, not for clinic staff", async () => {
    const o = await clinicWithOwner(await platformActor());
    const staffTg = newTgId();
    await linkClinicTelegram(o.ctx.principal.user.id, o.ctx.principal.sessionId, BigInt(staffTg), META);
    expect(await resolveWebApp(initData({ id: staffTg }), null, META)).toEqual({ status: "error", reason: "not_platform" });
  });

  it("refuses people it does not know; the SuperAdmin lands in the console", async () => {
    const tg = newTgId();
    expect(await resolveWebApp(initData({ id: tg }), null, META)).toEqual({ status: "error", reason: "not_platform" });
    const username = uniq("root");
    const id = await createPlatformUser({ email: `${uniq("p")}@itopmed.test`, username, fullName: "Synthetic Root", password: PASSWORD, role: "SUPER_ADMIN" });
    const login = await loginPlatformUser(username, PASSWORD, META);
    if (!login.ok) throw new Error("login");
    const p = (await validatePlatformSession(login.token))!;
    await linkPlatformTelegram(id, p.sessionId, BigInt(tg), META);
    expect(await resolveWebApp(initData({ id: tg }), null, META)).toMatchObject({ status: "signed_in", target: "admin", go: "/admin" });
  });
});
