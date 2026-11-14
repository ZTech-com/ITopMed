/**
 * Single-computer installation (`npm run local` / `npm run app`): which address
 * other devices on the clinic network use, and the local certificate authority
 * they must trust. Used by scripts/local.ts (the server) and the /connect page.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dataRoot } from "./paths";

/** Adapters that other devices on the Wi-Fi/LAN can never reach. */
const VIRTUAL = /vethernet|virtualbox|vmware|hyper-v|wsl|docker|loopback|bluetooth|npcap|vpn|tap-|tun|utun|zerotier|hamachi|default switch/i;

function rank(ip: string): number {
  if (ip.startsWith("192.168.")) return 0;
  if (ip.startsWith("10.")) return 1;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2;
  return 3;
}

/** IPv4 addresses of this computer that phones and other PCs can reach, best first. */
export function lanAddresses(): string[] {
  const out: { ip: string; virtual: boolean }[] = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family !== "IPv4" || i.internal || i.address.startsWith("169.254.")) continue;
      out.push({ ip: i.address, virtual: VIRTUAL.test(name) });
    }
  }
  // Real adapters first; virtual ones only if nothing else exists.
  const real = out.filter((o) => !o.virtual);
  return (real.length ? real : out).map((o) => o.ip).sort((a, b) => rank(a) - rank(b));
}

export const LOCAL_PUBLIC_PORT = Number(process.env.LOCAL_PUBLIC_PORT ?? 3443);

export function caCertPath(): string {
  return path.join(dataRoot(), "certs", "itopmed-local-ca.crt");
}

/** PEM of the local CA certificate (public part only), or null outside a local installation. */
export function readCaPem(): string | null {
  try {
    return fs.readFileSync(caCertPath(), "utf8");
  } catch {
    return null;
  }
}

export function pemToDer(pem: string): Buffer {
  return Buffer.from(pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, ""), "base64");
}

/** SHA-256 fingerprint as shown by browsers and phones (AA:BB:…), to compare by eye. */
export function caFingerprint(pem: string): string {
  return crypto
    .createHash("sha256")
    .update(pemToDer(pem))
    .digest("hex")
    .toUpperCase()
    .match(/.{2}/g)!
    .join(":");
}

/** iOS/iPadOS configuration profile that installs the CA (the user still enables full trust in Settings). */
export function caMobileConfig(pem: string): string {
  const der = pemToDer(pem).toString("base64");
  const uuid = (seed: string) => {
    const h = crypto.createHash("sha256").update(seed + der).digest("hex");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`.toUpperCase();
  };
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadCertificateFileName</key><string>itopmed-local-ca.cer</string>
      <key>PayloadContent</key><data>${der}</data>
      <key>PayloadDisplayName</key><string>ITop Med Local CA</string>
      <key>PayloadIdentifier</key><string>uz.itopmed.local.ca</string>
      <key>PayloadType</key><string>com.apple.security.root</string>
      <key>PayloadUUID</key><string>${uuid("cert")}</string>
      <key>PayloadVersion</key><integer>1</integer>
    </dict>
  </array>
  <key>PayloadDisplayName</key><string>ITop Med (this clinic network)</string>
  <key>PayloadIdentifier</key><string>uz.itopmed.local</string>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadUUID</key><string>${uuid("profile")}</string>
  <key>PayloadVersion</key><integer>1</integer>
</dict>
</plist>
`;
}
