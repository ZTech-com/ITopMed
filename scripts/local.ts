/**
 * `npm run local` — runs ITop Med on ONE computer for the whole clinic network.
 * `npm run app` starts this same server hidden in the background.
 *
 *   this computer ──http://127.0.0.1:3000──┐
 *   phones, tablets, other PCs             ├─► proxy (this script) ─► next start on 127.0.0.1:3100
 *     ──https://<this-pc-ip>:3443──────────┤        (production build)
 *     ──http://<this-pc-ip>[:80|:3443]─────┘  → "connect this device" page or redirect to HTTPS
 *   + embedded PostgreSQL + notification worker
 *
 * It is a supervisor: the database, the app and the worker are restarted
 * automatically if they stop, the app is restarted if it stops answering, and
 * the certificate follows the computer's IP address while running. Children
 * are started with `node` directly (no cmd.exe/npx), so closing a terminal
 * window never stops the server.
 *
 * HTTPS is required on other devices: session cookies are `Secure` in
 * production and phones only install the app from a secure origin. The
 * certificate comes from a private certificate authority created here on the
 * first run (.data/certs, never committed); each device trusts it once via the
 * /connect page. The CA private key never leaves this computer.
 *
 * Options: --build (force a fresh production build), --port 3443.
 */
import "dotenv/config";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import pg from "pg";
import { startEmbeddedDb } from "./lib/embedded-db";
import { lanAddresses } from "../src/server/local/lan";

const ROOT = process.cwd();
const DATA = path.join(ROOT, ".data");
const CERTS = path.join(DATA, "certs");
const args = process.argv.slice(2);
const PUBLIC_PORT = Number(args[args.indexOf("--port") + 1] || 0) || 3443;
const LOOPBACK_PORT = 3000; // what the desktop window and this computer's browser open
const APP_PORT = 3100; // next start, internal only
const DB_PORT = Number(process.env.DEV_PG_PORT ?? 54329);
const PID_FILE = path.join(DATA, "local.pid");
const STOP_FILE = path.join(DATA, "local.stop");
const STATUS_FILE = path.join(DATA, "local.status.json");
const NODE = process.execPath;
const bin = {
  next: path.join(ROOT, "node_modules", "next", "dist", "bin", "next"),
  prisma: path.join(ROOT, "node_modules", "prisma", "build", "index.js"),
  tsx: path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"),
};
const isWin = process.platform === "win32";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (msg: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

/* ---------------------------------------------------------------- certificates */

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
  execFileSync(opensslBin, argv, { stdio: "pipe", env: { ...process.env, MSYS2_ARG_CONV_EXCL: "*" }, windowsHide: true });
}

/** Private CA (once, 10 years) + server certificate for localhost and every LAN address (re-issued when they change). */
function ensureCertificates(ips: string[]) {
  fs.mkdirSync(CERTS, { recursive: true });
  const caKey = path.join(CERTS, "itopmed-local-ca.key");
  const caCrt = path.join(CERTS, "itopmed-local-ca.crt");
  const key = path.join(CERTS, "server.key");
  const crt = path.join(CERTS, "server.crt");
  const sanFile = path.join(CERTS, "server.san");
  if (!fs.existsSync(caKey) || !fs.existsSync(caCrt)) {
    openssl(["genrsa", "-out", caKey, "3072"]);
    openssl(["req", "-x509", "-new", "-key", caKey, "-sha256", "-days", "3650", "-subj", "/CN=ITop Med Local CA/O=ITop Med (this computer only)", "-out", caCrt]);
    log(`Created a private certificate authority: ${caCrt}`);
  }
  const names = ["localhost", os.hostname().toLowerCase(), `${os.hostname().toLowerCase()}.local`];
  const san = [...names.map((n) => `DNS:${n}`), ...["127.0.0.1", ...ips].map((ip) => `IP:${ip}`)].join(",");
  const valid = () => {
    try {
      return new Date(new crypto.X509Certificate(fs.readFileSync(crt)).validTo).getTime() > Date.now() + 30 * 86400_000;
    } catch {
      return false;
    }
  };
  if (fs.existsSync(crt) && fs.existsSync(sanFile) && fs.readFileSync(sanFile, "utf8") === san && valid()) return { key, crt, caCrt };
  const csr = path.join(CERTS, "server.csr");
  const ext = path.join(CERTS, "server.ext");
  fs.writeFileSync(ext, `basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=${san}\n`);
  openssl(["genrsa", "-out", key, "2048"]);
  openssl(["req", "-new", "-key", key, "-subj", "/CN=ITop Med local server", "-out", csr]);
  // 825 days: the longest validity Apple devices accept for TLS server certificates.
  openssl(["x509", "-req", "-in", csr, "-CA", caCrt, "-CAkey", caKey, "-CAcreateserial", "-days", "825", "-sha256", "-extfile", ext, "-out", crt]);
  fs.writeFileSync(sanFile, san);
  fs.rmSync(csr, { force: true });
  log(`Issued a server certificate for: ${san.replaceAll("DNS:", "").replaceAll("IP:", "")}`);
  return { key, crt, caCrt };
}

