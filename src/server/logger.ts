import "server-only";

/**
 * Structured logger with defensive redaction. Application logs must never
 * contain medical details, credentials, tokens or full personal data.
 * Log identifiers (UUIDs) and event names instead of content.
 */
const REDACT = /pass|token|secret|authorization|cookie|otp|diagnos|note|complaint|symptom|email|phone|name|address|birth/i;

type Fields = Record<string, unknown>;

function redact(fields: Fields): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(fields)) out[k] = REDACT.test(k) ? "[redacted]" : v;
  return out;
}

function write(level: "info" | "warn" | "error", event: string, fields: Fields = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...redact(fields) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else process.stdout.write(line + "\n");
}

export const logger = {
  info: (event: string, fields?: Fields) => write("info", event, fields),
  warn: (event: string, fields?: Fields) => write("warn", event, fields),
  error: (event: string, fields?: Fields) => write("error", event, fields),
};
