"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Check, Truck, CheckCircle2, ShieldCheck, Camera, Ban, ChevronRight, Settings2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import { useAuth } from "@/components/AuthContext";
import {
  canTransition, getOrder, updateOrder, updateOrderStatus, InvalidStatusTransition,
  type Order, type OrderStatus, type OrderStatusFields,
} from "@/lib/store";
import { OrderStatusChip, WarrantyStatusChip } from "@/components/projects/ui";
import { RoomPlanSVG, type RoomConfig } from "@/components/room/RoomConfigurator";
import { ShowerPreviewFromConfig, type ShowerConfig } from "@/components/shower/ShowerConfigurator";
import { VanityPreviewFromConfig, type VanityConfig } from "@/components/vanity/VanityConfigurator";
import { PlumbingPreviewFromConfig, type PlumbingConfig } from "@/components/plumbing/PlumbingConfigurator";

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—");

// The snapshot is the frozen source of truth — we never read back to the live quote/project.
type Snap = {
  retailTotal?: number;
  project?: { name?: string | null } | null;
  quote?: { name?: string | null; room?: unknown; shower?: unknown; vanity?: unknown; plumbing?: unknown } | null;
} | null;

// order status → chip/label i18n key (reuses the keys that back OrderStatusChip)
const STATUS_KEY: Record<OrderStatus, string> = {
  submitted: "projects.oStatusSubmitted",
  confirmed: "projects.oStatusConfirmed",
  in_production: "projects.oStatusInProduction",
  ready_to_ship: "projects.oStatusReadyToShip",
  in_transit: "projects.oStatusInTransit",
  delivered: "projects.oStatusDelivered",
  completed: "projects.oStatusCompleted",
  cancelled: "projects.oStatusCancelled",
};

// The one pipeline step an admin can take from each status. ready_to_ship is the only one
// that needs input first (carrier / tracking / ETA), so it opens the inline form instead.
const NEXT_ACTION: Partial<Record<OrderStatus, { to: OrderStatus; labelKey: string; needsForm?: boolean }>> = {
  submitted: { to: "confirmed", labelKey: "orders.actConfirm" },
  confirmed: { to: "in_production", labelKey: "orders.actProduction" },
  in_production: { to: "ready_to_ship", labelKey: "orders.actReadyToShip" },
  ready_to_ship: { to: "in_transit", labelKey: "orders.actShip", needsForm: true },
  in_transit: { to: "delivered", labelKey: "orders.actDelivered" },
};

const ADMIN_BTN = "inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50";
const ADMIN_GHOST = "inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-medium text-muted transition hover:text-ink disabled:opacity-50";
const ADMIN_INPUT = "w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none";

