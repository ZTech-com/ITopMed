import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { recordAudit } from "../audit";
import type { ClinicContext } from "../auth/clinic-auth";
import type { RequestMeta } from "../auth/platform-auth";
import { auditClinic, inClinic, requirePermission } from "../clinic/context";
import { withAppContext, withPortal, type Tx } from "../db";
import { telegramTransport } from "../env";
import { DomainError } from "../errors";
import { logger } from "../logger";
import type { PatientPrincipal } from "../portal/auth";
import { decryptField, encryptField, hashIp, randomToken, sha256Hex, uuidv7 } from "../security/crypto";
import { rateLimit } from "../security/rate-limit";
import { mailboxRoot } from "../local/paths";

/**
 * Telegram notifications through the CLINIC's own bot (created by the clinic
 * with @BotFather — the official Bot API, https://core.telegram.org/bots/api).
 *
 *  - The clinic pastes the bot token once; it is AES-GCM encrypted and never shown again.
 *  - A patient connects from the portal: a one-time deep link (t.me/<bot>?start=<code>)
 *    opens the bot; the worker reads "/start <code>" and links that chat to the patient.
 *    Connecting records the patient's TELEGRAM_NOTIFICATIONS consent; disconnecting withdraws it.
 *  - Messages carry no clinical content (same texts as SMS).
 *
 * Transports: "api" (real), "dev-outbox" (SIMULATED: files in .dev-mailbox/telegram), "none".
 */

const TOKEN_RE = /^\d{5,15}:[A-Za-z0-9_-]{30,64}$/;
const CODE_TTL_MS = 15 * 60_000;
const ctxKey = (tenantId: string) => `telegram:${tenantId}`;

async function api<T>(token: string, method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!json.ok) throw new Error(`telegram_${method}_failed`);
  return json.result as T;
}

