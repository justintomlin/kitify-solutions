"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Check, ChevronUp, Plus, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import { useAuth } from "@/components/AuthContext";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { loadCurrentQuote, saveCurrentQuote, clearCurrentQuote } from "@/lib/quoteStorage";
import { getQuote, getProject, saveQuote, type Quote } from "@/lib/store";
// From lib/bathrooms rather than lib/store: this is a client component, and lib/store pulls in
// the Supabase client, which throws at module load without env vars. The seam is import-free.
import {
  quoteBathrooms, quoteFlatSlots, bathroomTotal, bathroomsTotal,
  addBathroom, removeBathroom, renameBathroom, setBathroomSlots, isBathroomEmpty,
  labelForBathroom, DEFAULT_BATHROOM_ID, type Bathroom,
  vanityCount, setVanityQty, bathroomSinkCount,
} from "@/lib/bathrooms";
// The per-bathroom bookkeeping — shared sizes and which modules are mounted — as pure
// functions, so the cross-contamination the C survey flagged is testable rather than buried
// in a setState callback. Also import-free, for the same reason lib/bathrooms is.
import {
  omitKey, mergeSharedBath, mergeSharedVanity, markSectionOpened, isSectionOpen,
  type ByBathroom, type ConfigKind, type OpenedSections, type SharedBath, type SharedVanity,
} from "@/lib/hub-state";
import { BathroomStrip } from "@/components/configurator/BathroomStrip";
import { ConfirmDialog } from "@/components/configurator/ConfirmDialog";
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

/**
 * A blank bathroom. Key order matches quoteBathrooms()' synthesised one so the autosave
 * comparison below (a JSON string) doesn't see a difference that isn't there.
 */
const emptyBathroom = (id: string): Bathroom => ({ id, name: null, room: null, shower: null, vanity: null, plumbing: null });

/** Which tab to open, preferring the one asked for and falling back to the first. */
const resolveActive = (baths: Bathroom[], wanted: string | null | undefined) =>
  baths.some((b) => b.id === wanted) ? (wanted as string) : baths[0].id;

/** What the autosave effect compares against — the quote AND which tab was open. */
const autosaveKey = (baths: Bathroom[], activeId: string) => JSON.stringify({ bathrooms: baths, activeId });

