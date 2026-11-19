import { describe, expect, it } from "vitest";
import { assertSafeMetadata } from "@/server/audit";
import { decryptField, encryptField, hashIp, randomToken, uuidv7 } from "@/server/security/crypto";
import { hashPassword, passwordSchema, verifyPassword } from "@/server/security/password";
import { createClinicSchema, slugSchema } from "@/lib/validation";

describe("security primitives", () => {
  it("hashes passwords with argon2id and verifies them", async () => {
    const h = await hashPassword("Synthetic-Passw0rd-2026");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(h, "Synthetic-Passw0rd-2026")).toBe(true);
    expect(await verifyPassword(h, "wrong")).toBe(false);
    expect(await verifyPassword(null, "anything")).toBe(false);
  });

  it("enforces the password policy", () => {
    expect(passwordSchema.safeParse("short1").success).toBe(false);
    expect(passwordSchema.safeParse("onlylettersnodigits").success).toBe(false);
    expect(passwordSchema.safeParse("Long-enough-passw0rd").success).toBe(true);
  });

  it("encrypts fields with context binding", () => {
    const c = encryptField("secret-seed", "integration:user-1");
    expect(c).not.toContain("secret-seed");
    expect(decryptField(c, "integration:user-1")).toBe("secret-seed");
    expect(() => decryptField(c, "integration:user-2")).toThrow();
  });

  it("produces unguessable tokens and time-ordered UUIDv7", () => {
    expect(randomToken()).toMatch(/^[a-z2-7]{32}$/);
    expect(randomToken()).not.toBe(randomToken());
    const id = uuidv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("pseudonymises IPs", () => {
    expect(hashIp("203.0.113.5")).toHaveLength(32);
    expect(hashIp("203.0.113.5")).not.toContain("203");
    expect(hashIp(null)).toBeNull();
  });

  it("refuses sensitive keys in audit metadata", () => {
    expect(() => assertSafeMetadata({ diagnosis: "x" })).toThrow();
    expect(() => assertSafeMetadata({ password: "x" })).toThrow();
    expect(() => assertSafeMetadata({ role: "doctor" })).not.toThrow();
  });

  it("validates slugs and clinic input", () => {
    expect(slugSchema.safeParse("med-life").success).toBe(true);
    expect(slugSchema.safeParse("Med Life").success).toBe(false);
    expect(slugSchema.safeParse("admin").success).toBe(false);
    expect(slugSchema.safeParse("a--b").success).toBe(false);
    const r = createClinicSchema.safeParse({ name: "X", slug: "ok-slug" });
    expect(r.success).toBe(false);
  });
});
