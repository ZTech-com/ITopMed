import { requireClinic } from "@/server/auth/guards";
import { exportAllPatients } from "@/server/emr/patient-file";
import { env } from "@/server/env";
import { requestMeta } from "@/server/http";
import { DomainError } from "@/server/tenancy/provisioning";

/** All patients as a ZIP of Excel files (one per patient + list). Head doctor only; audited. */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(env().APP_URL).origin && origin !== new URL(request.url).origin) {
    return new Response("Forbidden", { status: 403 });
  }
  const { slug } = await params;
  const ctx = await requireClinic(slug, "emr.read_all");
  try {
    const { bytes } = await exportAllPatients(ctx, await requestMeta());
    const day = new Date().toISOString().slice(0, 10);
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="ITopMed-patients-${day}.zip"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof DomainError) return new Response(e.message === "errors.rateLimited" ? "Too many requests" : "Forbidden", { status: e.message === "errors.rateLimited" ? 429 : 403 });
    throw e;
  }
}