/* ---------------------------------------------------------------- build */

/** True when there is no production build, or the code changed since it was made (e.g. after `git pull`). */
function buildIsStale(): boolean {
  const stamp = path.join(ROOT, ".next", "BUILD_ID");
  if (!fs.existsSync(stamp)) return true;
  const built = fs.statSync(stamp).mtimeMs;
  const newer = (p: string): boolean => {
    if (!fs.existsSync(p)) return false;
    const st = fs.statSync(p);
    if (!st.isDirectory()) return st.mtimeMs > built;
    return fs.readdirSync(p).some((n) => newer(path.join(p, n)));
  };
  return ["src", "messages", "public", "prisma/schema.prisma", "package.json", "next.config.ts"].some((p) => newer(path.join(ROOT, p)));
}

/** Runs a node script to completion, with its output in this log. */
function runOnce(label: string, argv: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const c = spawn(NODE, argv, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const out = (b: Buffer) => b.toString().split(/\r?\n/).filter(Boolean).forEach((l) => console.log(`[${label}] ${l}`));
    c.stdout.on("data", out);
    c.stderr.on("data", out);
    c.on("error", reject);
    c.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${label} failed (exit ${code})`))));
  });
}

async function retry<T>(what: string, fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts) throw e;
      log(`${what} failed (${e instanceof Error ? e.message.split("\n")[0] : e}); retrying (${i}/${attempts - 1})…`);
      await sleep(1500 * i);
    }
  }
}

/* ---------------------------------------------------------------- database */

let db: { stop: () => Promise<void> } | null = null;

function portOpen(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ port, host }, () => (s.end(), resolve(true)));
    s.on("error", () => resolve(false));
    s.setTimeout(2000, () => (s.destroy(), resolve(false)));
  });
}

/** True only when PostgreSQL really answers a query (an open port alone can still be "starting up"). */
async function databaseAnswers(): Promise<boolean> {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) return portOpen(DB_PORT);
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3000 });
  try {
    await c.connect();
    await c.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await c.end().catch(() => undefined);
  }
}

const PG_DIR = process.env.DEV_PG_DIR ?? path.join(os.homedir(), ".itopmed-dev", "pg");

/**
 * After a crash or power cut, PostgreSQL helper processes can survive their
 * main process and keep the port open without answering. Stop the ones that
 * belong to OUR data directory so the database can start again.
 */
function killOrphanPostgres() {
  try {
    if (isWin) {
      // Only postgres.exe processes tied to OUR database port: its owner, or children that inherited the
      // listening socket from a dead owner (never the test database or anything else).
      execFileSync(
        "powershell",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `$own = @(Get-NetTCPConnection -LocalPort ${DB_PORT} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique); Get-CimInstance Win32_Process -Filter "Name='postgres.exe'" | Where-Object { $own -contains $_.ProcessId -or $own -contains $_.ParentProcessId } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
        ],
        { stdio: "ignore", windowsHide: true },
      );
    } else {
      execFileSync("pkill", ["-9", "-f", `postgres.*${PG_DIR}`], { stdio: "ignore" });
    }
  } catch {
    /* nothing to stop */
  }
}

