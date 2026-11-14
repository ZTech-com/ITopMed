/**
 * Local HTTPS certificates without OpenSSL (pure Node + node-forge), so the
 * packaged app needs nothing installed. A private certificate authority is
 * created once (10 years); the server certificate covers localhost, this
 * computer's name and every LAN address, and is re-issued when they change.
 * Existing CAs made earlier with OpenSSL are reused (PKCS#1 or PKCS#8 keys).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import forge from "node-forge";

const { pki } = forge;

function serial(): string {
  // Positive 128-bit serial (leading byte < 0x80).
  const b = crypto.randomBytes(16);
  b[0] = b[0]! & 0x7f;
  return b.toString("hex");
}

function keyPair(): forge.pki.rsa.KeyPair {
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const priv = pki.privateKeyFromPem(privateKey.export({ type: "pkcs1", format: "pem" }).toString()) as forge.pki.rsa.PrivateKey;
  return { privateKey: priv, publicKey: pki.setRsaPublicKey(priv.n, priv.e) };
}

const years = (n: number) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + n);
  return d;
};

export interface CertPaths {
  key: string;
  crt: string;
  caCrt: string;
}

export function ensureCertificates(dir: string, names: string[], ips: string[], log: (m: string) => void = () => undefined): CertPaths {
  fs.mkdirSync(dir, { recursive: true });
  const caKeyPath = path.join(dir, "itopmed-local-ca.key");
  const caCrtPath = path.join(dir, "itopmed-local-ca.crt");
  const keyPath = path.join(dir, "server.key");
  const crtPath = path.join(dir, "server.crt");
  const sanPath = path.join(dir, "server.san");

  let caKey: forge.pki.rsa.PrivateKey;
  let caCert: forge.pki.Certificate;
  if (fs.existsSync(caKeyPath) && fs.existsSync(caCrtPath)) {
    caKey = pki.privateKeyFromPem(fs.readFileSync(caKeyPath, "utf8")) as forge.pki.rsa.PrivateKey;
    caCert = pki.certificateFromPem(fs.readFileSync(caCrtPath, "utf8"));
  } else {
    const kp = keyPair();
    caKey = kp.privateKey;
    caCert = pki.createCertificate();
    caCert.publicKey = kp.publicKey;
    caCert.serialNumber = serial();
    caCert.validity.notBefore = new Date(Date.now() - 60_000);
    caCert.validity.notAfter = years(10);
    const subject = [
      { name: "commonName", value: "ITop Med Local CA" },
      { name: "organizationName", value: "ITop Med (this computer only)" },
    ];
    caCert.setSubject(subject);
    caCert.setIssuer(subject);
    caCert.setExtensions([
      { name: "basicConstraints", cA: true, critical: true },
      { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true },
      { name: "subjectKeyIdentifier" },
    ]);
    caCert.sign(caKey, forge.md.sha256.create());
    fs.writeFileSync(caKeyPath, pki.privateKeyToPem(caKey), { mode: 0o600 });
    fs.writeFileSync(caCrtPath, pki.certificateToPem(caCert));
    log(`Created a private certificate authority: ${caCrtPath}`);
  }

  const san = [...names.map((n) => `DNS:${n}`), ...ips.map((ip) => `IP:${ip}`)].join(",");
  const stillValid = () => {
    try {
      return new crypto.X509Certificate(fs.readFileSync(crtPath)).validToDate.getTime() > Date.now() + 30 * 86_400_000;
    } catch {
      return false;
    }
  };
  if (fs.existsSync(keyPath) && fs.existsSync(sanPath) && fs.readFileSync(sanPath, "utf8") === san && stillValid()) return { key: keyPath, crt: crtPath, caCrt: caCrtPath };

  const kp = keyPair();
  const cert = pki.createCertificate();
  cert.publicKey = kp.publicKey;
  cert.serialNumber = serial();
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  // 825 days: the longest validity Apple devices accept for TLS server certificates.
  cert.validity.notAfter = new Date(Date.now() + 825 * 86_400_000);
  cert.setSubject([{ name: "commonName", value: "ITop Med local server" }]);
  cert.setIssuer(caCert.subject.attributes);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true, critical: true },
    { name: "extKeyUsage", serverAuth: true },
    { name: "subjectAltName", altNames: [...names.map((value) => ({ type: 2, value })), ...ips.map((ip) => ({ type: 7, ip }))] },
    { name: "authorityKeyIdentifier", keyIdentifier: caCert.generateSubjectKeyIdentifier().getBytes() },
  ]);
  cert.sign(caKey, forge.md.sha256.create());
  fs.writeFileSync(keyPath, pki.privateKeyToPem(kp.privateKey), { mode: 0o600 });
  fs.writeFileSync(crtPath, pki.certificateToPem(cert));
  fs.writeFileSync(sanPath, san);
  log(`Issued a server certificate for: ${san.replaceAll("DNS:", "").replaceAll("IP:", "")}`);
  return { key: keyPath, crt: crtPath, caCrt: caCrtPath };
}
