import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureCertificates } from "../scripts/lib/certs";
import { createEnvFile } from "../scripts/lib/env-file";
import { completeFirstRun, needsFirstRun, slugFromName } from "@/server/local/first-run";
import { platformActor } from "./helpers/fixtures";

const form = { clinicName: "Synthetic Clinic", fullName: "Synthetic Owner", password: "Synthetic-Passw0rd-2026", confirmPassword: "Synthetic-Passw0rd-2026" };

describe("first start of a local installation", () => {
  it("is refused outside local mode, once accounts exist, and from other computers", async () => {
    await platformActor(); // the platform has an account
    const before = process.env.LOCAL_MODE;
    try {
      process.env.LOCAL_MODE = "0";
      expect(await needsFirstRun()).toBe(false);
      await expect(completeFirstRun(form, { ip: "127.0.0.1", userAgent: "vitest" })).rejects.toThrow("errors.forbidden");
      process.env.LOCAL_MODE = "1";
      expect(await needsFirstRun()).toBe(false); // accounts exist
      await expect(completeFirstRun(form, { ip: "127.0.0.1", userAgent: "vitest" })).rejects.toThrow("errors.forbidden");
      await expect(completeFirstRun(form, { ip: "192.168.1.20", userAgent: "vitest" })).rejects.toThrow("errors.forbidden");
    } finally {
      process.env.LOCAL_MODE = before;
    }
  });

  it("workspace addresses come from the clinic name", () => {
    expect(slugFromName("Shifo Kardio")).toBe("shifo-kardio");
    expect(slugFromName("Oʻzbek Gʻalaba Med")).toBe("ozbek-galaba-med");
    expect(slugFromName("Admin")).toBe("admin-klinika");
    expect(slugFromName("A")).toMatch(/^klinika-/);
  });
});

describe("local installation files", () => {
  it("settings file has fresh secrets and is never overwritten", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "itm-env-"));
    const file = path.join(dir, ".env");
    expect(createEnvFile(file)).toBe(true);
    const first = fs.readFileSync(file, "utf8");
    expect(first).toMatch(/^APP_ENCRYPTION_KEY=.{40,}$/m);
    expect(first).toMatch(/^DATABASE_URL=postgresql:\/\/itopmed_app:/m);
    expect(createEnvFile(file)).toBe(false);
    expect(fs.readFileSync(file, "utf8")).toBe(first);
  });

  it("certificates are issued without OpenSSL, for the LAN address, signed by the local CA", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "itm-certs-"));
    const c = ensureCertificates(dir, ["localhost"], ["127.0.0.1", "192.168.1.50"]);
    const ca = new crypto.X509Certificate(fs.readFileSync(c.caCrt));
    const server = new crypto.X509Certificate(fs.readFileSync(c.crt));
    expect(ca.ca).toBe(true);
    expect(server.checkIssued(ca)).toBe(true);
    expect(server.verify(ca.publicKey)).toBe(true);
    expect(server.subjectAltName).toContain("IP Address:192.168.1.50");
    expect(server.checkPrivateKey(crypto.createPrivateKey(fs.readFileSync(c.key)))).toBe(true);
    // Same addresses: reused. New address: re-issued by the SAME CA (devices keep trusting it).
    const again = ensureCertificates(dir, ["localhost"], ["127.0.0.1", "192.168.1.50"]);
    expect(fs.readFileSync(again.crt, "utf8")).toBe(fs.readFileSync(c.crt, "utf8"));
    ensureCertificates(dir, ["localhost"], ["127.0.0.1", "10.0.0.7"]);
    const moved = new crypto.X509Certificate(fs.readFileSync(c.crt));
    expect(moved.subjectAltName).toContain("IP Address:10.0.0.7");
    expect(moved.checkIssued(ca)).toBe(true);
  });
});
