import fs from "node:fs";
import path from "node:path";
import { IntlMessageFormat } from "intl-messageformat";

const LOCALES = ["uz-Latn", "uz-Cyrl", "ru", "en"] as const;
type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = "", out: Record<string, string> = {}) {
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else flatten(v, key, out);
  }
  return out;
}

// A placeholder is `{name}` or `{name, plural|select|number …`; plural branch texts such as `{No codes left}` are not.
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\s*[,}]/g)].map((m) => m[1]).sort().join(",");

/** Returns a list of human-readable problems; empty means all catalogs are complete. */
export function checkCatalogs(dir = path.join(process.cwd(), "messages")): string[] {
  const problems: string[] = [];
  const flat = Object.fromEntries(
    LOCALES.map((l) => [l, flatten(JSON.parse(fs.readFileSync(path.join(dir, `${l}.json`), "utf8")))]),
  ) as Record<(typeof LOCALES)[number], Record<string, string>>;
  const reference = flat.en;
  for (const locale of LOCALES) {
    const cat = flat[locale];
    for (const key of Object.keys(reference)) {
      if (!(key in cat)) problems.push(`${locale}: missing "${key}"`);
      else if (!cat[key]!.trim()) problems.push(`${locale}: empty "${key}"`);
      else if (placeholders(cat[key]!) !== placeholders(reference[key]!)) problems.push(`${locale}: placeholder mismatch in "${key}"`);
    }
    for (const key of Object.keys(cat)) if (!(key in reference)) problems.push(`${locale}: extra key "${key}"`);
    // Every message must be valid ICU syntax, or it crashes at runtime when shown.
    for (const [k, v] of Object.entries(cat)) {
      try {
        new IntlMessageFormat(v, locale);
      } catch {
        problems.push(`${locale}: invalid ICU message "${k}"`);
      }
    }
    // Script sanity: Uzbek Latin must not contain Cyrillic letters and vice versa.
    if (locale === "uz-Latn") for (const [k, v] of Object.entries(cat)) if (/[а-яё]/i.test(v)) problems.push(`uz-Latn: Cyrillic text in "${k}"`);
  }
  return problems;
}
