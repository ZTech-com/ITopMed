import { caMobileConfig, readCaPem } from "@/server/local/lan";

/**
 * iPhone/iPad configuration profile containing the public local CA certificate
 * (single-computer installation only). Public by design, like ../ca.crt.
 */
export const dynamic = "force-dynamic";

export function GET() {
  const pem = process.env.LOCAL_MODE === "1" ? readCaPem() : null;
  if (!pem) return new Response("Not found", { status: 404 });
  return new Response(caMobileConfig(pem), {
    headers: {
      "Content-Type": "application/x-apple-aspen-config",
      "Content-Disposition": 'attachment; filename="itopmed.mobileconfig"',
      "Cache-Control": "no-store",
    },
  });
}
