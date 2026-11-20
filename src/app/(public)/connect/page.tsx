import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { AuthLayout } from "@/components/shell/auth-layout";
import { Alert, buttonClass } from "@/components/ui/primitives";
import { caFingerprint, lanAddresses, LOCAL_PUBLIC_PORT, readCaPem } from "@/server/local/lan";

/**
 * "Connect this device" — single-computer installation only (LOCAL_MODE=1).
 * Public by design: it shows only this server's network address and the PUBLIC
 * part of its local certificate authority, which devices must trust once.
 * Reachable over plain HTTP on the clinic network (see scripts/local.ts) so a
 * phone can get the certificate before HTTPS works on it.
 */
export const dynamic = "force-dynamic";

type Platform = "android" | "ios" | "desktop";

export default async function ConnectPage() {
  if (process.env.LOCAL_MODE !== "1") notFound();
  const t = await getTranslations("connect");
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").replace(/:\d+$/, "");
  const secure = h.get("x-forwarded-proto") === "https";
  const ua = h.get("user-agent") ?? "";
  const platform: Platform = /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && /mobile/i.test(ua)) ? "ios" : /android/i.test(ua) ? "android" : "desktop";
  const ips = lanAddresses();
  const onServer = host === "127.0.0.1" || host === "localhost" || host === "";
  const deviceHost = onServer ? ips[0] : host;
  const appUrl = deviceHost ? `https://${deviceHost}:${LOCAL_PUBLIC_PORT}` : null;
  const pem = readCaPem();
  const fingerprint = pem ? caFingerprint(pem) : null;

  if (onServer) {
    const connectUrl = ips[0] ? `http://${ips[0]}:${LOCAL_PUBLIC_PORT}/connect` : null;
    return (
      <AuthLayout title={t("desktopTitle")} subtitle={t("subtitle")}>
        {connectUrl ? (
          <div className="space-y-4 text-center">
            <p className="text-[14px] text-text-2">{t("typeHint")}</p>
            <p className="break-all rounded-[10px] bg-surface-2 px-3 py-2 font-mono text-[16px]">{connectUrl}</p>
            {ips.length > 1 ? <p className="break-all text-[12px] text-text-3">{ips.slice(1).map((ip) => `http://${ip}:${LOCAL_PUBLIC_PORT}/connect`).join(" · ")}</p> : null}
          </div>
        ) : (
          <Alert tone="warning">{t("noNetwork")}</Alert>
        )}
        <Fingerprint label={t("fingerprint")} value={fingerprint} />
      </AuthLayout>
    );
  }

  const steps: { title: string; body: React.ReactNode }[] = [
    {
      title: t("step1"),
      body: (
        <a href={platform === "ios" ? "/connect/ios" : "/connect/ca.crt"} className={buttonClass("primary", "md", "w-full")} download={platform === "ios" ? undefined : "itopmed-local-ca.crt"}>
          {t("download")}
        </a>
      ),
    },
    { title: t("step2"), body: <p className="text-[14px] leading-relaxed text-text-2">{t(`trust.${platform}`)}</p> },
    {
      title: t("step3"),
      body: appUrl ? (
        <a href={`${appUrl}/login`} className={buttonClass("secondary", "md", "w-full")}>
          {t("open")}
        </a>
      ) : null,
    },
    { title: t("step4"), body: <p className="text-[14px] leading-relaxed text-text-2">{t(`install.${platform}`)}</p> },
  ];

  return (
    <AuthLayout title={t("title")} subtitle={t("subtitle")}>
      {secure ? (
        <div className="space-y-4">
          <Alert tone="success">{t("secureOk")}</Alert>
          <Link href="/login" className={buttonClass("primary", "md", "w-full")}>
            {t("open")}
          </Link>
          <p className="text-[14px] leading-relaxed text-text-2">{t(`install.${platform}`)}</p>
        </div>
      ) : (
        <ol className="space-y-5">
          {steps.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-solid text-[13px] font-semibold text-on-accent">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-[15px] font-medium">{s.title}</p>
                {s.body}
              </div>
            </li>
          ))}
        </ol>
      )}
      <details className="mt-6 text-[13px] text-text-2">
        <summary className="cursor-pointer font-medium text-text">{t("otherDevices")}</summary>
        <dl className="mt-3 space-y-3">
          {(["android", "ios", "desktop"] as const).map((p) => (
            <div key={p}>
              <dt className="font-medium text-text">{t(`platform.${p}`)}</dt>
              <dd className="mt-1 leading-relaxed">
                {t(`trust.${p}`)} {t(`install.${p}`)}
              </dd>
            </div>
          ))}
        </dl>
      </details>
      <p className="mt-4 text-[12px] leading-relaxed text-text-3">{t("why")}</p>
      <Fingerprint label={t("fingerprint")} value={fingerprint} />
    </AuthLayout>
  );
}

function Fingerprint({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="mt-4 text-[12px] text-text-3">
      <p>{label}</p>
      <p className="mt-1 break-all font-mono">{value}</p>
    </div>
  );
}
