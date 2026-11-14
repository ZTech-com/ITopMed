/**
 * ITop Med as a desktop app on this computer, and the server for the clinic network.
 *
 *   npm run app                  start the server in the background (if needed) and open the app window
 *   npm run app -- --no-window   start the server only (used by autostart)
 *   npm run app -- --admin       open the control panel (SuperAdmin / network admins) instead of the clinic app
 *   npm run app:stop             stop everything cleanly (database included)
 *   npm run app:status           is it running, and the addresses for other devices
 *   npm run app:doctor           check everything and say what to fix (+ QR code for phones)
 *   npm run app:firewall         Windows: allow other devices on the clinic network (asks for administrator)
 *   npm run app:autostart [-- off]  Windows: start the server when you sign in to this computer
 *   npm run app:shortcut         put "ITop Med" and "ITop Med - to'xtatish" shortcuts on the Desktop
 *
 * The server is scripts/local.ts running hidden; its output goes to .data/logs/local.log.
 */
import "dotenv/config";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import QRCode from "qrcode";
import { lanAddresses } from "../src/server/local/lan";

const ROOT = process.cwd();
const DATA = path.join(ROOT, ".data");
const PID_FILE = path.join(DATA, "local.pid");
const STOP_FILE = path.join(DATA, "local.stop");
const LOG = path.join(DATA, "logs", "local.log");
const URL = "http://127.0.0.1:3000";
const PUBLIC_PORT = 3443;
const isWin = process.platform === "win32";
const cmd = process.argv[2] ?? "start";
const flags = process.argv.slice(3);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function get(url: string, opts: https.RequestOptions = {}): Promise<number> {
  return new Promise((resolve) => {
    const req = (url.startsWith("https") ? https : http).get(url, { timeout: 4000, ...opts }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", () => resolve(0));
    req.on("timeout", () => (req.destroy(), resolve(0)));
  });
}
const healthy = async () => (await get(`${URL}/api/health`)) === 200;

function runningPid(): number | null {
  if (!fs.existsSync(PID_FILE)) return null;
  const pid = Number(fs.readFileSync(PID_FILE, "utf8"));
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

function portOpen(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ port, host }, () => (s.end(), resolve(true)));
    s.on("error", () => resolve(false));
    s.setTimeout(2000, () => (s.destroy(), resolve(false)));
  });
}

function browser(): string | null {
  const candidates = isWin
    ? [
        path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Microsoft\\Edge\\Application\\msedge.exe"),
        path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Microsoft\\Edge\\Application\\msedge.exe"),
        path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
        path.join(process.env.LOCALAPPDATA ?? "", "Google\\Chrome\\Application\\chrome.exe"),
      ]
    : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
      : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/microsoft-edge"];
  return candidates.find((c) => c && fs.existsSync(c)) ?? null;
}

