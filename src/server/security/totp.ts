import "server-only";
import { randomBytes } from "node:crypto";
import { createTOTPKeyURI, verifyTOTPWithGracePeriod } from "@oslojs/otp";
import { decryptField, encryptField } from "./crypto";

const PERIOD = 30;
const DIGITS = 6;

export function newTotpSecret(): Uint8Array {
  return new Uint8Array(randomBytes(20));
}

export function encryptTotpSecret(secret: Uint8Array, ownerId: string): string {
  return encryptField(Buffer.from(secret).toString("base64"), `totp:${ownerId}`);
}

export function decryptTotpSecret(enc: string, ownerId: string): Uint8Array {
  return new Uint8Array(Buffer.from(decryptField(enc, `totp:${ownerId}`), "base64"));
}

export function totpUri(secret: Uint8Array, account: string): string {
  return createTOTPKeyURI("ITop Med", account, secret, PERIOD, DIGITS);
}

export function verifyTotp(secret: Uint8Array, code: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  return verifyTOTPWithGracePeriod(secret, PERIOD, DIGITS, code, PERIOD);
}