async function writeOutbox(name: string, text: string) {
  const dir = path.join(mailboxRoot(), "telegram");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}_${name}.txt`), `SIMULATED TELEGRAM (dev-outbox transport)\n\n${text}\n`, "utf8");
}

export function telegramEnabled() {
  return telegramTransport() !== "none";
}

// ───────────── Clinic: connect the bot ─────────────

export const botTokenSchema = z.string().trim().regex(TOKEN_RE, "validation.telegramToken");

export async function connectTelegramBot(ctx: ClinicContext, tokenRaw: unknown, meta: RequestMeta) {
  requirePermission(ctx, "clinic.settings.manage");
  if (!telegramEnabled()) throw new DomainError("errors.telegramOff");
  const token = botTokenSchema.parse(tokenRaw);
  let username: string;
  if (telegramTransport() === "api") {
    try {
      username = (await api<{ username: string }>(token, "getMe", {})).username;
    } catch {
      throw new DomainError("errors.telegramTokenInvalid");
    }
  } else {
    username = "itopmed_simulated_bot";
  }
  await inClinic(ctx, async (tx) => {
    const data = { tokenEnc: encryptField(token, ctxKey(ctx.tenant.id)), username, enabled: true, updateOffset: 0n, updatedById: ctx.principal.user.id };
    await tx.telegramBot.upsert({ where: { tenantId: ctx.tenant.id }, create: { tenantId: ctx.tenant.id, ...data }, update: { ...data, connectedAt: new Date() } });
    await auditClinic(tx, ctx, meta, { action: "telegram.bot_connected", entityType: "TelegramBot", entityId: ctx.tenant.id, metadata: { username } });
  });
  return username;
}

export async function disconnectTelegramBot(ctx: ClinicContext, meta: RequestMeta) {
  requirePermission(ctx, "clinic.settings.manage");
  await inClinic(ctx, async (tx) => {
    await tx.telegramBot.deleteMany({ where: { tenantId: ctx.tenant.id } });
    await auditClinic(tx, ctx, meta, { action: "telegram.bot_disconnected", entityType: "TelegramBot", entityId: ctx.tenant.id });
  });
}

export async function telegramStatus(ctx: ClinicContext) {
  requirePermission(ctx, "clinic.settings.read");
  return inClinic(ctx, async (tx) => {
    const bot = await tx.telegramBot.findUnique({ where: { tenantId: ctx.tenant.id }, select: { username: true, enabled: true, connectedAt: true } });
    const linked = await tx.telegramLink.count({ where: { tenantId: ctx.tenant.id, revokedAt: null } });
    return { transport: telegramTransport(), bot, linkedPatients: linked };
  });
}

// ───────────── Patient: connect / disconnect ─────────────

export async function myTelegram(p: PatientPrincipal) {
  return withPortal({ sessionId: p.sessionId }, async (tx) => {
    const bot = (await tx.$queryRaw<{ username: string | null }[]>`SELECT portal_telegram_bot() AS username`)[0]?.username ?? null;
    const link = await tx.telegramLink.findFirst({ where: { revokedAt: null }, select: { id: true, linkedAt: true } });
    return { bot, linked: link ? { id: link.id, linkedAt: link.linkedAt } : null };
  });
}

/** One-time deep link to the clinic's bot. Clicking "connect" is the patient's consent to Telegram messages. */
export async function createTelegramLink(p: PatientPrincipal, meta: RequestMeta): Promise<string> {
  if (!(await rateLimit(`tglink:${p.accountId}`, 10, 60 * 60_000))) throw new DomainError("errors.rateLimited");
  const code = randomToken(16);
  return withPortal({ sessionId: p.sessionId }, async (tx) => {
    const bot = (await tx.$queryRaw<{ username: string | null }[]>`SELECT portal_telegram_bot() AS username`)[0]?.username;
    if (!bot) throw new DomainError("errors.telegramOff");
    await tx.telegramLinkCode.createMany({ data: [{ codeHash: sha256Hex(code), tenantId: p.tenant.id, patientId: p.patientId, expiresAt: new Date(Date.now() + CODE_TTL_MS) }] });
    const active = await tx.patientConsent.findFirst({ where: { purpose: "TELEGRAM_NOTIFICATIONS", withdrawnAt: null }, select: { id: true } });
    if (!active) {
      const id = uuidv7();
      await tx.patientConsent.createMany({ data: [{ id, tenantId: p.tenant.id, patientId: p.patientId, purpose: "TELEGRAM_NOTIFICATIONS", method: "PORTAL", recordedById: p.accountId }] });
      await recordAudit(tx, { tenantId: p.tenant.id, actorType: "PATIENT", actorId: p.accountId, action: "portal.consent_granted", entityType: "PatientConsent", entityId: id, ipHash: hashIp(meta.ip), metadata: { purpose: "TELEGRAM_NOTIFICATIONS" } });
    }
    return `https://t.me/${bot}?start=${code}`;
  });
}

export async function disconnectMyTelegram(p: PatientPrincipal, meta: RequestMeta) {
  await withPortal({ sessionId: p.sessionId }, async (tx) => {
    const now = new Date();
    await tx.telegramLink.updateMany({ where: { revokedAt: null }, data: { revokedAt: now } });
    await tx.patientConsent.updateMany({ where: { purpose: "TELEGRAM_NOTIFICATIONS", withdrawnAt: null }, data: { withdrawnAt: now } });
    await recordAudit(tx, { tenantId: p.tenant.id, actorType: "PATIENT", actorId: p.accountId, action: "portal.telegram_disconnected", ipHash: hashIp(meta.ip) });
  });
}

// ───────────── Worker: link chats, deliver messages ─────────────

/** "/start <code>" from a chat: links it to the patient who created the code. Returns true when linked. */
export async function handleTelegramStart(tenantId: string, code: string, chatId: bigint): Promise<boolean> {
  if (!/^[a-z2-7]{20,40}$/.test(code)) return false;
  return withAppContext({ tenantId }, async (tx) => {
    const c = await tx.telegramLinkCode.findUnique({ where: { codeHash: sha256Hex(code) } });
    if (!c || c.usedAt || c.expiresAt <= new Date()) return false;
    const used = await tx.telegramLinkCode.updateMany({ where: { codeHash: c.codeHash, usedAt: null }, data: { usedAt: new Date() } });
    if (used.count !== 1) return false;
    await tx.telegramLink.updateMany({ where: { patientId: c.patientId, revokedAt: null }, data: { revokedAt: new Date() } });
    const id = uuidv7();
    await tx.telegramLink.create({ data: { id, tenantId, patientId: c.patientId, chatId } });
    await recordAudit(tx, { tenantId, actorType: "SYSTEM", action: "telegram.patient_linked", entityType: "TelegramLink", entityId: id });
    return true;
  });
}