async function ensureDatabase(graceSeconds = 15) {
  if (await databaseAnswers()) return;
  const required = (k: string) => {
    const v = process.env[k];
    if (!v) throw new Error(`Missing ${k} in .env (run: npm run setup)`);
    return v;
  };
  if (await portOpen(DB_PORT)) {
    // Something holds the port but does not answer: give a starting/recovering server 15 s, then clear leftovers.
    for (let i = 0; i < graceSeconds; i++) {
      if (await databaseAnswers()) return;
      await sleep(1000);
    }
    log("The database port is held by a process that does not answer; clearing leftover database processes…");
    killOrphanPostgres();
    await sleep(1500);
  }
  if (!(await portOpen(DB_PORT))) {
    log("Starting the database…");
    const started = await startEmbeddedDb({
      dataDir: PG_DIR,
      port: DB_PORT,
      superuserPassword: required("DEV_PG_SUPERUSER_PASSWORD"),
      ownerPassword: required("DEV_PG_OWNER_PASSWORD"),
      appPassword: required("DEV_PG_APP_PASSWORD"),
      platformPassword: required("DEV_PG_PLATFORM_PASSWORD"),
      portalPassword: required("DEV_PG_PORTAL_PASSWORD"),
      postgresFlags: ["-c", "io_method=sync"],
    });
    db = started;
  }
  for (let i = 0; i < 60; i++) {
    if (await databaseAnswers()) return;
    await sleep(1000);
  }
  throw new Error("The database does not answer");
}

/* ---------------------------------------------------------------- supervised processes */

interface Supervised {
  name: string;
  argv: string[];
  child?: ChildProcess;
  restarts: number[];
}
const supervised: Supervised[] = [];
let stopping = false;

function startSupervised(s: Supervised, env: NodeJS.ProcessEnv) {
  const c = spawn(NODE, s.argv, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  s.child = c;
  const out = (b: Buffer) => b.toString().split(/\r?\n/).filter(Boolean).forEach((l) => console.log(`[${s.name}] ${l}`));
  c.stdout?.on("data", out);
  c.stderr?.on("data", out);
  c.on("exit", (code) => {
    if (stopping || s.child !== c) return;
    const now = Date.now();
    s.restarts = s.restarts.filter((t) => now - t < 5 * 60_000).concat(now);
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(s.restarts.length - 1, 5));
    log(`${s.name} stopped (exit ${code}); restarting in ${Math.round(delay / 1000)} s`);
    setTimeout(() => !stopping && startSupervised(s, env), delay);
  });
}

function killTree(c?: ChildProcess) {
  if (!c?.pid || c.exitCode !== null) return;
  if (isWin) {
    try {
      execFileSync("taskkill", ["/pid", String(c.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } catch {
      /* already gone */
    }
  } else c.kill("SIGTERM");
}

async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  log("Stopping ITop Med…");
  for (const s of supervised) killTree(s.child);
  if (db) {
    // pg_ctl lets PostgreSQL finish cleanly (on Windows the library's stop() terminates it hard,
    // which leaves postmaster.pid behind and means crash recovery on the next start).
    const pgCtl = path.join(ROOT, "node_modules", "@embedded-postgres", `${isWin ? "windows" : process.platform}-${process.arch}`, "native", "bin", isWin ? "pg_ctl.exe" : "pg_ctl");
    try {
      execFileSync(pgCtl, ["stop", "-D", PG_DIR, "-m", "fast", "-w", "-t", "30"], { stdio: "ignore", windowsHide: true });
    } catch {
      await db.stop().catch(() => undefined);
    }
  }
  fs.rmSync(PID_FILE, { force: true });
  fs.rmSync(STOP_FILE, { force: true });
  fs.rmSync(STATUS_FILE, { force: true });
  log("Stopped.");
  process.exit(code);
}
process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));
process.on("SIGHUP", () => void shutdown(0));

/* ---------------------------------------------------------------- proxy */

const agent = new http.Agent({ keepAlive: true, maxSockets: 256 });

