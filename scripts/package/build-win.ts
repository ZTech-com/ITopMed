/**
 * `npm run package:win` - builds the packaged Windows app: ONE zip that a clinic
 * downloads (e.g. from Telegram), extracts and runs by double-clicking
 * "ITop Med.exe". Nothing else to install: the zip contains its own Node
 * runtime, PostgreSQL, the prebuilt app, migrations and the plan catalog.
 * Data is created on first start in %LOCALAPPDATA%\ITopMed (see scripts/local.ts).
 *
 * Output: dist/ITopMed-Windows.zip (and the unpacked folder dist/ITopMed).
 * Requires Windows x64 (the bundled PostgreSQL and Node are Windows x64).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { stripPrivate } from "./strip-private";
import { build } from "esbuild";

const ROOT = process.cwd();
const DIST = path.join(ROOT, "dist");
const OUT = path.join(DIST, "ITopMed");
const ZIP = path.join(DIST, "ITopMed-Windows.zip");
const step = (m: string) => console.log(`\n▸ ${m}`);
const run = (cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env) => execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit", env, shell: false });

function copy(from: string, to: string) {
  fs.cpSync(from, to, { recursive: true, dereference: true, force: true });
}

/** Copies packages and everything they depend on (installed versions) into dest/node_modules. */
function copyPackages(names: string[], dest: string) {
  const seen = new Set<string>();
  const visit = (name: string) => {
    if (seen.has(name)) return;
    const dir = path.join(ROOT, "node_modules", name);
    if (!fs.existsSync(dir)) return; // optional dependency not installed on this platform
    seen.add(name);
    copy(dir, path.join(dest, "node_modules", name));
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) visit(dep);
  };
  names.forEach(visit);
  return [...seen];
}

/**
 * Turbopack's standalone output reaches some packages through symlinks with
 * hashed names (.next-pkg/node_modules/pg-<hash> -> ../../node_modules/pg).
 * Links do not survive a zip on Windows, so each one becomes a real copy of
 * its target inside the package.
 */
function materializeLinks(srcRoot: string, destRoot: string, sub = ""): number {
  let n = 0;
  const src = path.join(srcRoot, sub);
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const rel = path.join(sub, e.name);
    const srcEntry = path.join(srcRoot, rel);
    if (fs.lstatSync(srcEntry).isSymbolicLink()) {
      const target = fs.readlinkSync(srcEntry);
      const absSrcTarget = path.isAbsolute(target) ? target : path.resolve(path.dirname(srcEntry), target);
      const inDest = path.join(destRoot, path.relative(srcRoot, absSrcTarget));
      const destEntry = path.join(destRoot, rel);
      fs.rmSync(destEntry, { recursive: true, force: true });
      fs.cpSync(fs.existsSync(inDest) ? inDest : absSrcTarget, destEntry, { recursive: true, dereference: true });
      n++;
    } else if (e.isDirectory()) {
      n += materializeLinks(srcRoot, destRoot, rel);
    }
  }
  return n;
}

const esmRequire ="import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);";

async function bundle(entry: string, outfile: string, external: string[], conditions: string[] = []) {
  await build({
    entryPoints: [path.join(ROOT, entry)],
    outfile,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    conditions,
    external,
    banner: { js: esmRequire },
    tsconfig: path.join(ROOT, "tsconfig.json"),
    logLevel: "warning",
    legalComments: "none",
  });
}

/** Windows GUI subsystem: the exe starts without a console window. */
function markGuiSubsystem(exe: string) {
  const b = fs.readFileSync(exe);
  const pe = b.readUInt32LE(0x3c);
  if (b.toString("latin1", pe, pe + 4) !== "PE\0\0") throw new Error("not a PE file");
  const subsystem = pe + 24 + 68;
  b.writeUInt16LE(2, subsystem);
  fs.writeFileSync(exe, b);
}

