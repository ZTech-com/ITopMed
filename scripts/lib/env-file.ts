/**
 * Creates the settings file of a local installation with fresh random database
 * passwords and encryption keys (the packaged app does this on its first start,
 * `npm run setup` does it for a source checkout). Never overwrites an existing
 * file: its keys decrypt existing data.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function createEnvFile(target: string, opts: { port?: number } = {}): boolean {
  if (fs.existsSync(target)) return false;
  const port = opts.port ?? 54329;
  const pw = () => randomBytes(18).toString("base64url");
  const key = () => randomBytes(32).toString("base64");
  const p = { superuser: pw(), owner: pw(), app: pw(), platform: pw(), portal: pw() };
  const url = (role: string, password: string) => `postgresql://${role}:${password}@localhost:${port}/itopmed`;
  const lines = [
    "# ITop Med - settings of THIS computer. Keep a copy in a safe place and never share it:",
    "# without APP_ENCRYPTION_KEY and BACKUP_ENCRYPTION_KEY, stored secrets and backups cannot be read.",
    "APP_URL=http://127.0.0.1:3000",
    `DEV_PG_PORT=${port}`,
    `DEV_PG_SUPERUSER_PASSWORD=${p.superuser}`,
    `DEV_PG_OWNER_PASSWORD=${p.owner}`,
    `DEV_PG_APP_PASSWORD=${p.app}`,
    `DEV_PG_PLATFORM_PASSWORD=${p.platform}`,
    `DEV_PG_PORTAL_PASSWORD=${p.portal}`,
    `MIGRATION_DATABASE_URL=${url("itopmed_owner", p.owner)}`,
    `DATABASE_URL=${url("itopmed_app", p.app)}`,
    `PLATFORM_DATABASE_URL=${url("itopmed_platform", p.platform)}`,
    `PORTAL_DATABASE_URL=${url("itopmed_portal", p.portal)}`,
    `APP_ENCRYPTION_KEY=${key()}`,
    `AUDIT_HMAC_KEY=${key()}`,
    `BACKUP_ENCRYPTION_KEY=${key()}`,
    "",
  ];
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, lines.join("\n"), { mode: 0o600 });
  return true;
}
