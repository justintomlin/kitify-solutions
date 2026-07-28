/**
 * lib/catalog.ts — single source of truth for product sizes.
 *
 * The room editor (components/room) and the shower / vanity configurators all
 * read their SKU footprints and sizes from here, so they can never disagree on
 * what products exist or how big they are.
 *
 * PLACEHOLDER SKUs: entries marked `placeholder: true` are real physical sizes the
 * room editor can lay out and check clearances for, but the shower module still gates
 * them out of quotes until they carry confirmed pricing. (Right now ALL prices below
 * are nominal $1 placeholders — see the pricing note.) Remove the `placeholder` flag
 * once a SKU has both confirmed pricing and approval to quote.
 */

export type BaseSku = { id: string; w: number; d: number; label: string; dealerPrice: number; placeholder?: boolean };

// PLACEHOLDER PRICING — all values nominal ($1). Real pricing to be loaded from
// supplier spreadsheets. Do not ship to dealers with these values.
// (Placeholder-flagged SKUs stay gated out of quotes regardless of this nominal value.)
export const SHOWER_BASES: BaseSku[] = [
  { id: "32x32", w: 32, d: 32, label: '32" × 32"', dealerPrice: 1, placeholder: true },
  { id: "36x36", w: 36, d: 36, label: '36" × 36"', dealerPrice: 1, placeholder: true },
  { id: "48x30", w: 48, d: 30, label: '48" × 30"', dealerPrice: 1, placeholder: true },
  { id: "48x32", w: 48, d: 32, label: '48" × 32"', dealerPrice: 1, placeholder: true },
  { id: "48x36", w: 48, d: 36, label: '48" × 36"', dealerPrice: 1 },
  { id: "60x30", w: 60, d: 30, label: '60" × 30"', dealerPrice: 1, placeholder: true },
  { id: "60x32", w: 60, d: 32, label: '60" × 32"', dealerPrice: 1 },
  { id: "60x36", w: 60, d: 36, label: '60" × 36"', dealerPrice: 1 },
  { id: "72x36", w: 72, d: 36, label: '72" × 36"', dealerPrice: 1 },
  { id: "78x36", w: 78, d: 36, label: '78" × 36"', dealerPrice: 1 },
];

// PLACEHOLDER PRICING — all values nominal ($1). Real pricing to be loaded from
// supplier spreadsheets. Do not ship to dealers with these values.
export const TUBS: BaseSku[] = [
  { id: "60x30", w: 60, d: 30, label: '60" × 30"', dealerPrice: 1 },
  { id: "60x32", w: 60, d: 32, label: '60" × 32"', dealerPrice: 1 },
  { id: "60x36", w: 60, d: 36, label: '60" × 36" (deck)', dealerPrice: 1 },
  { id: "72x36", w: 72, d: 36, label: '72" × 36" (deck)', dealerPrice: 1 },
];

// Base/pan color options — solid hex swatches (no images), shared by the shower
// base and the skirted tub. Color is not a priced option.
export type ShowerBaseColor = { id: string; name: string; hex: string };
export const SHOWER_BASE_COLORS: ShowerBaseColor[] = [
  { id: "white", name: "White", hex: "#f4f2ee" },
  { id: "beige", name: "Beige", hex: "#d9cfbe" },
  { id: "black", name: "Black", hex: "#2b2b2b" },
  { id: "grey",  name: "Grey",  hex: "#a8a8a3" },
];

// Vanity cabinet sizes (inches wide) and depth — CS Factory CAD.
export const VANITY_SIZES: number[] = [18, 24, 30, 36, 42, 48, 60];
export const VANITY_DEPTH = 21;

// Durato V-EVO MAX — 6mm SPC rigid core, 20mil wear layer, click-lock.
// PLACEHOLDER PRICING — all values nominal ($1). Real pricing to be loaded from
// supplier spreadsheets. Do not ship to dealers with these values.
export const FLOORING_SF_PRICE = 1;
export const FLOORING_LINE = {
  id: "durato-vevo-max",
  brand: "Durato",
  name: "V-EVO MAX",
  plankSize: '7" × 48"',
  sfPerCarton: 14.1825,
  planksPerCarton: 6,
  sfPerPallet: 850.95,
  sfPrice: FLOORING_SF_PRICE,
};

