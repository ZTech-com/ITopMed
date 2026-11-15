import fs from "node:fs";
import path from "node:path";

/**
 * Next's standalone output copies the project's `.env*` files and anything
 * its file tracing touched (e.g. earlier packages in dist/). A release must
 * never carry the developer's settings or secrets: remove them, then refuse to
 * continue if any `.env` file is still inside the release.
 */
export function stripPrivate(appDir: string) {
  for (const e of fs.readdirSync(appDir)) {
    if (/^\.env(\..*)?$/.test(e)) fs.rmSync(path.join(appDir, e), { force: true });
  }
  for (const d of ["dist", ".data", ".dev-mailbox", ".claude", "tests", "coverage"]) fs.rmSync(path.join(appDir, d), { recursive: true, force: true });
  const leaks: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules") walk(p);
      } else if (/^\.env(\..*)?$/.test(e.name) && !e.name.endsWith(".example")) leaks.push(path.relative(appDir, p));
    }
  };
  walk(appDir);
  if (leaks.length) throw new Error(`Refusing to package settings files: ${leaks.join(", ")}`);
  // Packages the server needs at start must be complete (guards against over-eager pruning).
  for (const p of ["pg", "pg-protocol"]) {
    const dir = path.join(appDir, "node_modules", p);
    if (!fs.existsSync(dir)) continue;
    const main = (JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as { main?: string }).main ?? "index.js";
    const file = path.join(dir, main);
    if (!fs.existsSync(file) && !fs.existsSync(`${file}.js`)) throw new Error(`Incomplete package in the release: ${p} (${main} missing)`);
  }
}
