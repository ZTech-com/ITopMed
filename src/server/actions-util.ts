import "server-only";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { fieldErrors } from "@/lib/validation";
import type { FormState } from "@/lib/form-state";
import { logger } from "./logger";
import { DomainError } from "./tenancy/provisioning";

const SENSITIVE_FIELDS = /password|code|token/i;

/** Echoes submitted values back to the form (never secrets) so users don't retype after an error. */
export function formValues(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !k.startsWith("$") && !SENSITIVE_FIELDS.test(k)) out[k] = v;
  return out;
}

/** Maps errors to a localized form state. Unknown errors are logged without payloads. */
export function toFormState(e: unknown, fd?: FormData): FormState {
  unstable_rethrow(e); // let redirect()/notFound() propagate
  const values = fd ? formValues(fd) : undefined;
  if (e instanceof ZodError) return { fieldErrors: fieldErrors(e), values, nonce: Date.now() };
  if (e instanceof DomainError) return { message: e.code, values, nonce: Date.now() };
  logger.error("action.failed", { error: e instanceof Error ? e.name : "unknown" });
  return { message: "errors.generic", values, nonce: Date.now() };
}
