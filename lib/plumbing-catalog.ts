// Delta plumbing catalogue — generated from kitify-delta-sku-list.xlsx.
// Wholesale channel. Trims are Monitor 14 Series only. One rough-in valve for all
// packages and finishes. Order SKU already encodes the finish: lav faucets carry the
// code inside the model (559LF-BLMPU-DST), trims and accessories take it as a suffix
// (T14459-BL); Chrome has no code. Do not derive SKUs by rule — read them from here.
//
// PLACEHOLDER PRICING — all values nominal ($1). Real pricing to be loaded from
// supplier spreadsheets. Do not ship to dealers with these values.

export type PlumbingFinishId =
  | "chrome"
  | "stainless"
  | "matte-black"
  | "champagne-bronze"
  | "venetian-bronze"
  | "polished-nickel";

export type PlumbingComponentKey =
  | "faucet1cc"
  | "faucet8cc"
  | "showerTrim"
  | "tubShowerTrim"
  | "towelBar18"
  | "towelBar24"
  | "tpHolder"
  | "towelRing"
  | "robeHook";

export type PlumbingFinish = { id: PlumbingFinishId; name: string; code: string; hex: string };

export const PLUMBING_FINISHES: PlumbingFinish[] = [
  { id: "chrome", name: "Chrome", code: "", hex: "#c9ccd1" },
  { id: "stainless", name: "Brilliance Stainless", code: "SS", hex: "#adaea8" },
  { id: "matte-black", name: "Matte Black", code: "BL", hex: "#2b2b2b" },
  { id: "champagne-bronze", name: "Champagne Bronze", code: "CZ", hex: "#c2a878" },
  { id: "venetian-bronze", name: "Venetian Bronze", code: "RB", hex: "#4a3a2e" },
  { id: "polished-nickel", name: "Polished Nickel", code: "PN", hex: "#d6d3cb" },
];

// Shared across every package and finish.
export const ROUGH_IN_VALVE = {
  standard: { sku: "R10000-UNBX", name: "MultiChoice Universal rough-in valve", price: 1 },
  withStops: { sku: "R10000-UNWS", name: "MultiChoice Universal rough-in valve w/ stops", price: 1 },
};

// SKU PENDING — tub waste & overflow has not been sourced yet. The finish follows the
// tub/shower trim. Do not order against this entry until a real SKU is supplied.
export const WASTE_OVERFLOW = { sku: null as string | null, name: "Waste & overflow", price: 1 };

export type PlumbingPackage = {
  id: string;
  name: string;
  lane: string;          // style lane shown to the dealer
  family: string;        // Delta collection name
  skus: Record<PlumbingComponentKey, Partial<Record<PlumbingFinishId, string>>>;
};

