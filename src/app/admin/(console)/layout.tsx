import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/shell/app-shell";
import type { NavItem } from "@/components/shell/nav-links";
import { platformCan } from "@/server/authz/platform";
import { requirePlatform } from "@/server/auth/guards";
import { networkName } from "@/server/platform/networks";
import { adminLogoutAction } from "../actions";

/** The console installs as its own app ("ITop Med Boshqaruv"), separate from the clinic app. */
export const metadata: Metadata = { manifest: "/admin.webmanifest" };

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const p = await requirePlatform();
  const t = await getTranslations();
  const role = p.user.role;
  const network = role === "NETWORK_ADMIN" ? await networkName(p.user.networkId) : null;
  const nav: NavItem[] = [
    { href: "/admin", label: t("nav.dashboard"), icon: "dashboard", exact: true },
    ...(platformCan(role, "tenants.read") ? [{ href: "/admin/clinics", label: t("nav.clinics"), icon: "clinics" as const }] : []),
    ...(platformCan(role, "networks.manage") ? [{ href: "/admin/networks", label: t("nav.networks"), icon: "networks" as const }] : []),
    ...(platformCan(role, "staff.read") ? [{ href: "/admin/staff", label: t("nav.staff"), icon: "staff" as const }] : []),
    ...(platformCan(role, "audit.read") ? [{ href: "/admin/audit", label: t("nav.audit"), icon: "audit" as const }] : []),
  ];
  // Who you are here is always visible: SuperAdmin of the whole platform, or the admin of one network.
  const context = network ? t("nav.networkContext", { name: network }) : role === "SUPER_ADMIN" ? t("nav.superAdminContext") : t("nav.platform");
  return (
    <AppShell context={context} nav={nav} user={{ name: p.user.fullName, detail: t(`platformRole.${role}`) }} signOut={adminLogoutAction} securityHref="/admin/security">
      {children}
    </AppShell>
  );
}