async function botToken(tx: Tx, tenantId: string): Promise<string | null> {
  const bot = await tx.telegramBot.findUnique({ where: { tenantId }, select: { tokenEnc: true, enabled: true } });
  return bot?.enabled ? decryptField(bot.tokenEnc, ctxKey(tenantId)) : null;
}

/** Reads new bot messages (API transport) and links chats. Safe to call every worker pass. */
export async function pollTelegram(tenantId: string): Promise<number> {
  if (telegramTransport() !== "api") return 0;
  const state = await withAppContext({ tenantId }, async (tx) => {
    const b = await tx.telegramBot.findUnique({ where: { tenantId }, select: { tokenEnc: true, enabled: true, updateOffset: true } });
    return b?.enabled ? { token: decryptField(b.tokenEnc, ctxKey(tenantId)), offset: b.updateOffset } : null;
  });
  if (!state) return 0;
  let updates: { update_id: number; message?: { chat: { id: number }; text?: string } }[];
  try {
    updates = await api(state.token, "getUpdates", { offset: Number(state.offset), timeout: 0, allowed_updates: ["message"] });
  } catch {
    logger.warn("telegram.poll_failed", {});
    return 0;
  }
  let linked = 0;
  for (const u of updates) {
    const m = /^\/start\s+([a-z2-7]+)$/.exec(u.message?.text?.trim() ?? "");
    if (m && u.message) {
      const ok = await handleTelegramStart(tenantId, m[1]!, BigInt(u.message.chat.id));
      if (ok) linked++;
      await api(state.token, "sendMessage", { chat_id: u.message.chat.id, text: ok ? "✅ ITop Med: OK" : "ITop Med: link expired / havola eskirgan" }).catch(() => undefined);
    }
  }
  if (updates.length) {
    const next = BigInt(updates[updates.length - 1]!.update_id + 1);
    await withAppContext({ tenantId }, (tx) => tx.telegramBot.updateMany({ where: { tenantId }, data: { updateOffset: next } }));
  }
  return linked;
}

/** Active chat of a patient (for the dispatcher). */
export async function telegramChatFor(tx: Tx, tenantId: string, patientId: string): Promise<bigint | null> {
  const l = await tx.telegramLink.findFirst({ where: { tenantId, patientId, revokedAt: null }, orderBy: { linkedAt: "desc" }, select: { chatId: true } });
  return l?.chatId ?? null;
}

export async function telegramReady(tx: Tx, tenantId: string): Promise<boolean> {
  if (!telegramEnabled()) return false;
  const b = await tx.telegramBot.findUnique({ where: { tenantId }, select: { enabled: true } });
  return Boolean(b?.enabled);
}

export async function sendTelegram(tx: Tx, tenantId: string, chatId: bigint, text: string): Promise<{ delivered: boolean; transport: string | null }> {
  const mode = telegramTransport();
  if (mode === "none") return { delivered: false, transport: null };
  if (mode === "dev-outbox") {
    try {
      await writeOutbox(`chat-${chatId}`, text);
      return { delivered: true, transport: "telegram-dev-outbox" };
    } catch {
      return { delivered: false, transport: "telegram-dev-outbox" };
    }
  }
  const token = await botToken(tx, tenantId);
  if (!token) return { delivered: false, transport: "telegram" };
  try {
    await api(token, "sendMessage", { chat_id: chatId.toString(), text });
    return { delivered: true, transport: "telegram" };
  } catch {
    return { delivered: false, transport: "telegram" };
  }
}