export const PLUMBING_PACKAGES: PlumbingPackage[] = [
  {
    id: "terra",
    name: "Terra",
    lane: "Grounded",
    family: "Woodhurst",
    skus: {
      faucet1cc: { "chrome": "532-MPU-DST", "stainless": "532-SSMPU-DST", "matte-black": "532-BLMPU-DST", "champagne-bronze": "532-CZMPU-DST", "venetian-bronze": "532-RBMPU-DST", "polished-nickel": "532-PNMPU-DST" },
      faucet8cc: { "chrome": "3532LF-MPU", "stainless": "3532LF-SSMPU", "matte-black": "3532LF-BLMPU", "champagne-bronze": "3532LF-CZMPU", "venetian-bronze": "3532LF-RBMPU", "polished-nickel": "3532LF-PNMPU" },
      showerTrim: { "chrome": "T14232", "stainless": "T14232-SS", "matte-black": "T14232-BL", "champagne-bronze": "T14232-CZ", "venetian-bronze": "T14232-RB", "polished-nickel": "T14232-PN" },
      tubShowerTrim: { "chrome": "T14432", "stainless": "T14432-SS", "matte-black": "T14432-BL", "champagne-bronze": "T14432-CZ", "venetian-bronze": "T14432-RB", "polished-nickel": "T14432-PN" },
      towelBar18: { "chrome": "73218", "stainless": "73218-SS", "matte-black": "73218-BL", "champagne-bronze": "73218-CZ", "venetian-bronze": "73218-RB", "polished-nickel": "73218-PN" },
      towelBar24: { "chrome": "73224", "stainless": "73224-SS", "matte-black": "73224-BL", "champagne-bronze": "73224-CZ", "venetian-bronze": "73224-RB", "polished-nickel": "73224-PN" },
      tpHolder: { "chrome": "73250", "stainless": "73250-SS", "matte-black": "73250-BL", "champagne-bronze": "73250-CZ", "venetian-bronze": "73250-RB", "polished-nickel": "73250-PN" },
      towelRing: { "chrome": "73246", "stainless": "73246-SS", "matte-black": "73246-BL", "champagne-bronze": "73246-CZ", "venetian-bronze": "73246-RB", "polished-nickel": "73246-PN" },
      robeHook: { "chrome": "73235", "stainless": "73235-SS", "matte-black": "73235-BL", "champagne-bronze": "73235-CZ", "venetian-bronze": "73235-RB", "polished-nickel": "73235-PN" },
    },
  },
  {
    id: "boheme",
    name: "Bohème",
    lane: "Artsy",
    family: "Lahara",
    skus: {
      faucet1cc: { "chrome": "538-MPU-DST", "stainless": "538-SSMPU-DST", "matte-black": "538-BLMPU-DST", "champagne-bronze": "538-CZMPU-DST", "venetian-bronze": "538-RBMPU-DST", "polished-nickel": "538-PNMPU-DST" },
      faucet8cc: { "chrome": "3538-MPU-DST", "stainless": "3538-SSMPU-DST", "matte-black": "3538-BLMPU-DST", "champagne-bronze": "3538-CZMPU-DST", "venetian-bronze": "3538-RBMPU-DST", "polished-nickel": "3538-PNMPU-DST" },
      showerTrim: { "chrome": "T14238", "stainless": "T14238-SS", "matte-black": "T14238-BL", "champagne-bronze": "T14238-CZ", "venetian-bronze": "T14238-RB", "polished-nickel": "T14238-PN" },
      tubShowerTrim: { "chrome": "T14438", "stainless": "T14438-SS", "matte-black": "T14438-BL", "champagne-bronze": "T14438-CZ", "venetian-bronze": "T14438-RB", "polished-nickel": "T14438-PN" },
      towelBar18: { "chrome": "73818", "stainless": "73818-SS", "matte-black": "73818-BL", "champagne-bronze": "73818-CZ", "venetian-bronze": "73818-RB", "polished-nickel": "73818-PN" },
      towelBar24: { "chrome": "73824", "stainless": "73824-SS", "matte-black": "73824-BL", "champagne-bronze": "73824-CZ", "venetian-bronze": "73824-RB", "polished-nickel": "73824-PN" },
      tpHolder: { "chrome": "73850", "stainless": "73850-SS", "matte-black": "73850-BL", "champagne-bronze": "73850-CZ", "venetian-bronze": "73850-RB", "polished-nickel": "73850-PN" },
      towelRing: { "chrome": "73846", "stainless": "73846-SS", "matte-black": "73846-BL", "champagne-bronze": "73846-CZ", "venetian-bronze": "73846-RB", "polished-nickel": "73846-PN" },
      robeHook: { "chrome": "73835", "stainless": "73835-SS", "matte-black": "73835-BL", "champagne-bronze": "73835-CZ", "venetian-bronze": "73835-RB", "polished-nickel": "73835-PN" },
    },
  },
  {
    id: "eleva",
    name: "Eleva",
    lane: "Transitional",
    family: "Ashlyn",
    skus: {
      faucet1cc: { "chrome": "564-MPU-DST", "stainless": "564-SSMPU-DST", "matte-black": "564-BLMPU-DST", "champagne-bronze": "564-CZMPU-DST", "venetian-bronze": "564-RBMPU-DST", "polished-nickel": "564-PNMPU-DST" },
      faucet8cc: { "chrome": "3564-MPU-DST", "stainless": "3564-SSMPU-DST", "matte-black": "3564-BLMPU-DST", "champagne-bronze": "3564-CZMPU-DST", "venetian-bronze": "3564-RBMPU-DST", "polished-nickel": "3564-PNMPU-DST" },
      showerTrim: { "chrome": "T14264", "stainless": "T14264-SS", "matte-black": "T14264-BL", "champagne-bronze": "T14264-CZ", "venetian-bronze": "T14264-RB", "polished-nickel": "T14264-PN" },
      tubShowerTrim: { "chrome": "T14464", "stainless": "T14464-SS", "matte-black": "T14464-BL", "champagne-bronze": "T14464-CZ", "venetian-bronze": "T14464-RB", "polished-nickel": "T14464-PN" },
      towelBar18: { "chrome": "76418", "stainless": "76418-SS", "matte-black": "76418-BL", "champagne-bronze": "76418-CZ", "venetian-bronze": "76418-RB", "polished-nickel": "76418-PN" },
      towelBar24: { "chrome": "76424", "stainless": "76424-SS", "matte-black": "76424-BL", "champagne-bronze": "76424-CZ", "venetian-bronze": "76424-RB", "polished-nickel": "76424-PN" },
      tpHolder: { "chrome": "76450", "stainless": "76450-SS", "matte-black": "76450-BL", "champagne-bronze": "76450-CZ", "venetian-bronze": "76450-RB", "polished-nickel": "76450-PN" },
      towelRing: { "chrome": "76446", "stainless": "76446-SS", "matte-black": "76446-BL", "champagne-bronze": "76446-CZ", "venetian-bronze": "76446-RB", "polished-nickel": "76446-PN" },
      robeHook: { "chrome": "76435", "stainless": "76435-SS", "matte-black": "76435-BL", "champagne-bronze": "76435-CZ", "venetian-bronze": "76435-RB", "polished-nickel": "76435-PN" },
    },
  },
  {
    id: "lumen",
    name: "Lumen",
    lane: "Modern",
    family: "Trinsic",
    skus: {
      faucet1cc: { "chrome": "559LF-MPU-DST", "stainless": "559LF-SSMPU-DST", "matte-black": "559LF-BLMPU-DST", "champagne-bronze": "559LF-CZMPU-DST", "venetian-bronze": "559LF-RBMPU-DST", "polished-nickel": "559LF-PNMPU-DST" },
      faucet8cc: { "chrome": "3559-MPU-DST", "stainless": "3559-SSMPU-DST", "matte-black": "3559-BLMPU-DST", "champagne-bronze": "3559-CZMPU-DST", "venetian-bronze": "3559-RBMPU-DST", "polished-nickel": "3559-PNMPU-DST" },
      showerTrim: { "chrome": "T14259", "stainless": "T14259-SS", "matte-black": "T14259-BL", "champagne-bronze": "T14259-CZ", "venetian-bronze": "T14259-RB", "polished-nickel": "T14259-PN" },
      tubShowerTrim: { "chrome": "T14459", "stainless": "T14459-SS", "matte-black": "T14459-BL", "champagne-bronze": "T14459-CZ", "venetian-bronze": "T14459-RB", "polished-nickel": "T14459-PN" },
      towelBar18: { "chrome": "759180", "stainless": "759180-SS", "matte-black": "759180-BL", "champagne-bronze": "759180-CZ", "venetian-bronze": "759180-RB", "polished-nickel": "759180-PN" },
      towelBar24: { "chrome": "759240", "stainless": "759240-SS", "matte-black": "759240-BL", "champagne-bronze": "759240-CZ", "venetian-bronze": "759240-RB", "polished-nickel": "759240-PN" },
      tpHolder: { "chrome": "75950", "stainless": "75950-SS", "matte-black": "75950-BL", "champagne-bronze": "75950-CZ", "venetian-bronze": "75950-RB", "polished-nickel": "75950-PN" },
      towelRing: { "chrome": "759460", "stainless": "759460-SS", "matte-black": "759460-BL", "champagne-bronze": "759460-CZ", "venetian-bronze": "759460-RB", "polished-nickel": "759460-PN" },
      robeHook: { "chrome": "75935", "stainless": "75935-SS", "matte-black": "75935-BL", "champagne-bronze": "75935-CZ", "venetian-bronze": "75935-RB", "polished-nickel": "75935-PN" },
    },
  },
];

