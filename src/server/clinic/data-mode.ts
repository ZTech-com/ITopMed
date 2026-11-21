import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { DataMode } from "@/generated/prisma/client";
import type { ClinicContext } from "../auth/clinic-auth";
import type { RequestMeta } from "../auth/platform-auth";
import { recordAudit } from "../audit";
import { withAppContext, type Tx } from "../db";
import { fileClinic, indexFileName, loadPatientFileData, patientFileName, patientIndexWorkbook, patientWorkbook, type PatientFileData } from "../emr/patient-file";
import { logger } from "../logger";
import { DomainError } from "../tenancy/provisioning";
import { auditClinic, inClinic, requirePermission } from "./context";

/**
 * Where a clinic works.
 *  - LOCAL: the local app on the clinic's own computer, and nothing leaves it:
 *    patient messages (SMS, Telegram) are not sent and the Telegram bot
 *    is not contacted. Only possible on a local installation (LOCAL_MODE=1).
 *  - CONNECTED: messages may go out over the internet. Always the case on the
 *    internet server, where the data lives on the server by definition.
 * Optionally (local app only) every patient's data is also kept as a separate
 * Excel workbook in a folder on this computer, refreshed by the worker.
 */

export const isLocalInstall = () => process.env.LOCAL_MODE === "1";

export function effectiveMode(stored: DataMode | null | undefined): DataMode {
  if (!isLocalInstall()) return "CONNECTED";
  return stored ?? "LOCAL";
}

/** True when nothing may be sent off this computer for the clinic. */
export async function isLocalOnly(tx: Tx, tenantId: string): Promise<boolean> {
  if (!isLocalInstall()) return false;
  const p = await tx.clinicPolicy.findUnique({ where: { tenantId }, select: { dataMode: true } });
  return effectiveMode(p?.dataMode) === "LOCAL";
}

