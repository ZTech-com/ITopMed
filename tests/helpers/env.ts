// Test environment: isolated embedded PostgreSQL started by global-setup.ts.
// All data is synthetic. Never point tests at a real database.
const port = process.env.TEST_PG_PORT ?? "54339";
Object.assign(process.env, {
  NODE_ENV: "test",
  APP_URL: "http://localhost:3000",
  DATABASE_URL: `postgresql://itopmed_app:test-app@localhost:${port}/itopmed`,
  PLATFORM_DATABASE_URL: `postgresql://itopmed_platform:test-platform@localhost:${port}/itopmed`,
  PORTAL_DATABASE_URL: `postgresql://itopmed_portal:test-portal@localhost:${port}/itopmed`,
  MIGRATION_DATABASE_URL: `postgresql://itopmed_owner:test-owner@localhost:${port}/itopmed`,
  APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  AUDIT_HMAC_KEY: Buffer.alloc(32, 9).toString("base64"),
  EMAIL_TRANSPORT: "dev-mailbox",
  SMS_TRANSPORT: "dev-outbox",
});
