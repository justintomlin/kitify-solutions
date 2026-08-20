"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Check, ChevronUp, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import { useAuth } from "@/components/AuthContext";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { loadCurrentQuote, saveCurrentQuote, clearCurrentQuote } from "@/lib/quoteStorage";
import { getQuote, getProject, saveQuote, type Quote } from "@/lib/store";
import { SaveQuotePanel } from "@/components/configurator/SaveQuotePanel";
import { HeroPreview } from "@/components/configurator/HeroPreview";
import { VanityConfigurator, VanityPreviewFromConfig, type VanityConfig } from "@/components/vanity/VanityConfigurator";
import { ShowerConfigurator, ShowerPreviewFromConfig, showerWallPanel, type ShowerConfig } from "@/components/shower/ShowerConfigurator";
import { RoomConfigurator, RoomPlanSVG, type RoomConfig } from "@/components/room/RoomConfigurator";
import { PlumbingConfigurator, PlumbingPreviewFromConfig, plumbingCatalogItems, type PlumbingConfig, type PlumbingCatalogItem } from "@/components/plumbing/PlumbingConfigurator";
import { getProductImage, getProductPrice } from "@/lib/delta-catalog";
import { getPanelImage } from "@/lib/naturepanel-catalog";
import { FLOORING_COLORS, FLOORING_LINE } from "@/lib/catalog";

// Whole dollars for the nominal $1 placeholders; cents once a real catalog price lands, so
// a Woodhurst line reads $201.39 rather than a rounded $201.
const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: Number.isInteger(n) ? 0 : 2 });

// Relative "saved N ago" label, translated. Returns null for an unparseable timestamp.
function relativeSaved(t: (k: string, v?: Record<string, string>) => string, savedAtIso: string, nowMs: number): string | null {
  const then = Date.parse(savedAtIso);
  if (isNaN(then)) return null;
  const min = Math.max(0, Math.floor((nowMs - then) / 60000));
  if (min < 1) return t("configurator.savedJustNow");
  if (min < 60) return t("configurator.savedMinAgo", { n: String(min) });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("configurator.savedHrAgo", { n: String(hr) });
  const day = Math.floor(hr / 24);
  return t(day === 1 ? "configurator.savedDayAgo" : "configurator.savedDaysAgo", { n: String(day) });
}

type ConfigKind = "room" | "shower" | "vanity" | "plumbing";

// Shared size selections, last-edit-wins. Any configurator can write these; the
// others seed from them. Only positive selections are pushed (removing a fixture
// never clears a size another module chose).
type SharedBath = { kind: "shower" | "tub"; baseId: string; baseColor?: string };
type SharedVanity = { size: number; sinks: 1 | 2; drilling: "1cc" | "8cc"; sinkShape: "oval" | "rectangle" };