// Nominal pricing per component. Replace from the supplier price book.
export const PLUMBING_PRICES: Record<PlumbingComponentKey, number> = {
  faucet1cc: 1,
  faucet8cc: 1,
  showerTrim: 1,
  tubShowerTrim: 1,
  towelBar18: 1,
  towelBar24: 1,
  tpHolder: 1,
  towelRing: 1,
  robeHook: 1,
};

export const PLUMBING_COMPONENT_LABELS: Record<PlumbingComponentKey, string> = {
  faucet1cc: "Lavatory faucet — single handle (1cc)",
  faucet8cc: 'Lavatory faucet — 8" widespread (8cc)',
  showerTrim: "Shower-only trim",
  tubShowerTrim: "Tub/shower trim",
  towelBar18: 'Towel bar 18"',
  towelBar24: 'Towel bar 24"',
  tpHolder: "Toilet paper holder",
  towelRing: "Towel ring",
  robeHook: "Robe hook",
};

export const ACCESSORY_KEYS: PlumbingComponentKey[] = ["towelBar18", "towelBar24", "tpHolder", "towelRing", "robeHook"];

export function plumbingSku(packageId: string, component: PlumbingComponentKey, finish: PlumbingFinishId): string | undefined {
  return PLUMBING_PACKAGES.find((p) => p.id === packageId)?.skus[component]?.[finish];
}