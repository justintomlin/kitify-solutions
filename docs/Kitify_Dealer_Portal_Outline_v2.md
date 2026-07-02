# Kitify Dealer & Training Portal — Functional Outline (v2)

*Contractor-facing dealer portal. End-user / homeowner-facing tools are a separate later project. This phase is a foundational build-out; several pieces ship as basic versions or placeholders and get fully built in later updates.*

---

## 0. Global Requirements (apply everywhere)

- **Bilingual from day one.** A button toggles the entire portal between **English and Spanish**, including the login page. Built as real localization (all text externalized), not a bolt-on — this shapes the tech approach from the start.
- **Manual approval + manual account creation.** No self-serve signup. Admin reviews every request and creates the account.
- **Standalone build.** Assume **no existing systems to connect** (no SpaceLogic, Formspree, or order/payment integration). Marc has a configurator, but its use is undecided — don't design around it.
- **Tier-ready pricing.** One partner level at launch, but architected so **three levels** (Certified Installer → Certified Partner → Master Partner) can switch on, with **pricing that varies per level**.

---

## 1. Purpose

The portal is the platform layer — it trains, certifies, transacts, and creates belonging. This phase stands up the contractor-facing foundation so partners can be onboarded and certified while heavier pieces get built out.

---

## 2. Access Model

| State | Who | Access |
|---|---|---|
| **Prospect** (pre-login) | Requested access, not yet approved | Login page + request form only |
| **User** | Approved partner | Full portal, scoped to their own data |
| **Administrator** | Kitify staff | Everything + management/approval tools |

**At launch:** one flat User level. **Built for:** the three-tier ladder, where level drives pricing and which pages/leads a partner can access. Tiering is architected now, switched on later.

---

## 3. Public Zone (Pre-Login)

### 3.1 Login Page (standalone)
- Kitify branding / logo
- **EN / ES toggle**
- Username field
- Password field
- **Log In** button
- "Request Access" link → §3.2

### 3.2 Request Access Flow
Captures enough to reach out and set them up:
- Name
- Company / business name
- Email
- Phone
- Location / territory (city, state)
- Trade or role
- Rough volume (bathrooms per month)
- How they heard about Kitify

**After submit:** lands in the Admin queue as a lead → admin reviews → **admin manually creates the account** and credentials → welcome email. Every request is a tracked lead so nothing falls through.

---

## 4. Authenticated Zone — Dashboard (Main Landing)

Personalized on login: *"Welcome back, [Name]"* plus certification badge/level. EN/ES toggle in the header.

**Navigation:** top header + left-side tabbed menu.

**Dashboard modules:**
- **Blog space**
- **Product updates**
- **Featured projects** (pulls from approved work samples, §5.3)
- **Leads tracking** — leads routed to this partner
- **Order overview** — snapshot of open/recent orders *(populates once ordering ships in Phase 3; placeholder module until then)*

---

## 5. Core Pages

### 5.1 Training Course — "Kitify University"
- **Does:** delivers the certification curriculum (maps to the 5-module structure in the Vision doc).
- **Elements:** modules, quizzes, progress tracking, certificate issuance.
- **Status:** page built in Phase 1. **Certification requirements per level are a placeholder** — David + JT to define before the detail is finalized.
- **Admin:** publish/edit modules, view completion, issue/revoke certification.

### 5.2 Register a Job — Warranty Registration + Tracking
- **Does:** logs each completed install for warranty coverage and job history.
- **Elements:** job address, product/kit used, install date, homeowner contact, warranty start, unique job ID.
- **Admin:** view/search all registered jobs.

### 5.3 Upload Work Samples — Certification Maintenance
- **Does:** partners submit install photos/video to earn and maintain certification.
- **Elements:** upload per job, tagging, review status; approved samples feed Featured Projects.
- **Status:** exact submission/review requirements tie to §5.1 and are **placeholder pending the David conversation**.
- **Admin:** review queue, approve/reject, flag recertification.

### 5.4 Claims
- **Does:** file and track warranty/product claims against a registered job.
- **Status:** **create the page and a placeholder** now. Full scope pending David + JT discussion.
- **Admin:** triage, assign, resolve, report.

### 5.5 Order Tracking
- **Does:** status of placed orders (confirmed → production → shipped → delivered).
- **Status:** ships with ordering in Phase 3.

### 5.6 Order Placement + Payment
- **Does:** partner configures/places an order and pays, with **pricing by partner level**.
- **Status:** **basic build-out only this phase**, fully built in later updates. Now sequenced into Phase 3.

### 5.7 AI Picture Configurator — *elevated priority; nearly as important as anything else*
- **Does:** a **contractor** photographs the client's space; the tool overlays Kitify products so the space can be visualized before buying. On-site closing tool for the contractor (homeowner self-serve is the later end-user project).
- **Status:** **needs to be figured out or built** — no assumed existing system. This phase’s marquee piece.
- **Core UX:** capture photo → select products → see the space rendered with them → save/share → hand to a quote or order.

**Approaches to evaluate (the key decision):**
1. **Generative AI render (inpainting).** Upload photo; AI re-renders the room with chosen products. Most photorealistic, most flexible. Risk: the rendered product can *drift* from the actual SKU that ships — fidelity/accuracy needs guardrails.
2. **AR / plane-detection overlay.** Detect wall/floor planes (phone camera or LiDAR), composite the *actual* product textures with correct perspective. Shows the real product accurately; heavier engineering.
3. **Manual overlay ("sticker").** User drags/scales product cutouts onto the photo. Cheapest and fastest to ship; least convincing (not perspective-aware). Good candidate for a v0 proof-of-concept.
4. **Third-party visualizer / partner.** License an existing room-visualization service, or revisit Marc's configurator. Fastest to market; least control.

**The trade-off to resolve:** photorealism vs. exact-product fidelity vs. build cost/speed. That single call drives everything else about this piece.

---

## 6. Administrator Capabilities

- Approve/deny access requests and **manually create accounts** (§3.2)
- Publish blog posts, product updates, featured projects
- Review/approve/reject work samples; manage certification status
- View all leads, jobs, claims, and orders across partners
- Manage Kitify University curriculum
- Manage EN/ES content for anything editable
- (Later) tier management + per-level pricing; lead routing by territory/tier

---

## 7. Decisions Locked / Still Open

**Locked this round:**
- One level now, three tiers later, pricing per level ✔
- Ordering + payment: basic now, full later ✔
- Contractor-facing only this phase; end-user tools later project ✔
- Manual approval + manual account creation ✔
- No existing systems to connect; Marc's configurator undecided ✔
- Bilingual EN/ES toggle required from the start ✔
- Monetization (pay-2-play) deliberately **not** a focus now ✔

**Still open (owner):**
- Claims full scope — *David + JT*
- Certification requirements per level — *David + JT*
- Picture configurator approach (§5.7) — *needs a decision to scope*
- Whether Marc's configurator gets used at all

---

## 8. Build Sequencing (Phase 2 and 3 swapped)

- **Phase 1 — Foundation.** Login + request-access + manual approval/account creation, EN/ES toggle, dashboard shell, blog / product updates / featured projects, training course (cert detail placeholder), register-a-job, upload work samples, claims (placeholder page).
- **Phase 2 — AI Picture Configurator.** Elevated; the differentiator. Approach decision in §5.7 comes first.
- **Phase 3 — Transactional.** Order tracking, order placement + basic payment (tier pricing), leads routing.
