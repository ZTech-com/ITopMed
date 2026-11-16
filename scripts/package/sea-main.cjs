/*
 * "ITop Med.exe" - the entry of the packaged Windows app (Node single executable).
 * Built-in modules only. It sets where the program and its data live, makes the
 * Desktop / Start menu shortcuts on first use, and hands over to the bundled
 * controller (app-control.mjs) running on the bundled Node runtime.
 *
 *   ITop Med.exe            open ITop Med (starts the server if needed)
 *   ITop Med.exe --admin    open the control panel (ITop Med Boshqaruv)
 *   ITop Med.exe --stop     stop the server
 */
/* eslint-disable @typescript-eslint/no-require-imports -- a Node single executable's main script must be CommonJS */
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const exe = process.execPath;
const root = path.dirname(exe);
const home = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "ITopMed");
const node = path.join(root, "runtime", "node.exe");
const args = process.argv.slice(1).filter((a) => a.startsWith("--"));
const cmd = args.includes("--stop") ? "stop" : "start";

fs.mkdirSync(home, { recursive: true });

/** Desktop + Start menu shortcuts that point at THIS exe (re-made when the program folder moves). */
function ensureShortcuts() {
  const marker = path.join(home, "shortcuts.path");
  try {
    if (fs.readFileSync(marker, "utf8") === exe) return;
  } catch {
    /* first use */
  }
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const items = [
    ["ITop Med", ""],
    ["ITop Med Boshqaruv", "--admin"],
    ["ITop Med - to'xtatish", "--stop"],
  ];
  const lines = ["$w = New-Object -ComObject WScript.Shell", "$d = [Environment]::GetFolderPath('Desktop')", "$m = Join-Path ([Environment]::GetFolderPath('Programs')) 'ITop Med'", "New-Item -ItemType Directory -Force -Path $m | Out-Null"];
  for (const [name, arg] of items) {
    for (const dir of ["$d", "$m"]) {
      lines.push(`$s = $w.CreateShortcut((Join-Path ${dir} ${q(name + ".lnk")})); $s.TargetPath = ${q(exe)}; $s.Arguments = ${q(arg)}; $s.WorkingDirectory = ${q(root)}; $s.IconLocation = ${q(exe + ",0")}; $s.Save()`);
    }
  }
  try {
    execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", lines.join("; ")], { stdio: "ignore", windowsHide: true });
    fs.writeFileSync(marker, exe);
  } catch {
    /* shortcuts are a convenience; the exe still works */
  }
}

if (cmd === "start") ensureShortcuts();

const child = spawn(node, [path.join(root, "app-control.mjs"), cmd, ...(args.includes("--admin") ? ["--admin"] : [])], {
  cwd: root,
  // A detached console process on Windows shows a terminal window (windowsHide is ignored);
  // without detaching it is hidden and still outlives this exe.
  detached: process.platform !== "win32",
  windowsHide: true,
  stdio: "ignore",
  env: { ...process.env, ITM_PACKAGED: "1", ITM_ROOT: root, ITM_HOME: home },
});
child.unref();
