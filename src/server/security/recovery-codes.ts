import "server-only";
import { randomBytes } from "node:crypto";
import { encodeBase32LowerCaseNoPadding } from "@oslojs/encoding";
import { sha256Hex } from "./crypto";

/** Codes issued per set. Generating a new set replaces the old one. */
export const RECOVERY_CODE_COUNT = 10;

/**
 * One-time MFA recovery codes: 80 random bits each, shown once as
 * `abcd-efgh-ijkl-mnop`. Only a SHA-256 bound to the account id is stored —
 * at 80 bits an offline guess is infeasible, so a slow hash is not needed.
 */
export function newRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const raw = encodeBase32LowerCaseNoPadding(randomBytes(10)); // 16 chars
    return raw.match(/.{4}/g)!.join("-");
  });
}

/** Accepts the code with or without dashes/spaces, in any case. Returns null when it cannot be a code. */
export function normalizeRecoveryCode(input: string): string | null {
  const s = input.toLowerCase().replace(/[\s-]/g, "");
  return /^[a-z2-7]{16}$/.test(s) ? s : null;
}

export function recoveryCodeHash(ownerId: string, normalized: string): string {
  return sha256Hex(`mfa-recovery:${ownerId}:${normalized}`);
}
