// Which portal pages get a fixed nav column and which collapse it to a slide-over.
//
// Pure route/layout constants, deliberately free of React and JSX so the rule can be
// imported and exercised on its own. The provider that applies it lives in
// components/SidebarContext.tsx.

export type SidebarMode = "fixed" | "collapsible";

// Panel width, as static class strings so Tailwind's scanner can see the arbitrary values.
// The layout's grid column and the sidebar's panel must agree, so both are defined here
// rather than typed separately into each file.
export const SIDEBAR_PANEL_WIDTH = "w-[260px]";
export const SIDEBAR_GRID_COLS = "grid-cols-[260px_1fr]";

// Below this width every page is collapsible, whatever the route: tablets and phones need
// the full width for content. 1024px is Tailwind's `lg`, and phones (<768px) fall under it
// too, so one rule covers both.
export const WIDE_VIEWPORT = "(min-width: 1024px)";

// Focused-work routes, matched exactly.
const FOCUSED_EXACT = ["/portal/configurator"];

// Detail-page parents. A path is a detail page when it is one of these plus EXACTLY one more
// segment — that segment count is what keeps a list page (/portal/orders) fixed while its
// detail page (/portal/orders/abc123) collapses. Anything deeper is not treated as one.
const FOCUSED_DETAIL_PARENTS = ["/portal/orders", "/portal/projects", "/portal/admin/crm"];

/** True when a path is a focused-work page, where the nav should get out of the way. */
export function isFocusedRoute(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (FOCUSED_EXACT.includes(path)) return true;
  return FOCUSED_DETAIL_PARENTS.some((parent) => {
    if (!path.startsWith(parent + "/")) return false;
    const rest = path.slice(parent.length + 1);
    return rest.length > 0 && !rest.includes("/");
  });
}

/**
 * The mode for a route at a given viewport. Viewport wins: a narrow screen is always
 * collapsible, and only at >=1024px does the route get a say.
 */
export function resolveSidebarMode(pathname: string, isWideViewport: boolean): SidebarMode {
  return isWideViewport && !isFocusedRoute(pathname) ? "fixed" : "collapsible";
}
