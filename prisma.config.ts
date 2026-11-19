import "dotenv/config";
import { defineConfig } from "prisma/config";

// Migrations run as the schema-owner role. The application itself never
// connects with this role (see docs/ARCHITECTURE.md §Database roles).
// `prisma generate` (npm postinstall) needs no database, so a missing URL must
// not fail a fresh install (CI runs `npm ci` before `npm run setup` creates .env);
// migrate/seed commands still fail clearly without it.
const url = process.env.MIGRATION_DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  ...(url ? { datasource: { url } } : {}),
});
