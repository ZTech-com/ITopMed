import { Activity, Building2, CalendarDays, DoorOpen, KeyRound, LifeBuoy, Stethoscope, UserRound, GitBranch, LayoutDashboard, ScrollText, Settings, ShieldCheck, Users } from "lucide-react";

/** Icons are referenced by name so server components can pass them to client nav. */
const ICONS = {
  dashboard: LayoutDashboard,
  clinics: Building2,
  staff: Users,
  audit: ScrollText,
  settings: Settings,
  branches: GitBranch,
  shield: ShieldCheck,
  activity: Activity,
  roles: KeyRound,
  support: LifeBuoy,
  calendar: CalendarDays,
  doctors: UserRound,
  services: Stethoscope,
  facilities: DoorOpen,
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  const C = ICONS[name];
  return <C aria-hidden className={className} strokeWidth={1.75} />;
}
