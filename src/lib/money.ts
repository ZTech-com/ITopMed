/**
 * Money is stored as integer minor units (BigInt) with an ISO 4217 currency.
 * Both supported currencies (UZS, USD) have 2 minor digits.
 */
export const CURRENCY_MINOR_DIGITS: Record<string, number> = { UZS: 2, USD: 2 };

/** Parses user input such as "150 000", "150000,50" or "1 250.5" into minor units. */
export function parseMoney(input: string, currency = "UZS"): bigint | null {
  const digits = CURRENCY_MINOR_DIGITS[currency];
  if (digits === undefined) return null;
  const s = input.replace(/[\s  ']/g, "").replace(",", ".");
  const m = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const frac = (m[2] ?? "").padEnd(digits, "0");
  return BigInt(m[1]!) * 10n ** BigInt(digits) + BigInt(frac || "0");
}

/** Converts minor units to a plain decimal string (for form defaults). */
export function minorToDecimalString(minor: bigint, currency = "UZS"): string {
  const digits = CURRENCY_MINOR_DIGITS[currency] ?? 2;
  const base = 10n ** BigInt(digits);
  const whole = minor / base;
  const frac = minor % base;
  return frac === 0n ? whole.toString() : `${whole}.${frac.toString().padStart(digits, "0").replace(/0+$/, "")}`;
}

/** Number for Intl formatting. Safe: prices are far below 2^53 minor units. */
export function minorToNumber(minor: bigint, currency = "UZS"): number {
  const digits = CURRENCY_MINOR_DIGITS[currency] ?? 2;
  return Number(minor) / 10 ** digits;
}

/**
 * Lets a formatted amount wrap only between the number and the currency
 * ("125 400 000" / "soʻm"), never inside the digits: the no-break space next
 * to the currency becomes a normal space; digit-group spaces stay unbreakable.
 */
export function wrapCurrency(formatted: string): string {
  return formatted.replace(/[  ](?=[^\d  ]+$)/, " ").replace(/^([^\d\s  -]+)[  ]/, "$1 ");
}
