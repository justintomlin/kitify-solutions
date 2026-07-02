import {
  LayoutDashboard,
  GraduationCap,
  ClipboardCheck,
  Camera,
  ShieldAlert,
  Truck,
  ShoppingCart,
  Wand2,
  Inbox,
  FileText,
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
  { key: "orderTracking", href: "/portal/order-tracking", icon: Truck },
  { key: "orders", href: "/portal/orders", icon: ShoppingCart },
  { key: "configurator", href: "/portal/configurator", icon: Wand2 },
];

// Admin-only navigation, shown when the signed-in user has the admin role.
export const adminNav: NavItem[] = [
  { key: "approvals", href: "/portal/approvals", icon: Inbox, adminOnly: true },
  { key: "content", href: "/portal/content", icon: FileText, adminOnly: true },
];