function forward(req: http.IncomingMessage, res: http.ServerResponse, proto: "http" | "https") {
  const headers = { ...req.headers, "x-forwarded-for": req.socket.remoteAddress ?? "", "x-forwarded-proto": proto, "x-forwarded-host": req.headers.host ?? "" };
  const upstream = http.request({ host: "127.0.0.1", port: APP_PORT, method: req.method, path: req.url, headers, agent }, (up) => {
    res.writeHead(up.statusCode ?? 502, up.headers);
    up.pipe(res);
  });
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(503, { "content-type": "text/html; charset=utf-8", "retry-after": "5", "cache-control": "no-store" });
    res.end(STARTING_PAGE);
  });
  req.pipe(upstream);
}

const STARTING_PAGE = `<!doctype html><html lang="uz"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="4"><title>ITop Med</title>
<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;background:#f5f5f7;color:#1d1d1f"><div style="text-align:center;padding:24px">
<div style="width:56px;height:56px;border-radius:16px;background:linear-gradient(135deg,#2d8cff,#0a5bc4);color:#fff;font-size:32px;display:grid;place-items:center;margin:0 auto 16px">+</div>
<h1 style="font-size:20px;margin:0 0 8px">ITop Med ishga tushmoqda…</h1><p style="margin:0;color:#5b5b61">ITop Med is starting · ITop Med запускается</p></div></body></html>`;

/** Plain HTTP from another device: the connect page (to trust the certificate) works over HTTP, everything else goes to HTTPS. */
function plainHttp(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = req.url ?? "/";
  if (/^\/(connect(\/|$|\?)|_next\/static\/|icons\/|favicon|manifest\.webmanifest)/.test(url)) return forward(req, res, "http");
  const host = (req.headers.host ?? "").replace(/:\d+$/, "") || lanAddresses()[0] || "localhost";
  const target = url === "/" ? `http://${host}:${PUBLIC_PORT}/connect` : `https://${host}:${PUBLIC_PORT}${url}`;
  res.writeHead(302, { location: target, "cache-control": "no-store" });
  res.end();
}

/* ---------------------------------------------------------------- main */

