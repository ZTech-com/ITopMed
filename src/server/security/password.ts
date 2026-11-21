import "server-only";
import { randomInt } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { z } from "zod";

// OWASP Password Storage Cheat Sheet (argon2id, m=19 MiB, t=2, p=1).
const ARGON2 = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2);
}

export async function verifyPassword(stored: string | null | undefined, password: string): Promise<boolean> {
  if (!stored) {
    // Equalise timing with a real verification so unknown accounts are not distinguishable.
    await hash(password, ARGON2);
    return false;
  }
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

/**
 * Shared password policy: at least 8 characters, nothing else required (kept
 * simple on purpose for clinic staff). Brute force is held back by the account
 * lockout (5 failures → 15 min) and per-IP rate limits. Messages are i18n keys.
 */
export const PASSWORD_MIN = 8;
export const passwordSchema = z.string().min(PASSWORD_MIN, "validation.passwordTooShort").max(128, "validation.passwordTooLong");

const SUGGEST_LETTERS = "abcdefghjkmnpqrstuvwxyz";
const SUGGEST_DIGITS = "23456789";

/**
 * An easy first password to read aloud and copy by hand: 4 lowercase letters +
 * 4 digits, no look-alikes (no 0/o, 1/l/i), e.g. "kxmp4827". Shown once to the
 * administrator who creates the account; never stored in clear.
 */
export function suggestPassword(): string {
  const letters = Array.from({ length: 4 }, () => SUGGEST_LETTERS[randomInt(SUGGEST_LETTERS.length)]).join("");
  const digits = Array.from({ length: 4 }, () => SUGGEST_DIGITS[randomInt(SUGGEST_DIGITS.length)]).join("");
  return letters + digits;
}