export default function OrderDetailPage() {
  const { t } = useLanguage();
  const { isAdmin } = useAuth();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [order, setOrder] = useState<Order | null | undefined>(undefined); // undefined = loading
  const [installInput, setInstallInput] = useState("");
  const [busy, setBusy] = useState<null | "install" | "complete" | "warranty">(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    getOrder(id).then((o) => { setOrder(o); setInstallInput(o?.installDate ?? ""); });
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function run(kind: "install" | "complete" | "warranty", patch: Parameters<typeof updateOrder>[1]) {
    setBusy(kind);
    setError("");
    try {
      const updated = await updateOrder(id, patch);
      setOrder(updated);
      setInstallInput(updated.installDate ?? "");
    } catch {
      setError(t("orders.actionError"));
    } finally {
      setBusy(null);
    }
  }
  // ---- admin pipeline actions (rendered only when isAdmin) ----
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminError, setAdminError] = useState("");
  const [shipOpen, setShipOpen] = useState(false);
  const [ship, setShip] = useState({ carrier: "", tracking: "", eta: "" });
  const [confirmCancel, setConfirmCancel] = useState(false);

  async function advance(to: OrderStatus, fields?: OrderStatusFields) {
    setAdminBusy(true);
    setAdminError("");
    try {
      const updated = await updateOrderStatus(id, to, fields);
      setOrder(updated);
      setInstallInput(updated.installDate ?? "");
      setShipOpen(false);
      setConfirmCancel(false);
      setShip({ carrier: "", tracking: "", eta: "" });
    } catch (e) {
      // A rejected transition means this page is stale, which is worth saying plainly.
      setAdminError(t(e instanceof InvalidStatusTransition ? "orders.transitionError" : "orders.actionError"));
    } finally {
      setAdminBusy(false);
    }
  }

  function submitShip() {
    if (!ship.carrier.trim() || !ship.tracking.trim() || !ship.eta) {
      setAdminError(t("orders.shipRequired"));
      return;
    }
    advance("in_transit", {
      carrier: ship.carrier.trim(),
      trackingNumber: ship.tracking.trim(),
      estimatedDelivery: ship.eta,
    });
  }

  const saveInstall = () => run("install", { installDate: installInput || null });
  const markCompleted = () => {
    if (!installInput) { setError(t("orders.installRequired")); return; }
    run("complete", { status: "completed", installDate: installInput, completedAt: new Date().toISOString() });
  };
  const registerWarranty = () => run("warranty", { warrantyStatus: "registered", warrantyRegisteredAt: new Date().toISOString() });

  const backLink = (
    <Link href="/portal/orders" className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-ink">
      <ArrowLeft className="h-4 w-4" /> {t("orders.back")}
    </Link>
  );

  if (order === undefined) {
    return <div className="mx-auto max-w-3xl"><div className="rounded-2xl border border-line bg-paper/60 p-8 text-center text-sm text-muted">{t("orders.loading")}</div></div>;
  }
  if (order === null) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        {backLink}
        <div className="rounded-2xl border border-dashed border-line bg-paper/50 p-10 text-center text-sm text-muted">{t("orders.notFound")}</div>
      </div>
    );
  }

  const snap = order.snapshot as Snap;
  const room = (snap?.quote?.room as RoomConfig | null) ?? null;
  const shower = (snap?.quote?.shower as ShowerConfig | null) ?? null;
  const vanity = (snap?.quote?.vanity as VanityConfig | null) ?? null;
  const plumbing = (snap?.quote?.plumbing as PlumbingConfig | null) ?? null;
  const hasProducts = !!(shower || vanity || plumbing);
  const addr = order.address;
  const addrLine = addr ? [addr.street, [addr.city, addr.state, addr.zip].filter(Boolean).join(", ")].filter(Boolean).join(" · ") : "";
  const hasShipping = !!(order.carrier || order.trackingNumber || order.actualDelivery);
  const showCompletion = order.status === "delivered" || order.status === "completed";
  const showWarranty = order.status === "completed";

  // Timeline steps + which one is current
  const steps: { status: OrderStatus; ts: string | null }[] = [
    { status: "submitted", ts: order.placedAt },
    { status: "confirmed", ts: order.confirmedAt },
    { status: "in_production", ts: null },
    { status: "ready_to_ship", ts: null },
    { status: "in_transit", ts: order.shippedAt },
    { status: "delivered", ts: order.deliveredAt },
    { status: "completed", ts: order.completedAt },
  ];
  const currentIdx = steps.findIndex((s) => s.status === order.status); // -1 when cancelled

  // Admin pipeline: the single next step, and whether cancelling is still on the table.
  // Both read from the store's canTransition rule so the UI can't offer an invalid move.
  const nextAction = NEXT_ACTION[order.status];
  const cancellable = canTransition(order.status, "cancelled");

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {backLink}

      {/* Header */}
      <div className="rounded-2xl border border-line bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-display text-xl font-bold tracking-tight text-ink">{order.orderNumber}</div>
            <div className="mt-1 text-xs text-muted">{t("orders.placed")}: {fmtDate(order.placedAt)}</div>
          </div>
          <OrderStatusChip status={order.status} />
        </div>
      </div>

      {/* Customer */}
      <Section title={t("orders.sectionCustomer")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Detail label={t("orders.customer")}>{order.customer.name || "—"}</Detail>
          <Detail label={t("orders.lblEmail")}>{order.customer.email || "—"}</Detail>
          <Detail label={t("orders.lblPhone")}>{order.customer.phone || "—"}</Detail>
          <Detail label={t("orders.lblAddress")}>{addrLine || "—"}</Detail>
        </div>
      </Section>

      {/* What was ordered — rendered from the frozen snapshot */}
      <Section title={t("orders.sectionContents")}>
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <div className="text-sm text-muted">{snap?.project?.name || snap?.quote?.name || ""}</div>
          <div className="text-right">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">{t("orders.orderTotal")}</div>
            <div className="font-display text-2xl font-bold text-ink">{money(snap?.retailTotal ?? 0)}</div>
          </div>
        </div>
        <div className="space-y-5">
          {room?.selections && (
            <div className="mx-auto w-full max-w-[560px]">
              <RoomPlanSVG state={room.selections} interactive={false} showClearances={false} />
            </div>
          )}
          {hasProducts && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {shower && <PreviewCard label={t("configurator.showerTitle")}><ShowerPreviewFromConfig config={shower} /></PreviewCard>}
              {vanity && <PreviewCard label={t("configurator.vanityTitle")}><VanityPreviewFromConfig config={vanity} /></PreviewCard>}
              {plumbing && <PreviewCard label={t("configurator.plumbingTitle")}><PlumbingPreviewFromConfig config={plumbing} /></PreviewCard>}
            </div>
          )}
        </div>
      </Section>

      {/* Admin pipeline controls — never rendered for a contractor */}
      {isAdmin && (
        <Section title={t("orders.adminSection")} icon={<Settings2 className="h-4 w-4 text-muted" />}>
          {!nextAction && !cancellable ? (
            <p className="text-sm text-muted">{t("orders.adminNoActions")}</p>
          ) : (
            <div className="space-y-3">
              {/* Shipping capture — the one step that needs input before it can run */}
              {shipOpen && nextAction?.needsForm ? (
                <div className="space-y-3 rounded-xl border border-line bg-paper/50 p-4">
                  <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("orders.shipFormTitle")}</div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label={t("orders.lblCarrier")}>
                      <input value={ship.carrier} onChange={(e) => setShip((s) => ({ ...s, carrier: e.target.value }))}
                        className={ADMIN_INPUT} />
                    </Field>
                    <Field label={t("orders.lblTracking")}>
                      <input value={ship.tracking} onChange={(e) => setShip((s) => ({ ...s, tracking: e.target.value }))}
                        className={ADMIN_INPUT} />
                    </Field>
                    <Field label={t("orders.estDelivery")}>
                      <input type="date" value={ship.eta} onChange={(e) => setShip((s) => ({ ...s, eta: e.target.value }))}
                        className={ADMIN_INPUT} />
                    </Field>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={submitShip} disabled={adminBusy} className={ADMIN_BTN}>
                      <Truck className="h-4 w-4" /> {adminBusy ? t("orders.saving") : t("orders.actShip")}
                    </button>
                    <button onClick={() => { setShipOpen(false); setAdminError(""); }} disabled={adminBusy} className={ADMIN_GHOST}>
                      {t("orders.actKeep")}
                    </button>
                  </div>
                </div>
              ) : confirmCancel ? (
                <div className="space-y-3 rounded-xl border border-amber/40 bg-amber/10 p-4">
                  <p className="text-sm font-medium text-amber">{t("orders.cancelConfirm")}</p>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => advance("cancelled")} disabled={adminBusy}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-amber px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50">
                      <Ban className="h-4 w-4" /> {adminBusy ? t("orders.saving") : t("orders.cancelConfirmYes")}
                    </button>
                    <button onClick={() => { setConfirmCancel(false); setAdminError(""); }} disabled={adminBusy} className={ADMIN_GHOST}>
                      {t("orders.actKeep")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  {nextAction && (
                    <button
                      onClick={() => (nextAction.needsForm ? (setShipOpen(true), setAdminError("")) : advance(nextAction.to))}
                      disabled={adminBusy} className={ADMIN_BTN}>
                      {adminBusy ? t("orders.saving") : t(nextAction.labelKey)} <ChevronRight className="h-4 w-4" />
                    </button>
                  )}
                  {cancellable && (
                    <button onClick={() => { setConfirmCancel(true); setAdminError(""); }} disabled={adminBusy}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-amber/40 px-3 py-2 text-sm font-medium text-amber transition hover:bg-amber/10 disabled:opacity-50">
                      <Ban className="h-4 w-4" /> {t("orders.actCancel")}
                    </button>
                  )}
                </div>
              )}

              {adminError && <p className="rounded-md border border-amber/30 bg-amber/10 px-3 py-2 text-sm text-amber">{adminError}</p>}
            </div>
          )}
        </Section>
      )}

      {/* Timeline */}
      <Section title={t("orders.sectionTimeline")}>
        {order.status === "cancelled" && (
          <div className="mb-3 rounded-lg border border-amber/30 bg-amber/10 px-3 py-2 text-sm text-amber">{t("orders.cancelledNote")}</div>
        )}
        <ol>
          {steps.map((step, i) => {
            const done = currentIdx >= 0 && i < currentIdx;
            const current = i === currentIdx;
            const reached = done || current;
            return (
              <li key={step.status} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${reached ? "border-accent bg-accent text-white" : "border-line bg-card"}`}>
                    {reached && <Check className="h-3 w-3" />}
                  </span>
                  {i < steps.length - 1 && <span className={`min-h-[22px] w-0.5 flex-1 ${done ? "bg-accent" : "bg-line"}`} />}
                </div>
                <div className={`pb-4 ${reached ? "" : "opacity-40"}`}>
                  <div className={`text-sm font-semibold ${current ? "text-accent" : "text-ink"}`}>{t(STATUS_KEY[step.status])}</div>
                  {step.ts && <div className="text-[11px] text-muted">{fmtDate(step.ts)}</div>}
                  {/* Carrier + tracking ride along with the shipping step once captured. */}
                  {step.status === "in_transit" && reached && (order.carrier || order.trackingNumber) && (
                    <div className="text-[11px] text-muted">
                      {[order.carrier, order.trackingNumber].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </Section>

      {/* Shipping — once carrier/tracking exists */}
      <Section title={t("orders.sectionShipping")} icon={<Truck className="h-4 w-4 text-muted" />}>
        {hasShipping ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Detail label={t("orders.lblCarrier")}>{order.carrier || "—"}</Detail>
            <Detail label={t("orders.lblTracking")}>{order.trackingNumber || "—"}</Detail>
            <Detail label={t("orders.estDelivery")}>{fmtDate(order.estimatedDelivery)}</Detail>
            <Detail label={t("orders.lblActualDelivery")}>{fmtDate(order.actualDelivery)}</Detail>
          </div>
        ) : (
          <p className="text-sm text-muted">{t("orders.noShipping")}</p>
        )}
      </Section>

      {/* Completion — once delivered */}
      {showCompletion && (
        <Section title={t("orders.sectionCompletion")} icon={<CheckCircle2 className="h-4 w-4 text-muted" />}>
          <div className="space-y-4">
            <div>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("orders.lblInstallDate")}</div>
              <div className="flex flex-wrap items-center gap-2">
                <input type="date" value={installInput} disabled={order.status === "completed"}
                  onChange={(e) => setInstallInput(e.target.value)}
                  className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none disabled:opacity-60" />
                {order.status === "delivered" && (
                  <button onClick={saveInstall} disabled={busy !== null}
                    className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-muted transition hover:text-ink disabled:opacity-50">
                    {busy === "install" ? t("orders.saving") : t("orders.saveInstall")}
                  </button>
                )}
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted"><Camera className="h-3.5 w-3.5" /> {t("orders.photos")}</div>
              <p className="text-xs text-muted">{t("orders.photosSoon")}</p>
            </div>

            {error && <p className="rounded-md border border-amber/30 bg-amber/10 px-3 py-2 text-sm text-amber">{error}</p>}

            {order.status === "delivered" ? (
              <button onClick={markCompleted} disabled={busy !== null || !installInput}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">
                <CheckCircle2 className="h-4 w-4" /> {busy === "complete" ? t("orders.saving") : t("orders.markCompleted")}
              </button>
            ) : (
              <p className="text-sm text-muted">{t("orders.completedOn", { date: fmtDate(order.completedAt) })}</p>
            )}
          </div>
        </Section>
      )}

      {/* Warranty — once completed */}
      {showWarranty && (
        <Section title={t("orders.sectionWarranty")} icon={<ShieldCheck className="h-4 w-4 text-muted" />}>
          <div className="flex flex-wrap items-center gap-3">
            <WarrantyStatusChip status={order.warrantyStatus} />
            {order.warrantyStatus === "unregistered" ? (
              <button onClick={registerWarranty} disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50">
                <ShieldCheck className="h-4 w-4" /> {busy === "warranty" ? t("orders.registering") : t("orders.registerWarranty")}
              </button>
            ) : (
              <span className="text-sm text-muted">{t("orders.warrantyRegisteredOn", { date: fmtDate(order.warrantyRegisteredAt) })}</span>
            )}
          </div>
          {error && <p className="mt-3 rounded-md border border-amber/30 bg-amber/10 px-3 py-2 text-sm text-amber">{error}</p>}
        </Section>
      )}
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-card p-5">
      <div className="mb-3 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
        {icon}{title}
      </div>
      {children}
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{label}</div>
      <div className="break-words text-sm text-ink">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{label}</div>
      {children}
    </div>
  );
}

function PreviewCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-paper/50 p-3">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{label}</div>
      <div className="overflow-hidden rounded-lg">{children}</div>
    </div>
  );
}
