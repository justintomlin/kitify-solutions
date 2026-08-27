/**
 * Three-way EN / ES / RU parity check for lib/i18n.ts.
 *
 * Counts leaf keys per language and reports any key that one language has and another doesn't.
 * EN is the reference: a key is expected wherever EN has one, and a key NO language other than
 * EN should invent.
 *
 * Why this exists: translate() returns the KEY ITSELF when a lookup misses — there is no
 * fall-back to English — so a missing RU key doesn't degrade to English, it puts a raw dotted
 * key like "orders.tabInTransit" on screen. Parity is the only thing standing between a
 * forgotten key and that.
 *
 * It parses the file as data rather than importing it, so it runs without a build step:
 *
 *     node scripts/i18n-parity.mjs [path/to/i18n.ts]
 *
 * KNOWN BLIND SPOT: this reads the PARSED object, so a duplicate key inside one language
 * silently collapses to the last one and still counts as parity. `npx tsc --noEmit` is what
 * catches that (TS1117) — run both.
 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LANGS = ["en", "es", "ru"];

const src = readFileSync(process.argv[2] ?? "lib/i18n.ts", "utf8");
const js = src
  .replace(/^export type Lang.*$/m, "")
  .replace(/export const dictionary:\s*Record<Lang,\s*Record<string,\s*any>>\s*=/, "const dictionary =")
  .replace(/^export function[\s\S]*$/m, "");

const dir = mkdtempSync(join(tmpdir(), "parity-"));
const f = join(dir, "d.mjs");
writeFileSync(f, js + "\nexport default dictionary;\n");
const dict = (await import("file://" + f.replace(/\\/g, "/"))).default;

function leaves(o, prefix = "", out = []) {
  for (const [k, v] of Object.entries(o)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (Array.isArray(v)) out.push(key);
    else if (v && typeof v === "object") leaves(v, key, out);
    else out.push(key);
  }
  return out;
}

const sets = Object.fromEntries(LANGS.map((l) => [l, new Set(leaves(dict[l] ?? {}))]));
for (const l of LANGS) console.log(`${l.toUpperCase()} leaf keys: ${sets[l].size}`);

// Every pair, both directions — a key ES has and RU doesn't is a gap even when EN has neither.
let bad = 0;
for (const a of LANGS) {
  for (const b of LANGS) {
    if (a === b) continue;
    const missing = [...sets[a]].filter((k) => !sets[b].has(k));
    if (missing.length) {
      bad += missing.length;
      console.log(`In ${a.toUpperCase()} but missing from ${b.toUpperCase()} (${missing.length}):`, missing);
    }
  }
}

// An untranslated string is not a parity failure — it is often correct (product names, SKUs,
// "CRM") — so this only prints, and never fails the run.
const en = dict.en;
const get = (o, k) => k.split(".").reduce((cur, p) => cur?.[p], o);
for (const l of LANGS.filter((x) => x !== "en")) {
  const same = [...sets.en].filter((k) => {
    const a = get(en, k), b = get(dict[l], k);
    return typeof a === "string" && typeof b === "string" && a === b && /[a-z]{4}/i.test(a);
  });
  if (same.length) console.log(`Identical to EN in ${l.toUpperCase()} (${same.length}) — check these are deliberate:`, same);
}

console.log(bad ? `\nFAIL — ${bad} key gap(s).` : "\nPASS — all languages match.");
process.exit(bad ? 1 : 0);
