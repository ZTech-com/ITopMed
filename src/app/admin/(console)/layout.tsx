import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/shell/app-shell";
import type { NavItem } from "@/components/shell/nav-links";
import { platformCan } from "@/server/authz/platform";
import { requirePlatform } from "@/server/auth/guards";
import { adminLogoutAction } from "../actions";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const p = await requirePlatform();
  const t = await getTranslations();
  const role = p.user.role;
  const nav: NavItem[] = [
    { href: "/admin", label: t("nav.dashboard"), icon: "dashboard", exact: true },
    ...(platformCan(role, "tenants.read") ? [{ href: "/admin/clinics", label: t("nav.clinics"), icon: "clinics" as const }] : []),
    ...(platformCan(role, "staff.read") ? [{ href: "/admin/staff", label: t("nav.staff"), icon: "staff" as const }] : []),
    ...(platformCan(role, "audit.read") ? [{ href: "/admin/audit", label: t("nav.audit"), icon: "audit" as const }] : []),
  ];
  return (
    <AppShell
      context={t("nav.platform")}
      nav={nav}
      user={{ name: p.user.fullName, detail: t(`platformRole.${role}`) }}
      signOut={adminLogoutAction}
    >
      {children}
    </AppShell>
  );
}