/** Opens the app in its own window (no address bar), like an installed program. */
function openWindow(page = "/") {
  const target = `${URL}${page}`;
  const b = browser();
  if (b) spawn(b, [`--app=${target}`, "--new-window"], { detached: true, stdio: "ignore" }).unref();
  else if (isWin) spawn("cmd", ["/c", "start", "", target], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  else spawn(process.platform === "darwin" ? "open" : "xdg-open", [target], { detached: true, stdio: "ignore" }).unref();
}

const FIREWALL_ASKED = path.join(DATA, "firewall.asked");
const firewallRuleOn = () => powershell("Get-NetFirewallRule -DisplayName 'ITop Med (clinic network)' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Enabled") === "True";

/**
 * Windows, when the person opens the app themselves: if phones cannot reach
 * this computer yet, ask ONCE for the firewall rule (Windows shows its own
 * "Yes/No" dialog; nothing changes without that click). Never in the
 * background (--no-window / autostart). Later: npm run app:firewall.
 */
function offerFirewall() {
  if (!isWin || fs.existsSync(FIREWALL_ASKED) || firewallRuleOn()) return;
  fs.writeFileSync(FIREWALL_ASKED, new Date().toISOString());
  console.log("Telefon va planshetlar ulana olishi uchun Windows ruxsat so'raydi — \"Ha\" ni bosing (bir marta).");
  firewall();
}

function rotateLog() {
  try {
    if (fs.statSync(LOG).size > 5 * 1024 * 1024) fs.renameSync(LOG, `${LOG}.1`);
  } catch {
    /* no log yet */
  }
}

function tail(n: number): string {
  try {
    return fs.readFileSync(LOG, "utf8").split(/\r?\n/).filter(Boolean).slice(-n).join("\n");
  } catch {
    return "";
  }
}

async function start() {
  if (!fs.existsSync(path.join(ROOT, ".env"))) {
    console.error("`.env` topilmadi. Avval: npm run setup");
    process.exit(1);
  }
  if (!(await healthy())) {
    if (!runningPid()) {
      fs.mkdirSync(path.dirname(LOG), { recursive: true });
      rotateLog();
      const out = fs.openSync(LOG, "a");
      const tsx = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
      const child = spawn(process.execPath, [tsx, "scripts/local.ts"], { cwd: ROOT, detached: true, windowsHide: true, stdio: ["ignore", out, out] });
      child.unref();
      console.log("ITop Med ishga tushmoqda… (birinchi marta yoki yangilanishdan keyin 1–3 daqiqa)");
    } else {
      console.log("ITop Med ishga tushmoqda, kuting…");
    }
    const started = Date.now();
    while (!(await healthy())) {
      const waited = Date.now() - started;
      if (waited > 8 * 60_000 || (waited > 20_000 && !runningPid())) {
        console.error(`\nITop Med ishga tushmadi. Jurnalning oxiri (${LOG}):\n\n${tail(15)}\n\nTekshirish: npm run app:doctor`);
        process.exit(1);
      }
      await sleep(1500);
    }
  }
  if (!flags.includes("--no-window")) {
    openWindow(flags.includes("--admin") ? "/admin" : "/");
    offerFirewall();
  }
  console.log(`ITop Med ochildi: ${URL}${flags.includes("--admin") ? "/admin" : ""}`);
  const ips = lanAddresses();
  if (ips.length) console.log(`Telefon va planshetlar: http://${ips[0]}:${PUBLIC_PORT}/connect`);
}

/** Shuts PostgreSQL down cleanly if it is still running (no stale lock, no crash recovery on the next start). */
function stopDatabase() {
  const dataDir = process.env.DEV_PG_DIR ?? path.join(os.homedir(), ".itopmed-dev", "pg");
  const pgCtl = path.join(ROOT, "node_modules", "@embedded-postgres", `${isWin ? "windows" : process.platform}-${process.arch}`, "native", "bin", isWin ? "pg_ctl.exe" : "pg_ctl");
  if (!fs.existsSync(pgCtl) || !fs.existsSync(path.join(dataDir, "postmaster.pid"))) return;
  try {
    execFileSync(pgCtl, ["stop", "-D", dataDir, "-m", "fast", "-w", "-t", "30"], { stdio: "ignore", windowsHide: true });
  } catch {
    /* already stopped */
  }
}

async function stop() {
  const pid = runningPid();
  if (pid) {
    // Ask the server to stop itself: it stops the app and worker, then PostgreSQL cleanly.
    fs.writeFileSync(STOP_FILE, "stop");
    for (let i = 0; i < 60 && runningPid(); i++) await sleep(500);
    if (runningPid()) {
      stopDatabase();
      if (isWin) {
        try {
          execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        } catch {
          /* already gone */
        }
      } else process.kill(pid, "SIGTERM");
    }
  }
  // The database may also have been started separately (npm run db:start); it is stopped either way.
  stopDatabase();
  fs.rmSync(PID_FILE, { force: true });
  fs.rmSync(STOP_FILE, { force: true });
  console.log(pid ? "ITop Med to'xtatildi." : "ITop Med ishlamayapti.");
}

async function status() {
  const ok = await healthy();
  console.log(ok ? `ITop Med ishlayapti: ${URL}` : runningPid() ? "ITop Med ishga tushmoqda…" : "ITop Med ishlamayapti (ishga tushirish: npm run app)");
  for (const ip of lanAddresses()) console.log(`  Boshqa qurilmalar: https://${ip}:${PUBLIC_PORT}   (birinchi marta: http://${ip}:${PUBLIC_PORT}/connect)`);
}

function powershell(script: string): string {
  try {
    return execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true }).trim();
  } catch {
    return "";
  }
}

