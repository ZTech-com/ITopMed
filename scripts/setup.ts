/**
 * `npm run setup` — first-time configuration on a new computer.
 * Creates `.env` from `.env.example` with fresh random database passwords and
 * encryption keys. Refuses to overwrite an existing `.env` (its keys decrypt
 * existing data — losing them makes MFA secrets and backups unreadable).
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const target = path.join(root, ".env");
if (fs.existsSync(target)) {
  console.log(".env already exists — nothing changed. (Delete it only if this computer has no data yet.)");
  process.exit(0);
}

const pw = () => randomBytes(18).toString("base64url");
const key = () => randomBytes(32).toString("base64");
const passwords = { superuser: pw(), owner: pw(), app: pw(), platform: pw(), portal: pw() };

let s = fs.readFileSync(path.join(root, ".env.example"), "utf8");
const set = (name: string, value: string) => {
  s = s.replace(new RegExp(`^${name}=.*$`, "m"), `${name}=${value}`);
};
set("DEV_PG_SUPERUSER_PASSWORD", passwords.superuser);
set("DEV_PG_OWNER_PASSWORD", passwords.owner);
set("DEV_PG_APP_PASSWORD", passwords.app);
set("DEV_PG_PLATFORM_PASSWORD", passwords.platform);
set("DEV_PG_PORTAL_PASSWORD", passwords.portal);
set("MIGRATION_DATABASE_URL", `postgresql://itopmed_owner:${passwords.owner}@localhost:54329/itopmed`);
set("DATABASE_URL", `postgresql://itopmed_app:${passwords.app}@localhost:54329/itopmed`);
set("PLATFORM_DATABASE_URL", `postgresql://itopmed_platform:${passwords.platform}@localhost:54329/itopmed`);
set("PORTAL_DATABASE_URL", `postgresql://itopmed_portal:${passwords.portal}@localhost:54329/itopmed`);
set("APP_ENCRYPTION_KEY", key());
set("AUDIT_HMAC_KEY", key());
set("BACKUP_ENCRYPTION_KEY", key());
fs.writeFileSync(target, s, { mode: 0o600 });
console.log(`Created .env with new random passwords and keys.
Keep a copy of .env in a safe place (e.g. a password manager): without APP_ENCRYPTION_KEY
two-step verification secrets cannot be read, and without BACKUP_ENCRYPTION_KEY backups cannot be restored.`);