export default function Page() {
  const { t } = useLanguage();

  const [room, setRoom] = useState<RoomConfig | null>(null);
  const [shower, setShower] = useState<ShowerConfig | null>(null);
  const [vanity, setVanity] = useState<VanityConfig | null>(null);
  const [plumbing, setPlumbing] = useState<PlumbingConfig | null>(null);
  const [activeKind, setActiveKind] = useState<ConfigKind | null>(null);

  const [sharedBath, setSharedBath] = useState<SharedBath | null>(null);
  const [sharedVanity, setSharedVanity] = useState<SharedVanity | null>(null);

  // In-progress configs, emitted by each module on every selection. They feed the hero
  // preview only — never the quote, never persistence — so the picture moves as the dealer
  // picks a decor instead of waiting for Add-to-quote. A committed slot is the fallback, so
  // closing a module without committing leaves the hero showing the last committed state.
  const [draftShower, setDraftShower] = useState<ShowerConfig | null>(null);
  const [draftVanity, setDraftVanity] = useState<VanityConfig | null>(null);
  const [draftPlumbing, setDraftPlumbing] = useState<PlumbingConfig | null>(null);

  // Configurators mount lazily on first open and then stay mounted (hidden when
  // inactive) so in-progress work — and the room's placed fixtures — survive
  // switching between them. Seeding therefore reads shared state at first open.
  const [opened, setOpened] = useState<Record<ConfigKind, boolean>>({ room: false, shower: false, vanity: false, plumbing: false });
  const open = (kind: ConfigKind) => { setActiveKind(kind); setOpened((p) => (p[kind] ? p : { ...p, [kind]: true })); };

  // Base color only comes from the shower module; a room-sourced update (which omits it)
  // preserves whatever the shower last chose. Last-edit-wins on every field.
  const applyBath = (v: { kind: "shower" | "tub"; baseId: string; baseColor?: string } | null) => {
    if (!v) return;
    setSharedBath((prev) => {
      const baseColor = v.baseColor ?? prev?.baseColor ?? "white";
      if (prev && prev.kind === v.kind && prev.baseId === v.baseId && (prev.baseColor ?? "white") === baseColor) return prev;
      return { kind: v.kind, baseId: v.baseId, baseColor };
    });
  };
  // Drilling & sink shape only come from the vanity module; a room-sourced update (which
  // omits them) preserves whatever the vanity last chose. Last-edit-wins on every field.
  const applyVanity = (v: { size: number; sinks: 1 | 2; drilling?: "1cc" | "8cc"; sinkShape?: "oval" | "rectangle" } | null) => {
    if (!v) return;
    setSharedVanity((prev) => {
      const drilling = v.drilling ?? prev?.drilling ?? "1cc";
      const sinkShape = v.sinkShape ?? prev?.sinkShape ?? "oval";
      if (prev && prev.size === v.size && prev.sinks === v.sinks && prev.drilling === drilling && prev.sinkShape === sinkShape) return prev;
      return { size: v.size, sinks: v.sinks, drilling, sinkShape };
    });
  };

  const onRoomChange = (cfg: RoomConfig) => {
    const b = cfg.selections.bath, v = cfg.selections.vanity;
    if (b) applyBath({ kind: b.kind, baseId: b.sku });
    if (v) applyVanity({ size: v.w, sinks: v.sinks === 2 ? 2 : 1 });
    setRoom((prev) => (prev ? cfg : prev)); // keep a committed room slot live as sizes flow in
  };
  const onRoomComplete = (cfg: RoomConfig) => {
    const b = cfg.selections.bath, v = cfg.selections.vanity;
    if (b) applyBath({ kind: b.kind, baseId: b.sku });
    if (v) applyVanity({ size: v.w, sinks: v.sinks === 2 ? 2 : 1 });
    setRoom(cfg); setActiveKind(null);
  };
  const onShowerComplete = (cfg: ShowerConfig) => {
    if (cfg.selections.path && cfg.selections.baseId) applyBath({ kind: cfg.selections.path, baseId: cfg.selections.baseId, baseColor: cfg.selections.baseColor });
    setShower(cfg); setActiveKind(null);
  };
  const onVanityComplete = (cfg: VanityConfig) => {
    if (cfg.selections.size != null) applyVanity({ size: cfg.selections.size, sinks: cfg.selections.sinks, drilling: cfg.selections.drilling, sinkShape: cfg.selections.sinkShape });
    setVanity(cfg); setActiveKind(null);
  };
  const onPlumbingComplete = (cfg: PlumbingConfig) => { setPlumbing(cfg); setActiveKind(null); };

  const total = useMemo(() => {
    return (room ? room.price.total : 0) + (vanity ? vanity.price.total : 0) + (shower ? shower.price.total : 0) + (plumbing ? plumbing.price.total : 0);
  }, [room, vanity, shower, plumbing]);

  // Shared seeds for the plumbing module: vanity sink count → faucet qty; the bathing
  // fixture kind → tub/shower vs shower-only trim.
  const plumbingFaucetQty: 1 | 2 = sharedVanity?.sinks === 2 ? 2 : 1;
  const plumbingBathKind = sharedBath?.kind;

  // ---- persistence: keep the current quote across reloads ------------------
  // Only the emitted config objects are stored, never React state/refs, so a
  // restored quote flows through the exact same paths as a freshly-built one.
  const { userId, loading } = useAuth();
  const ready = !loading; // auth session resolved — safe to hydrate/persist
  // Scope storage per user by the stable auth uuid (portal routes require a session, so this
  // is a real uuid; "anon" is only a defensive fallback). Also used as owner_id for saves.
  const userKey = userId ?? "anon";
  const hydratedRef = useRef(false);
  const lastSnapshotRef = useRef<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(0);

  // Saved-quote wiring (a quote persisted into a project, distinct from the
  // localStorage autosave which is just crash recovery). `activeQuote` is set once
  // the current work is tied to a stored quote — via Save-to-project or a ?quote= load.
  const [activeQuote, setActiveQuote] = useState<{ id: string; projectId: string; name: string; projectName: string; status: Quote["status"] } | null>(null);
  const [savePanelOpen, setSavePanelOpen] = useState(false);
  const [savePanelProjectId, setSavePanelProjectId] = useState<string | undefined>(undefined);
  const [saveStamp, setSaveStamp] = useState(0); // bumped on each explicit save to flash a confirmation
  const [showSaved, setShowSaved] = useState(false);

  // Push the three slots + shared sizes from a set of config objects. Shared with the
  // localStorage restore and the ?quote= load so both flow through one hydration path.
  const hydrateSlots = useCallback((r: RoomConfig | null, sh: ShowerConfig | null, va: VanityConfig | null, pl: PlumbingConfig | null) => {
    if (r) setRoom(r);
    if (sh) setShower(sh);
    if (va) setVanity(va);
    if (pl) setPlumbing(pl);
    const bath: SharedBath | null = sh && sh.selections.path && sh.selections.baseId
      ? { kind: sh.selections.path, baseId: sh.selections.baseId, baseColor: sh.selections.baseColor ?? "white" }
      : r && r.selections.bath ? { kind: r.selections.bath.kind, baseId: r.selections.bath.sku } : null;
    if (bath) setSharedBath(bath);
    const van: SharedVanity | null = va && va.selections.size != null
      ? { size: va.selections.size, sinks: va.selections.sinks, drilling: va.selections.drilling ?? "1cc", sinkShape: va.selections.sinkShape ?? "oval" }
      : r && r.selections.vanity ? { size: r.selections.vanity.w, sinks: (r.selections.vanity.sinks === 2 ? 2 : 1) as 1 | 2, drilling: "1cc", sinkShape: r.selections.vanity.sinkShape ?? "oval" } : null;
    if (van) setSharedVanity(van);
  }, []);

  // Restore once auth is ready (client-only; never reads storage during render). A
  // ?quote= param takes precedence over the autosaved current quote: if it resolves,
  // hydrate from it, mark it active, and strip the param so a later refresh doesn't
  // clobber unsaved edits.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      const quoteId = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("quote") : null;
      if (quoteId) {
        const q = await getQuote(quoteId);
        if (cancelled) return;
        if (q) {
          hydrateSlots(q.room as RoomConfig | null, q.shower as ShowerConfig | null, q.vanity as VanityConfig | null, q.plumbing as PlumbingConfig | null);
          const proj = await getProject(q.projectId);
          if (cancelled) return;
          setActiveQuote({ id: q.id, projectId: q.projectId, name: q.name, projectName: proj?.name ?? "", status: q.status });
          if (typeof window !== "undefined") window.history.replaceState(null, "", "/portal/configurator");
          lastSnapshotRef.current = JSON.stringify({ room: q.room ?? null, shower: q.shower ?? null, vanity: q.vanity ?? null, plumbing: q.plumbing ?? null });
          hydratedRef.current = true;
          return;
        }
      }
      // Fall back to the autosaved current quote.
      const stored = loadCurrentQuote(userKey);
      if (cancelled) return;
      if (stored) {
        hydrateSlots(stored.room as RoomConfig | null, stored.shower as ShowerConfig | null, stored.vanity as VanityConfig | null, stored.plumbing as PlumbingConfig | null);
        setSavedAt(stored.savedAt);
      }
      lastSnapshotRef.current = JSON.stringify({ room: stored?.room ?? null, shower: stored?.shower ?? null, vanity: stored?.vanity ?? null, plumbing: stored?.plumbing ?? null });
      hydratedRef.current = true;
    })();
    return () => { cancelled = true; };
  }, [ready, userKey, hydrateSlots]);

  // Flash a brief "saved" confirmation after an explicit save/update.
  useEffect(() => {
    if (saveStamp === 0) return;
    setShowSaved(true);
    const id = setTimeout(() => setShowSaved(false), 3500);
    return () => clearTimeout(id);
  }, [saveStamp]);

  // Auto-save (debounced) whenever the slots change; clear storage once empty.
  useEffect(() => {
    if (!ready || !hydratedRef.current) return;
    const snapshot = JSON.stringify({ room, shower, vanity, plumbing });
    if (snapshot === lastSnapshotRef.current) return; // nothing actually changed (e.g. just restored)
    const timer = setTimeout(() => {
      if (!room && !shower && !vanity && !plumbing) {
        clearCurrentQuote(userKey);
        setSavedAt(null);
      } else {
        saveCurrentQuote(userKey, { room, shower, vanity, plumbing });
        setSavedAt(new Date().toISOString());
      }
      lastSnapshotRef.current = snapshot;
    }, 400);
    return () => clearTimeout(timer);
  }, [room, shower, vanity, plumbing, ready, userKey]);

  // Refresh the "saved N ago" label without spamming re-renders.
  useEffect(() => {
    setNowMs(Date.now());
    if (!savedAt) return;
    const id = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(id);
  }, [savedAt]);

  function clearQuote() {
    if (typeof window !== "undefined" && !window.confirm(t("configurator.confirmClear"))) return;
    setRoom(null); setShower(null); setVanity(null); setPlumbing(null);
    setSharedBath(null); setSharedVanity(null);
    // Drafts too, or a module left open would keep repainting the hero from work the dealer
    // just cleared. A still-mounted module re-emits its own state on the next edit.
    setDraftShower(null); setDraftVanity(null); setDraftPlumbing(null);
    clearCurrentQuote(userKey);
    setSavedAt(null);
    setActiveQuote(null); setSavePanelOpen(false); setShowSaved(false);
    lastSnapshotRef.current = JSON.stringify({ room: null, shower: null, vanity: null, plumbing: null });
  }

  const hasAny = !!(room || shower || vanity || plumbing);

  // A brand-new quote was created (via Save-to-project or Save-as-new): adopt it as active.
  function onQuoteSaved(saved: Quote, projectName: string) {
    setActiveQuote({ id: saved.id, projectId: saved.projectId, name: saved.name, projectName, status: saved.status });
    setSavePanelOpen(false);
    setSaveStamp((s) => s + 1);
  }

  // Update the active saved quote in place — preserves its name/project/status.
  async function updateActiveQuote() {
    if (!activeQuote) return;
    await saveQuote({
      id: activeQuote.id, projectId: activeQuote.projectId, ownerId: userKey,
      name: activeQuote.name, room, shower, vanity, plumbing, total, status: activeQuote.status,
    });
    setSaveStamp((s) => s + 1);
  }

  const savedText = savedAt ? relativeSaved(t, savedAt, nowMs) : null;

  // ---- quote summary placement -------------------------------------------
  // Wide screens keep the quote as a standing column beside the work area. Below that the
  // work area needs the whole width (the room plan is the point of this page), so the quote
  // collapses to a sticky total bar that expands into a sheet.
  //
  // Chosen in JS rather than by rendering both and hiding one with CSS: the summary contains
  // SaveQuotePanel, which holds its own form state and loads the project list. Two mounted
  // copies would mean two fetches and a half-filled form the user can't see.
  const wideQuote = useMediaQuery("(min-width: 1280px)", true);
  const [quoteSheetOpen, setQuoteSheetOpen] = useState(false);
  const [sheetShown, setSheetShown] = useState(false); // drives the slide-up transition

  // Mount, then transition on the next frame so there's a starting transform to animate from.
  useEffect(() => {
    if (!quoteSheetOpen) { setSheetShown(false); return; }
    const raf = requestAnimationFrame(() => setSheetShown(true));
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") setQuoteSheetOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("keydown", onKeyDown); };
  }, [quoteSheetOpen]);

  // Growing past the breakpoint reveals the standing column, so a sheet left open would sit
  // on top of it.
  useEffect(() => { if (wideQuote) setQuoteSheetOpen(false); }, [wideQuote]);

  // Open the sheet already showing the save controls — what the bar's save button implies.
  const openQuoteSheetForSave = () => {
    if (!activeQuote) { setSavePanelProjectId(undefined); setSavePanelOpen(true); }
    setQuoteSheetOpen(true);
  };

  // Flooring product-strip tile: read from the same live room state the plan uses, so
  // changing the color or room size updates it without recommitting. Nothing to show
  // until a flooring color is selected in the room. The plan also carries the texture.
  const flooringColor = room?.selections.flooring?.colorId
    ? FLOORING_COLORS.find((c) => c.id === room.selections.flooring!.colorId)
    : undefined;
  const flooringCartons = room?.metrics.flooringCartons ?? 0;
  const flooringLabel = flooringColor
    ? `${FLOORING_LINE.brand} ${FLOORING_LINE.name} · ${flooringColor.name}${flooringCartons > 0 ? " · " + t(flooringCartons === 1 ? "configurator.room.cartonsOne" : "configurator.room.cartonsMany", { n: String(flooringCartons) }) : ""}`
    : null;

  // ---- hero preview ---------------------------------------------------------
  // Drafts win over committed slots so an open module drives the picture live; everything
  // else — turning configs into textures, hexes and product photos — lives in HeroPreview,
  // which the proposal, order and quote-list views share so all four agree on what a quote
  // looks like.
  const heroSource = {
    room,
    shower: draftShower ?? shower,
    vanity: draftVanity ?? vanity,
    plumbing: draftPlumbing ?? plumbing,
  };

  // The quote panel, built once and placed in exactly one of two spots (see wideQuote).
  const quoteSummary = (
    <div className="rounded-2xl border border-line bg-card p-5">
      <div className="mb-4">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">{t("configurator.currentQuote")}</span>
          {(room || shower || vanity) && (
            <button onClick={clearQuote} className="text-[10px] text-muted transition hover:text-ink">{t("configurator.clearQuote")}</button>
          )}
        </div>
        {savedText && <div className="mt-0.5 text-[10px] text-muted">{savedText}</div>}
      </div>

      <div className="space-y-3">
        {/* Room row */}
        <div className="rounded-2xl border border-line/70 bg-paper/80 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-ink">
              <div className="font-semibold">{t("configurator.roomTitle")}</div>
              <div className="text-xs text-muted">{room ? room.label : t("configurator.notAdded")}</div>
            </div>
            <div className="flex items-center gap-3">
              {room && room.price.total > 0 && <div className="font-semibold">{money(room.price.total)}</div>}
              {room != null && (
                <button onClick={() => open("room")} className="text-sm text-accent">{t("configurator.edit")}</button>
              )}
              {room != null && (
                <button onClick={() => setRoom(null)} className="text-sm text-muted">{t("configurator.remove")}</button>
              )}
            </div>
          </div>
          {/* Priced components (flooring, wall base) — a breakdown of the room total,
              each translated at render so a saved quote reads right in either language. */}
          {room && room.price.lines.length > 0 && (
            <div className="mt-2 space-y-1 border-t border-line/60 pl-3 pt-2">
              {room.price.lines.map((l, i) => (
                <div key={i} className="flex items-center justify-between gap-3">
                  <span className="text-xs text-ink">{t(l.key, l.params)}</span>
                  <span className="text-xs text-muted">{money(l.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Shower row */}
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-line/70 bg-paper/80 px-4 py-3">
          <div className="text-sm text-ink">
            <div className="font-semibold">{t("configurator.showerTitle")}</div>
            <div className="text-xs text-muted">{shower ? shower.label : t("configurator.notAdded")}</div>
          </div>
          <div className="flex items-center gap-3">
            {shower && <div className="font-semibold">{money(shower.price.total)}</div>}
            {shower != null && (
              <>
                <button onClick={() => open("shower")} className="text-sm text-accent">{t("configurator.edit")}</button>
                <button onClick={() => setShower(null)} className="text-sm text-muted">{t("configurator.remove")}</button>
              </>
            )}
          </div>
        </div>

        {/* Vanity row */}
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-line/70 bg-paper/80 px-4 py-3">
          <div className="text-sm text-ink">
            <div className="font-semibold">{t("configurator.vanityTitle")}</div>
            <div className="text-xs text-muted">{vanity ? vanity.label : t("configurator.notAdded")}</div>
          </div>
          <div className="flex items-center gap-3">
            {vanity && <div className="font-semibold">{money(vanity.price.total)}</div>}
            {vanity != null && (
              <>
                <button onClick={() => open("vanity")} className="text-sm text-accent">{t("configurator.edit")}</button>
                <button onClick={() => setVanity(null)} className="text-sm text-muted">{t("configurator.remove")}</button>
              </>
            )}
          </div>
        </div>

        {/* Plumbing row */}
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-line/70 bg-paper/80 px-4 py-3">
          <div className="text-sm text-ink">
            <div className="font-semibold">{t("configurator.plumbingTitle")}</div>
            <div className="text-xs text-muted">{plumbing ? plumbing.label : t("configurator.notAdded")}</div>
          </div>
          <div className="flex items-center gap-3">
            {plumbing && <div className="font-semibold">{money(plumbing.price.total)}</div>}
            {plumbing != null && (
              <>
                <button onClick={() => open("plumbing")} className="text-sm text-accent">{t("configurator.edit")}</button>
                <button onClick={() => setPlumbing(null)} className="text-sm text-muted">{t("configurator.remove")}</button>
              </>
            )}
          </div>
        </div>

        {/* Total */}
        <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
          <div className="text-sm font-semibold">{t("configurator.total")}</div>
          <div className="font-semibold">{money(total)}</div>
        </div>
        <div className="mt-2 rounded-md bg-amber/10 px-2 py-1 text-center text-[10px] font-medium text-amber">{t("configurator.placeholderPricing")}</div>

        {/* Save to project */}
        <div className="mt-4 border-t border-line pt-4">
          {activeQuote && (
            <div className="mb-3 text-[11px] text-muted">
              <div className="truncate">{t("configurator.editingQuote", { quote: activeQuote.name })}</div>
              <Link href={`/portal/projects/${activeQuote.projectId}`} className="text-accent transition hover:underline">
                {activeQuote.projectName || t("configurator.viewProject")}
              </Link>
            </div>
          )}

          {activeQuote ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={updateActiveQuote}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
              >
                {t("configurator.updateQuote")}
              </button>
              <button
                onClick={() => { setSavePanelProjectId(activeQuote.projectId); setSavePanelOpen(true); }}
                className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-muted transition hover:text-ink"
              >
                {t("configurator.saveAsNew")}
              </button>
            </div>
          ) : (
            <button
              onClick={() => { setSavePanelProjectId(undefined); setSavePanelOpen(true); }}
              disabled={!hasAny}
              className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("configurator.saveToProject")}
            </button>
          )}

          {showSaved && activeQuote && (
            <div className="mt-2 text-[11px] text-accent">
              {t("configurator.savedToProject", { name: activeQuote.projectName || activeQuote.name })}{" · "}
              <Link href={`/portal/projects/${activeQuote.projectId}`} className="underline">
                {t("configurator.viewProject")}
              </Link>
            </div>
          )}

          {savePanelOpen && (
            <div className="mt-3">
              <SaveQuotePanel
                ownerId={userKey}
                initialProjectId={savePanelProjectId}
                quoteInput={{ room, shower, vanity, plumbing, total }}
                onSaved={onQuoteSaved}
                onCancel={() => setSavePanelOpen(false)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    // No max-w-6xl: the room plan scales with its container, and capping the page at 1152px
    // was most of why it drew small. The remaining cap only stops the plan from becoming
    // absurdly wide on an ultrawide monitor. pb-24 clears the sticky quote bar below xl.
    <div className="mx-auto max-w-[1700px] space-y-4 pb-24 xl:pb-0">
      <div className="rounded-2xl border border-line bg-card px-5 py-4">
        <div className="mb-1 font-mono text-sm uppercase tracking-[0.12em] text-accent">
          {t("pages.configurator.title")}
        </div>
        <p className="text-sm leading-6 text-ink/75">{t("pages.configurator.desc")}</p>
      </div>

      {/* Module tabs — one row across the top of the work area, equal width so they're
          predictable finger targets on a tablet. Tapping the open module returns to the
          overview, which is the only way back to the read-only plan + product strip. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(
          [
            { key: "room" as const, title: t("configurator.roomTitle"), desc: t("configurator.roomDesc"), filled: !!room },
            { key: "shower" as const, title: t("configurator.showerTitle"), desc: t("configurator.showerDesc"), filled: !!shower },
            { key: "vanity" as const, title: t("configurator.vanityTitle"), desc: t("configurator.vanityDesc"), filled: !!vanity },
            { key: "plumbing" as const, title: t("configurator.plumbingTitle"), desc: t("configurator.plumbingDesc"), filled: !!plumbing },
          ]
        ).map((c) => {
          const active = activeKind === c.key;
          return (
            <button
              key={c.key}
              onClick={() => (active ? setActiveKind(null) : open(c.key))}
              aria-pressed={active}
              className={`min-h-[44px] rounded-xl border px-3 py-2.5 text-left transition ${
                active ? "border-accent bg-accent-soft/50 ring-1 ring-accent/30" : "border-line bg-card hover:bg-ink/5"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className="truncate font-display text-sm font-semibold">{c.title}</span>
                {c.filled && <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-accent" />}
              </div>
              <div className="mt-0.5 hidden text-xs leading-snug text-muted sm:block">{c.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* Work area — full width below xl, ~70% above it. min-w-0 so a wide child can't
            push the grid column past its track and squeeze the quote column. */}
        <div className="min-w-0 space-y-5">

          {/* Hero preview. Sits above the module content and stays visible while a module is
              open, because its whole point is to react as selections are made. Unlike the
              proposal and order views it is never hidden for an empty quote — here the base
              scene is the starting canvas the dealer configures against. */}
          <HeroPreview {...heroSource} caption={t("configurator.hero.caption")} />

          {/* Open configurator area. Each configurator mounts on first open and
              stays mounted (hidden when inactive) so its state persists and it
              can keep seeding from / feeding the shared sizes. */}
          <div>
            <div className={activeKind === "room" ? "" : "hidden"}>
              {opened.room && (
                <RoomConfigurator
                  mode="dealer"
                  initialBath={sharedBath}
                  initialVanity={sharedVanity}
                  initialTreatments={room?.selections.treatments}
                  initialFlooring={room?.selections.flooring}
                  initialWallBase={room?.selections.wallBase}
                  initialPartitions={room?.selections.partitions}
                  onChange={onRoomChange}
                  onComplete={onRoomComplete}
                  // Same call the module tab above makes — but reachable without scrolling
                  // back up past the drawing.
                  onBack={() => setActiveKind(null)}
                  primaryLabel={room ? t("configurator.updateRoom") : t("configurator.addToQuote")}
                />
              )}
            </div>
            <div className={activeKind === "shower" ? "" : "hidden"}>
              {opened.shower && (
                <ShowerConfigurator
                  mode="dealer"
                  initialKind={sharedBath?.kind}
                  initialBaseId={sharedBath?.baseId}
                  initialBaseColor={sharedBath?.baseColor}
                  onChange={applyBath}
                  onPreview={setDraftShower}
                  onComplete={onShowerComplete}
                  primaryLabel={shower ? t("configurator.updateShower") : t("configurator.addToQuote")}
                />
              )}
            </div>
            <div className={activeKind === "vanity" ? "" : "hidden"}>
              {opened.vanity && (
                <VanityConfigurator
                  mode="dealer"
                  initialSize={sharedVanity?.size}
                  initialSinks={sharedVanity?.sinks}
                  initialDrilling={sharedVanity?.drilling}
                  initialSinkShape={sharedVanity?.sinkShape}
                  onChange={applyVanity}
                  onPreview={setDraftVanity}
                  onComplete={onVanityComplete}
                  primaryLabel={vanity ? t("configurator.updateVanity") : t("configurator.addToQuote")}
                />
              )}
            </div>
            <div className={activeKind === "plumbing" ? "" : "hidden"}>
              {opened.plumbing && (
                <PlumbingConfigurator
                  mode="dealer"
                  lockedDrilling={sharedVanity?.drilling}
                  lockedBathKind={plumbingBathKind}
                  initialFaucetQty={plumbingFaucetQty}
                  onChange={setDraftPlumbing}
                  onComplete={onPlumbingComplete}
                  primaryLabel={plumbing ? t("configurator.updatePlumbing") : t("configurator.addToQuote")}
                />
              )}
            </div>
            {!activeKind && (
              <div className="space-y-4">
                {room ? (
                  // Live read-only room plan — reflects the room state the hub keeps
                  // current via the room's onChange (incl. conflict/overhang states).
                  // Click to open the Room editor.
                  <button
                    type="button"
                    onClick={() => open("room")}
                    title={t("configurator.openRoomEditor")}
                    className="block w-full rounded-2xl border border-line bg-card p-6 text-left transition hover:border-accent"
                  >
                    <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("configurator.roomPlan")}</div>
                    {/* Full width — this is the overview's hero. The old max-w-[680px] capped
                        it well below the space available. */}
                    <div className="w-full">
                      <RoomPlanSVG state={room.selections} interactive={false} showClearances={false} />
                      <div className="mt-2 text-center text-xs text-muted">{room.label}</div>
                    </div>
                  </button>
                ) : (
                  <div className="rounded-2xl border border-line bg-paper/60 p-6 text-muted">{t("configurator.selectToBegin")}</div>
                )}

                {/* Selected products — each tile is the configurator's own live SVG
                    preview of the assembled product, read from the live slot state, so
                    it updates when a selection changes. Click to edit. */}
                {(flooringColor || shower || vanity || plumbing) && (
                  <div className="rounded-2xl border border-line bg-card p-4">
                    <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t("configurator.selectedProducts")}</div>
                    <div className="flex flex-wrap gap-4">
                      {flooringColor && flooringLabel && (
                        <ProductTile category={t("configurator.flooringTitle")} label={flooringLabel} onClick={() => open("room")}>
                          <FloorTileImage src={flooringColor.image} alt={flooringColor.name} />
                        </ProductTile>
                      )}
                      {shower && (
                        <ProductTile category={t("configurator.showerTitle")} label={shower.label} onClick={() => open("shower")}>
                          <ShowerWallPreview config={shower} />
                        </ProductTile>
                      )}
                      {vanity && (
                        <ProductTile category={t("configurator.vanityTitle")} label={vanity.label} onClick={() => open("vanity")}>
                          <VanityPreviewFromConfig config={vanity} />
                        </ProductTile>
                      )}
                      {plumbing && (
                        <ProductTile category={t("configurator.plumbingTitle")} label={plumbing.label} onClick={() => open("plumbing")}>
                          <PlumbingProductStrip config={plumbing} />
                        </ProductTile>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Quote summary. Wide screens keep it as a standing, sticky column; below the
            breakpoint the same element is rendered inside the slide-up sheet instead, so
            there is only ever one mounted copy. */}
        {wideQuote && <aside className="xl:sticky xl:top-4 xl:self-start">{quoteSummary}</aside>}
      </div>

      {/* ---- Below xl: sticky total bar, expanding into a sheet ---- */}
      {!wideQuote && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card/95 px-4 py-2 backdrop-blur">
          <div className="mx-auto flex max-w-[1700px] items-center gap-2">
            <button
              type="button"
              onClick={() => setQuoteSheetOpen(true)}
              aria-label={t("configurator.viewQuote")}
              aria-expanded={quoteSheetOpen}
              className="flex min-h-[44px] flex-1 items-center gap-2 rounded-lg px-2 text-left transition hover:bg-ink/5"
            >
              <ChevronUp className="h-4 w-4 shrink-0 text-muted" />
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">{t("configurator.total")}</span>
              <span className="ml-auto font-display text-lg font-bold">{money(total)}</span>
            </button>
            {activeQuote ? (
              <button
                onClick={updateActiveQuote}
                className="min-h-[44px] shrink-0 rounded-lg bg-accent px-4 text-sm font-semibold text-white transition hover:brightness-110"
              >
                {t("configurator.updateQuote")}
              </button>
            ) : (
              <button
                onClick={openQuoteSheetForSave}
                disabled={!hasAny}
                className="min-h-[44px] shrink-0 rounded-lg bg-accent px-4 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t("configurator.saveToProject")}
              </button>
            )}
          </div>
        </div>
      )}

      {!wideQuote && quoteSheetOpen && (
        <div className="fixed inset-0 z-40">
          <div
            aria-hidden
            onClick={() => setQuoteSheetOpen(false)}
            className={`absolute inset-0 bg-ink/40 transition-opacity duration-200 ease-out ${sheetShown ? "opacity-100" : "opacity-0"}`}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("configurator.currentQuote")}
            className={`absolute inset-x-0 bottom-0 max-h-[86dvh] overflow-y-auto rounded-t-2xl border-t border-line bg-paper p-4 shadow-2xl transition-transform duration-200 ease-out ${
              sheetShown ? "translate-y-0" : "translate-y-full"
            }`}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{t("configurator.currentQuote")}</span>
              <button
                type="button"
                onClick={() => setQuoteSheetOpen(false)}
                aria-label={t("configurator.hideQuote")}
                className="-mr-1 grid h-11 w-11 shrink-0 place-items-center rounded-md text-muted transition hover:bg-ink/5 hover:text-ink"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {quoteSummary}
          </div>
        </div>
      )}
    </div>
  );
}

// A single product tile: the configurator's own live SVG preview (passed as children),
// a category label and the truncated slot label. Clicking opens that configurator.
function ProductTile({ category, label, onClick, children }: {
  category: string; label: string; onClick: () => void; children: ReactNode;
}) {
  const { t } = useLanguage();
  return (
    <button type="button" onClick={onClick} title={t("configurator.openConfigurator", { item: category })} className="w-[200px] text-left">
      <div className="overflow-hidden rounded-2xl border border-line bg-paper p-2 transition hover:border-accent">{children}</div>
      <div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{category}</div>
      <div className="truncate text-xs text-ink">{label}</div>
    </button>
  );
}

// Shower tile body: the live SVG preview (which already tiles the walls with the real decor
// when one is picked), plus a swatch chip naming it. The chip is skipped entirely for the
// flat-colour tiers, where the preview's wall tint already says everything there is to say.
function ShowerWallPreview({ config }: { config: ShowerConfig }) {
  const panel = showerWallPanel(config);
  return (
    <>
      <ShowerPreviewFromConfig config={config} />
      {panel && <ShowerWallChip panel={panel} />}
    </>
  );
}

function ShowerWallChip({ panel }: { panel: { id: string; name: string; style?: string; imageUrl: string } }) {
  const { t } = useLanguage();
  const [err, setErr] = useState(false);
  const src = getPanelImage(panel.id, 160, 160) ?? panel.imageUrl;
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <span className="block h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-line bg-ink/5">
        {!err && <img src={src} alt={panel.name} loading="lazy" onError={() => setErr(true)} className="h-full w-full object-cover" />}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-medium text-ink">{panel.name}</span>
        <span className="block truncate font-mono text-[9px] uppercase tracking-wide text-muted">{t("configurator.shower.panel.brand")}</span>
      </span>
    </div>
  );
}

// Plumbing tile body: the faucet as a full-width hero photo, then a thumbnail grid of the
// remaining components — trim and accessories. The faucet is deliberately absent from the
// grid; it is the hero, and showing it in both read as a duplicate.
//
// Everything degrades together for a package/finish with no catalog data (Lahara, Ashlyn,
// Trinsic, and the two finishes Delta doesn't publish): the hero falls back to the schematic
// drawing and the grid empties, at which point the preview re-enables its own accessory row
// so the selected accessories still show as glyphs rather than vanishing.
function PlumbingProductStrip({ config }: { config: PlumbingConfig }) {
  // The faucet is the hero above, so it's dropped from the grid rather than shown twice.
  const thumbs = plumbingCatalogItems(config).filter((it) => it.key !== "faucet1cc" && it.key !== "faucet8cc");
  return (
    <>
      <PlumbingPreviewFromConfig config={config} showHeroPhoto showAccessories={thumbs.length === 0} />
      {thumbs.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {thumbs.map((it) => (
            <ProductHoverCard key={it.key} item={it} />
          ))}
        </div>
      )}
    </>
  );
}

const HOVER_CARD_W = 232;

/**
 * A 64px product thumbnail that reveals a larger card — 200px photo, title, SKU and
 * Internet price — on hover, or on tap for touch.
 *
 * The card is portalled to <body> with fixed positioning: the tile it sits in is
 * `overflow-hidden`, so an absolutely-positioned popup would simply be clipped. Fixed
 * coordinates go stale on scroll, so the card closes rather than chases the anchor.
 */
function ProductHoverCard({ item }: { item: PlumbingCatalogItem }) {
  const { t } = useLanguage();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);   // drives the 150ms fade
  const [box, setBox] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const [imgErr, setImgErr] = useState(false);
  const fromTouch = useRef(false);   // set on pointerdown, read by the click swallower

  useEffect(() => {
    if (!open) { setShown(false); setBox(null); return; }
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left + r.width / 2 - HOVER_CARD_W / 2, window.innerWidth - HOVER_CARD_W - 8));
    // Prefer above. Anchoring by `bottom` there lets the card grow upward however far the
    // title wraps, instead of needing its height measured first.
    const above = r.top >= 300;
    setBox(above ? { left, bottom: window.innerHeight - r.top + 8 } : { left, top: r.bottom + 8 });
    // Fade in on the next frame so the transition has a starting opacity to animate from.
    const raf = requestAnimationFrame(() => setShown(true));

    const close = () => setOpen(false);
    // A tap anywhere else dismisses — the touch counterpart of mouseleave.
    const onDocDown = (e: PointerEvent) => { if (!anchorRef.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    document.addEventListener("pointerdown", onDocDown);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("pointerdown", onDocDown);
    };
  }, [open]);

  // Hover and tap are split by pointer type rather than by mouse-vs-pointer events. A tap
  // also emits compatibility mouse events, so an onMouseEnter here would fire in the same
  // batch as the tap's toggle and immediately cancel it — the card would never open on
  // touch. Gating on pointerType keeps the two paths from ever fighting.
  const onPointerEnter = (e: React.PointerEvent) => { if (e.pointerType === "mouse") setOpen(true); };
  const onPointerLeave = (e: React.PointerEvent) => { if (e.pointerType === "mouse") setOpen(false); };
  // Touch taps toggle the card instead of opening the configurator underneath.
  const onPointerDown = (e: React.PointerEvent) => {
    fromTouch.current = e.pointerType === "touch";
    if (!fromTouch.current) return;   // mouse: leave click-to-open alone
    e.stopPropagation();
    setOpen((o) => !o);
  };
  // The click has to be swallowed separately: preventDefault() on pointerdown suppresses
  // the compatibility mouse events but NOT the click, so without this the tap would still
  // reach the tile and open the configurator — unmounting the card it just opened.
  const onClick = (e: React.MouseEvent) => {
    if (!fromTouch.current) return;
    e.preventDefault();
    e.stopPropagation();
    fromTouch.current = false;
  };

  const large = getProductImage(item.sku, 200, 200);
  const price = getProductPrice(item.sku);
  const tip = item.qty > 1 ? `${item.title} ×${item.qty}` : item.title;

  return (
    <span
      ref={anchorRef}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerDown={onPointerDown}
      onClick={onClick}
      title={tip}
      className="relative block h-16 w-16 overflow-hidden rounded-lg border border-line bg-white"
    >
      {!imgErr && (
        <img src={item.image} alt={item.title} loading="lazy" onError={() => setImgErr(true)} className="h-full w-full object-contain" />
      )}
      {item.qty > 1 && (
        <span className="absolute bottom-0 right-0 rounded-tl-md bg-ink/80 px-1 font-mono text-[9px] leading-4 text-white">×{item.qty}</span>
      )}
      {open && box && typeof document !== "undefined" && createPortal(
        <div
          role="tooltip"
          style={{ position: "fixed", left: box.left, top: box.top, bottom: box.bottom, width: HOVER_CARD_W, zIndex: 60 }}
          // pointer-events-none: the card must never steal the hover that keeps it open.
          className={`pointer-events-none rounded-xl border border-line bg-white p-2 shadow-lg transition-opacity duration-150 ${shown ? "opacity-100" : "opacity-0"}`}
        >
          {large && <img src={large} alt={item.title} className="mx-auto block h-[200px] w-[200px] object-contain" />}
          <div className="mt-1.5 text-xs font-medium leading-snug text-ink">{item.title}</div>
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">{item.sku}</div>
          {price != null && (
            <div className="mt-1 text-xs font-semibold text-ink">
              {money(price)}{" "}
              <span className="font-mono text-[9px] font-normal uppercase tracking-wide text-accent">{t("configurator.plumbing.msrpTag")}</span>
            </div>
          )}
        </div>,
        document.body,
      )}
    </span>
  );
}

// Flooring has no SVG preview — it shows the real product swatch image. Kept the same
// footprint as the SVG previews (fixed aspect) so the strip stays even. On a missing
// image it falls back to a neutral block, mirroring the vanity module's swatch pattern.
function FloorTileImage({ src, alt }: { src: string; alt: string }) {
  const [err, setErr] = useState(false);
  return (
    <div className="aspect-[4/3] w-full overflow-hidden rounded-lg bg-ink/5">
      {!err && <img src={src} alt={alt} className="h-full w-full object-cover" onError={() => setErr(true)} />}
    </div>
  );
}
