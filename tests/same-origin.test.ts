import { describe, expect, it } from "vitest";
import { isSameOriginRequest } from "@/server/http";

const req = (origin: string | null, headers: Record<string, string> = {}) =>
  new Request("http://127.0.0.1:3100/c/x/patients/1/record/xlsx", { method: "POST", headers: { ...(origin ? { origin } : {}), ...headers } });

describe("POST download origin check", () => {
  const APP = "https://itopmed.example.test";
  it("accepts the configured address, the proxied address and requests without Origin", () => {
    expect(isSameOriginRequest(req(APP), APP)).toBe(true);
    expect(isSameOriginRequest(req(null), APP)).toBe(true);
    // Local app: the clinic computer itself opens http://127.0.0.1:3000 (proxy -> 3100).
    expect(isSameOriginRequest(req("http://127.0.0.1:3000", { "x-forwarded-host": "127.0.0.1:3000", "x-forwarded-proto": "http" }), APP)).toBe(true);
    // A phone on the clinic network.
    expect(isSameOriginRequest(req("https://192.168.1.10:3443", { "x-forwarded-host": "192.168.1.10:3443", "x-forwarded-proto": "https" }), APP)).toBe(true);
  });
  it("refuses other sites", () => {
    expect(isSameOriginRequest(req("https://evil.example", { "x-forwarded-host": "127.0.0.1:3000", "x-forwarded-proto": "http" }), APP)).toBe(false);
    expect(isSameOriginRequest(req("http://127.0.0.1:3000"), APP)).toBe(false);
  });
});