async function main() {
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Build the Windows package on Windows x64.");
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version as string;

  step("Building the app (standalone)…");
  fs.rmSync(path.join(ROOT, ".next-pkg"), { recursive: true, force: true });
  // next build rewrites tsconfig.json for its distDir; the project keeps its own.
  const tsconfig = fs.readFileSync(path.join(ROOT, "tsconfig.json"), "utf8");
  try {
    run(process.execPath, [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "build"], { ...process.env, ITM_STANDALONE: "1", NEXT_TELEMETRY_DISABLED: "1" });
  } finally {
    fs.writeFileSync(path.join(ROOT, "tsconfig.json"), tsconfig);
  }

  step("Assembling the program folder…");
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const app = path.join(OUT, "app");
  copy(path.join(ROOT, ".next-pkg", "standalone"), app);
  materializeLinks(path.join(ROOT, ".next-pkg", "standalone"), app);
  stripPrivate(app);
  copy(path.join(ROOT, ".next-pkg", "static"), path.join(app, ".next-pkg", "static"));
  copy(path.join(ROOT, "public"), path.join(app, "public"));
  copy(path.join(ROOT, "prisma", "migrations"), path.join(OUT, "migrations"));
  fs.mkdirSync(path.join(OUT, "runtime"), { recursive: true });
  fs.copyFileSync(process.execPath, path.join(OUT, "runtime", "node.exe"));
  fs.mkdirSync(path.join(OUT, "tools"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "scripts", "windows", "firewall.ps1"), path.join(OUT, "tools", "firewall.ps1"));

  step("Bundling the server, worker and controller…");
  // The worker runs next to the app and uses the app's own traced node_modules (Prisma, pg, argon2).
  await bundle("scripts/worker.ts", path.join(app, "worker.mjs"), ["@prisma/client", "@prisma/client/*", "@node-rs/argon2", "pg-native"], ["react-server"]);
  const rootExternal = ["embedded-postgres", "@embedded-postgres/*", "pg", "pg-native"];
  await bundle("scripts/local.ts", path.join(OUT, "launcher.mjs"), rootExternal);
  await bundle("scripts/app.ts", path.join(OUT, "app-control.mjs"), rootExternal);
  await bundle("prisma/seed.ts", path.join(OUT, "seed.mjs"), rootExternal);
  const shipped = copyPackages(["embedded-postgres", "@embedded-postgres/windows-x64", "pg"], OUT);
  console.log(`  packages: ${shipped.join(", ")}`);
  const missing = ["@prisma/client", "pg", "@node-rs/argon2"].filter((p) => !fs.existsSync(path.join(app, "node_modules", p)));
  if (missing.length) copyPackages(missing, app);

  step("Making ITop Med.exe…");
  const work = path.join(DIST, "sea");
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  fs.copyFileSync(path.join(ROOT, "scripts", "package", "sea-main.cjs"), path.join(work, "sea-main.cjs"));
  fs.writeFileSync(path.join(work, "sea-config.json"), JSON.stringify({ main: "sea-main.cjs", output: "sea.blob", disableExperimentalSEAWarning: true, useCodeCache: false }));
  execFileSync(process.execPath, ["--experimental-sea-config", "sea-config.json"], { cwd: work, stdio: "inherit" });
  const exe = path.join(OUT, "ITop Med.exe");
  fs.copyFileSync(process.execPath, exe);
  run(path.join(ROOT, "node_modules", "rcedit", "bin", "rcedit-x64.exe"), [
    exe,
    "--set-icon", path.join(ROOT, "public", "icons", "itopmed.ico"),
    "--set-version-string", "ProductName", "ITop Med",
    "--set-version-string", "FileDescription", "ITop Med",
    "--set-version-string", "CompanyName", "ITop Med",
    "--set-version-string", "OriginalFilename", "ITop Med.exe",
    "--set-version-string", "InternalName", "ITop Med",
    "--set-file-version", version,
    "--set-product-version", version,
  ]);
  run(process.execPath, [path.join(ROOT, "node_modules", "postject", "dist", "cli.js"), exe, "NODE_SEA_BLOB", path.join(work, "sea.blob"), "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"]);
  markGuiSubsystem(exe);

  fs.writeFileSync(
    path.join(OUT, "O'QING - README.txt"),
    [
      "ITop Med — klinikani boshqarish dasturi",
      "",
      "1. \"ITop Med.exe\" ni ikki marta bosing.",
      "   Windows \"Windows protected your PC\" desa: \"More info\" -> \"Run anyway\" (\"Подробнее\" -> \"Выполнить в любом случае\").",
      "2. Birinchi marta 1-2 daqiqa kuting: brauzerda ITop Med oynasi ochiladi.",
      "3. Klinika nomi, ismingiz, login va parolingizni kiriting -> \"Klinikani yaratish\".",
      "4. Windows tarmoq ruxsatini so'rasa -> \"Ha\" (telefonlar ulana olishi uchun).",
      "5. Telefonlar: kirish sahifasidagi \"Telefon yoki planshetni ulash\" -> u yerdagi manzilni telefon brauzerida oching.",
      "",
      "Ish stolida \"ITop Med\", \"ITop Med Boshqaruv\" va \"ITop Med - to'xtatish\" yorliqlari o'zi paydo bo'ladi.",
      "Ma'lumotlar: %LOCALAPPDATA%\\ITopMed (har kuni shifrlangan zaxira: backups papkasi).",
      "Yangilash: yangi papkani oching va \"ITop Med.exe\" ni bosing — ma'lumotlar saqlanib qoladi.",
      "Kerak: Windows 10 yoki 11 (64-bit). Bu papkani o'chirmang va boshqa joyga ko'chirmang.",
      "",
    ].join("\r\n"),
  );

  step("Compressing…");
  fs.rmSync(ZIP, { force: true });
  execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-a", "-c", "-f", ZIP, "-C", DIST, "ITopMed"], { stdio: "inherit" });
  const mb = (fs.statSync(ZIP).size / 1024 / 1024).toFixed(0);
  console.log(`\nReady: ${ZIP} (${mb} MB)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
