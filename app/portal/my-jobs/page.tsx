"use client";

// My Jobs — the consolidated install → warranty → claim lifecycle, replacing the old
// "Register a job" / "Work samples" / "Claims" placeholder pages.
//
//   Registered Jobs — delivered orders waiting to be registered, plus everything already
//                     installed. Registering an install completes the order, stores the
//                     completion photos and activates warranty coverage in one step.
//   Portfolio       — pick the best completion photos across jobs (slideshow builder).
//   Claims          — file a warranty claim against a registered job and track it.
//
// Photos go to the 'job-photos' Supabase Storage bucket (see lib/storage.ts). That bucket
// does not exist yet, so uploads are treated as best-effort everywhere: the registration
// and the claim still succeed, and the UI says the photos can be added later.
//
// Both photo pickers are <PhotoUpload>, which uploads on selection rather than on submit —
// so by the time these forms submit they are only writing URLs that already exist.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Camera, CheckCircle2, ShieldAlert, Truck, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import { useAuth } from "@/components/AuthContext";
import { useToast, ToastView } from "@/components/Toast";
import { PhotoUpload } from "@/components/PhotoUpload";
import { WarrantyStatusChip, ClaimStatusChip } from "@/components/projects/ui";
import { createClaim, listClaims, listOrders, updateOrder, type Claim, type Order } from "@/lib/store";
import { claimLines, claimProductLabel, PRODUCT_KEY_LABEL } from "@/lib/claim-scope";

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—");

const MAX_PORTFOLIO = 10;
const MIN_PORTFOLIO = 4;
const MAX_CLAIM_PHOTOS = 5;

// Photo tags ride in the storage filename — completion_photos is a jsonb array of URL
// strings, so encoding the tag there keeps that shape (and the Order type) unchanged.
const TAGS = ["before", "during", "finished", "detail", "full-room"] as const;
type Tag = (typeof TAGS)[number];
const TAG_KEY: Record<Tag, string> = {
  before: "myJobs.tagBefore",
  during: "myJobs.tagDuring",
  finished: "myJobs.tagFinished",
  detail: "myJobs.tagDetail",
  "full-room": "myJobs.tagFullRoom",
};

// Claim line items come from the frozen order snapshot — never from the live quote. The
// two-shape rule (bare 'shower' vs bathroom-scoped 'b-4f2a91:shower') lives in lib/claim-scope,
// where it is testable; here we only pull the snapshot's quote out of the order.
type Snap = { quote?: unknown } | null;
const snapshotQuote = (o: Order | undefined) => (o?.snapshot as Snap)?.quote ?? null;

const BTN = "inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50";
const BTN_GHOST = "inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-medium text-muted transition hover:text-ink disabled:opacity-50";
const FIELD = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none";

type Tab = "registered" | "portfolio" | "claims";

