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

/** Shared password policy. Messages are i18n keys under `validation.*`. */
export const passwordSchema = z
  .string()
  .min(12, "validation.passwordTooShort")
  .max(128, "validation.passwordTooLong")
  .refine((v) => /[a-zA-Zа-яА-ЯёЁўЎқҚғҒҳҲ]/.test(v) && /\d/.test(v), "validation.passwordWeak");

const SUGGEST_LETTERS = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ";
const SUGGEST_DIGITS = "23456789";

/**
 * A strong password that is easy to read aloud and copy by hand (no 0/O, 1/l/I),
 * e.g. "Kxm7-Pqt4-Wre9-Hns3": 4 groups of 3 letters + 1 digit, about 84 bits.
 * Shown once to the platform admin who sets up a clinic owner; never stored.
 */
export function suggestPassword(): string {
  const group = () => Array.from({ length: 3 }, () => SUGGEST_LETTERS[randomInt(SUGGEST_LETTERS.length)]).join("") + SUGGEST_DIGITS[randomInt(SUGGEST_DIGITS.length)];
  return [group(), group(), group(), group()].join("-");
}