export default function Page() {
  const { t } = useLanguage();

  /**
   * The whole quote. One bathroom for the ordinary job — the array is what makes a second
   * expressible, not a change of shape for the first. DEFAULT_BATHROOM_ID is the id
   * quoteBathrooms() synthesises, so a fresh single-bathroom quote saves byte-identically to
   * what C1 wrote.
   */
  const [bathrooms, setBathrooms] = useState<Bathroom[]>(() => [emptyBathroom(DEFAULT_BATHROOM_ID)]);
  const [activeBathroomId, setActiveBathroomId] = useState<string>(DEFAULT_BATHROOM_ID);
  const [activeKind, setActiveKind] = useState<ConfigKind | null>(null);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  // A stale id — the active bathroom was just removed — resolves to the first rather than to
  // undefined, so every read below stays total.
  const activeIndex = Math.max(0, bathrooms.findIndex((b) => b.id === activeBathroomId));
  const activeBathroom = bathrooms[activeIndex] ?? bathrooms[0];
  const activeId = activeBathroom.id;
  const multi = bathrooms.length > 1;
  /** True when this bathroom takes the same vanity twice — his-and-hers. */
  const twin = vanityCount(activeBathroom) > 1;

  // The active bathroom's four slots, typed. Everything downstream — the summary, the hero,
  // the product strip — reads these, so it is unchanged from when they were four useStates.
  const room = (activeBathroom.room as RoomConfig | null) ?? null;
  const shower = (activeBathroom.shower as ShowerConfig | null) ?? null;
  const vanity = (activeBathroom.vanity as VanityConfig | null) ?? null;
  const plumbing = (activeBathroom.plumbing as PlumbingConfig | null) ?? null;

  const [sharedBath, setSharedBath] = useState<ByBathroom<SharedBath>>({});
  const [sharedVanity, setSharedVanity] = useState<ByBathroom<SharedVanity>>({});

  // In-progress configs, emitted by each module on every selection. They feed the hero
  // preview only — never the quote, never persistence — so the picture moves as the dealer
  // picks a decor instead of waiting for Add-to-quote. A committed slot is the fallback, so
  // closing a module without committing leaves the hero showing the last committed state.
  const [draftShower, setDraftShower] = useState<ByBathroom<ShowerConfig>>({});
  const [draftVanity, setDraftVanity] = useState<ByBathroom<VanityConfig>>({});
  const [draftPlumbing, setDraftPlumbing] = useState<ByBathroom<PlumbingConfig>>({});

  /**
   * MOUNT PER BATHROOM, LAZILY. One entry per (bathroom, section) that has ever been opened.
   *
   * Through C1 a configurator mounted on first open and then stayed mounted (hidden when
   * inactive) so in-progress work — and the room's placed fixtures — survived switching
   * between sections. That property is load-bearing and gets stronger here, not weaker: the
   * four modules take partial seeds (baseId, dimensions, finishes) and cannot be handed a
   * committed config back, and the room drawing has no initialDoc at all. Re-mounting on a
   * bathroom switch would therefore mean drawing a room in bathroom 1, switching away and
   * back, and committing from a blank canvas over the top of the good data. Ordinary
   * navigation would destroy work.
   *
   * So each bathroom gets its OWN set of modules, mounted the first time that bathroom's
   * section is opened and hidden when it isn't the visible one. Nothing mounts for a section
   * a dealer never opens, which is why the usual one-to-three bathrooms cost nothing.
   */
  const [opened, setOpened] = useState<OpenedSections>({});
  const markOpened = (id: string, kind: ConfigKind) => setOpened((p) => markSectionOpened(p, id, kind));
  const open = (kind: ConfigKind) => { setActiveKind(kind); markOpened(activeId, kind); };

  // The cross-module size sync, scoped to one bathroom. The merge rules — which field wins,
  // and when nothing has actually moved — live in lib/hub-state so they are testable.
  const applyBath = (id: string, v: Parameters<typeof mergeSharedBath>[2]) =>
    setSharedBath((all) => mergeSharedBath(all, id, v));
  const applyVanity = (id: string, v: Parameters<typeof mergeSharedVanity>[2]) =>
    setSharedVanity((all) => mergeSharedVanity(all, id, v));

  /** Commit into one bathroom's slots. Pure helper in, new array out — never an in-place edit. */
  const setSlots = useCallback(
    (id: string, slots: Partial<Pick<Bathroom, "room" | "shower" | "vanity" | "plumbing">>) =>
      setBathrooms((prev) => setBathroomSlots(prev, id, slots)),
    [],
  );

  const onRoomChange = (id: string, cfg: RoomConfig) => {
    const b = cfg.selections.bath, v = cfg.selections.vanity;
    if (b) applyBath(id, { kind: b.kind, baseId: b.sku });
    if (v) applyVanity(id, { size: v.w, sinks: v.sinks === 2 ? 2 : 1 });
    // Keep a COMMITTED room slot live as sizes flow in; an uncommitted one stays uncommitted.
    setBathrooms((prev) => prev.map((x) => (x.id === id && x.room ? { ...x, room: cfg } : x)));
  };
  const onRoomComplete = (id: string, cfg: RoomConfig) => {
    const b = cfg.selections.bath, v = cfg.selections.vanity;
    if (b) applyBath(id, { kind: b.kind, baseId: b.sku });
    if (v) applyVanity(id, { size: v.w, sinks: v.sinks === 2 ? 2 : 1 });
    setSlots(id, { room: cfg }); setActiveKind(null);
  };
  const onShowerComplete = (id: string, cfg: ShowerConfig) => {
    if (cfg.selections.path && cfg.selections.baseId) applyBath(id, { kind: cfg.selections.path, baseId: cfg.selections.baseId, baseColor: cfg.selections.baseColor });
    setSlots(id, { shower: cfg }); setActiveKind(null);
  };
  const onVanityComplete = (id: string, cfg: VanityConfig) => {
    if (cfg.selections.size != null) applyVanity(id, { size: cfg.selections.size, sinks: cfg.selections.sinks, drilling: cfg.selections.drilling, sinkShape: cfg.selections.sinkShape });
    setSlots(id, { vanity: cfg }); setActiveKind(null);
  };
  const onPlumbingComplete = (id: string, cfg: PlumbingConfig) => { setSlots(id, { plumbing: cfg }); setActiveKind(null); };

  // The quote total is the whole JOB — every bathroom on it. Anything charged once per job
  // (freight, in Phase D) belongs at quote level and never inside a bathroom, or a
  // two-bathroom quote would pay for it twice.
  const total = useMemo(() => bathroomsTotal(bathrooms), [bathrooms]);

  // ---- bathroom actions ----------------------------------------------------
  /**
   * Switch tabs, carrying the open section across: with the shower open, clicking another
   * bathroom means "show me this bathroom's shower". That mounts it if this is the first time,
   * which is the only place a module mounts without an explicit section click.
   */
  const selectBathroom = (id: string) => {
    setActiveBathroomId(id);
    if (activeKind) markOpened(id, activeKind);
  };

  function addAnotherBathroom() {
    const next = addBathroom(bathrooms);
    setBathrooms(next.bathrooms);
    setActiveBathroomId(next.id);
    // Back to the overview: a brand-new bathroom has nothing to show in any section yet.
    setActiveKind(null);
  }

  function confirmRemoveBathroom() {
    const id = pendingRemove;
    setPendingRemove(null);
    if (!id) return;
    const next = removeBathroom(bathrooms, id);
    if (next.bathrooms === bathrooms) return; // refused (the last one) or an unknown id
    setBathrooms(next.bathrooms);
    setActiveBathroomId(next.activeId);
    // Ids are never re-issued, so these entries could only leak memory — but a long session
    // adding and removing bathrooms would accumulate them, and a stale draft is worse than none.
    setSharedBath((m) => omitKey(m, id));
    setSharedVanity((m) => omitKey(m, id));
    setDraftShower((m) => omitKey(m, id));
    setDraftVanity((m) => omitKey(m, id));
    setDraftPlumbing((m) => omitKey(m, id));
    setOpened((m) => omitKey(m, id));
  }

  const renameBathroomTo = (id: string, name: string) => setBathrooms((prev) => renameBathroom(prev, id, name));

  // Shared seeds for the plumbing module: vanity sink count → faucet qty; the bathing
  // fixture kind → tub/shower vs shower-only trim. Read per bathroom at the render site.
  /**
   * One faucet per basin, across every cabinet in the bathroom.
   *
   * Reads the committed vanity plus its count rather than the live shared size, because the
   * count is a quote fact and the shared sizes are only a cross-module sync. Two double-sink
   * vanities is four faucets — off one cabinet's sink count the order would ship two, and
   * nobody would find out until install day.
   *
   * Falls back to the shared size while the vanity is still being configured and has not been
   * committed to a slot yet, so the plumbing module is seeded from the moment a size is picked.
   */
  const plumbingFaucetQty = (id: string): number => {
    const b = bathrooms.find((x) => x.id === id);
    const committed = b ? bathroomSinkCount(b) : 0;
    return committed > 0 ? committed : (sharedVanity[id]?.sinks === 2 ? 2 : 1);
  };

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

  /**
   * Adopt a whole quote's bathrooms, re-deriving each one's shared sizes from its own configs.
   *
   * Shared by the localStorage restore and the ?quote= load so both flow through one path.
   * The shared sizes are DERIVED rather than stored: they are a running cross-module sync, not
   * quote data, and re-computing them from the committed configs is what makes a restored
   * quote behave exactly like one that was just built.
   */
  const hydrateBathrooms = useCallback((baths: Bathroom[], wantedActive?: string | null) => {
    setBathrooms(baths);
    setActiveBathroomId(resolveActive(baths, wantedActive));
    const nextBath: ByBathroom<SharedBath> = {};
    const nextVanity: ByBathroom<SharedVanity> = {};
    for (const b of baths) {
      const r = b.room as RoomConfig | null;
      const sh = b.shower as ShowerConfig | null;
      const va = b.vanity as VanityConfig | null;
      // The shower is authoritative on the bathing fixture; the room's placed bath is the
      // fallback for a quote where only the room was drawn.
      const bath: SharedBath | null = sh && sh.selections.path && sh.selections.baseId
        ? { kind: sh.selections.path, baseId: sh.selections.baseId, baseColor: sh.selections.baseColor ?? "white" }
        : r && r.selections.bath ? { kind: r.selections.bath.kind, baseId: r.selections.bath.sku } : null;
      if (bath) nextBath[b.id] = bath;
      const van: SharedVanity | null = va && va.selections.size != null
        ? { size: va.selections.size, sinks: va.selections.sinks, drilling: va.selections.drilling ?? "1cc", sinkShape: va.selections.sinkShape ?? "oval" }
        : r && r.selections.vanity ? { size: r.selections.vanity.w, sinks: (r.selections.vanity.sinks === 2 ? 2 : 1) as 1 | 2, drilling: "1cc", sinkShape: r.selections.vanity.sinkShape ?? "oval" } : null;
      if (van) nextVanity[b.id] = van;
    }
    setSharedBath(nextBath);
    setSharedVanity(nextVanity);
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
          // Through the accessor rather than off q directly: a legacy quote (bathrooms null)
          // resolves to a synthesised bathroom holding the same four slots, so a quote saved
          // before C1 and one saved after it load identically.
          const baths = quoteBathrooms(q);
          hydrateBathrooms(baths);
          const proj = await getProject(q.projectId);
          if (cancelled) return;
          setActiveQuote({ id: q.id, projectId: q.projectId, name: q.name, projectName: proj?.name ?? "", status: q.status });
          if (typeof window !== "undefined") window.history.replaceState(null, "", "/portal/configurator");
          lastSnapshotRef.current = autosaveKey(baths, baths[0].id);
          hydratedRef.current = true;
          return;
        }
      }
      // Fall back to the autosaved current quote.
      const stored = loadCurrentQuote(userKey);
      if (cancelled) return;
      // A v2 draft has no `bathrooms` and no open tab — the accessor synthesises the first
      // bathroom from its four flat slots, which is the whole of the upgrade.
      const baths = quoteBathrooms(stored ?? {});
      const active = resolveActive(baths, stored?.activeBathroomId);
      if (stored) {
        hydrateBathrooms(baths, stored.activeBathroomId);
        setSavedAt(stored.savedAt);
      }
      lastSnapshotRef.current = autosaveKey(baths, active);
      hydratedRef.current = true;
    })();
    return () => { cancelled = true; };
  }, [ready, userKey, hydrateBathrooms]);

  // Flash a brief "saved" confirmation after an explicit save/update.
  useEffect(() => {
    if (saveStamp === 0) return;
    setShowSaved(true);
    const id = setTimeout(() => setShowSaved(false), 3500);
    return () => clearTimeout(id);
  }, [saveStamp]);

  // Auto-save (debounced) whenever the quote changes; clear storage once empty. The open tab
  // is part of the key as well as the payload, so a bare tab switch is persisted too and a
  // reload does not drop the dealer back on bathroom 1.
  useEffect(() => {
    if (!ready || !hydratedRef.current) return;
    const snapshot = autosaveKey(bathrooms, activeId);
    if (snapshot === lastSnapshotRef.current) return; // nothing actually changed (e.g. just restored)
    const timer = setTimeout(() => {
      if (bathrooms.length === 1 && isBathroomEmpty(bathrooms[0])) {
        clearCurrentQuote(userKey);
        setSavedAt(null);
      } else {
        // Both shapes, as everywhere else: the flat slots hold bathroom 1 for anything that
        // has not been taught about bathrooms, and the array holds the truth.
        saveCurrentQuote(userKey, { ...quoteFlatSlots({ bathrooms }), bathrooms, activeBathroomId: activeId });
        setSavedAt(new Date().toISOString());
      }
      lastSnapshotRef.current = snapshot;
    }, 400);
    return () => clearTimeout(timer);
  }, [bathrooms, activeId, ready, userKey]);

  // Refresh the "saved N ago" label without spamming re-renders.
  useEffect(() => {
    setNowMs(Date.now());
    if (!savedAt) return;
    const id = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(id);
  }, [savedAt]);

  function clearQuote() {
    if (typeof window !== "undefined" && !window.confirm(t("configurator.confirmClear"))) return;
    // Back to one empty bathroom — clearing the quote clears the whole job, extra bathrooms
    // included, which is what "clear the whole quote?" asks.
    const fresh = [emptyBathroom(DEFAULT_BATHROOM_ID)];
    setBathrooms(fresh);
    setActiveBathroomId(DEFAULT_BATHROOM_ID);
    setSharedBath({}); setSharedVanity({});
    // Drafts too, or a module left open would keep repainting the hero from work the dealer
    // just cleared. A still-mounted module re-emits its own state on the next edit.
    setDraftShower({}); setDraftVanity({}); setDraftPlumbing({});
    clearCurrentQuote(userKey);
    setSavedAt(null);
    setActiveQuote(null); setSavePanelOpen(false); setShowSaved(false);
    lastSnapshotRef.current = autosaveKey(fresh, DEFAULT_BATHROOM_ID);
  }

  const hasAny = bathrooms.some((b) => !isBathroomEmpty(b));

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
      name: activeQuote.name,
      // The dual-write, from the one place that knows the whole quote: flat slots mirror
      // bathroom 1, `bathrooms` carries the rest.
      ...quoteFlatSlots({ bathrooms }), bathrooms,
      total, status: activeQuote.status,
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
  // The hero shows the ACTIVE bathroom, so the drafts it prefers are that bathroom's — a
  // draft left behind in another one must not paint over the picture of this one.
  const heroSource = {
    room,
    shower: draftShower[activeId] ?? shower,
    vanity: draftVanity[activeId] ?? vanity,
    plumbing: draftPlumbing[activeId] ?? plumbing,
  };

  // The four slot rows of the ACTIVE bathroom. Extracted so the summary can put a bathroom
  // heading above them without duplicating them per bathroom — only one bathroom is ever
  // expanded, and it is always the one whose sections the dealer is editing.
  const slotRows = (
    <>
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
                <button onClick={() => setSlots(activeId, { room: null })} className="text-sm text-muted">{t("configurator.remove")}</button>
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
                <button onClick={() => setSlots(activeId, { shower: null })} className="text-sm text-muted">{t("configurator.remove")}</button>
              </>
            )}
          </div>
        </div>

        {/* Vanity row. The twin checkbox lives HERE rather than in the vanity module: the
            module configures one cabinet, and how many of it the job takes is a quote fact. */}
        <div className="rounded-2xl border border-line/70 bg-paper/80 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-ink">
              <div className="flex items-center gap-1.5 font-semibold">
                {t("configurator.vanityTitle")}
                {twin && (
                  <span className="rounded-full border border-accent/30 bg-accent-soft px-1.5 font-mono text-[9px] tracking-[0.1em] text-accent">
                    {t("configurator.vanity.twinBadge")}
                  </span>
                )}
              </div>
              <div className="text-xs text-muted">{vanity ? vanity.label : t("configurator.notAdded")}</div>
            </div>
            <div className="flex items-center gap-3">
              {/* The doubled figure, because that is what the quote charges. */}
              {vanity && <div className="font-semibold">{money(vanity.price.total * vanityCount(activeBathroom))}</div>}
              {vanity != null && (
                <>
                  <button onClick={() => open("vanity")} className="text-sm text-accent">{t("configurator.edit")}</button>
                  <button onClick={() => { setSlots(activeId, { vanity: null }); setBathrooms((prev) => setVanityQty(prev, activeId, 1)); }} className="text-sm text-muted">{t("configurator.remove")}</button>
                </>
              )}
            </div>
          </div>
          {/* Warn-don't-block, and opt-in: nothing is doubled until this is ticked. */}
          {vanity != null && (
            <label className="mt-2 flex cursor-pointer items-start gap-2 border-t border-line/60 pt-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={twin}
                onChange={(e) => setBathrooms((prev) => setVanityQty(prev, activeId, e.target.checked ? 2 : 1))}
                className="mt-0.5 shrink-0"
              />
              <span className="min-w-0">
                <span className="block text-ink">{t("configurator.vanity.twinAdd")}</span>
                <span className="block leading-snug">{t("configurator.vanity.twinHint")}</span>
              </span>
            </label>
          )}
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
                <button onClick={() => setSlots(activeId, { plumbing: null })} className="text-sm text-muted">{t("configurator.remove")}</button>
              </>
            )}
          </div>
        </div>
    </>
  );

  // The quote panel, built once and placed in exactly one of two spots (see wideQuote).
  const quoteSummary = (
    <div className="rounded-2xl border border-line bg-card p-5">
      <div className="mb-4">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">{t("configurator.currentQuote")}</span>
          {/* Across every bathroom now, but otherwise the condition it has always been —
              plumbing deliberately still not counted, so a single-bathroom quote shows this
              exactly where it did before. Left alone rather than quietly corrected here. */}
          {bathrooms.some((b) => b.room || b.shower || b.vanity) && (
            <button onClick={clearQuote} className="text-[10px] text-muted transition hover:text-ink">{t("configurator.clearQuote")}</button>
          )}
        </div>
        {savedText && <div className="mt-0.5 text-[10px] text-muted">{savedText}</div>}
      </div>

      <div className="space-y-3">
        {/* One bathroom expands into its four slot rows; the others collapse to a name and a
            subtotal that switches to them. At N=1 neither the heading nor a collapsed row is
            rendered, so this is the same list of four rows it has always been. */}
        {bathrooms.map((b, i) =>
          b.id === activeId ? (
            <Fragment key={b.id}>
              {multi && (
                <div className="flex items-baseline justify-between gap-2 pt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-accent">
                  <span className="truncate">{labelForBathroom(b, i, t)}</span>
                  <span className="shrink-0 normal-case tracking-normal text-muted">{money(bathroomTotal(b))}</span>
                </div>
              )}
              {slotRows}
            </Fragment>
          ) : (
            <button
              key={b.id}
              type="button"
              onClick={() => selectBathroom(b.id)}
              className="flex w-full items-baseline justify-between gap-2 rounded-2xl border border-line/70 bg-paper/40 px-4 py-2.5 text-left transition hover:border-accent"
            >
              <span className="truncate text-sm text-muted">{labelForBathroom(b, i, t)}</span>
              <span className="shrink-0 text-sm text-muted">{money(bathroomTotal(b))}</span>
            </button>
          ),
        )}

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
                quoteInput={{ bathrooms, total }}
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

      {/* Bathroom tabs. Renders NOTHING for a one-bathroom quote, which is every quote that
          exists today — see BathroomStrip for why that is the design and not an omission. */}
      {multi && (
        <BathroomStrip
          bathrooms={bathrooms}
          activeId={activeId}
          onSelect={selectBathroom}
          onRename={renameBathroomTo}
          onAdd={addAnotherBathroom}
          onRemoveRequest={setPendingRemove}
        />
      )}

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

          {/* Open configurator area. ONE SET OF MODULES PER BATHROOM, each mounting the first
              time that bathroom's section is opened and then staying mounted (hidden when it
              isn't the visible one) so its state persists and it can keep seeding from /
              feeding that bathroom's shared sizes. See the `opened` state for why switching
              bathrooms must not re-mount a shared set. */}
          <div>
            {bathrooms.map((b) => {
              // Same four typed slots as the active-bathroom reads above, for THIS bathroom.
              const bRoom = (b.room as RoomConfig | null) ?? null;
              const bShower = (b.shower as ShowerConfig | null) ?? null;
              const bVanity = (b.vanity as VanityConfig | null) ?? null;
              const bPlumbing = (b.plumbing as PlumbingConfig | null) ?? null;
              const bBath = sharedBath[b.id] ?? null;
              const bVanitySizes = sharedVanity[b.id] ?? null;
              // Visible only where the dealer actually is: this bathroom's tab AND this section.
              const shows = (kind: ConfigKind) => (b.id === activeId && activeKind === kind ? "" : "hidden");
              const mounted = (kind: ConfigKind) => isSectionOpen(opened, b.id, kind);
              return (
                <Fragment key={b.id}>
                  <div className={shows("room")}>
                    {mounted("room") && (
                      <RoomConfigurator
                        mode="dealer"
                        initialBath={bBath}
                        initialVanity={bVanitySizes}
                        vanityCount={vanityCount(b)}
                        initialTreatments={bRoom?.selections.treatments}
                        initialFlooring={bRoom?.selections.flooring}
                        initialWallBase={bRoom?.selections.wallBase}
                        initialPartitions={bRoom?.selections.partitions}
                        onChange={(cfg) => onRoomChange(b.id, cfg)}
                        onComplete={(cfg) => onRoomComplete(b.id, cfg)}
                        // Same call the module tab above makes — but reachable without scrolling
                        // back up past the drawing.
                        onBack={() => setActiveKind(null)}
                        primaryLabel={bRoom ? t("configurator.updateRoom") : t("configurator.addToQuote")}
                      />
                    )}
                  </div>
                  <div className={shows("shower")}>
                    {mounted("shower") && (
                      <ShowerConfigurator
                        mode="dealer"
                        initialKind={bBath?.kind}
                        initialBaseId={bBath?.baseId}
                        initialBaseColor={bBath?.baseColor}
                        onChange={(v) => applyBath(b.id, v)}
                        onPreview={(cfg) => setDraftShower((m) => ({ ...m, [b.id]: cfg }))}
                        onComplete={(cfg) => onShowerComplete(b.id, cfg)}
                        primaryLabel={bShower ? t("configurator.updateShower") : t("configurator.addToQuote")}
                      />
                    )}
                  </div>
                  <div className={shows("vanity")}>
                    {mounted("vanity") && (
                      <VanityConfigurator
                        mode="dealer"
                        initialSize={bVanitySizes?.size}
                        initialSinks={bVanitySizes?.sinks}
                        initialDrilling={bVanitySizes?.drilling}
                        initialSinkShape={bVanitySizes?.sinkShape}
                        onChange={(v) => applyVanity(b.id, v)}
                        onPreview={(cfg) => setDraftVanity((m) => ({ ...m, [b.id]: cfg }))}
                        onComplete={(cfg) => onVanityComplete(b.id, cfg)}
                        primaryLabel={bVanity ? t("configurator.updateVanity") : t("configurator.addToQuote")}
                      />
                    )}
                  </div>
                  <div className={shows("plumbing")}>
                    {mounted("plumbing") && (
                      <PlumbingConfigurator
                        mode="dealer"
                        lockedDrilling={bVanitySizes?.drilling}
                        lockedBathKind={bBath?.kind}
                        initialFaucetQty={plumbingFaucetQty(b.id)}
                        onChange={(cfg) => setDraftPlumbing((m) => ({ ...m, [b.id]: cfg }))}
                        onComplete={(cfg) => onPlumbingComplete(b.id, cfg)}
                        primaryLabel={bPlumbing ? t("configurator.updatePlumbing") : t("configurator.addToQuote")}
                      />
                    )}
                  </div>
                </Fragment>
              );
            })}
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

          {/* The one way into a second bathroom, and it only appears once there is a first
              bathroom worth having a second alongside. An empty quote offering "add another
              bathroom" would be asking a dealer to organise work they have not done yet.
              Past two, the strip's own + is the control and this disappears. */}
          {!multi && !isBathroomEmpty(bathrooms[0]) && (
            <button
              type="button"
              onClick={addAnotherBathroom}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-dashed border-line px-4 text-sm font-medium text-muted transition hover:border-accent hover:text-accent"
            >
              <Plus className="h-4 w-4" /> {t("configurator.bathroom.addAnother")}
            </button>
          )}
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

      {/* Removing a bathroom deletes work, and the dealer has to be able to read WHICH
          bathroom before they agree to it — hence a named dialog rather than window.confirm.
          removeBathroom() still refuses to remove the last one, so this can never empty a quote. */}
      {pendingRemove && (
        <ConfirmDialog
          title={t("configurator.bathroom.removeTitle", {
            name: labelForBathroom(
              bathrooms.find((b) => b.id === pendingRemove),
              Math.max(0, bathrooms.findIndex((b) => b.id === pendingRemove)),
              t,
            ),
          })}
          body={t("configurator.bathroom.removeBody")}
          confirmLabel={t("configurator.bathroom.removeConfirm")}
          cancelLabel={t("configurator.cancel")}
          onConfirm={confirmRemoveBathroom}
          onCancel={() => setPendingRemove(null)}
        />
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
