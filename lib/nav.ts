import {
  LayoutDashboard,
  GraduationCap,
  ClipboardCheck,
  Camera,
  ShieldAlert,
  Package,
  FolderKanban,
  Wand2,
  Inbox,
  FileText,
  Users,
  FileSearch,
  Building2,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  key: string; // i18n key under "nav"
  href: string;
  icon: LucideIcon;
  adminOnly?: boolean;
};

// Primary partner-facing navigation.
export const primaryNav: NavItem[] = [
  { key: "dashboard", href: "/portal/dashboard", icon: LayoutDashboard },
  { key: "training", href: "/portal/training", icon: GraduationCap },
  { key: "registerJob", href: "/portal/register-job", icon: ClipboardCheck },
  { key: "workSamples", href: "/portal/work-samples", icon: Camera },
  { key: "claims", href: "/portal/claims", icon: ShieldAlert },
  // Single Orders hub — replaces the old "Order tracking" + "Place an order" items.
  { key: "orders", href: "/portal/orders", icon: Package },
  { key: "projects", href: "/portal/projects", icon: FolderKanban },
  { key: "configurator", href: "/portal/configurator", icon: Wand2 },
];

// Admin-only navigation, shown when the signed-in user has the admin role.
export const adminNav: NavItem[] = [
  { key: "crm", href: "/portal/admin/crm", icon: Users, adminOnly: true },
  { key: "leads", href: "/portal/admin/leads", icon: FileSearch, adminOnly: true },
  { key: "insideLeads", href: "/portal/admin/inside-leads", icon: Building2, adminOnly: true },
  { key: "approvals", href: "/portal/approvals", icon: Inbox, adminOnly: true },
  { key: "content", href: "/portal/content", icon: FileText, adminOnly: true },
];
