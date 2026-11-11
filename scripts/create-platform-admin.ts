/**
 * Creates a platform staff account (bootstrap for the first SUPER_ADMIN).
 *
 *   npm run admin:create -- --email you@itopmed.uz --name "Full Name" --role SUPER_ADMIN
 *
 * The password is read interactively (never from argv, which leaks into shell
 * history). The user must enrol TOTP MFA at first sign-in.
 */
import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).reduce<[string, string][]>((acc, cur, i, arr) => (cur.startsWith("--") ? [...acc, [cur.slice(2), arr[i + 1] ?? ""]] : acc), []),
  );
  const roles = ["SUPER_ADMIN", "PLATFORM_ADMIN", "SUPPORT", "BILLING", "READ_ONLY"] as const;
  const role = (args.role ?? "SUPER_ADMIN") as (typeof roles)[number];
  if (!args.email || !args.name || !roles.includes(role)) {
    console.error('Usage: npm run admin:create -- --email <email> --name "<full name>" [--role SUPER_ADMIN]');
    process.exit(1);
  }
  const password = process.env.ITM_ADMIN_PASSWORD ?? (await prompt("Password (min 12 chars, letters + digits): "));
  const { passwordSchema } = await import("../src/server/security/password");
  const ok = passwordSchema.safeParse(password);
  if (!ok.success) {
    console.error("Password does not meet the policy.");
    process.exit(1);
  }
  const { createPlatformUser } = await import("../src/server/auth/platform-auth");
  const id = await createPlatformUser({ email: args.email, fullName: args.name, password, role });
  console.log(`Created ${role} ${args.email} (${id}). MFA enrolment is required at first sign-in: /admin/login`);
  const { disconnectAll } = await import("../src/server/db");
  await disconnectAll();
}

async function prompt(q: string) {
  const rl = createInterface({ input: stdin, output: stdout });
  const a = await rl.question(q);
  rl.close();
  return a;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