async function doctor() {
  const lines: string[] = [];
  const check = (ok: boolean, good: string, bad: string) => lines.push(`${ok ? "  ✓" : "  ✗"} ${ok ? good : bad}`);
  check(fs.existsSync(path.join(ROOT, ".env")), ".env bor", ".env yo'q → npm run setup");
  check(fs.existsSync(path.join(ROOT, ".next", "BUILD_ID")), "Tezkor (production) versiya yig'ilgan", "Production versiya yo'q → npm run app (o'zi yig'adi)");
  const pid = runningPid();
  check(Boolean(pid), `Server ishlayapti (PID ${pid})`, "Server ishlamayapti → npm run app");
  check(await portOpen(Number(process.env.DEV_PG_PORT ?? 54329)), "Ma'lumotlar bazasi ishlayapti", "Ma'lumotlar bazasi ishlamayapti → npm run app (o'zi ishga tushiradi)");
  check(await healthy(), `Shu kompyuterda ochiladi: ${URL}`, `${URL} javob bermayapti → jurnal: ${LOG}`);
  const ips = lanAddresses();
  check(ips.length > 0, `Tarmoq manzili: ${ips.join(", ")}`, "Kompyuter hech qaysi Wi-Fi/tarmoqqa ulanmagan");
  const caFile = path.join(DATA, "certs", "itopmed-local-ca.crt");
  const ca = fs.existsSync(caFile) ? fs.readFileSync(caFile) : undefined;
  const san = fs.existsSync(path.join(DATA, "certs", "server.san")) ? fs.readFileSync(path.join(DATA, "certs", "server.san"), "utf8") : "";
  for (const ip of ips) {
    check(san.includes(`IP:${ip}`), `Sertifikat ${ip} uchun chiqarilgan`, `Sertifikatda ${ip} yo'q → server 20 soniyada o'zi yangilaydi (yoki npm run app:stop, npm run app)`);
    const code = await get(`https://${ip}:${PUBLIC_PORT}/api/health`, { ca });
    check(code === 200, `https://${ip}:${PUBLIC_PORT} tarmoqda ishlayapti`, `https://${ip}:${PUBLIC_PORT} ochilmayapti (${code || "ulanib bo'lmadi"})`);
  }
  check(await portOpen(80), "80-port ochiq: telefonda shunchaki IP manzilni yozish yetadi", `80-port band — telefonda manzilni :${PUBLIC_PORT} bilan yozing`);
  if (isWin) {
    const node = process.execPath.replaceAll("'", "''");
    const profile = powershell("(Get-NetConnectionProfile | Select-Object -First 1 -ExpandProperty NetworkCategory)");
    const blocked = powershell(
      `Get-NetFirewallApplicationFilter | Where-Object { $_.Program -ieq '${node}' } | Get-NetFirewallRule | Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Block' -and $_.Enabled -eq 'True' } | ForEach-Object { $_.Profile.ToString() }`,
    );
    const ours = powershell("Get-NetFirewallRule -DisplayName 'ITop Med (clinic network)' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Enabled");
    const blocksNow = Boolean(blocked) && (blocked.includes("Any") || (profile && blocked.includes(profile)));
    if (profile) lines.push(`  · Windows tarmoq turi: ${profile === "Public" ? "Public (umumiy)" : profile === "Private" ? "Private (shaxsiy)" : profile}`);
    check(!blocked, "Windows Firewall Node.js ni bloklamaydi", `Windows Firewall Node.js ni bloklaydi (${blocked.replaceAll("\n", ", ")})${blocksNow ? " — HOZIR telefonlar ulana olmaydi" : ""} → npm run app:firewall`);
    check(ours === "True", "ITop Med uchun Firewall ruxsati bor", "ITop Med uchun Firewall ruxsati yo'q → npm run app:firewall (bir marta, administrator ruxsati so'raladi)");
  }
  console.log(`\nITop Med tekshiruvi\n\n${lines.join("\n")}\n`);
  if (ips[0]) {
    const url = `http://${ips[0]}:${PUBLIC_PORT}/connect`;
    console.log(`Telefon kamerasi bilan skanerlang (shu Wi-Fi'da bo'lsin):  ${url}\n`);
    console.log(await QRCode.toString(url, { type: "terminal", small: true }));
  }
  if (lines.some((l) => l.startsWith("  ✗"))) process.exitCode = 1;
}

