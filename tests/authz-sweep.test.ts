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
const PUBLIC_PAGES = new Set([
  "page.tsx",
  "(public)/forgot-password/page.tsx",
  // Local installation only (LOCAL_MODE=1): network address + public CA certificate for new devices.
  "(public)/connect/page.tsx",
  // Fresh local installation only, while no account exists (see completeFirstRun).
  "(public)/welcome/page.tsx",
  "(public)/reset-password/[token]/page.tsx",
  // Waiting-room TV: no user on a screen; the secret link (hash stored, revocable) is the credential.
  "(public)/tv/[token]/page.tsx",
  // Invited ITop Med employee has no account yet; the single-use token is the credential.
  "admin/(auth)/invite/[token]/page.tsx",
  // Telegram Mini App entry: identity comes from Telegram's signed launch data, verified by /auth/telegram/webapp.
  "(public)/tg/page.tsx",
]);

/** Actions that run before anyone is signed in (they authenticate instead). */
const PUBLIC_ACTIONS = new Set([
  "admin/actions.ts:adminLoginAction",
  "admin/actions.ts:acceptStaffInvitationAction", // token-authenticated account creation
  "admin/actions.ts:adminLogoutAction",
  "first-run-actions.ts:firstRunAction", // no account yet: allowed only with zero accounts, LOCAL_MODE, from this computer
  "clinic-actions.ts:clinicLoginAction",
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
    // Local installation only (LOCAL_MODE=1): the PUBLIC half of the local CA, so devices can trust HTTPS.
    // api/tv: the waiting-room screen's data; its secret link is the credential (see src/server/queue/board.ts).
    // api/telegram/webhook: called by Telegram; the secret header derived from the bot token is the credential.
    // auth/telegram/callback: Telegram Login returns here; the encrypted flow cookie + state and the verified id_token authenticate.
    // auth/telegram/webapp: Mini App sign-in; Telegram's initData (HMAC with the bot token) authenticates, same-origin only.
    const PUBLIC_ROUTES = new Set(["api/health/route.ts", "(public)/connect/ca.crt/route.ts", "(public)/connect/ios/route.ts", "api/tv/[token]/route.ts", "api/telegram/webhook/route.ts", "auth/telegram/callback/route.ts", "auth/telegram/webapp/route.ts"]);
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
