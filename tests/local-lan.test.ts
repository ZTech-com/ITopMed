import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { GET as caRoute } from "@/app/(public)/connect/ca.crt/route";
import { GET as iosRoute } from "@/app/(public)/connect/ios/route";
import { caFingerprint, caMobileConfig, lanAddresses, pemToDer } from "@/server/local/lan";

// A throw-away self-signed certificate (synthetic; not the installation's CA).
const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
void privateKey;
const fakePem = `-----BEGIN CERTIFICATE-----\n${publicKey.export({ type: "spki", format: "der" }).toString("base64")}\n-----END CERTIFICATE-----\n`;

describe("local installation helpers", () => {
  it("LAN addresses are IPv4, not loopback or link-local", () => {
    for (const ip of lanAddresses()) {
      expect(ip).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
      expect(ip.startsWith("127.")).toBe(false);
      expect(ip.startsWith("169.254.")).toBe(false);
    }
  });

  it("fingerprint and iOS profile are built from the certificate bytes", () => {
    const der = pemToDer(fakePem);
    expect(caFingerprint(fakePem)).toBe(crypto.createHash("sha256").update(der).digest("hex").toUpperCase().match(/.{2}/g)!.join(":"));
    const profile = caMobileConfig(fakePem);
    expect(profile).toContain("com.apple.security.root");
    expect(profile).toContain(der.toString("base64"));
    expect(profile).not.toMatch(/PRIVATE KEY/);
  });

  it("certificate downloads exist only in a local installation", async () => {
    const before = process.env.LOCAL_MODE;
    process.env.LOCAL_MODE = "0";
    try {
      expect((await caRoute()).status).toBe(404);
      expect((await iosRoute()).status).toBe(404);
    } finally {
      process.env.LOCAL_MODE = before;
    }
  });
});
