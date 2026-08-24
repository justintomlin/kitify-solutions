/**
 * lib/hub-state.ts — the configurator hub's per-bathroom bookkeeping. Pure, zero imports.
 *
 * Through Phase C1 the hub held three things page-global, and each was correct only because a
 * quote WAS one bathroom:
 *
 *   sharedBath / sharedVanity   the cross-module size sync. The room and shower modules both
 *                               write the bathing fixture, the vanity writes its own size, and
 *                               plumbing reads sink count off the vanity. Last-edit-wins.
 *   opened                      which sections have ever been opened, and therefore which
 *                               modules are mounted.
 *
 * Keyed by bathroom id they stop leaking. The C-phase survey called the shared sync out as the
 * least obvious thing that breaks under multiple bathrooms — "selecting a 60″ vanity in bathroom
 * 2 rewrites bathroom 1's plumbing faucet quantity. High probability, low visibility." That is a
 * wrong order line discovered weeks later, so the merge rules live here as ordinary functions
 * rather than inline in a setState callback, where nothing could reach them.
 *
 * Every function is PURE and returns the map it was given, unchanged and by identity, when
 * nothing actually moved. React leans on that: a new object is a re-render, and these maps are
 * written on every keystroke inside a module.
 */

/** The four sections of one bathroom. */
export type ConfigKind = "room" | "shower" | "vanity" | "plumbing";

/**
 * The bathing fixture, shared between the room and shower modules. `baseColor` only ever comes
 * from the shower — a room-sourced update omits it, and must not clear what the shower chose.
 */
export type SharedBath = { kind: "shower" | "tub"; baseId: string; baseColor?: string };

/**
 * The vanity, shared between the room, vanity and plumbing modules. `drilling` and `sinkShape`
 * only ever come from the vanity module, for the same reason.
 */
export type SharedVanity = { size: number; sinks: 1 | 2; drilling: "1cc" | "8cc"; sinkShape: "oval" | "rectangle" };

/** Anything the hub keeps one of per bathroom. Absent means "nothing recorded for that one". */
export type ByBathroom<T> = Record<string, T | undefined>;

/** Which sections of which bathrooms have been opened — i.e. which modules are mounted. */
export type OpenedSections = ByBathroom<Partial<Record<ConfigKind, boolean>>>;

/** Drop one bathroom's entry. Returns the same map when there was nothing to drop. */
export function omitKey<T>(map: ByBathroom<T>, id: string): ByBathroom<T> {
  if (!(id in map)) return map;
  const next = { ...map };
  delete next[id];
  return next;
}

/**
 * Record a bathing-fixture selection against ONE bathroom.
 *
 * Last-edit-wins per field: a room-sourced update carries no colour, so the colour the shower
 * last chose is preserved rather than reset to white. A null update is ignored outright —
 * removing a fixture in one module must never clear a size another module is relying on.
 */
export function mergeSharedBath(
  all: ByBathroom<SharedBath>,
  id: string,
  v: { kind: "shower" | "tub"; baseId: string; baseColor?: string } | null,
): ByBathroom<SharedBath> {
  if (!v) return all;
  const prev = all[id];
  const baseColor = v.baseColor ?? prev?.baseColor ?? "white";
  if (prev && prev.kind === v.kind && prev.baseId === v.baseId && (prev.baseColor ?? "white") === baseColor) return all;
  return { ...all, [id]: { kind: v.kind, baseId: v.baseId, baseColor } };
}

/** The vanity counterpart. Same rules, same reasons. */
export function mergeSharedVanity(
  all: ByBathroom<SharedVanity>,
  id: string,
  v: { size: number; sinks: 1 | 2; drilling?: "1cc" | "8cc"; sinkShape?: "oval" | "rectangle" } | null,
): ByBathroom<SharedVanity> {
  if (!v) return all;
  const prev = all[id];
  const drilling = v.drilling ?? prev?.drilling ?? "1cc";
  const sinkShape = v.sinkShape ?? prev?.sinkShape ?? "oval";
  if (prev && prev.size === v.size && prev.sinks === v.sinks && prev.drilling === drilling && prev.sinkShape === sinkShape) return all;
  return { ...all, [id]: { size: v.size, sinks: v.sinks, drilling, sinkShape } };
}

/**
 * Mark one section of one bathroom as opened — which is what mounts its module.
 *
 * Deliberately additive and one cell at a time. Mounting is per (bathroom, section) because the
 * four modules cannot be handed a committed config back: they take partial seeds only, and the
 * room drawing has no initialDoc at all. A single set of modules shared across bathrooms would
 * mean drawing a room in bathroom 1, switching away and back, and then committing from a blank
 * canvas over the top of the good data — data loss from ordinary navigation. So each bathroom
 * gets its own set, and a section nobody opens never mounts anywhere.
 */
export function markSectionOpened(map: OpenedSections, id: string, kind: ConfigKind): OpenedSections {
  if (map[id]?.[kind]) return map;
  return { ...map, [id]: { ...map[id], [kind]: true } };
}

/** True when that bathroom's section has been opened and its module is therefore mounted. */
export function isSectionOpen(map: OpenedSections, id: string, kind: ConfigKind): boolean {
  return !!map[id]?.[kind];
}
