import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static authorization sweep (rule 5 of CLAUDE.md): every page, server action
 * and route handler must authorize on the server itself. Layout guards do not
 * protect page loaders or actions, so each entry point is checked. New public
 * entry points must be added to the explicit allowlists below — on purpose.
 */
const ROOT = path.join(process.cwd(), "src", "app");
const GUARDS = /\b(requireClinic|requirePlatform|requirePatient|requireClinicUser|clinicFrom|tenantFrom|getClinicPrincipal|getPlatformPrincipal|getPatientPrincipal|getPortalTenant)\s*\(/;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");
const files = walk(ROOT);

/** Pages anyone may open: sign-in, invitations, password reset, the landing page. */
const PUBLIC_PAGES = new Set(["page.tsx", "(public)/forgot-password/page.tsx", "(public)/reset-password/[token]/page.tsx"]);

/** Actions that run before anyone is signed in (they authenticate instead). */
const PUBLIC_ACTIONS = new Set([
  "admin/actions.ts:adminLoginAction",
  "admin/actions.ts:adminMfaAction",
  "admin/actions.ts:adminLogoutAction",
  "clinic-actions.ts:clinicLoginAction",
  "clinic-actions.ts:clinicMfaAction",
  "clinic-actions.ts:clinicLogoutAction",
  "clinic-actions.ts:acceptInvitationAction",
  "clinic-actions.ts:forgotPasswordAction",
  "clinic-actions.ts:resetPasswordAction",
  "portal-actions.ts:portalLogoutAction",
  "actions/preferences.ts:setThemeAction",
]);

function exportedFunctions(src: string): { name: string; body: string }[] {
  const re = /export\s+async\s+function\s+(\w+)\s*\(/g;
  const starts = [...src.matchAll(re)].map((m) => ({ name: m[1]!, index: m.index! }));
  return starts.map((s, i) => ({ name: s.name, body: src.slice(s.index, starts[i + 1]?.index ?? src.length) }));
}

describe("authorization sweep", () => {
  it("every non-public page calls a server-side guard", () => {
    const pages = files.filter((f) => f.endsWith(`${path.sep}page.tsx`)).map(rel);
    expect(pages.length).toBeGreaterThan(50);
    const missing = pages.filter((p) => !PUBLIC_PAGES.has(p) && !GUARDS.test(fs.readFileSync(path.join(ROOT, p), "utf8")));
    expect(missing).toEqual([]);
  });

  it("every server action authorizes (or is an explicitly public sign-in action)", () => {
    const actionFiles = files.filter((f) => /^\s*["']use server["']/.test(fs.readFileSync(f, "utf8"))).map(rel);
    expect(actionFiles.length).toBeGreaterThan(8);
    const unguarded: string[] = [];
    for (const f of actionFiles) {
      for (const fn of exportedFunctions(fs.readFileSync(path.join(ROOT, f), "utf8"))) {
        const id = `${f}:${fn.name}`;
        if (!PUBLIC_ACTIONS.has(id) && !GUARDS.test(fn.body)) unguarded.push(id);
      }
    }
    expect(unguarded).toEqual([]);
  });

  it("every route handler authorizes", () => {
    const routes = files.filter((f) => f.endsWith(`${path.sep}route.ts`)).map(rel);
    const PUBLIC_ROUTES = new Set(["api/health/route.ts"]);
    const missing = routes.filter((r) => !PUBLIC_ROUTES.has(r) && !GUARDS.test(fs.readFileSync(path.join(ROOT, r), "utf8")));
    expect(missing).toEqual([]);
  });

  it("the public allowlist only names actions that exist", () => {
    for (const id of PUBLIC_ACTIONS) {
      const [file, name] = id.split(":");
      const src = fs.readFileSync(path.join(ROOT, file!), "utf8");
      expect([id, new RegExp(`export\\s+async\\s+function\\s+${name}\\s*\\(`).test(src)]).toEqual([id, true]);
    }
  });
});
