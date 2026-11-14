/**
 * ITop Med as a desktop app on this computer.
 *
 *   npm run app            start everything in the background (if not running) and open the app window
 *   npm run app:stop       stop the background server
 *   npm run app:shortcut   put "ITop Med" and "ITop Med — stop" shortcuts on the Desktop
 *
 * The server is `scripts/local.ts` (database, production build, worker, HTTPS
 * for other devices) running hidden; its output goes to .data/logs/local.log.
 * On this computer the window opens http://127.0.0.1:3000 — loopback is a secure
 * context, so no certificate is needed here (other devices use HTTPS, see QOLLANMA).
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const DATA = path.join(ROOT, ".data");
const PID_FILE = path.join(DATA, "local.pid");
const LOG = path.join(DATA, "logs", "local.log");
const URL = "http://127.0.0.1:3000";
const isWin = process.platform === "win32";
const cmd = process.argv[2] ?? "start";

function healthy(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`${URL}/api/health`, { timeout: 3000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => (req.destroy(), resolve(false)));
  });
}

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
function openWindow() {
  const b = browser();
  if (b) spawn(b, [`--app=${URL}/`, "--new-window"], { detached: true, stdio: "ignore" }).unref();
  else if (isWin) spawn("cmd", ["/c", "start", "", `${URL}/`], { detached: true, stdio: "ignore" }).unref();
  else spawn(process.platform === "darwin" ? "open" : "xdg-open", [`${URL}/`], { detached: true, stdio: "ignore" }).unref();
}

async function start() {
  if (!(await healthy())) {
    if (!runningPid()) {
      fs.mkdirSync(path.dirname(LOG), { recursive: true });
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
      // The server writes its PID within a few seconds; if it is gone, it failed (see the log).
      if (waited > 6 * 60_000 || (waited > 20_000 && !runningPid())) {
        console.error(`ITop Med ishga tushmadi. Sababini jurnalda ko'ring: ${LOG}`);
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  openWindow();
  console.log(`ITop Med ochildi: ${URL}`);
}

function stop() {
  const pid = runningPid();
  if (!pid) {
    console.log("ITop Med ishlamayapti.");
    return;
  }
  if (isWin) execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
  else process.kill(-pid, "SIGINT");
  fs.rmSync(PID_FILE, { force: true });
  console.log("ITop Med to'xtatildi.");
}

/** Windows: Desktop shortcuts with the ITop Med icon. */
function shortcut() {
  if (!isWin) {
    console.log("Shortcuts are created on Windows only. Elsewhere run: npm run app");
    return;
  }
  const ico = path.join(ROOT, "public", "icons", "itopmed.ico");
  // PowerShell single-quoted strings escape ' as ''.
  const q = (s: string) => `'${s.replaceAll("'", "''")}'`;
  const make = (name: string, script: string) => {
    const ps = `$d=[Environment]::GetFolderPath('Desktop'); $s=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $d ${q(`${name}.lnk`)})); $s.TargetPath=${q(path.join(ROOT, "scripts", "windows", script))}; $s.WorkingDirectory=${q(ROOT)}; $s.WindowStyle=7; $s.IconLocation=${q(`${ico},0`)}; $s.Save()`;
    execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { stdio: "inherit" });
  };
  make("ITop Med", "start-itopmed.cmd");
  make("ITop Med - to'xtatish", "stop-itopmed.cmd");
  console.log(`Ish stolida "ITop Med" va "ITop Med - to'xtatish" yorliqlari yaratildi (${os.hostname()}).`);
}

if (cmd === "stop") stop();
else if (cmd === "shortcut") shortcut();
else void start();
