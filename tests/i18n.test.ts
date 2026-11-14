import { describe, expect, it } from "vitest";
import * as Enums from "@/generated/prisma/enums";
import en from "../messages/en.json";
import { checkCatalogs } from "../scripts/lib/i18n-check";

describe("localization catalogs", () => {
  it("all four languages have identical keys, no empty values and matching placeholders", () => {
    const problems = checkCatalogs();
    expect(problems).toEqual([]);
  });

  it("every enum value the UI translates directly has a label (no MISSING_MESSAGE crash at runtime)", () => {
    const m = en as unknown as Record<string, Record<string, unknown>>;
    const missing: string[] = [];
    const need = (ns: string, values: readonly string[]) => values.forEach((v) => !(v in m[ns]!) && missing.push(`${ns}.${v}`));
    need("auditActor", Object.values(Enums.AuditActorType));
    need("platformRole", Object.values(Enums.PlatformRole));
    need("practiceType", Object.values(Enums.PracticeType));
    need("serviceKind", Object.values(Enums.ServiceKind));
    need("roomKind", Object.values(Enums.RoomKind));
    // Status badges use the shared `status` namespace (notifications have their own).
    for (const [name, e] of Object.entries(Enums)) if (name.endsWith("Status") && name !== "NotificationStatus") need("status", Object.values(e as Record<string, string>));
    expect(missing).toEqual([]);
  });
});