export type FlooringColor = { id: string; name: string; image: string };
// Image paths point at the exact files in public/durato_vevo_max/. Filenames contain
// spaces (encoded as %20) and two are .jpeg rather than .jpg.
export const FLOORING_COLORS: FlooringColor[] = [
  { id: "vmd-01", name: "Florence", image: "/durato_vevo_max/VMD-01%20Florence.jpg" },
  { id: "vmd-02", name: "Woolworth", image: "/durato_vevo_max/VMD-02%20Woolworth.jpg" },
  { id: "vmd-03", name: "Baymont", image: "/durato_vevo_max/VMD-03%20Baymont.jpeg" },
  { id: "vmd-04", name: "Wentworth", image: "/durato_vevo_max/VMD-04%20Wentworth.jpg" },
  { id: "vmd-05", name: "Blenheim", image: "/durato_vevo_max/VMD-05%20Blenheim.jpeg" },
  { id: "vmd-06", name: "Buckingham", image: "/durato_vevo_max/VMD-06%20Buckingham.jpg" },
  { id: "vmd-07", name: "Dresden", image: "/durato_vevo_max/VMD-07%20Dresden.jpg" },
  { id: "vmd-08", name: "Sistine", image: "/durato_vevo_max/VMD-08%20Sistine.jpg" },
  { id: "vmd-09", name: "Gherkin", image: "/durato_vevo_max/VMD-09%20Gherkin.jpg" },
  { id: "vmd-10", name: "Savoye", image: "/durato_vevo_max/VMD-10%20Savoye.jpg" },
  { id: "vmd-11", name: "Petronas", image: "/durato_vevo_max/VMD-11%20Petronas.jpg" },
  { id: "vmd-12", name: "Cayan", image: "/durato_vevo_max/VMD-12%20Cayan.jpg" },
];

// Carton-based flooring takeoff. Cartons are whole units — partial cartons can't be
// ordered, so coverage rounds up and overage is the resulting waste. Pure & testable.
export function flooringTakeoff(floorSF: number, wastePct: number) {
  const { sfPerCarton, sfPrice } = FLOORING_LINE;
  const withWasteSF = floorSF * (1 + wastePct / 100);
  const cartons = Math.ceil(withWasteSF / sfPerCarton);
  const coverageSF = cartons * sfPerCarton;
  const overageSF = coverageSF - floorSF;
  const cost = coverageSF * sfPrice;
  return { withWasteSF, cartons, coverageSF, overageSF, cost };
}

// PLACEHOLDER PRICING — nominal ($1 per stick). Real pricing to be loaded from
// supplier spreadsheets. Do not ship to dealers with these values.
export const WALL_BASE_STICK_PRICE = 1;
export const WALL_BASE_STICK_LF = 8;
export const WALL_BASE_HEIGHTS = [4, 6] as const;   // inches
export type WallBaseColor = { id: string; name: string; hex: string };
export const WALL_BASE_COLORS: WallBaseColor[] = [
  { id: "white",     name: "White",     hex: "#f4f2ee" },
  { id: "beige",     name: "Beige",     hex: "#d9cfbe" },
  { id: "black",     name: "Black",     hex: "#2b2b2b" },
  { id: "dove-grey", name: "Dove Grey", hex: "#a8a8a3" },
];

// Stick-based wall base takeoff. Wall base sells in whole 8-ft sticks — partial sticks
// can't be ordered, so coverage rounds up and overage is the resulting waste. Mirrors
// flooringTakeoff so the two read consistently. Pure & testable.
export function wallBaseTakeoff(baseboardLF: number, wastePct = 10) {
  const withWasteLF = baseboardLF * (1 + wastePct / 100);
  const sticks = Math.ceil(withWasteLF / WALL_BASE_STICK_LF);
  const coverageLF = sticks * WALL_BASE_STICK_LF;
  const overageLF = coverageLF - baseboardLF;
  const cost = sticks * WALL_BASE_STICK_PRICE;
  return { withWasteLF, sticks, coverageLF, overageLF, cost };
}

// Wall panel stock: 24" wide × 110" tall, installed vertically.
export const WALL_PANEL = { widthIn: 24, heightIn: 110 };

export type WallPanelTakeoff = { fullPanels: number; binsUsed: number; totalPanels: number };

/**
 * Wall-panel takeoff with offcut reuse. `netLengths` are the net running lengths
 * (inches) of every wall to be panelled. Each wall yields floor(net / width) full
 * panels; the leftover remainder is an offcut. Remainders are packed into additional
 * full-width panels using first-fit-decreasing bin packing (offcuts are full height,
 * so only width matters). Openings are NOT deducted by this function — pass the net
 * length including any door/window, since a cutout is waste, not a saved panel.
 *
 * Pure and deterministic — safe to unit test in isolation.
 */
export function wallPanelTakeoff(netLengths: number[], widthIn: number = WALL_PANEL.widthIn): WallPanelTakeoff {
  let fullPanels = 0;
  const remainders: number[] = [];
  for (const len of netLengths) {
    if (!(len > 0)) continue;
    const full = Math.floor(len / widthIn);
    fullPanels += full;
    const rem = len - full * widthIn;
    if (rem > 1e-6) remainders.push(rem);
  }
  remainders.sort((a, b) => b - a); // first-fit DECREASING
  const capacityLeft: number[] = []; // remaining width in each opened offcut panel
  for (const r of remainders) {
    let placed = false;
    for (let i = 0; i < capacityLeft.length; i++) {
      if (capacityLeft[i] + 1e-6 >= r) { capacityLeft[i] -= r; placed = true; break; }
    }
    if (!placed) capacityLeft.push(widthIn - r); // open a new panel
  }
  return { fullPanels, binsUsed: capacityLeft.length, totalPanels: fullPanels + capacityLeft.length };
}
