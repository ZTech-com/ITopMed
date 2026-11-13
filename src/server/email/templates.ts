import "server-only";
import { createTranslator } from "use-intl/core";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";
import { escapeHtml, type EmailMessage } from "./index";

async function translator(locale: Locale) {
  const messages = (await import(`../../../messages/${locale}.json`)).default;
  return createTranslator({ locale, messages, namespace: "email" });
}

function layout(locale: string, paragraphs: string[], cta: { label: string; link: string }, footer: string[]) {
  return `<!doctype html><html lang="${locale}"><body style="font-family:-apple-system,Segoe UI,Inter,sans-serif;color:#1d1d1f;max-width:560px;margin:auto;padding:24px">
<p style="font-size:13px;color:#6e6e73;letter-spacing:.02em">ITop Med</p>
${paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("")}
<p><a href="${escapeHtml(cta.link)}" style="display:inline-block;background:#0a66d8;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none">${escapeHtml(cta.label)}</a></p>
<p style="font-size:13px;color:#6e6e73">${footer.map(escapeHtml).join("<br>")}</p></body></html>`;
}

/** Password reset link. No clinical data. */
export async function passwordResetEmail(args: { locale: string; to: string; name: string; link: string; expiresInMinutes: number }): Promise<EmailMessage> {
  const locale = isLocale(args.locale) ? args.locale : DEFAULT_LOCALE;
  const t = await translator(locale);
  const greeting = t("passwordReset.greeting", { name: args.name });
  const body = t("passwordReset.body");
  const cta = t("passwordReset.cta");
  const expiry = t("passwordReset.expiry", { minutes: args.expiresInMinutes });
  const ignore = t("passwordReset.ignore");
  return {
    to: args.to,
    subject: t("passwordReset.subject"),
    text: `${greeting}\n\n${body}\n\n${cta}: ${args.link}\n\n${expiry}\n${ignore}`,
    html: layout(locale, [greeting, body], { label: cta, link: args.link }, [expiry, ignore]),
  };
}

/** Clinic invitation. Contains no clinical data; the link is single-use and expires. */
export async function invitationEmail(args: {
  locale: string;
  to: string;
  inviteeName: string;
  clinicName: string;
  link: string;
  expiresInHours: number;
}): Promise<EmailMessage> {
  const locale = isLocale(args.locale) ? args.locale : DEFAULT_LOCALE;
  const t = await translator(locale);
  const subject = t("invitation.subject", { clinic: args.clinicName });
  const greeting = t("invitation.greeting", { name: args.inviteeName });
  const body = t("invitation.body", { clinic: args.clinicName });
  const cta = t("invitation.cta");
  const expiry = t("invitation.expiry", { hours: args.expiresInHours });
  const ignore = t("invitation.ignore");
  const text = `${greeting}\n\n${body}\n\n${cta}: ${args.link}\n\n${expiry}\n${ignore}`;
  const html = `<!doctype html><html lang="${locale}"><body style="font-family:-apple-system,Segoe UI,Inter,sans-serif;color:#1d1d1f;max-width:560px;margin:auto;padding:24px">
<p style="font-size:13px;color:#6e6e73;letter-spacing:.02em">ITop Med</p>
<p>${escapeHtml(greeting)}</p><p>${escapeHtml(body)}</p>
<p><a href="${escapeHtml(args.link)}" style="display:inline-block;background:#0a66d8;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none">${escapeHtml(cta)}</a></p>
<p style="font-size:13px;color:#6e6e73">${escapeHtml(expiry)}<br>${escapeHtml(ignore)}</p></body></html>`;
  return { to: args.to, subject, text, html };
}

/** ITop Med console invitation for a new employee. Single-use link; MFA enrolment follows at first sign-in. */
export async function platformInvitationEmail(args: { locale: string; to: string; inviteeName: string; role: string; link: string; expiresInHours: number }): Promise<EmailMessage> {
  const locale = isLocale(args.locale) ? args.locale : DEFAULT_LOCALE;
  const t = await translator(locale);
  const messages = (await import(`../../../messages/${locale}.json`)).default;
  const roleLabel = createTranslator({ locale, messages, namespace: "platformRole" })(args.role as never);
  const greeting = t("platformInvitation.greeting", { name: args.inviteeName });
  const body = t("platformInvitation.body", { role: roleLabel });
  const mfa = t("platformInvitation.mfa");
  const cta = t("platformInvitation.cta");
  const expiry = t("platformInvitation.expiry", { hours: args.expiresInHours });
  const ignore = t("platformInvitation.ignore");
  return {
    to: args.to,
    subject: t("platformInvitation.subject"),
    text: `${greeting}\n\n${body}\n${mfa}\n\n${cta}: ${args.link}\n\n${expiry}\n${ignore}`,
    html: layout(locale, [greeting, body, mfa], { label: cta, link: args.link }, [expiry, ignore]),
  };
}
