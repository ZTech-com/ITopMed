import { readCaPem } from "@/server/local/lan";

/**
 * Public part of the local certificate authority (single-computer installation
 * only). Public by design: devices on the clinic network install it once so
 * HTTPS works. The private key is never served.
 */
export const dynamic = "force-dynamic";

export function GET() {
  const pem = process.env.LOCAL_MODE === "1" ? readCaPem() : null;
  if (!pem) return new Response("Not found", { status: 404 });
  return new Response(pem, {
    headers: {
      "Content-Type": "application/x-x509-ca-cert",
      "Content-Disposition": 'attachment; filename="itopmed-local-ca.crt"',
      "Cache-Control": "no-store",
    },
  });
}
