/**
 * Catalog fixture — guards the hand-transcribed price sheet.
 *
 * Every figure in the shower half of lib/catalog.ts was typed in from the Therma-Glass Master
 * Price Sheet, which is exactly the kind of data that rots silently: a duplicated product code
 * or a dropped decimal place still compiles, still renders, and still quotes. These assert the
 * things a reader cannot check by eye — uniqueness across ~180 codes, the derived footprint
 * prices, and the colour subsets that differ per size.
 *
 * Node's built-in runner with type stripping — no framework:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  SHOWER_BASE_SKUS, ALCOVE_TUB_SKUS, SHOWER_BASES, TUBS,
  COMPOSITE_BASE_COLORS, NUVO_THRESHOLDS,
  SHOWER_DOORS, DOOR_FAMILIES, DEFAULT_DOOR_FAMILY,
  SPC_WALL_KITS, NUVO_PANEL_KITS, NUVO_TRIM, NUVO_INSTALL_TAPE,
  CORNER_SHELF, SHOWER_NICHE, GRAB_BARS, LEGACY_GRAB_BAR_SIZES, SHOWER_CHAIR,
  matchSpcWallKit, spcKitCode,
} from "../catalog.ts";
import { getAllHplPanels, getPanelCollections, getPanel } from "../naturepanel-catalog.ts";

// --------------------------------------------------------------- bases

test("every base variant carries a real product code and a real price", () => {
  for (const sku of [...SHOWER_BASE_SKUS, ...ALCOVE_TUB_SKUS]) {
    assert.ok(sku.variants.length > 0, `${sku.family}/${sku.id} has no variants`);
    for (const v of sku.variants) {
      assert.match(v.productCode, /^[A-Z0-9][A-Z0-9-]+$/, `bad code ${v.productCode}`);
      // $1 was the old placeholder sentinel — nothing on the sheet costs a dollar.
      assert.ok(v.dealerPrice > 10, `${v.productCode} priced at ${v.dealerPrice}`);
    }
  }
});

test("base SKU counts match the price sheet", () => {
  const byFamily = (f: string) =>
    [...SHOWER_BASE_SKUS, ...ALCOVE_TUB_SKUS].filter((s) => s.family === f).flatMap((s) => s.variants).length;
  assert.equal(byFamily("composite"), 18);   // 4+4+4+3+3
  assert.equal(byFamily("acrylic"), 13);
  assert.equal(byFamily("alcove-tub"), 4);
});

test("72x36 and 78x36 composite are not offered in Cotton White", () => {
  for (const id of ["72x36", "78x36"]) {
    const sku = SHOWER_BASE_SKUS.find((s) => s.family === "composite" && s.id === id)!;
    assert.equal(sku.variants.length, 3);
    assert.ok(!sku.variants.some((v) => v.colorId === "cotton-white"), `${id} should not offer Cotton White`);
  }
  // …whereas the three smaller composites are.
  const small = SHOWER_BASE_SKUS.find((s) => s.family === "composite" && s.id === "48x36")!;
  assert.equal(small.variants.length, 4);
  assert.ok(small.variants.some((v) => v.colorId === "cotton-white"));
});

test("the 60x32 collision resolves to three different products", () => {
  const at6032 = SHOWER_BASE_SKUS.filter((s) => s.w === 60 && s.d === 32);
  const codes = at6032.flatMap((s) => s.variants.map((v) => v.productCode));
  assert.ok(codes.includes("NUV-BASE-6032E-CW"), "composite end-drain missing");
  assert.ok(codes.includes("K-UT09-6032L"), "acrylic left-drain missing");
  assert.ok(codes.includes("K-SB6032R"), "seated right-drain missing");
  // …and the seated pan is its own id, not a variant of the standard one.
  assert.ok(at6032.some((s) => s.id === "60x32-seated"));
  const tub = ALCOVE_TUB_SKUS.find((s) => s.id === "60x32")!;
  assert.equal(tub.variants[0].productCode, "BGS-2763-6032L");
});

test("drain positions come from the SKU, not from the dimension", () => {
  const drains = (family: string, id: string) =>
    [...new Set(SHOWER_BASE_SKUS.filter((s) => s.family === family && s.id === id).flatMap((s) => s.variants.map((v) => v.drain)))].sort();
  assert.deepEqual(drains("acrylic", "60x30"), ["left", "right"]);
  assert.deepEqual(drains("acrylic", "60x36"), ["center"]);
  assert.deepEqual(drains("composite", "60x32"), ["end"]);
});

// ------------------------------------------------- derived footprint list

test("SHOWER_BASES is one row per dimension at the cheapest family price", () => {
  const price = (id: string) => SHOWER_BASES.find((b) => b.id === id)!.dealerPrice;
  // 48x36 exists as a $558 composite and a $403.20 acrylic.
  assert.equal(price("48x36"), 403.2);
  // 60x32 as a $543.60 composite and a $411 acrylic.
  assert.equal(price("60x32"), 411);
  // 60x36 as a $608.40 composite and a $464.40 acrylic.
  assert.equal(price("60x36"), 464.4);
  // Composite-only sizes keep their own price.
  assert.equal(price("72x36"), 658.8);
  assert.equal(price("78x36"), 684);
});

test("footprint ids are unique — the room editor keys on them", () => {
  for (const list of [SHOWER_BASES, TUBS]) {
    const ids = list.map((b) => b.id);
    assert.equal(new Set(ids).size, ids.length, `duplicate id in ${ids.join(",")}`);
  }
});

test("sizes with no orderable SKU stay as unquotable footprints", () => {
  for (const id of ["32x32", "48x30"]) {
    const b = SHOWER_BASES.find((x) => x.id === id)!;
    assert.equal(b.placeholder, true, `${id} must be gated out of quotes`);
    assert.equal(b.dealerPrice, 0, `${id} must not carry an invented price`);
  }
  // The deck-mount tubs are out of scope but still lay out in a room.
  for (const id of ["60x36", "72x36"]) {
    assert.equal(TUBS.find((x) => x.id === id)!.placeholder, true);
  }
  // …and the alcove tubs that ARE offered are priced.
  assert.equal(TUBS.find((x) => x.id === "60x30")!.dealerPrice, 730.2);
});

test("every priced footprint lost its placeholder flag", () => {
  for (const b of [...SHOWER_BASES, ...TUBS]) {
    assert.equal(b.dealerPrice > 0, !b.placeholder, `${b.id} price/flag disagree`);
  }
});

// --------------------------------------------------------------- doors

test("door families are the three on the sheet, defaulting to the value line", () => {
  assert.deepEqual(DOOR_FAMILIES, ["pacific", "rainier", "tetherow"]);
  assert.equal(DEFAULT_DOOR_FAMILY, "rainier");
  // Salishan and Trillium were invented placeholder series and must not come back.
  const codes = SHOWER_DOORS.flatMap((d) => d.variants.map((v) => v.productCode)).join(" ");
  assert.ok(!/SAL|TRI/.test(codes), "a retired series survived");
});

test("only Rainier offers opaque glass", () => {
  for (const d of SHOWER_DOORS) {
    const hasOpaque = d.variants.some((v) => v.glass === "opaque");
    assert.equal(hasOpaque, d.family === "rainier", `${d.id} glass axis is wrong`);
  }
  assert.equal(SHOWER_DOORS.filter((d) => d.family === "rainier").flatMap((d) => d.variants).length, 18);
  assert.equal(SHOWER_DOORS.filter((d) => d.family === "pacific").flatMap((d) => d.variants).length, 9);
  assert.equal(SHOWER_DOORS.filter((d) => d.family === "tetherow").flatMap((d) => d.variants).length, 6);
});

test("door prices and codes match the sheet", () => {
  const find = (code: string) => SHOWER_DOORS.flatMap((d) => d.variants).find((v) => v.productCode === code);
  assert.equal(find("PAC-4880-SC")!.dealerPrice, 984);
  assert.equal(find("PAC-4880-BNC")!.dealerPrice, 996);
  assert.equal(find("PAC-6080-MBC")!.dealerPrice, 1086);
  assert.equal(find("RAN-4870-SC")!.dealerPrice, 505.8);
  assert.equal(find("RAN-6070-BNO")!.dealerPrice, 610.8);   // opaque prices as clear
  assert.equal(find("RAN-6057-MBC")!.dealerPrice, 577.2);
  assert.equal(find("TET-6075-SC")!.dealerPrice, 728.4);
  assert.equal(find("TET-6060-BNC")!.dealerPrice, 715.8);
});

test("Tetherow has no 48-inch model, so a 48-inch opening sees two families", () => {
  const at48 = SHOWER_DOORS.filter((d) => d.fits === 48);
  assert.deepEqual([...new Set(at48.map((d) => d.family))].sort(), ["pacific", "rainier"]);
  assert.ok(!SHOWER_DOORS.some((d) => d.family === "tetherow" && d.fits === 48));
});

test("every opening has both a shower door and a tub door where the sheet lists one", () => {
  assert.ok(SHOWER_DOORS.some((d) => d.forPath === "tub" && d.family === "pacific"));
  assert.ok(SHOWER_DOORS.some((d) => d.forPath === "tub" && d.family === "rainier"));
  assert.ok(SHOWER_DOORS.some((d) => d.forPath === "tub" && d.family === "tetherow"));
  // Tub doors are short — a 70" screen on a tub rim would be the wrong product.
  for (const d of SHOWER_DOORS.filter((x) => x.forPath === "tub")) {
    assert.ok(d.heightIn <= 66, `${d.id} is ${d.heightIn}" — too tall for a tub`);
  }
});

// ----------------------------------------------------------- SPC walls

test("SPC kit matching is exact where the sheet has a kit", () => {
  const m = matchSpcWallKit(60, 36, 80)!;
  assert.equal(m.exact, true);
  assert.equal(spcKitCode(m.kit, "amber-beige"), "NUV-6036-80AB");

  const h = matchSpcWallKit(60, 36, 96)!;
  assert.equal(h.exact, true);
  assert.equal(spcKitCode(h.kit, "amber-beige"), "NUV-HPKG-AB");

  const wide = matchSpcWallKit(80, 36, 96)!;
  assert.equal(wide.exact, true);
  assert.equal(spcKitCode(wide.kit, "winter-white"), "NUV-HPKG-WW-80");
});

test("Driftwood is DT on the vertical kits and DW on the horizontal ones", () => {
  // Verbatim from the sheet. Normalising these would produce a code that does not order.
  assert.equal(spcKitCode(matchSpcWallKit(60, 36, 80)!.kit, "driftwood"), "NUV-6036-80DT");
  assert.equal(spcKitCode(matchSpcWallKit(60, 36, 96)!.kit, "driftwood"), "NUV-HPKG-DW");
});

test("the 66-inch kit is not offered in Amber Beige or Carrara Bronze", () => {
  const match = matchSpcWallKit(60, 36, 66)!;
  assert.equal(match.exact, true);
  const kit = match.kit;
  assert.equal(kit.colors.length, 4);
  assert.equal(spcKitCode(kit, "amber-beige"), null);
  assert.equal(spcKitCode(kit, "slate-grey"), "NUV-6036-66SG");
});

test("an enclosure no kit fits warns rather than failing", () => {
  const m = matchSpcWallKit(48, 48, 96)!;
  assert.equal(m.exact, false, "a 48x48 has no NuVo kit");
  assert.ok(m.kit, "must still return the closest kit — warn, don't block");
  // Ceiling dominates the choice: a kit that cannot reach the ceiling is unusable.
  assert.equal(m.kit.heightIn, 96);
});

test("ceiling height picks between kits at the same footprint", () => {
  assert.equal(matchSpcWallKit(60, 36, 66)!.kit.heightIn, 66);
  assert.equal(matchSpcWallKit(60, 36, 80)!.kit.heightIn, 80);
  assert.equal(matchSpcWallKit(60, 36, 96)!.kit.heightIn, 96);
});

// ------------------------------------------------- accessories & trim

test("grab bars are 24/36/48 — the retired 42 resolves but cannot be priced", () => {
  assert.deepEqual(GRAB_BARS.map((g) => g.lengthIn), [24, 36, 48]);
  assert.deepEqual(GRAB_BARS.map((g) => g.variants[0].dealerPrice), [87, 98.4, 108]);
  const retired = LEGACY_GRAB_BAR_SIZES.find((g) => g.id === "42")!;
  assert.equal(retired.variants.length, 0, "a retired size must not carry an invented price");
});

test("accessories carry their real codes", () => {
  assert.equal(CORNER_SHELF.variants.length, 3);
  assert.ok(CORNER_SHELF.variants.every((v) => v.dealerPrice === 33));
  assert.ok(SHOWER_NICHE.variants.every((v) => v.dealerPrice === 156));
  assert.ok(SHOWER_NICHE.variants.some((v) => v.productCode === "NUV-6703MB"));
  assert.ok(SHOWER_CHAIR.variants.every((v) => v.dealerPrice === 163.2));
});

test("trim is 36 SKUs across three profiles and two lengths", () => {
  assert.equal(NUVO_TRIM.length, 6);
  assert.equal(NUVO_TRIM.flatMap((r) => r.codes).length, 36);
  for (const row of NUVO_TRIM) assert.equal(row.codes.length, 6, `${row.id} colour count`);
  // The sheet's own inconsistency, preserved on purpose.
  assert.ok(NUVO_TRIM.find((r) => r.id === "trim-f-120")!.codes.includes("NUV-TRIMF-W-120"));
  assert.ok(NUVO_TRIM.find((r) => r.id === "trim-l-120")!.codes.includes("NUV-TRIML-D-120"));
  assert.equal(NUVO_INSTALL_TAPE.productCode, "NUV-INSTALL TAPE");
});

// ------------------------------------------------------ global integrity

test("no product code is used twice anywhere in the catalog", () => {
  const codes = [
    ...[...SHOWER_BASE_SKUS, ...ALCOVE_TUB_SKUS].flatMap((s) => s.variants.map((v) => v.productCode)),
    ...NUVO_THRESHOLDS.flatMap((t) => t.variants.map((v) => v.productCode)),
    ...SHOWER_DOORS.flatMap((d) => d.variants.map((v) => v.productCode)),
    ...SPC_WALL_KITS.flatMap((k) => k.colors.map((c) => spcKitCode(k, c.id)!)),
    ...NUVO_PANEL_KITS.flatMap((k) => ["AB", "CB", "DW", "PG", "SG", "WW"].map((c) => k.codePattern.replace("{C}", c))),
    ...NUVO_TRIM.flatMap((r) => r.codes),
    NUVO_INSTALL_TAPE.productCode,
    ...[CORNER_SHELF, SHOWER_NICHE, SHOWER_CHAIR].flatMap((a) => a.variants.map((v) => v.productCode)),
    ...GRAB_BARS.flatMap((g) => g.variants.map((v) => v.productCode)),
  ];
  const seen = new Set<string>();
  const dupes = codes.filter((c) => (seen.has(c) ? true : (seen.add(c), false)));
  assert.deepEqual(dupes, [], `duplicate product codes: ${dupes.join(", ")}`);
  // The sheet is ~178 SKUs; this is the shower-side slice that is actually wired.
  assert.ok(codes.length >= 170, `only ${codes.length} codes wired`);
});

test("composite colour codes are the four on the sheet", () => {
  assert.deepEqual(COMPOSITE_BASE_COLORS.map((c) => c.code), ["CW", "GR", "WH", "BL"]);
});

// --------------------------------------------------------- Nature Panel

test("all 21 decors serve a local image and a tileable texture", () => {
  const panels = getAllHplPanels();
  assert.equal(panels.length, 21);
  for (const p of panels) {
    assert.match(p.imageUrl, /^\/decor-swatches\/.+-tile\.jpg$/, `${p.id} thumbnail`);
    assert.match(p.textureUrl ?? "", /^\/decor-swatches\/.+\.jpg$/, `${p.id} texture`);
    assert.equal(p.isSwatch, true, `${p.id} must be tileable — every master is a flat scan`);
    // Nothing may render from the CDN any more.
    assert.ok(!p.imageUrl.startsWith("http"), `${p.id} still points at a CDN`);
  }
});

test("families match the price sheet, and the tile collection is split", () => {
  const cols = getPanelCollections();
  assert.deepEqual(cols.map((c) => c.id), ["wood", "pure", "large-tile", "metro-tile"]);
  assert.deepEqual(cols.map((c) => c.panels.length), [7, 7, 5, 2]);
});

test("shiplap and slat wall are separate products, not one decor with a finish", () => {
  const wood = getPanelCollections().find((c) => c.id === "wood")!.panels;
  assert.equal(wood.filter((p) => p.format === "shiplap").length, 5);
  assert.equal(wood.filter((p) => p.format === "slat-wall").length, 2);
  // Both Cuneo Oaks exist twice — same decor, two constructions, two SKUs.
  for (const stem of ["bleached-cuneo-oak", "brown-cuneo-oak"]) {
    assert.ok(getPanel(`${stem}-shiplap`), `${stem}-shiplap missing`);
    assert.ok(getPanel(`${stem}-slat`), `${stem}-slat missing`);
  }
  // Only wood carries a format.
  for (const p of getAllHplPanels().filter((x) => x.family !== "wood")) {
    assert.equal(p.format, undefined, `${p.id} should not carry a format`);
  }
});

test("the Grained prefix is gone from display names but ids are untouched", () => {
  // ids are stored on saved quotes and feed hplPanelSkuCode() — they must not move.
  assert.equal(getPanel("grained-alpine-white")!.name, "Alpine White");
  assert.equal(getPanel("grained-angora-grey")!.name, "Angora Grey");
  assert.equal(getPanel("grained-stone-green")!.name, "Stone Green");
  for (const p of getAllHplPanels()) assert.ok(!/^Grained/.test(p.name), `${p.id} still reads Grained`);
});

test("colour-unverified decors are flagged, including the two flat chips", () => {
  const panels = getAllHplPanels();
  const unverified = panels.filter((p) => p.colorUnverified).map((p) => p.id).sort();
  assert.equal(unverified.length, 7, `expected 7 CMYK masters, got ${unverified.join(",")}`);
  const flat = panels.filter((p) => p.flatChip).map((p) => p.id).sort();
  assert.deepEqual(flat, ["sage-green-pure", "white-grey-pure"]);
  // Anything flat is by definition unverified too.
  for (const p of panels.filter((x) => x.flatChip)) assert.equal(p.colorUnverified, true);
});