async function main() {
  fs.mkdirSync(path.join(DATA, "logs"), { recursive: true });
  fs.writeFileSync(PID_FILE, String(process.pid));
  fs.rmSync(STOP_FILE, { force: true });
  // `npm run app:stop` asks for a clean stop by creating this file (taskkill /F could not let PostgreSQL shut down).
  setInterval(() => fs.existsSync(STOP_FILE) && void shutdown(0), 1000).unref();

  let ips = lanAddresses();
  let certs = ensureCertificates(ips);
  const primary = ips[0] ?? "localhost";
  const appUrl = `https://${primary}:${PUBLIC_PORT}`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    LOCAL_MODE: "1",
    LOCAL_PUBLIC_PORT: String(PUBLIC_PORT),
    APP_URL: process.env.LOCAL_APP_URL ?? appUrl,
    // Email: a configured SMTP server is used as is; otherwise messages are saved in .dev-mailbox on this computer.
    EMAIL_TRANSPORT: process.env.SMTP_URL ? "smtp" : "dev-mailbox",
    SMS_TRANSPORT: "none",
    NEXT_TELEMETRY_DISABLED: "1",
  };

  // Show "starting…" on every entry point at once, before the slow steps.
  const loopback = http.createServer((req, res) => forward(req, res, "http"));
  loopback.keepAliveTimeout = 65_000;
  await new Promise<void>((resolve, reject) => {
    loopback.once("error", reject);
    loopback.listen(LOOPBACK_PORT, "127.0.0.1", () => resolve());
  }).catch((e: NodeJS.ErrnoException) => {
    throw new Error(e.code === "EADDRINUSE" ? `Port ${LOOPBACK_PORT} is already in use (is "npm run dev" or another ITop Med running?). Stop it and start again.` : e.message);
  });

  const secure = https.createServer({ key: fs.readFileSync(certs.key), cert: fs.readFileSync(certs.crt) }, (req, res) => forward(req, res, "https"));
  secure.keepAliveTimeout = 65_000;
  const plain = http.createServer(plainHttp);
  // One port for both: a TLS handshake starts with byte 0x16; anything else is plain HTTP (someone typed http://).
  const lan = net.createServer((socket) => {
    socket.on("error", () => undefined);
    socket.once("data", (first) => {
      socket.pause();
      socket.unshift(first);
      (first[0] === 0x16 ? secure : plain).emit("connection", socket);
      process.nextTick(() => socket.resume());
    });
  });
  lan.listen(PUBLIC_PORT, "0.0.0.0");
  // http://<ip> without a port number, when port 80 is free (best effort).
  const port80 = http.createServer(plainHttp);
  port80.on("error", () => log("Port 80 is not available; other devices use the address with :3443."));
  port80.listen(80, "0.0.0.0");

  await retry("Database start", ensureDatabase, 4);
  log("Applying database migrations…");
  await retry("Migrations", () => runOnce("migrate", [bin.prisma, "migrate", "deploy"], process.env), 4);

  if (args.includes("--build") || buildIsStale()) {
    log("Building the production app (1–3 minutes)…");
    await runOnce("build", [bin.next, "build"], env);
  }

  const app: Supervised = { name: "app", argv: [bin.next, "start", "-H", "127.0.0.1", "-p", String(APP_PORT)], restarts: [] };
  const worker: Supervised = { name: "worker", argv: [bin.tsx, "--conditions=react-server", "scripts/worker.ts"], restarts: [] };
  supervised.push(app, worker);
  startSupervised(app, env);
  startSupervised(worker, env);
  for (let i = 0; i < 240 && !(await portOpen(APP_PORT)); i++) await sleep(500);

  // Watchdog: database down → start it again; app not answering for ~1 minute → restart it; IP changed → new certificate.
  let silent = 0;
  let dbSilent = 0;
  let busy = false;
  setInterval(async () => {
    if (stopping || busy) return;
    busy = true;
    try {
      await watchdog();
    } finally {
      busy = false;
    }
  }, 10_000).unref();

  async function watchdog() {
    dbSilent = (await databaseAnswers()) ? 0 : dbSilent + 1;
    if (dbSilent >= 2) {
      log("The database does not answer; starting it again…");
      dbSilent = 0;
      db = null;
      await ensureDatabase(2).catch((e) => log(`Database restart failed: ${e instanceof Error ? e.message : e}`));
    }
    const answered = await new Promise<boolean>((resolve) => {
      const r = http.get({ host: "127.0.0.1", port: APP_PORT, path: "/api/health", timeout: 10_000, agent }, (res) => (res.resume(), resolve(true)));
      r.on("error", () => resolve(false));
      r.on("timeout", () => (r.destroy(), resolve(false)));
    });
    silent = answered ? 0 : silent + 1;
    if (silent >= 3 && app.child) {
      log("The app does not answer; restarting it");
      silent = 0;
      killTree(app.child); // the exit handler starts it again
    }
    // A short Wi-Fi drop (no address for a moment) keeps the current certificate; a new address gets a new one.
    const now = lanAddresses();
    if (now.length && now.join() !== ips.join()) {
      ips = now;
      certs = ensureCertificates(ips);
      secure.setSecureContext({ key: fs.readFileSync(certs.key), cert: fs.readFileSync(certs.crt) } as tls.SecureContextOptions);
      log(`Network changed: ${ips.map((ip) => `https://${ip}:${PUBLIC_PORT}`).join("  ")}`);
      writeStatus(ips);
    }
  }

  writeStatus(ips);
  console.log(`
ITop Med is running.

  On this computer:   http://127.0.0.1:${LOOPBACK_PORT}
${ips.map((ip) => `  Other devices:      https://${ip}:${PUBLIC_PORT}     (first time: http://${ip}:${PUBLIC_PORT}/connect)`).join("\n") || "  Other devices:      no network connection"}

Emails: ${env.EMAIL_TRANSPORT === "smtp" ? "sent through your SMTP server" : "saved as files in the .dev-mailbox folder on this computer (no SMTP configured)"}.
Stop: npm run app:stop (or Ctrl+C here).
`);
}

function writeStatus(ips: string[]) {
  fs.writeFileSync(STATUS_FILE, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), loopback: `http://127.0.0.1:${LOOPBACK_PORT}`, lan: ips.map((ip) => `https://${ip}:${PUBLIC_PORT}`), connect: ips.map((ip) => `http://${ip}:${PUBLIC_PORT}/connect`) }, null, 2));
}


main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  void shutdown(1);
});
