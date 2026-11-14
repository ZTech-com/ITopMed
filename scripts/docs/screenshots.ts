/**
 * Screenshots for the PDF documents (docs/pdf). Synthetic demo data only.
 *   ITM_AUDIT_EMAIL=… ITM_AUDIT_PASSWORD=… [ITM_DOCS_PORTAL_PHONE=…] npx tsx scripts/docs/screenshots.ts --slug shifo-med
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright-core";
import pg from "pg";

const args = process.argv.slice(2);
const SLUG = args.includes("--slug") ? args[args.indexOf("--slug") + 1]! : "shifo-med";
const BASE = "http://127.0.0.1:3000";
const OUT = path.join(process.cwd(), "docs", "pdf-src", "img");

async function ids() {
  const c = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await c.connect();
  const t = (await c.query(`SELECT id FROM "Tenant" WHERE slug = $1`, [SLUG])).rows[0].id;
  const one = async (sql: string) => (await c.query(sql, [t])).rows[0]?.id as string | undefined;
  const r = {
    encounter: await one(`SELECT "encounterId" AS id FROM "Prescription" WHERE "tenantId" = $1 AND status = 'ACTIVE' ORDER BY "createdAt" DESC LIMIT 1`),
    invoice: await one(`SELECT id FROM "Invoice" WHERE "tenantId" = $1 ORDER BY "totalMinor" DESC LIMIT 1`),
    summary: await one(`SELECT id FROM "ClinicTemplate" WHERE "tenantId" = $1 AND kind = 'DOCUMENT' AND archivedAt IS NULL ORDER BY "createdAt" LIMIT 1`.replace("archivedAt", '"archivedAt"')),
    noteTemplate: await one(`SELECT id FROM "ClinicTemplate" WHERE "tenantId" = $1 AND kind = 'NOTE' AND "archivedAt" IS NULL AND specialty = 'cardiology' LIMIT 1`),
  };
  await c.end();
  return r;
}

async function signIn(p: Page, url: string, field: string, user: string, password: string) {
  await p.goto(`${BASE}${url}`);
  await p.fill(`input[name="${field}"]`, user);
  await p.fill('input[name="password"]', password);
  await Promise.all([p.waitForURL((u) => !u.pathname.endsWith("/login")), p.press('input[name="password"]', "Enter")]);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const id = await ids();
  const c = `/c/${SLUG}`;
  const b = await chromium.launch({ channel: "msedge" });
  const shot = async (p: Page, name: string, url: string, full = false) => {
    await p.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
    await p.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
    console.log("  ", name);
  };

  const desk = await (await b.newContext({ viewport: { width: 1366, height: 860 }, colorScheme: "light" })).newPage();
  await signIn(desk, "/admin/login", "email", process.env.ITM_AUDIT_EMAIL!, process.env.ITM_AUDIT_PASSWORD!);
  await shot(desk, "admin-dashboard", "/admin");
  await shot(desk, "admin-clinics", "/admin/clinics");
  await signIn(desk, "/login", "email", process.env.ITM_AUDIT_EMAIL!, process.env.ITM_AUDIT_PASSWORD!);
  await shot(desk, "dashboard", c);
  await shot(desk, "control", `${c}/control`, true);
  await shot(desk, "queue", `${c}/queue`);
  await shot(desk, "patients", `${c}/patients`);
  if (id.encounter) {
    await shot(desk, "visit", `${c}/encounters/${id.encounter}`, true);
    await shot(desk, "prescription", `${c}/encounters/${id.encounter}/prescription`);
    if (id.summary) await shot(desk, "visit-summary", `${c}/encounters/${id.encounter}/document/${id.summary}`, true);
  }
  if (id.invoice) await shot(desk, "invoice", `${c}/billing/${id.invoice}`, true);
  await shot(desk, "reports", `${c}/reports`);
  await shot(desk, "templates", `${c}/templates`);
  if (id.noteTemplate) await shot(desk, "template-edit", `${c}/templates/${id.noteTemplate}`, true);
  await shot(desk, "settings", `${c}/settings`, true);
  await shot(desk, "integrations", `${c}/integrations`);
  await shot(desk, "services", `${c}/services`);
  await shot(desk, "inventory", `${c}/inventory`);
  await shot(desk, "lab", `${c}/lab`);

  const phone = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: "light" })).newPage();
  await signIn(phone, "/login", "email", process.env.ITM_AUDIT_EMAIL!, process.env.ITM_AUDIT_PASSWORD!);
  await shot(phone, "phone-control", `${c}/control`);
  await shot(phone, "phone-billing", `${c}/billing`);
  if (id.invoice) await shot(phone, "phone-invoice", `${c}/billing/${id.invoice}`);

  const portalPhone = process.env.ITM_DOCS_PORTAL_PHONE;
  if (portalPhone) {
    const pat = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: "light" })).newPage();
    await signIn(pat, `/p/${SLUG}/login`, "phone", portalPhone, process.env.ITM_AUDIT_PASSWORD!);
    await shot(pat, "portal-home", `/p/${SLUG}`);
    await shot(pat, "portal-book", `/p/${SLUG}/book`);
    await pat.goto(`${BASE}/p/${SLUG}/book`, { waitUntil: "networkidle" });
    const doc = pat.locator("main a[href*='doctor=']").first();
    if (await doc.count()) {
      await doc.click();
      await pat.waitForLoadState("networkidle");
      await pat.screenshot({ path: path.join(OUT, "portal-slots.png") });
      console.log("   portal-slots");
    }
    await shot(pat, "portal-account", `/p/${SLUG}/account`);
  }
  await b.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
