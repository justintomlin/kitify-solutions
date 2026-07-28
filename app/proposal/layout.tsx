import type { Metadata } from "next";

// Public proposal routes get their own neutral, contractor-forward metadata — no Kitify /
// "Partner Portal" branding in the browser tab — overriding the root layout's title for this
// subtree only. The client page further sets document.title to the proposal's own name once
// loaded. Also noindex: a shared homeowner link should never be search-indexed.
export const metadata: Metadata = {
  title: "Proposal",
  robots: { index: false, follow: false },
};

export default function ProposalLayout({ children }: { children: React.ReactNode }) {
  return children;
}
