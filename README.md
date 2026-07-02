# Kitify Solutions — Partner Portal (Scaffold)

Contractor-facing dealer & training portal. Next.js 15 (App Router) · TypeScript · Tailwind CSS v4. Same stack as kitifydwellings.com, so it deploys to Vercel the same way.

This is the **framework**: login, request-access, dashboard, full navigation, an EN/ES language toggle, and every page stubbed as a placeholder. The pieces get built out from here.

---

## Run it locally (PowerShell / CMD)

From the folder where you unzipped this project:

```
cd kitify-solutions
npm install
npm run dev
```

Then open http://localhost:3000

**To sign in:** type anything for username/password, pick **Partner** or **Administrator** under "Demo — sign in as," and click **Sign in**. (Auth is mocked for the scaffold — see below.) Admins see two extra menu items (Access requests, Content).

The **EN / ES** button (top-right, and on the login page) switches the whole portal between English and Spanish.

---

## Deploy to Vercel

Option A — from the dashboard: push this folder to a new GitHub repo, then "Import Project" in Vercel. No settings to change; it detects Next.js.

Option B — from the CLI:

```
npm i -g vercel
vercel
```

Follow the prompts. `vercel --prod` publishes the production URL you can share.

---

## What's mocked (replace when building out)

- **Auth** — `components/AuthContext.tsx`. Any credentials work and the role is picked at sign-in. Swap for real authentication.
- **Request access** — `app/request-access/page.tsx` shows a confirmation but sends nothing. Wire to the admin approvals queue.
- **All page bodies** — every file under `app/portal/*` renders a placeholder describing what it will do.

## Where things live

```
app/
  page.tsx                 Login / launch page
  request-access/          Public "request access" form
  portal/
    layout.tsx             Auth guard + sidebar + header shell
    dashboard/             Landing: blog, product updates, featured, leads, orders
    training/ ... etc.     One folder per page
    approvals/ content/    Admin-only pages
components/                Sidebar, Header, contexts, brand mark, placeholder
lib/
  i18n.ts                  All EN/ES strings live here
  nav.ts                   Sidebar navigation config
```

To add a page: create `app/portal/<name>/page.tsx`, add its strings to `lib/i18n.ts`, and add an entry to `lib/nav.ts`.
