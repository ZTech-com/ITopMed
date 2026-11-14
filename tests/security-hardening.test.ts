import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import config from "../next.config";
import { proxy } from "@/proxy";
import { rateLimit } from "@/server/security/rate-limit";
import { uniq } from "./helpers/fixtures";

const resetProcessStore = () => {
  delete (globalThis as { __itmRateLimit?: unknown }).__itmRateLimit;
};

describe("rate limiting (shared database store)", () => {
  it("counts per key within the window, independently per key", async () => {
    const k = uniq("rl");
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await rateLimit(k, 3, 60_000));
    expect(results).toEqual([true, true, true, false]);
    expect(await rateLimit(uniq("rl-other"), 3, 60_000)).toBe(true);
  });

  it("limits survive a new process (i.e. hold across app instances) and reset after the window", async () => {
    const k = uniq("rl");
    expect(await rateLimit(k, 2, 60_000)).toBe(true);
    expect(await rateLimit(k, 2, 60_000)).toBe(true);
    resetProcessStore(); // like a second server instance
    expect(await rateLimit(k, 2, 60_000)).toBe(false);

    const short = uniq("rl-short");
    expect(await rateLimit(short, 1, 1000)).toBe(true);
    expect(await rateLimit(short, 1, 1000)).toBe(false);
    await new Promise((r) => setTimeout(r, 1200));
    expect(await rateLimit(short, 1, 1000)).toBe(true);
  });

  it("concurrent hits are counted exactly", async () => {
    const k = uniq("rl-burst");
    const res = await Promise.all(Array.from({ length: 20 }, () => rateLimit(k, 10, 60_000)));
    expect(res.filter(Boolean)).toHaveLength(10);
  });

  it("stores only hashed keys, and no runtime role can read the table", async () => {
    const plain = `login:e:${uniq("person")}@clinic.test`;
    await rateLimit(plain, 5, 60_000);
    const owner = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await owner.connect();
    const rows = (await owner.query(`SELECT key FROM "RateLimitBucket"`)).rows.map((r) => r.key as string);
    const persistence = (await owner.query(`SELECT relpersistence FROM pg_class WHERE relname = 'RateLimitBucket'`)).rows[0].relpersistence;
    await owner.end();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((k) => /^[0-9a-f]{64}$/.test(k))).toBe(true);
    expect(rows.some((k) => k.includes("clinic.test"))).toBe(false);
    expect(persistence).toBe("u"); // UNLOGGED
    for (const [user, pw] of [["itopmed_app", "test-app"], ["itopmed_platform", "test-platform"], ["itopmed_portal", "test-portal"]]) {
      const c = new pg.Client({ host: "localhost", port: Number(process.env.TEST_PG_PORT ?? 54339), user, password: pw, database: "itopmed" });
      await c.connect();
      await expect(c.query(`SELECT 1 FROM "RateLimitBucket" LIMIT 1`)).rejects.toThrow(/permission denied/);
      await c.end();
    }
  });
});

describe("security headers", () => {
  it("every response gets a nonce-based CSP that forbids framing, plugins and foreign scripts", () => {
    const res = proxy(new NextRequest("http://localhost:3000/c/some-clinic"));
    const csp = res.headers.get("Content-Security-Policy")!;
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    for (const d of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"]) expect(csp).toContain(d);
    const other = proxy(new NextRequest("http://localhost:3000/login")).headers.get("Content-Security-Policy")!;
    expect(other.match(/nonce-([^']+)/)![1]).not.toBe(csp.match(/nonce-([^']+)/)![1]); // fresh nonce per request
  });

  it("production forces HTTPS (HSTS + upgrade-insecure-requests), except a single-computer LOCAL_MODE installation", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const prod = proxy(new NextRequest("https://itopmed.example/login"));
      expect(prod.headers.get("Strict-Transport-Security")).toContain("max-age=63072000");
      expect(prod.headers.get("Content-Security-Policy")).toContain("upgrade-insecure-requests");
      vi.stubEnv("LOCAL_MODE", "1");
      const local = proxy(new NextRequest("http://127.0.0.1:3000/login"));
      expect(local.headers.get("Strict-Transport-Security")).toBeNull();
      expect(local.headers.get("Content-Security-Policy")).not.toContain("upgrade-insecure-requests");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("static headers: no sniffing, no framing, no referrer, locked-down features, and no caching of pages", async () => {
    const rules = await config.headers!();
    const all = rules.find((r) => r.source === "/:path*")!.headers;
    const h = Object.fromEntries(all.map((x) => [x.key, x.value]));
    expect(h).toMatchObject({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer", "Cross-Origin-Opener-Policy": "same-origin" });
    expect(h["Permissions-Policy"]).toContain("camera=()");
    const pages = rules.find((r) => r.headers.some((x) => x.key === "Cache-Control"))!;
    expect(pages.headers[0]).toEqual({ key: "Cache-Control", value: "no-store" });
    expect(config.poweredByHeader).toBe(false);
  });
});
