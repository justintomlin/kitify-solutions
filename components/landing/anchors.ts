/**
 * Anchor navigation for the public landing page.
 *
 * The landing page is a single scrolling document, so every nav link is an
 * in-page anchor rather than a route. Two things live here so the nav bar, the
 * mobile menu and the hero's secondary CTA all agree:
 *
 *   - SECTIONS is the one list of anchor targets. The nav renders from it and
 *     the page tags its <section> ids from it, so a rename can't drift into a
 *     link that scrolls nowhere.
 *   - scrollToAnchor() does the scrolling in JS instead of relying on
 *     `scroll-behavior: smooth` in globals.css. globals.css is shared with the
 *     portal, and the portal has no use for smooth scrolling; doing it here
 *     keeps the landing page's behaviour inside the landing page.
 */

/** Anchor targets, in nav order (which is also page order). */
export const SECTIONS = [
  { id: "how", labelKey: "landing.nav.how" },
  { id: "kit", labelKey: "landing.nav.kit" },
  { id: "partners", labelKey: "landing.nav.partners" },
  { id: "platform", labelKey: "landing.nav.platform" },
  { id: "about", labelKey: "landing.nav.about" },
  { id: "faq", labelKey: "landing.nav.faq" },
] as const;

/**
 * Smooth-scroll to a section, honouring prefers-reduced-motion.
 *
 * The links stay real `<a href="#id">` elements — this only intercepts the
 * default jump when JS is running, so middle-click, "copy link address" and a
 * no-JS load all still work. `scroll-mt-*` on the section handles the offset
 * for the sticky nav bar; scrollIntoView respects it.
 */
export function scrollToAnchor(e: React.MouseEvent<HTMLAnchorElement>, id: string) {
  const el = typeof document !== "undefined" ? document.getElementById(id) : null;
  if (!el) return; // let the browser's own anchor handling try instead
  e.preventDefault();
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  // Keep the URL shareable without pushing a history entry per click.
  window.history.replaceState(null, "", `#${id}`);
}
