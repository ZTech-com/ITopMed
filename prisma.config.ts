import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Migrations run as the schema-owner role. The application itself never
// connects with this role (see docs/ARCHITECTURE.md §Database roles).
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  datasource: { url: env("MIGRATION_DATABASE_URL") },
});
