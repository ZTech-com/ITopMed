/**
 * `npm run local` — runs ITop Med on ONE computer for the whole clinic network.
 *
 *   phones, tablets, other PCs ──https://<this-pc-ip>:3443──► HTTPS proxy (this script)
 *                                                               └─► next start on 127.0.0.1:3000 (production build)
 *   + embedded PostgreSQL (if not already running) + notification worker
 *
 * HTTPS is required: session cookies are `Secure` in production and phones only
 * install the app (PWA) from a secure origin. The certificate is issued by a
 * private certificate authority created here on first run (.data/certs, never
 * committed). Each device must trust `.data/certs/itopmed-local-ca.crt` once —
 * see docs/QOLLANMA.md. The CA private key never leaves this computer.
 *
 * Options: --build (force a fresh production build), --port 3443.
 */
import "dotenv/config";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const CERTS = path.join(ROOT, ".data", "certs");
const args = process.argv.slice(2);
const PUBLIC_PORT = Number(args[args.indexOf("--port") + 1] || 0) || 3443;
const APP_PORT = 3000;
const DB_PORT = Number(process.env.DEV_PG_PORT ?? 54329);
const children: ChildProcess[] = [];
const isWin = process.platform === "win32";

function lanAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i): i is os.NetworkInterfaceInfo => Boolean(i && i.family === "IPv4" && !i.internal))
    .map((i) => i.address);
}

/** OpenSSL from PATH, or the copy that ships with Git for Windows. */
function opensslPath(): string {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return "openssl";
  } catch {
    const candidates = ["C:\\Program Files\\Git\\usr\\bin\\openssl.exe", "C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe"];
    const found = candidates.find((c) => fs.existsSync(c));
    if (!found) throw new Error("OpenSSL was not found. Install Git for Windows (it includes OpenSSL) and run again.");
    return found;
  }
}

let opensslBin: string | undefined;
function openssl(argv: string[]) {
  opensslBin ??= opensslPath();
  // MSYS2_ARG_CONV_EXCL: stop Git's OpenSSL from rewriting "/CN=…" as a Windows path.
  execFileSync(opensslBin, argv, { stdio: "pipe", env: { ...process.env, MSYS2_ARG_CONV_EXCL: "*" } });
}

/** Private CA (once, 10 years) + server certificate for localhost and every LAN address of this PC (re-issued when they change). */
function ensureCertificates(names: string[], ips: string[]) {
  fs.mkdirSync(CERTS, { recursive: true });
  const caKey = path.join(CERTS, "itopmed-local-ca.key");
  const caCrt = path.join(CERTS, "itopmed-local-ca.crt");
  const key = path.join(CERTS, "server.key");
  const crt = path.join(CERTS, "server.crt");
  const sanFile = path.join(CERTS, "server.san");
  if (!fs.existsSync(caKey) || !fs.existsSync(caCrt)) {
    openssl(["genrsa", "-out", caKey, "3072"]);
    openssl(["req", "-x509", "-new", "-key", caKey, "-sha256", "-days", "3650", "-subj", "/CN=ITop Med Local CA/O=ITop Med (this computer only)", "-out", caCrt]);
    console.log(`Created a private certificate authority: ${caCrt}`);
  }
  const san = [...names.map((n) => `DNS:${n}`), ...ips.map((ip) => `IP:${ip}`)].join(",");
  if (fs.existsSync(crt) && fs.existsSync(sanFile) && fs.readFileSync(sanFile, "utf8") === san) return { key, crt, caCrt };
  const csr = path.join(CERTS, "server.csr");
  const ext = path.join(CERTS, "server.ext");
  fs.writeFileSync(ext, `basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=${san}\n`);
  openssl(["genrsa", "-out", key, "2048"]);
  openssl(["req", "-new", "-key", key, "-subj", "/CN=ITop Med local server", "-out", csr]);
  // 825 days: the longest validity Apple devices accept for TLS server certificates.
  openssl(["x509", "-req", "-in", csr, "-CA", caCrt, "-CAkey", caKey, "-CAcreateserial", "-days", "825", "-sha256", "-extfile", ext, "-out", crt]);
  fs.writeFileSync(sanFile, san);
  fs.rmSync(csr, { force: true });
  console.log(`Issued a server certificate for: ${san.replaceAll("DNS:", "").replaceAll("IP:", "")}`);
  return { key, crt, caCrt };
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: "127.0.0.1" }, () => (s.end(), resolve(true)));
    s.on("error", () => resolve(false));
  });
}

