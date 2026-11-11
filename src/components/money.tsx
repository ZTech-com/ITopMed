import { getFormatter } from "next-intl/server";
import { minorToNumber } from "@/lib/money";

/** Localized currency formatting; whole sums without trailing ",00". */
export async function moneyFormatter() {
  const format = await getFormatter();
  return (minor: bigint, currency: string) =>
    format.number(minorToNumber(minor, currency), { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
