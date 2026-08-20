import {
  LayoutDashboard,
  Settings,
  GraduationCap,
  Briefcase,
  Package,
  FolderKanban,
  Wand2,
  Inbox,
  FileText,
  Users,
  FileSearch,
  Building2,
  Boxes,
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
  // My Jobs replaces the old "Register a job" / "Work samples" / "Claims" items — the
  // install → warranty → claim lifecycle now lives in one tabbed page.
  { key: "myJobs", href: "/portal/my-jobs", icon: Briefcase },
  // The contractor's own homeowner book — distinct from the admin CRM (which tracks
  // contractors) even though both use the Users icon.
  { key: "myCustomers", href: "/portal/my-customers", icon: Users },
  // Single Orders hub — replaces the old "Order tracking" + "Place an order" items.
  { key: "orders", href: "/portal/orders", icon: Package },
  { key: "projects", href: "/portal/projects", icon: FolderKanban },
  { key: "configurator", href: "/portal/configurator", icon: Wand2 },
  // Company branding shown on every shared proposal — see app/portal/settings.
  { key: "settings", href: "/portal/settings", icon: Settings },
];

// Admin-only navigation, shown when the signed-in user has the admin role.
export const adminNav: NavItem[] = [
  { key: "crm", href: "/portal/admin/crm", icon: Users, adminOnly: true },
  { key: "leads", href: "/portal/admin/leads", icon: FileSearch, adminOnly: true },
  { key: "insideLeads", href: "/portal/admin/inside-leads", icon: Building2, adminOnly: true },
  // Kitify's OWN stock — SKU/component level, admin-only at every layer (nav, page guard,
  // RLS). Never surfaced to a contractor.
  { key: "inventory", href: "/portal/admin/inventory", icon: Boxes, adminOnly: true },
  { key: "approvals", href: "/portal/approvals", icon: Inbox, adminOnly: true },
  { key: "content", href: "/portal/content", icon: FileText, adminOnly: true },
];