/** Windows: one-time firewall rule for the clinic network (asks for administrator rights via UAC). */
function firewall() {
  if (!isWin) {
    console.log("Faqat Windows uchun.");
    return;
  }
  const ps1 = path.join(ROOT, "scripts", "windows", "firewall.ps1");
  const q = (s: string) => s.replaceAll("'", "''");
  console.log("Windows administrator ruxsatini so'raydi — \"Ha\" ni bosing.");
  powershell(`Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','"${q(ps1)}"','-Node','"${q(process.execPath)}"'`);
  const ours = powershell("Get-NetFirewallRule -DisplayName 'ITop Med (clinic network)' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Enabled");
  console.log(ours === "True" ? "Tayyor: shu tarmoqdagi telefon va kompyuterlar ITop Med'ga ulana oladi." : "Firewall qoidasi qo'shilmadi (ruxsat berilmadi?). Qayta urinib ko'ring.");
}

function shortcutPs(file: string, target: string, args = "") {
  const ico = path.join(ROOT, "public", "icons", "itopmed.ico");
  const q = (s: string) => `'${s.replaceAll("'", "''")}'`;
  return `$s=(New-Object -ComObject WScript.Shell).CreateShortcut(${q(file)}); $s.TargetPath=${q(target)}; $s.Arguments=${q(args)}; $s.WorkingDirectory=${q(ROOT)}; $s.WindowStyle=7; $s.IconLocation=${q(`${ico},0`)}; $s.Save()`;
}

/** Windows: start the server (no window) when the user signs in, so phones can always connect. */
function autostart() {
  if (!isWin) {
    console.log("Faqat Windows uchun.");
    return;
  }
  const startup = path.join(process.env.APPDATA ?? "", "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
  const file = path.join(startup, "ITop Med server.lnk");
  if (flags.includes("off")) {
    fs.rmSync(file, { force: true });
    console.log("Avtomatik ishga tushirish o'chirildi.");
    return;
  }
  execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", shortcutPs(file, path.join(ROOT, "scripts", "windows", "start-itopmed-server.cmd"))], { stdio: "inherit", windowsHide: true });
  console.log("Tayyor: kompyuterga kirganingizda ITop Med server o'zi (oynasiz) ishga tushadi. O'chirish: npm run app:autostart -- off");
}

/** Windows: Desktop shortcuts with the ITop Med icon. */
function shortcut() {
  if (!isWin) {
    console.log("Shortcuts are created on Windows only. Elsewhere run: npm run app");
    return;
  }
  const desktop = powershell("[Environment]::GetFolderPath('Desktop')");
  const make = (name: string, script: string) =>
    execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", shortcutPs(path.join(desktop, `${name}.lnk`), path.join(ROOT, "scripts", "windows", script))], { stdio: "inherit", windowsHide: true });
  make("ITop Med", "start-itopmed.cmd");
  make("ITop Med Boshqaruv", "start-itopmed-admin.cmd");
  make("ITop Med - to'xtatish", "stop-itopmed.cmd");
  console.log(`Ish stolida "ITop Med", "ITop Med Boshqaruv" va "ITop Med - to'xtatish" yorliqlari yaratildi (${os.hostname()}).`);
}

const commands: Record<string, () => unknown> = { start, stop, status, doctor, firewall, autostart, shortcut };
Promise.resolve((commands[cmd] ?? start)()).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
