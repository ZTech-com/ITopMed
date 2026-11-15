/**
 * `npm run package:linux` - release for a Linux server (systemd + Nginx), built
 * on this computer so the server never runs a memory-hungry build next to other
 * projects. Output: dist/itopmed-linux.tar.gz containing app/ (Next standalone
 * server, static files, worker.mjs, tasks.mjs, admin.mjs, migrations/).
 * Platform-specific packages (PostgreSQL binaries, argon2 for Linux) are
 * installed on the server next to app/ by scripts/deploy/server-install.sh.
 * See docs/DEPLOYMENT.md (section "Linux server").
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const ROOT = process.cwd();
const DIST = path.join(ROOT, "dist");
const OUT = path.join(DIST, "itopmed-linux");
const step = (m: string) => console.log(`\n▸ ${m}`);

function materializeLinks(srcRoot: string, destRoot: string, sub = "") {
  for (const e of fs.readdirSync(path.join(srcRoot, sub), { withFileTypes: true })) {
    const rel = path.join(sub, e.name);
    const srcEntry = path.join(srcRoot, rel);
    if (fs.lstatSync(srcEntry).isSymbolicLink()) {
      const target = fs.readlinkSync(srcEntry);
      const absSrc = path.isAbsolute(target) ? target : path.resolve(path.dirname(srcEntry), target);
      const inDest = path.join(destRoot, path.relative(srcRoot, absSrc));
      const destEntry = path.join(destRoot, rel);
      fs.rmSync(destEntry, { recursive: true, force: true });
      fs.cpSync(fs.existsSync(inDest) ? inDest : absSrc, destEntry, { recursive: true, dereference: true });
    } else if (e.isDirectory()) materializeLinks(srcRoot, destRoot, rel);
  }
}

async function bundle(entry: string, outfile: string) {
  await build({
    entryPoints: [path.join(ROOT, entry)],
    outfile,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    conditions: ["react-server"],
    // Resolved on the server from app/node_modules (traced by Next) or the release's node_modules.
    external: ["@prisma/client", "@prisma/client/*", "@node-rs/argon2", "pg", "pg-native", "embedded-postgres", "@embedded-postgres/*"],
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    tsconfig: path.join(ROOT, "tsconfig.json"),
    logLevel: "warning",
    legalComments: "none",
  });
}

async function main() {
  const pkg = (p: string) => JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules", p, "package.json"), "utf8")).version as string;

  step("Building the app (standalone)…");
  fs.rmSync(path.join(ROOT, ".next-pkg"), { recursive: true, force: true });
  const tsconfig = fs.readFileSync(path.join(ROOT, "tsconfig.json"), "utf8");
  try {
    execFileSync(process.execPath, [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "build"], { cwd: ROOT, stdio: "inherit", env: { ...process.env, ITM_STANDALONE: "1", NEXT_TELEMETRY_DISABLED: "1" } });
  } finally {
    fs.writeFileSync(path.join(ROOT, "tsconfig.json"), tsconfig);
  }

  step("Assembling the release…");
  fs.rmSync(OUT, { recursive: true, force: true });
  const app = path.join(OUT, "app");
  fs.cpSync(path.join(ROOT, ".next-pkg", "standalone"), app, { recursive: true, dereference: true });
  materializeLinks(path.join(ROOT, ".next-pkg", "standalone"), app);
  fs.cpSync(path.join(ROOT, ".next-pkg", "static"), path.join(app, ".next-pkg", "static"), { recursive: true });
  fs.cpSync(path.join(ROOT, "public"), path.join(app, "public"), { recursive: true });
  fs.cpSync(path.join(ROOT, "prisma", "migrations"), path.join(app, "migrations"), { recursive: true });
  // Windows-only native packages traced on this computer are useless on the server.
  for (const p of ["@node-rs/argon2-win32-x64-msvc", "@embedded-postgres/windows-x64"]) fs.rmSync(path.join(app, "node_modules", p), { recursive: true, force: true });

  step("Bundling worker and server tasks…");
  await bundle("scripts/worker.ts", path.join(app, "worker.mjs"));
  await bundle("scripts/package/server-tasks.ts", path.join(app, "tasks.mjs"));
  await bundle("scripts/create-platform-admin.ts", path.join(app, "admin.mjs"));

  // What the server must install for Linux (exact versions of this build).
  const deps = {
    "embedded-postgres": pkg("embedded-postgres"),
    "@embedded-postgres/linux-x64": pkg("embedded-postgres"),
    pg: pkg("pg"),
    "@node-rs/argon2": pkg("@node-rs/argon2"),
    "@node-rs/argon2-linux-x64-gnu": pkg("@node-rs/argon2"),
  };
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version as string;
  fs.writeFileSync(path.join(OUT, "package.json"), JSON.stringify({ name: "itopmed-server", private: true, version, dependencies: deps }, null, 2));
  // The installer travels with the release, so a deploy always runs the matching version.
  for (const f of ["server-install.sh", "itopmed-admin.sh", "itopmed-clinic.sh"]) fs.copyFileSync(path.join(ROOT, "scripts", "deploy", f), path.join(OUT, f));
  // Ready-made clinic specs for `itopmed-clinic` (no patient data, only names and prices).
  fs.cpSync(path.join(ROOT, "scripts", "deploy", "clinics"), path.join(OUT, "clinics"), { recursive: true });
  fs.writeFileSync(path.join(OUT, "RELEASE"), `${new Date().toISOString()} ${execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT }).toString().trim()}\n`);

  step("Compressing…");
  const tgz = path.join(DIST, "itopmed-linux.tar.gz");
  fs.rmSync(tgz, { force: true });
  // Windows has bsdtar in System32; Linux (CI) has GNU tar on PATH.
  const tar = process.platform === "win32" ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
  execFileSync(tar, ["-czf", tgz, "-C", OUT, "."], { stdio: "inherit" });
  console.log(`\nReady: ${tgz} (${(fs.statSync(tgz).size / 1024 / 1024).toFixed(0)} MB)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