export default function MyJobsPage() {
  const { t } = useLanguage();
  const { userId } = useAuth();
  const { toast, showToast } = useToast(6000);

  const [tab, setTab] = useState<Tab>("registered");
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(() => {
    if (!userId) return;
    setLoadFailed(false);
    listOrders({ ownerId: userId })
      .then(setOrders)
      .catch(() => { setOrders([]); setLoadFailed(true); });
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  const TABS: { key: Tab; label: string }[] = [
    { key: "registered", label: t("myJobs.tabRegistered") },
    { key: "portfolio", label: t("myJobs.tabPortfolio") },
    { key: "claims", label: t("myJobs.tabClaims") },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <ToastView toast={toast} />

      <div className="mb-5">
        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{t("myJobs.title")}</div>
        <p className="mt-1 text-sm text-muted">{t("myJobs.subtitle")}</p>
      </div>

      {/* Tabs — scroll horizontally on phones */}
      <div className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-card p-1">
        {TABS.map((tb) => (
          <button key={tb.key} onClick={() => setTab(tb.key)}
            className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition ${tab === tb.key ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"}`}>
            {tb.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {orders === null ? (
          <Panel>{t("myJobs.loading")}</Panel>
        ) : loadFailed ? (
          <Panel>{t("myJobs.error")}</Panel>
        ) : tab === "registered" ? (
          <RegisteredTab orders={orders} onDone={(msg) => { showToast(msg); load(); }} />
        ) : tab === "portfolio" ? (
          <PortfolioTab orders={orders} />
        ) : (
          <ClaimsTab orders={orders} ownerId={userId ?? ""} onDone={showToast} />
        )}
      </div>
    </div>
  );
}

// --------------------------- tab 1 — registered ---------------------------
function RegisteredTab({ orders, onDone }: { orders: Order[]; onDone: (msg: string) => void }) {
  const { t } = useLanguage();
  const [openId, setOpenId] = useState<string | null>(null);

  // Delivered-but-not-completed orders are the registration queue; everything installed
  // (or already warranty-registered) is the history below it.
  const ready = orders.filter((o) => o.status === "delivered");
  const registered = orders.filter((o) => o.status === "completed" || (!!o.warrantyRegisteredAt && o.status !== "delivered"));

  return (
    <div className="space-y-6">
      {ready.length > 0 && (
        <section>
          <div className="mb-2 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            <Truck className="h-3.5 w-3.5" /> {t("myJobs.readyTitle")}
          </div>
          <p className="mb-3 text-sm text-muted">{t("myJobs.readyPrompt")}</p>
          <div className="space-y-2.5">
            {ready.map((o) => (
              <div key={o.id} className="rounded-2xl border border-accent/30 bg-accent-soft/20 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-sm font-bold text-ink">{o.orderNumber}</div>
                    <div className="mt-0.5 truncate text-xs text-muted">{o.customer.name || "—"}</div>
                  </div>
                  <button onClick={() => setOpenId(openId === o.id ? null : o.id)} className={openId === o.id ? BTN_GHOST : BTN}>
                    {openId === o.id ? (<><X className="h-4 w-4" /> {t("myJobs.cancel")}</>) : (<><CheckCircle2 className="h-4 w-4" /> {t("myJobs.registerInstall")}</>)}
                  </button>
                </div>
                {openId === o.id && (
                  <RegistrationForm order={o} onDone={(msg) => { setOpenId(null); onDone(msg); }} />
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        {registered.length === 0 ? (
          <EmptyPanel>{t("myJobs.registeredEmpty")}</EmptyPanel>
        ) : (
          <div className="space-y-2.5">
            {registered.map((o) => {
              const n = o.completionPhotos.length;
              return (
                <div key={o.id} className="rounded-2xl border border-line bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono text-sm font-bold text-ink">{o.orderNumber}</div>
                      <div className="mt-0.5 truncate text-xs text-muted">
                        {t("myJobs.lblCustomer")}: {o.customer.name || "—"}
                      </div>
                    </div>
                    <WarrantyStatusChip status={o.warrantyStatus} />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
                    <span>{t("myJobs.lblInstalled")}: {fmtDate(o.installDate)}</span>
                    <span className="inline-flex items-center gap-1">
                      <Camera className="h-3.5 w-3.5" />
                      {n === 0 ? t("myJobs.noPhotos") : n === 1 ? t("myJobs.photoCountOne") : t("myJobs.photoCount", { n: String(n) })}
                    </span>
                    <Link href={`/portal/orders/${o.id}`} className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-accent transition hover:gap-1.5">
                      {t("myJobs.viewOrder")} <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

// ------------------------- install registration form -------------------------

function RegistrationForm({ order, onDone }: { order: Order; onDone: (msg: string) => void }) {
  const { t } = useLanguage();
  const [installDate, setInstallDate] = useState(order.installDate ?? "");
  // URLs of photos already in storage — PhotoUpload uploads as they're picked.
  const [photos, setPhotos] = useState<string[]>([]);
  // The tag is encoded into the storage filename, which is fixed at upload time, so it has to
  // be chosen BEFORE the pick. It applies to each photo added next.
  const [tag, setTag] = useState<Tag>("finished");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!installDate) { setError(t("myJobs.errInstallDate")); return; }
    if (photos.length === 0) { setError(t("myJobs.errPhotoRequired")); return; }
    setBusy(true);
    setError("");
    try {
      const now = new Date().toISOString();
      // One write closes the loop: order completed, photos stored, warranty activated.
      await updateOrder(order.id, {
        status: "completed",
        installDate,
        completedAt: now,
        completionPhotos: [...order.completionPhotos, ...photos],
        notes: notes.trim() || order.notes,
        warrantyStatus: "registered",
        warrantyRegisteredAt: now,
      });
      onDone(t("myJobs.registered"));
    } catch {
      setError(t("myJobs.errSave"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-4 border-t border-accent/20 pt-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("myJobs.formTitle")}</div>

      <Field label={t("myJobs.fInstallDate")}>
        <input type="date" value={installDate} onChange={(e) => setInstallDate(e.target.value)} className={FIELD + " sm:w-auto"} />
      </Field>

      <Field label={t("myJobs.fPhotos")}>
        <p className="mb-2 text-xs text-muted">{t("myJobs.photosHint")}</p>
        {/* Tag first, then shoot: the stored filename carries the tag and is fixed the moment
            the upload starts, so it can't be re-assigned from the thumbnail afterwards. */}
        <label className="mb-2 flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("myJobs.tag")}</span>
          <select
            value={tag}
            disabled={busy}
            onChange={(e) => setTag(e.target.value as Tag)}
            className="rounded-md border border-line bg-paper px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none disabled:opacity-50"
          >
            {TAGS.map((tg) => <option key={tg} value={tg}>{t(TAG_KEY[tg])}</option>)}
          </select>
        </label>
        <PhotoUpload
          photos={photos}
          onPhotosChange={setPhotos}
          storagePrefix={`orders/${order.id}`}
          tag={tag}
          minPhotos={1}
          disabled={busy}
        />
      </Field>

      <Field label={t("myJobs.fNotes")}>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
          placeholder={t("myJobs.notesPlaceholder")} className={FIELD + " resize-y"} />
      </Field>

      {error && <ErrorNote>{error}</ErrorNote>}
      {/* No upload progress here any more — PhotoUpload reports it per thumbnail as the
          photos are picked, so submit is just the database write. */}

      <button onClick={submit} disabled={busy} className={BTN}>
        <CheckCircle2 className="h-4 w-4" /> {busy ? t("myJobs.submitting") : t("myJobs.submit")}
      </button>
    </div>
  );
}

// ---------------------------- tab 2 — portfolio ----------------------------
function PortfolioTab({ orders }: { orders: Order[] }) {
  const { t } = useLanguage();
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState("");

  const groups = useMemo(() => orders.filter((o) => o.completionPhotos.length > 0), [orders]);

  function toggle(url: string) {
    setNote("");
    setSelected((prev) => {
      if (prev.includes(url)) return prev.filter((u) => u !== url);
      if (prev.length >= MAX_PORTFOLIO) { setNote(t("myJobs.maxReached", { max: String(MAX_PORTFOLIO) })); return prev; }
      return [...prev, url];
    });
  }

  if (groups.length === 0) return <EmptyPanel>{t("myJobs.portfolioEmpty")}</EmptyPanel>;

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">{t("myJobs.portfolioIntro")}</p>

      {groups.map((o) => (
        <section key={o.id}>
          <div className="mb-2 flex flex-wrap items-baseline gap-x-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            <span className="font-bold text-ink">{o.orderNumber}</span>
            <span className="normal-case tracking-normal">{o.customer.name || "—"}</span>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
            {o.completionPhotos.map((url) => {
              const on = selected.includes(url);
              return (
                <button key={url} type="button" onClick={() => toggle(url)}
                  className={`relative aspect-square overflow-hidden rounded-xl border-2 transition ${on ? "border-accent" : "border-line hover:border-accent/50"}`}>
                  {/* Plain <img>: these are user-uploaded Supabase Storage URLs, which
                      next/image would need a remote-pattern allowlist for. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="h-full w-full object-cover" />
                  <span className={`absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border-2 ${on ? "border-accent bg-accent text-white" : "border-white/80 bg-ink/30"}`}>
                    {on && <CheckCircle2 className="h-3 w-3" />}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}

      <div className="sticky bottom-4 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-card p-4 shadow-sm">
        <span className="font-mono text-xs text-muted">
          {t("myJobs.selectedCount", { n: String(selected.length), max: String(MAX_PORTFOLIO) })}
        </span>
        <button onClick={() => setNote(t("myJobs.generateSoon"))} disabled={selected.length < MIN_PORTFOLIO} className={BTN + " ml-auto"}>
          {t("myJobs.generate")}
        </button>
      </div>
      {selected.length < MIN_PORTFOLIO && (
        <p className="text-xs text-muted">{t("myJobs.generateHint", { n: String(MIN_PORTFOLIO) })}</p>
      )}
      {note && <p className="rounded-lg border border-accent/30 bg-accent-soft/30 px-3 py-2 text-sm text-accent">{note}</p>}
    </div>
  );
}

// ------------------------------ tab 3 — claims ------------------------------
function ClaimsTab({ orders, ownerId, onDone }: { orders: Order[]; ownerId: string; onDone: (msg: string) => void }) {
  const { t } = useLanguage();
  const [claims, setClaims] = useState<Claim[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    listClaims().then(setClaims).catch(() => { setClaims([]); setFailed(true); });
  }, []);
  useEffect(() => { load(); }, [load]);

  // Only a warranty-registered job can carry a claim.
  const eligible = orders.filter((o) => o.warrantyStatus === "registered");
  const orderById = new Map(orders.map((o) => [o.id, o]));

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t("myJobs.claimsIntro")}</p>

      {eligible.length === 0 ? (
        <EmptyPanel>{t("myJobs.noEligible")}</EmptyPanel>
      ) : showForm ? (
        <ClaimForm
          orders={eligible}
          ownerId={ownerId}
          onCancel={() => setShowForm(false)}
          onDone={(msg) => { setShowForm(false); onDone(msg); load(); }}
        />
      ) : (
        <button onClick={() => setShowForm(true)} className={BTN}>
          <ShieldAlert className="h-4 w-4" /> {t("myJobs.fileClaim")}
        </button>
      )}

      {claims === null ? (
        <Panel>{t("myJobs.loading")}</Panel>
      ) : failed ? (
        <Panel>{t("myJobs.error")}</Panel>
      ) : claims.length === 0 ? (
        <EmptyPanel>{t("myJobs.claimsEmpty")}</EmptyPanel>
      ) : (
        <div className="space-y-2.5">
          {claims.map((c) => {
            const o = orderById.get(c.orderId);
            return (
              <div key={c.id} className="rounded-2xl border border-line bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-sm font-bold text-ink">{c.claimNumber}</div>
                    <div className="mt-0.5 truncate text-xs text-muted">
                      {t("myJobs.claimOrder")}: {o?.orderNumber ?? "—"}
                    </div>
                  </div>
                  <ClaimStatusChip status={c.status} />
                </div>
                <p className="mt-2.5 text-sm text-ink/80">{c.description}</p>
                <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
                  <span>{t("myJobs.claimFiledOn")}: {fmtDate(c.submittedAt ?? c.createdAt)}</span>
                  {c.affectedProducts.length > 0 && (
                    <span>
                      {t("myJobs.claimProducts")}:{" "}
                      {c.affectedProducts.map((k) => claimProductLabel(k, snapshotQuote(o), t)).join(", ")}
                    </span>
                  )}
                  {c.photos.length > 0 && (
                    <span className="inline-flex items-center gap-1"><Camera className="h-3.5 w-3.5" />{c.photos.length}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ClaimForm({
  orders, ownerId, onDone, onCancel,
}: { orders: Order[]; ownerId: string; onDone: (msg: string) => void; onCancel: () => void }) {
  const { t } = useLanguage();
  const [orderId, setOrderId] = useState("");
  const [products, setProducts] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const order = orders.find((o) => o.id === orderId) ?? null;
  const items = claimLines(snapshotQuote(order ?? undefined), t);

  async function submit() {
    if (!orderId) { setError(t("myJobs.errJob")); return; }
    if (products.length === 0) { setError(t("myJobs.errProducts")); return; }
    if (!description.trim()) { setError(t("myJobs.errDescription")); return; }
    setBusy(true);
    setError("");
    try {
      const claim = await createClaim({
        orderId,
        ownerId,
        affectedProducts: products,
        description: description.trim(),
        photos,
      });
      onDone(t("myJobs.claimFiled", { number: claim.claimNumber }));
    } catch {
      setError(t("myJobs.errClaimSave"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-2xl border border-line bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{t("myJobs.claimFormTitle")}</div>
        <button onClick={onCancel} disabled={busy} aria-label={t("myJobs.cancel")}
          className="rounded-md border border-line p-1.5 text-muted transition hover:text-ink disabled:opacity-50">
          <X className="h-4 w-4" />
        </button>
      </div>

      <Field label={t("myJobs.fJob")}>
        <select value={orderId} onChange={(e) => { setOrderId(e.target.value); setProducts([]); setPhotos([]); }} className={FIELD}>
          <option value="">{t("myJobs.fJobPlaceholder")}</option>
          {orders.map((o) => (
            <option key={o.id} value={o.id}>{o.orderNumber} — {o.customer.name || "—"}</option>
          ))}
        </select>
      </Field>

      {order && (
        <Field label={t("myJobs.fProducts")}>
          {items.length === 0 ? (
            <p className="text-xs text-muted">{t("myJobs.noProducts")}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {items.map((it) => {
                const on = products.includes(it.key);
                return (
                  <label key={it.key}
                    className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition ${on ? "border-accent bg-accent-soft/50 text-accent" : "border-line text-muted hover:text-ink"}`}>
                    <input type="checkbox" checked={on}
                      onChange={() => setProducts((prev) => (on ? prev.filter((x) => x !== it.key) : [...prev, it.key]))} />
                    {/* On a two-bathroom job "Shower" is not an answer — the room comes first,
                        the product second, so the pair reads as one thing being claimed. */}
                    {it.bathroom
                      ? t("myJobs.claimProductScoped", { bathroom: it.bathroom, product: t(PRODUCT_KEY_LABEL[it.kind]) })
                      : t(PRODUCT_KEY_LABEL[it.kind])}
                  </label>
                );
              })}
            </div>
          )}
        </Field>
      )}

      <Field label={t("myJobs.fDescription")}>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4}
          placeholder={t("myJobs.descriptionPlaceholder")} className={FIELD + " resize-y"} />
      </Field>

      <Field label={t("myJobs.fClaimPhotos", { max: String(MAX_CLAIM_PHOTOS) })}>
        {/* Photos land under claims/<orderId>, so a job has to be picked first — and changing
            the job clears them, since anything already uploaded sits under the old job's path. */}
        {order ? (
          <PhotoUpload
            photos={photos}
            onPhotosChange={setPhotos}
            storagePrefix={`claims/${orderId}`}
            maxPhotos={MAX_CLAIM_PHOTOS}
            disabled={busy}
          />
        ) : (
          <p className="text-xs text-muted">{t("myJobs.claimPhotosPickJob")}</p>
        )}
      </Field>

      {error && <ErrorNote>{error}</ErrorNote>}

      <button onClick={submit} disabled={busy} className={BTN}>
        <ShieldAlert className="h-4 w-4" /> {busy ? t("myJobs.submittingClaim") : t("myJobs.submitClaim")}
      </button>
    </div>
  );
}

// --------------------------------- pieces ----------------------------------
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{label}</div>
      {children}
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-line bg-paper/60 p-8 text-center text-sm text-muted">{children}</div>;
}

function EmptyPanel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-line bg-paper/50 p-10 text-center text-sm text-muted">{children}</div>;
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-amber/30 bg-amber/10 px-3 py-2 text-sm text-amber">{children}</p>;
}
