# Kitify Solutions — Project Context

Contractor-facing dealer & training portal for Kitify (bathroom renovation kits). This file primes Claude Code on how the project is built and how to work in it.

## Stack
- Next.js 15 (App Router) · TypeScript · Tailwind CSS v4 · deployed on Vercel
- Icons: `lucide-react`
- No other runtime dependencies. Keep it lean — check before adding packages.

## Run
```
npm install
npm run dev      # http://localhost:3000
npm run build    # must pass before considering a change done
```
Windows/PowerShell environment.

## Architecture
```
app/
  page.tsx              Login / launch page (mock auth)
  request-access/       Public request-access form (no backend yet)
  portal/
    layout.tsx          Auth guard + Sidebar + Header shell
    dashboard/          Landing: blog, product updates, featured, leads, orders
    training/ register-job/ work-samples/ claims/
    order-tracking/ orders/ configurator/   One folder per page
    approvals/ content/  Admin-only pages
components/             Sidebar, Header, contexts, Brand, PagePlaceholder
lib/
  i18n.ts               ALL user-facing strings (EN + ES)
  nav.ts                Sidebar nav config
```

## Conventions (follow these)
- **Bilingual is non-negotiable.** Every user-facing string lives in `lib/i18n.ts` under both `en` and `es`. Never hardcode display text in a component — add a key and use `t("group.key")` (or `tList` for arrays). The EN/ES toggle must keep working, including on the login page.
- **Design tokens** are defined in `app/globals.css` under `@theme` (Tailwind v4). Use the semantic utilities: `bg-ink`, `text-accent`, `border-line`, `bg-card`, `text-muted`, `bg-amber`, `font-display`, `font-mono`. Don't introduce raw hex in components.
- **Adding a page** = three edits: create `app/portal/<name>/page.tsx`, add its strings to `lib/i18n.ts` (both languages), add an entry to `lib/nav.ts`.
- Client components need `"use client"` when they use hooks/context (most pages do, because of `t()`).
- Keep `npm run build` green.

## What's mocked on purpose (don't "fix" without being asked)
- **Auth** (`components/AuthContext.tsx`) — any credentials work, role picked at sign-in, persisted to localStorage. Placeholder until real auth is chosen.
- **Request access** (`app/request-access/page.tsx`) — shows a confirmation, sends nothing.
- **Page bodies** — every `app/portal/*` page renders `PagePlaceholder` describing what it will do.

## Build phase & priorities
This is the framework/skeleton. Build-out order:
1. Foundation (done): login, request-access, dashboard, nav, EN/ES, placeholder pages.
2. **Space configurator** (next, highest priority) — contractor photographs a client's space and previews Kitify products over it. Approach still undecided: photorealistic AI render vs. AR/exact-product overlay vs. simple manual overlay. Confirm direction before building.
3. Transactional — order tracking, order placement + payment (pricing varies by partner level), leads routing.

Partner levels: one flat level now, architected for three tiers (Certified Installer → Certified Partner → Master Partner) with per-level pricing later.

## Reference docs (in the project workspace, not code)
- `Kitify_Dealer_Portal_Outline_v2.md` — the functional spec this scaffold implements.