export function defaultFilesDir(clinicName: string): string {
  const safe = clinicName.replace(/[<>:"/\\|?*]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Klinika";
  return path.join(os.homedir(), "Documents", "ITopMed", safe);
}

export async function getDataSettings(ctx: ClinicContext) {
  requirePermission(ctx, "clinic.settings.read");
  const p = await inClinic(ctx, (tx) =>
    tx.clinicPolicy.findUnique({ where: { tenantId: ctx.tenant.id }, select: { dataMode: true, patientFilesEnabled: true, patientFilesDir: true, patientFilesSyncedAt: true } }),
  );
  const local = isLocalInstall();
  return {
    install: local ? ("local" as const) : ("server" as const),
    mode: effectiveMode(p?.dataMode),
    filesEnabled: local && Boolean(p?.patientFilesEnabled),
    filesDir: p?.patientFilesDir ?? defaultFilesDir(ctx.tenant.name),
    syncedAt: p?.patientFilesSyncedAt ?? null,
  };
}

function assertOwner(ctx: ClinicContext) {
  requirePermission(ctx, "clinic.settings.manage");
  if (!ctx.roleKeys.includes("clinic_owner")) throw new DomainError("errors.ownerOnly");
}

export const dataModeSchema = z.object({ mode: z.enum(["LOCAL", "CONNECTED"]) });

export async function saveDataMode(ctx: ClinicContext, raw: unknown, meta: RequestMeta) {
  assertOwner(ctx);
  const { mode } = dataModeSchema.parse(raw);
  if (mode === "LOCAL" && !isLocalInstall()) throw new DomainError("errors.localAppOnly");
  await inClinic(ctx, async (tx) => {
    await tx.clinicPolicy.upsert({
      where: { tenantId: ctx.tenant.id },
      create: { tenantId: ctx.tenant.id, dataMode: mode, updatedById: ctx.principal.user.id },
      update: { dataMode: mode, updatedById: ctx.principal.user.id },
    });
    await auditClinic(tx, ctx, meta, { action: "clinic.data_mode_changed", entityType: "Tenant", entityId: ctx.tenant.id, metadata: { mode } });
  });
}

export const filesSchema = z.object({
  enabled: z.boolean(),
  dir: z.string().trim().max(240, "validation.tooLong").optional(),
});

/**
 * Turns the folder of patient files on or off. The files contain medical
 * records, so this needs oversight access to records (head doctor), besides
 * managing the clinic's settings.
 */
export async function savePatientFiles(ctx: ClinicContext, raw: unknown, meta: RequestMeta): Promise<{ written: number }> {
  requirePermission(ctx, "clinic.settings.manage");
  if (!ctx.permissions.has("emr.read_all")) throw new DomainError("errors.needsHeadDoctor");
  if (!isLocalInstall()) throw new DomainError("errors.localAppOnly");
  const input = filesSchema.parse(raw);
  const dir = input.dir ? input.dir : defaultFilesDir(ctx.tenant.name);
  if (input.enabled) prepareDir(dir);
  await inClinic(ctx, async (tx) => {
    const data = { patientFilesEnabled: input.enabled, patientFilesDir: dir, patientFilesEnabledById: input.enabled ? ctx.principal.user.id : null, patientFilesSyncedAt: null, updatedById: ctx.principal.user.id };
    await tx.clinicPolicy.upsert({ where: { tenantId: ctx.tenant.id }, create: { tenantId: ctx.tenant.id, ...data }, update: data });
    await auditClinic(tx, ctx, meta, { action: "clinic.patient_files_configured", entityType: "Tenant", entityId: ctx.tenant.id, metadata: { enabled: input.enabled } });
  });
  if (!input.enabled) return { written: 0 };
  return syncPatientFiles(ctx.tenant.id, { full: true });
}

/** "Refresh now": writes every patient's file again. */
export async function syncPatientFilesNow(ctx: ClinicContext, meta: RequestMeta): Promise<{ written: number }> {
  requirePermission(ctx, "clinic.settings.manage");
  if (!ctx.permissions.has("emr.read_all")) throw new DomainError("errors.needsHeadDoctor");
  if (!isLocalInstall()) throw new DomainError("errors.localAppOnly");
  const r = await syncPatientFiles(ctx.tenant.id, { full: true });
  await inClinic(ctx, (tx) => auditClinic(tx, ctx, meta, { action: "clinic.patient_files_refreshed", entityType: "Tenant", entityId: ctx.tenant.id, metadata: { written: r.written } }));
  return r;
}

function prepareDir(dir: string) {
  if (!path.isAbsolute(dir)) throw new DomainError("errors.folderInvalid");
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.itopmed-write-test-${process.pid}`);
    fs.writeFileSync(probe, "ok");
    fs.rmSync(probe, { force: true });
  } catch {
    throw new DomainError("errors.folderNotWritable");
  }
}

// ───────────── Folder of patient files (local app) ─────────────

const INDEX = ".itopmed-files.json";
interface FolderIndex {
  /** patientId -> file name currently used for that patient. */
  files: Record<string, string>;
  /** Patients whose file could not be written (e.g. open in Excel): retried next time. */
  pending: string[];
}

function readIndex(dir: string): FolderIndex {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, INDEX), "utf8")) as Partial<FolderIndex>;
    return { files: j.files ?? {}, pending: j.pending ?? [] };
  } catch {
    return { files: {}, pending: [] };
  }
}

function writeAtomic(file: string, bytes: Uint8Array) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, bytes);
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

/** Patients with anything new since `since` (records, visits, results, payments). */
async function changedPatients(tx: Tx, since: Date): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id::text FROM "Patient" WHERE "updatedAt" > ${since}
    UNION SELECT "patientId"::text FROM "Encounter" WHERE "createdAt" > ${since} OR "closedAt" > ${since}
    UNION SELECT "patientId"::text FROM "ClinicalNote" WHERE "updatedAt" > ${since}
    UNION SELECT "patientId"::text FROM "Diagnosis" WHERE "updatedAt" > ${since}
    UNION SELECT "patientId"::text FROM "Allergy" WHERE "updatedAt" > ${since}
    UNION SELECT "patientId"::text FROM "VitalSign" WHERE "createdAt" > ${since}
    UNION SELECT "patientId"::text FROM "Prescription" WHERE "createdAt" > ${since} OR "cancelledAt" > ${since}
    UNION SELECT "patientId"::text FROM "LabOrder" WHERE GREATEST("orderedAt", "collectedAt", "resultedAt", "verifiedAt", "cancelledAt") > ${since}
    UNION SELECT "patientId"::text FROM "Invoice" WHERE "updatedAt" > ${since}
    UNION SELECT i."patientId"::text FROM "Payment" p JOIN "Invoice" i ON i.id = p."invoiceId" WHERE p."receivedAt" > ${since}`;
  return rows.map((r) => r.id);
}

const running = new Set<string>();

/**
 * Brings the folder up to date: rewrites the files of patients that changed
 * since the last run (all of them with `full`), renames a file when the name
 * changed, removes files of merged patients, and rewrites the patient list.
 * Runs as a system job inside the clinic's tenant context (RLS applies).
 */
export async function syncPatientFiles(tenantId: string, opts: { full?: boolean } = {}): Promise<{ written: number }> {
  if (!isLocalInstall() || running.has(tenantId)) return { written: 0 };
  running.add(tenantId);
  try {
    const startedAt = new Date();
    const cfg = await withAppContext({ tenantId }, (tx) =>
      tx.clinicPolicy.findUnique({ where: { tenantId }, select: { patientFilesEnabled: true, patientFilesDir: true, patientFilesSyncedAt: true } }),
    );
    if (!cfg?.patientFilesEnabled || !cfg.patientFilesDir) return { written: 0 };
    const dir = cfg.patientFilesDir;
    fs.mkdirSync(dir, { recursive: true });
    const index = readIndex(dir);
    const full = opts.full || !cfg.patientFilesSyncedAt;

    const { ids, clinic } = await withAppContext({ tenantId }, async (tx) => ({
      ids: full ? (await tx.patient.findMany({ select: { id: true } })).map((p) => p.id) : [...new Set([...(await changedPatients(tx, cfg.patientFilesSyncedAt!)), ...index.pending])],
      clinic: await fileClinic(tx, tenantId),
    }));

    let written = 0;
    const pending: string[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const datas = await withAppContext({ tenantId }, async (tx) => {
        const out: PatientFileData[] = [];
        for (const id of chunk) {
          const exists = await tx.patient.findUnique({ where: { id }, select: { id: true } });
          if (exists) out.push(await loadPatientFileData(tx, id));
        }
        return out;
      });
      for (const d of datas) {
        const old = index.files[d.patient.id];
        if (d.patient.status === "MERGED") {
          if (old) fs.rmSync(path.join(dir, old), { force: true });
          delete index.files[d.patient.id];
          continue;
        }
        const name = patientFileName(d.patient);
        try {
          writeAtomic(path.join(dir, name), await patientWorkbook(d, clinic));
          if (old && old !== name) fs.rmSync(path.join(dir, old), { force: true });
          index.files[d.patient.id] = name;
          written++;
        } catch {
          pending.push(d.patient.id); // e.g. the file is open in Excel; retried next pass
        }
      }
    }

    if (written > 0 || full) {
      const list = await withAppContext({ tenantId }, async (tx) => {
        const patients = await tx.patient.findMany({
          where: { status: { not: "MERGED" } },
          select: { id: true, mrn: true, lastName: true, firstName: true, middleName: true, birthDate: true, birthYearOnly: true, sex: true, phone: true, address: true, status: true, createdAt: true },
        });
        const visits = await tx.encounter.groupBy({ by: ["patientId"], _max: { startedAt: true } });
        return { patients, last: new Map(visits.filter((v) => v._max.startedAt).map((v) => [v.patientId, v._max.startedAt!])) };
      });
      try {
        writeAtomic(path.join(dir, await indexFileName(clinic.locale)), await patientIndexWorkbook(list.patients, list.last, clinic));
      } catch {
        logger.warn("patient_files.index_busy", { tenantId });
      }
    }
    fs.writeFileSync(path.join(dir, INDEX), JSON.stringify({ files: index.files, pending }, null, 1));

    await withAppContext({ tenantId }, async (tx) => {
      await tx.clinicPolicy.update({ where: { tenantId }, data: { patientFilesSyncedAt: startedAt } });
      if (written > 0) await recordAudit(tx, { tenantId, actorType: "SYSTEM", action: "clinic.patient_files_synced", entityType: "Tenant", entityId: tenantId, metadata: { written, pending: pending.length } });
    });
    return { written };
  } catch (e) {
    logger.error("patient_files.sync_failed", { tenantId, error: e instanceof Error ? e.name : "unknown" });
    throw e;
  } finally {
    running.delete(tenantId);
  }
}
