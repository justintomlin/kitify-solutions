"use client";

// Inventory locations — add, rename, deactivate.
//
// Locations are never deleted: inventory_movements reference location_id and the audit log
// has to stay readable forever, so retiring one flips `active` instead. Deactivating a
// location that still holds stock WARNS and asks for confirmation rather than refusing —
// the admin may well be retiring a site they are mid-way through emptying.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Check, X, Pencil } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import { AdminGuard } from "@/components/AdminGuard";
import { useToast, ToastView } from "@/components/Toast";
import {
  listLocations,
  listStock,
  createLocation,
  updateLocation,
  type InventoryLocation,
  type StockRow,
} from "@/lib/inventory";
import {
  Badge,
  Field,
  BackLink,
  PageHeading,
  WarnBanner,
  EmptyCard,
  fmtDate,
  INPUT,
  BTN_PRIMARY,
  BTN_GHOST,
} from "@/components/inventory/ui";

export default function LocationsPage() {
  return (
    <AdminGuard>
      <Locations />
    </AdminGuard>
  );
}

function Locations() {
  const { t } = useLanguage();
  const { toast, showToast } = useToast();

  const [locations, setLocations] = useState<InventoryLocation[] | null>(null);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmOff, setConfirmOff] = useState<InventoryLocation | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    Promise.all([listLocations(), listStock()])
      .then(([lo, st]) => {
        setLocations(lo);
        setStock(st);
        setError("");
      })
      .catch((e: unknown) => {
        setLocations([]);
        setError(e instanceof Error ? e.message : t("inventory.errLoad"));
      });
  }, [t]);
  useEffect(() => {
    load();
  }, [load]);

  // Pieces held at each location — drives the deactivation warning.
  const heldAt = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of stock) if (s.quantity > 0) m.set(s.locationId, (m.get(s.locationId) ?? 0) + s.quantity);
    return m;
  }, [stock]);

  async function addLocation(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      await createLocation(newName, newNotes);
      setNewName("");
      setNewNotes("");
      setAdding(false);
      load();
      showToast(t("inventory.saved"));
    } catch {
      setError(t("inventory.errSave"));
    }
  }

  async function rename(id: string) {
    if (!editName.trim()) return;
    try {
      await updateLocation(id, { name: editName });
      setEditingId(null);
      load();
      showToast(t("inventory.saved"));
    } catch {
      setError(t("inventory.errSave"));
    }
  }

  async function setActive(loc: InventoryLocation, active: boolean) {
    try {
      await updateLocation(loc.id, { active });
      setConfirmOff(null);
      load();
      showToast(t("inventory.saved"));
    } catch {
      setError(t("inventory.errSave"));
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <ToastView toast={toast} />

      <div className="mb-4">
        <BackLink href="/portal/admin/inventory" label={t("inventory.backToInventory")} />
      </div>
      <PageHeading
        eyebrow={t("inventory.locations")}
        sub={t("inventory.locationsSub")}
        right={
          !adding && (
            <button type="button" onClick={() => setAdding(true)} className={BTN_PRIMARY}>
              <Plus className="h-4 w-4" /> {t("inventory.addLocation")}
            </button>
          )
        }
      />

      {error && (
        <div className="mb-4">
          <WarnBanner>{error}</WarnBanner>
        </div>
      )}

      {adding && (
        <form onSubmit={addLocation} className="mb-4 space-y-3 rounded-2xl border border-line bg-card p-5">
          <Field label={t("inventory.fieldLocationName")} required>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} className={INPUT} autoFocus />
          </Field>
          <Field label={t("inventory.fieldNotes")}>
            <input value={newNotes} onChange={(e) => setNewNotes(e.target.value)} className={INPUT} />
          </Field>
          <div className="flex gap-2">
            <button type="submit" className={BTN_PRIMARY}>
              {t("inventory.save")}
            </button>
            <button type="button" onClick={() => setAdding(false)} className={BTN_GHOST}>
              {t("inventory.cancel")}
            </button>
          </div>
        </form>
      )}

      {locations === null ? (
        <EmptyCard>{t("inventory.loading")}</EmptyCard>
      ) : locations.length === 0 ? (
        <EmptyCard>{t("inventory.noLocations")}</EmptyCard>
      ) : (
        <div className="space-y-2.5">
          {locations.map((l) => {
            const held = heldAt.get(l.id) ?? 0;
            return (
              <div key={l.id} className="rounded-2xl border border-line bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {editingId === l.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className={INPUT + " mt-0 max-w-xs"}
                          autoFocus
                        />
                        <button type="button" onClick={() => rename(l.id)} className="rounded-md p-1.5 text-accent transition hover:brightness-110">
                          <Check className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => setEditingId(null)} className="rounded-md p-1.5 text-muted transition hover:text-ink">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-display text-sm font-semibold text-ink">{l.name}</span>
                        {!l.active && <Badge tone="muted">{t("inventory.inactive")}</Badge>}
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(l.id);
                            setEditName(l.name);
                          }}
                          aria-label={t("inventory.rename")}
                          className="rounded-md p-1 text-muted transition hover:text-accent"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                    {l.notes && <p className="mt-1 text-xs leading-relaxed text-muted">{l.notes}</p>}
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
                      <span>
                        {t("inventory.piecesHeld")}: <span className="font-semibold text-ink">{held}</span>
                      </span>
                      <span>
                        {t("inventory.created")}: {fmtDate(l.createdAt)}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => (l.active ? (held > 0 ? setConfirmOff(l) : setActive(l, false)) : setActive(l, true))}
                    className={BTN_GHOST + " shrink-0"}
                  >
                    {l.active ? t("inventory.deactivate") : t("inventory.reactivate")}
                  </button>
                </div>

                {confirmOff?.id === l.id && (
                  <div className="mt-3 space-y-2">
                    <WarnBanner>{t("inventory.warnDeactivate", { n: String(held), location: l.name })}</WarnBanner>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setActive(l, false)} className={BTN_PRIMARY}>
                        {t("inventory.deactivateAnyway")}
                      </button>
                      <button type="button" onClick={() => setConfirmOff(null)} className={BTN_GHOST}>
                        {t("inventory.cancel")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
