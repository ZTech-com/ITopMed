import { getTranslations } from "next-intl/server";
import { roleLabel } from "@/lib/role-label";
import { AppShell } from "@/components/shell/app-shell";
import type { NavItem } from "@/components/shell/nav-links";
import { requireClinic } from "@/server/auth/guards";
import type { Permission } from "@/server/authz/permissions";
import { DOCTOR_ROLE_KEYS } from "@/server/clinic/doctors";
import { clinicLogoutAction } from "../../clinic-actions";

export default async function ClinicLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireClinic(slug);
  const t = await getTranslations();
  const base = `/c/${ctx.tenant.slug}`;
  const can = (p: Permission) => ctx.permissions.has(p);
  const isDoctor = ctx.roleKeys.some((r) => (DOCTOR_ROLE_KEYS as readonly string[]).includes(r));

  // Navigation is derived from permissions; every page re-checks on the server.
  const nav: NavItem[] = [
    { href: base, label: t("nav.dashboard"), icon: "dashboard", exact: true },
    ...(isDoctor && can("emr.write") ? [{ href: `${base}/my-queue`, label: t("nav.myQueue"), icon: "visits" as const }] : []),
    ...(can("patients.read") ? [{ href: `${base}/patients`, label: t("nav.patients"), icon: "patients" as const }] : []),
    ...(can("queue.manage") ? [{ href: `${base}/queue`, label: t("nav.queue"), icon: "queue" as const }] : []),
    ...(can("appointments.manage") ? [{ href: `${base}/appointments`, label: t("nav.appointments"), icon: "booking" as const }] : []),
    ...(isDoctor ? [{ href: `${base}/my-schedule`, label: t("nav.mySchedule"), icon: "calendar" as const }] : []),
    ...(can("schedules.read") ? [{ href: `${base}/doctors`, label: t("nav.doctors"), icon: "doctors" as const }] : []),
    ...(can("services.read") ? [{ href: `${base}/services`, label: t("nav.services"), icon: "services" as const }] : []),
    ...(can("staff.read") ? [{ href: `${base}/staff`, label: t("nav.team"), icon: "staff" as const }] : []),
    ...(can("roles.manage") ? [{ href: `${base}/roles`, label: t("nav.roles"), icon: "roles" as const }] : []),
    ...(can("clinic.settings.read") ? [{ href: `${base}/facilities`, label: t("nav.facilities"), icon: "facilities" as const }] : []),
    ...(can("clinic.settings.read") ? [{ href: `${base}/branches`, label: t("nav.branches"), icon: "branches" as const }] : []),
    ...(can("clinic.settings.read") ? [{ href: `${base}/settings`, label: t("nav.settings"), icon: "settings" as const }] : []),
    ...(can("support_access.decide") ? [{ href: `${base}/support-access`, label: t("nav.supportAccess"), icon: "support" as const }] : []),
    ...(can("audit.read") ? [{ href: `${base}/audit`, label: t("nav.clinicAudit"), icon: "audit" as const }] : []),
  ];
  return (
    <AppShell
      context={ctx.tenant.name}
      nav={nav}
      user={{ name: ctx.principal.user.fullName, detail: ctx.roleKeys.map((r) => roleLabel(t as never, r)).join(", ") }}
      signOut={clinicLogoutAction}
    >
      {children}
    </AppShell>
  );
}
