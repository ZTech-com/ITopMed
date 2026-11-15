/**
 * Reference-data seed (idempotent): the plan catalogue only - never patients,
 * never real people. Runs as the schema owner (MIGRATION_DATABASE_URL).
 * The catalogue lives in scripts/lib/seed-plans.ts (shared with the server release).
 */
import "dotenv/config";
import { seedPlans } from "../scripts/lib/seed-plans";

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("MIGRATION_DATABASE_URL is required");
seedPlans(url)
  .then((n) => console.log(`Seeded ${n} plans.`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
