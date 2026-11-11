import QRCode from "qrcode";
import { getTranslations } from "next-intl/server";
import type { FormState } from "@/lib/form-state";
import { Form, SubmitButton, TextField } from "./ui/form";

/** Shared TOTP enrolment / verification body for platform and clinic sign-in. */
export async function MfaPanel({
  enrollment,
  action,
  hidden,
}: {
  enrollment: { uri: string; secretBase32: string } | null;
  action: (s: FormState, fd: FormData) => Promise<FormState>;
  hidden?: Record<string, string>;
}) {
  const t = await getTranslations("auth");
  const qr = enrollment ? await QRCode.toDataURL(enrollment.uri, { margin: 1, width: 192, errorCorrectionLevel: "M" }) : null;
  return (
    <div className="space-y-6">
      {enrollment && qr ? (
        <ol className="space-y-5 text-[14px] text-text-2">
          <li>
            <p>{t("mfaEnrollIntro")}</p>
          </li>
          <li className="space-y-3">
            <p>
              <span className="font-semibold text-text">1.</span> {t("mfaStep1")}
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element -- data: URL generated server-side */}
            <img src={qr} alt="" width={192} height={192} className="mx-auto rounded-xl border border-border bg-white p-2" />
            <details className="text-[13px]">
              <summary className="cursor-pointer text-accent">{t("mfaManual")}</summary>
              <code className="mt-2 block select-all break-all rounded-lg bg-sunken px-3 py-2 font-mono text-[13px] tracking-wider text-text">
                {enrollment.secretBase32.match(/.{1,4}/g)?.join(" ")}
              </code>
            </details>
          </li>
          <li>
            <p>
              <span className="font-semibold text-text">2.</span> {t("mfaStep2")}
            </p>
          </li>
        </ol>
      ) : null}
      <Form action={action}>
        {Object.entries(hidden ?? {}).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <TextField name="code" label={t("mfaCode")} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" required autoFocus />
        <SubmitButton full>{t("verify")}</SubmitButton>
      </Form>
    </div>
  );
}
