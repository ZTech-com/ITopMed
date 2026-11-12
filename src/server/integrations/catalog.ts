import "server-only";
import { env } from "../env";

/**
 * Honest status of every external integration. Nothing here pretends to be
 * connected: real providers need contracts and official API specifications
 * before an adapter is written.
 */
export type IntegrationStatus = "connected" | "simulated" | "off" | "partial" | "planned";

export interface IntegrationInfo {
  key: "email" | "sms" | "telegram" | "payme" | "click" | "uzum" | "dmed" | "fiscal";
  status: IntegrationStatus;
}

export function integrationStatuses(): IntegrationInfo[] {
  const e = env();
  return [
    { key: "email", status: e.EMAIL_TRANSPORT === "smtp" ? "connected" : "simulated" },
    { key: "sms", status: e.SMS_TRANSPORT === "dev-outbox" ? "simulated" : "off" },
    { key: "telegram", status: "planned" },
    { key: "payme", status: "planned" },
    { key: "click", status: "planned" },
    { key: "uzum", status: "planned" },
    { key: "dmed", status: "partial" },
    { key: "fiscal", status: "planned" },
  ];
}