async function waitFor(port: number, what: string, seconds = 120) {
  for (let i = 0; i < seconds * 2; i++) {
    if (await portOpen(port)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${what} did not start on port ${port}`);
}

function run(cmd: string, argv: string[], env: NodeJS.ProcessEnv, label: string) {
  const child = spawn(cmd, argv, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"], shell: isWin });
  const prefix = (chunk: Buffer) => chunk.toString().split(/\r?\n/).filter(Boolean).forEach((l) => console.log(`[${label}] ${l}`));
  child.stdout?.on("data", prefix);
  child.stderr?.on("data", prefix);
  child.on("exit", (code) => {
    if (!stopping) {
      console.error(`[${label}] stopped (exit ${code}). Shutting down.`);
      void shutdown(1);
    }
  });
  children.push(child);
  return child;
}

let stopping = false;
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children.reverse()) {
    if (c.pid && isWin) {
      try {
        execFileSync("taskkill", ["/pid", String(c.pid), "/T", "/F"], { stdio: "ignore" });
      } catch {
        /* already gone */
      }
    } else c.kill("SIGINT");
  }
  process.exit(code);
}
process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));

async function main() {
  const ips = lanAddresses();
  const host = os.hostname().toLowerCase();
  const { key, crt, caCrt } = ensureCertificates(["localhost", host], ["127.0.0.1", ...ips]);
  const primary = ips[0] ?? "localhost";
  const appUrl = `https://${primary}:${PUBLIC_PORT}`;

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    LOCAL_MODE: "1",
    APP_URL: process.env.LOCAL_APP_URL ?? appUrl,
    // Email: a configured SMTP server is used as is; otherwise messages are saved in .dev-mailbox on this computer.
    EMAIL_TRANSPORT: process.env.SMTP_URL ? "smtp" : "dev-mailbox",
    SMS_TRANSPORT: "none",
  };

  if (!(await portOpen(DB_PORT))) {
    console.log("Starting the database…");
    run("npx", ["tsx", "scripts/dev-db.ts"], process.env, "db");
    await waitFor(DB_PORT, "PostgreSQL");
  }
  console.log("Applying database migrations…");
  execFileSync("npx", ["prisma", "migrate", "deploy"], { cwd: ROOT, stdio: "inherit", shell: isWin });

  if (args.includes("--build") || !fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"))) {
    console.log("Building the production app (takes a minute)…");
    execFileSync("npx", ["next", "build"], { cwd: ROOT, stdio: "inherit", env, shell: isWin });
  }

  run("npx", ["next", "start", "-H", "127.0.0.1", "-p", String(APP_PORT)], env, "app");
  run("npx", ["tsx", "--conditions=react-server", "scripts/worker.ts"], env, "worker");
  await waitFor(APP_PORT, "The app");

  // HTTPS entry point for the whole network. It overwrites X-Forwarded-For, so
  // rate limits and the audit log see the real device address.
  const server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(crt) }, (req, res) => {
    const headers = { ...req.headers, "x-forwarded-for": req.socket.remoteAddress ?? "", "x-forwarded-proto": "https", "x-forwarded-host": req.headers.host ?? "" };
    const upstream = http.request({ host: "127.0.0.1", port: APP_PORT, method: req.method, path: req.url, headers }, (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    });
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end("ITop Med is starting or stopped. Try again in a moment.");
    });
    req.pipe(upstream);
  });
  server.listen(PUBLIC_PORT, "0.0.0.0");

  console.log(`
ITop Med is running on this computer's network.

  On this computer:   https://localhost:${PUBLIC_PORT}
${ips.map((ip) => `  Other devices:      https://${ip}:${PUBLIC_PORT}`).join("\n")}
  Platform console:   ${appUrl}/admin/login
  Clinic sign-in:     ${appUrl}/login

First time on each device: install and trust the certificate
  ${caCrt}
(docs/QOLLANMA.md, section "Telefon va planshetlar"). Then open the address and choose "Install app".
Emails: ${env.EMAIL_TRANSPORT === "smtp" ? "sent through your SMTP server" : "saved as files in the .dev-mailbox folder on this computer (no SMTP configured)"}.
Press Ctrl+C to stop.
`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  void shutdown(1);
});
