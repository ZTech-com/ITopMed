/**
 * Reference-data seed (idempotent). Seeds ONLY catalog data — never patients,
 * never real people. Runs as the schema owner (MIGRATION_DATABASE_URL).
 *
 * PLAN PRICES ARE PLACEHOLDERS: commercial pricing is a business decision
 * that has not been made yet (see docs/ROADMAP.md, external dependencies).
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import pg from "pg";

const plans = [
  {
    code: "starter",
    name: { "uz-Latn": "Boshlangʻich", "uz-Cyrl": "Бошланғич", ru: "Стартовый", en: "Starter" },
    maxUsers: 10,
    maxBranches: 1,
    maxStorageMb: 5_000,
    modules: ["patients", "appointments", "queue", "emr", "billing", "dental"],
  },
  {
    code: "professional",
    name: { "uz-Latn": "Professional", "uz-Cyrl": "Профессионал", ru: "Профессиональный", en: "Professional" },
    maxUsers: 50,
    maxBranches: 5,
    maxStorageMb: 50_000,
    modules: ["patients", "appointments", "queue", "emr", "laboratory", "billing", "inventory", "reports", "dental"],
  },
  {
    code: "enterprise",
    name: { "uz-Latn": "Korporativ", "uz-Cyrl": "Корпоратив", ru: "Корпоративный", en: "Enterprise" },
    maxUsers: null,
    maxBranches: null,
    maxStorageMb: null,
    modules: ["patients", "appointments", "queue", "emr", "laboratory", "billing", "inventory", "hr", "patient_portal", "reports", "integrations", "dental"],
  },
];

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL is required");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    for (const p of plans) {
      await client.query(
        `INSERT INTO "Plan" (id, code, name, "maxUsers", "maxBranches", "maxStorageMb", modules, "trialDays", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, 14, now())
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, modules = EXCLUDED.modules, "updatedAt" = now()`,
        [randomUUID(), p.code, JSON.stringify(p.name), p.maxUsers, p.maxBranches, p.maxStorageMb, p.modules],
      );
    }
    console.log(`Seeded ${plans.length} plans.`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
