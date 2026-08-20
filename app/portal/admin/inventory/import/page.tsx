"use client";

// CSV import for the Kitify SKU catalog.
//
// Parse → review → commit, in that order and never collapsed. The preview is the point: an
// admin sees which rows insert, which UPDATE an existing SKU, and which are broken, before
// anything is written. Commit is disabled while any hard error remains.
//
// Catalog only. This screen cannot create stock — a CSV carrying quantity/location/movement
// columns is refused outright with an actionable message rather than importing the half it
// understands.

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Upload, Download, FileWarning, Check, AlertTriangle } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import { AdminGuard } from "@/components/AdminGuard";
import { useToast, ToastView } from "@/components/Toast";
import {
  parseCatalogCsv,
  checkExisting,
  commitCatalogRows,
  errorsToCsv,
  type ParsedRow,
  type RowError,
} from "@/lib/inventory-import";
import { downloadCsv } from "@/lib/inventory";
import {
  BackLink,
  PageHeading,
  StatCard,
  Badge,
  EmptyCard,
  WarnBanner,
  categoryLabel,
  BTN_PRIMARY,
  BTN_GHOST,
} from "@/components/inventory/ui";

export default function InventoryImportPage() {
  return (
    <AdminGuard>
      <InventoryImport />
    </AdminGuard>
  );
}

function InventoryImport() {
  const { t } = useLanguage();
  const { toast, showToast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [errors, setErrors] = useState<RowError[]>([]);
  const [fatal, setFatal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [committed, setCommitted] = useState<{ inserted: number; updated: number } | null>(null);

  const reset = useCallback(() => {
    setRows(null);
    setErrors([]);
    setFatal(null);
    setCommitted(null);
    setConfirming(false);
    setFileName("");
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const onFile = useCallback(async (file: File) => {
    reset();
    setFileName(file.name);
    setBusy(true);
    try {
      const text = await file.text();
      const parsed = parseCatalogCsv(text);
      if (parsed.fatal) {
        setFatal(parsed.fatal);
        setBusy(false);
        return;
      }
      // Resolve insert-vs-update against the live catalog before showing the preview.
      const { rows: marked } = await checkExisting(parsed.rows);
      setRows(marked);
      setErrors(parsed.errors);
    } catch {
      setFatal("unreadable");
    } finally {
      setBusy(false);
    }
  }, [reset]);

  const summary = useMemo(() => {
    const list = rows ?? [];
    return {
      total: list.length,
      inserts: list.filter((r) => r.action === "insert").length,
      updates: list.filter((r) => r.action === "update").length,
      errors: errors.length,
    };
  }, [rows, errors]);

  // Lines carrying an error are excluded from the commit set; the button stays disabled
  // anyway, so this only matters if a future change relaxes that.
  const errorLines = useMemo(() => new Set(errors.map((e) => e.line)), [errors]);
  const commitable = useMemo(() => (rows ?? []).filter((r) => !errorLines.has(r.line)), [rows, errorLines]);
  const canCommit = !!rows && rows.length > 0 && errors.length === 0 && !busy;

  async function commit() {
    if (!canCommit) return;
    setBusy(true);
    try {
      const result = await commitCatalogRows(commitable);
      setCommitted(result);
      setConfirming(false);
      showToast(t("invImport.committed", { n: String(result.inserted + result.updated) }));
    } catch {
      setFatal("commit-failed");
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  const fatalMessage = (code: string) => {
    if (code.startsWith("stock-columns:")) {
      return t("invImport.errStockColumns", { columns: code.slice("stock-columns:".length) });
    }
    if (code === "missing-required-columns") return t("invImport.errMissingColumns");
    if (code === "empty") return t("invImport.errEmpty");
    if (code === "commit-failed") return t("invImport.errCommit");
    return t("invImport.errUnreadable");
  };

  return (
    <div className="mx-auto max-w-5xl">
      <ToastView toast={toast} />

      <div className="mb-4">
        <BackLink href="/portal/admin/inventory" label={t("inventory.backToInventory")} />
      </div>
      <PageHeading
        eyebrow={t("invImport.title")}
        sub={t("invImport.subtitle")}
        right={
          <a href="/inventory-import-template.csv" download className={BTN_GHOST}>
            <Download className="h-4 w-4" /> {t("invImport.template")}
          </a>
        }
      />

      <div className="rounded-2xl border border-line bg-card p-5">
        <p className="text-sm leading-relaxed text-muted">{t("invImport.catalogOnlyNote")}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
            }}
            className="hidden"
            id="inventory-csv"
          />
          <label htmlFor="inventory-csv" className={BTN_PRIMARY + " cursor-pointer"}>
            <Upload className="h-4 w-4" /> {t("invImport.choose")}
          </label>
          {fileName && <span className="text-sm text-muted">{fileName}</span>}
          {rows && (
            <button type="button" onClick={reset} className={BTN_GHOST}>
              {t("invImport.startOver")}
            </button>
          )}
        </div>
      </div>

      {fatal && (
        <div className="mt-4">
          <WarnBanner>
            <span className="flex items-start gap-2">
              <FileWarning className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{fatalMessage(fatal)}</span>
            </span>
          </WarnBanner>
        </div>
      )}

      {committed && (
        <div className="mt-4 rounded-2xl border border-success/30 bg-success/10 p-5">
          <div className="flex items-start gap-2 text-sm text-success">
            <Check className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-semibold">{t("invImport.doneTitle")}</div>
              <div className="mt-0.5">
                {t("invImport.doneBody", {
                  inserted: String(committed.inserted),
                  updated: String(committed.updated),
                })}
              </div>
            </div>
          </div>
          <Link href="/portal/admin/inventory" className={BTN_GHOST + " mt-4"}>
            {t("invImport.viewCatalog")}
          </Link>
        </div>
      )}

      {rows && !committed && (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label={t("invImport.statRows")} value={String(summary.total)} />
            <StatCard label={t("invImport.statNew")} value={String(summary.inserts)} />
            <StatCard label={t("invImport.statUpdates")} value={String(summary.updates)} />
            <StatCard label={t("invImport.statErrors")} value={String(summary.errors)} />
          </div>

          {errors.length > 0 && (
            <div className="mt-4 space-y-2">
              <WarnBanner>
                <span className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{t("invImport.errorsBlock", { n: String(errors.length) })}</span>
                </span>
              </WarnBanner>
              <button
                type="button"
                onClick={() => downloadCsv("inventory-import-errors.csv", errorsToCsv(errors))}
                className={BTN_GHOST}
              >
                <Download className="h-4 w-4" /> {t("invImport.downloadErrors")}
              </button>
              <div className="overflow-x-auto rounded-2xl border border-line bg-card">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                      <th className="px-3 py-2">{t("invImport.colLine")}</th>
                      <th className="px-3 py-2">{t("invImport.colSku")}</th>
                      <th className="px-3 py-2">{t("invImport.colColumn")}</th>
                      <th className="px-3 py-2">{t("invImport.colProblem")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {errors.slice(0, 100).map((e, i) => (
                      <tr key={i} className="border-b border-line/60 last:border-0">
                        <td className="px-3 py-2 font-mono text-[12px] text-muted">{e.line}</td>
                        <td className="px-3 py-2 font-mono text-[12px] text-ink">{e.sku || "—"}</td>
                        <td className="px-3 py-2 text-muted">{e.column}</td>
                        <td className="px-3 py-2 text-amber">{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {errors.length > 100 && (
                <p className="text-[11px] text-muted">{t("invImport.errorsTruncated", { n: String(errors.length - 100) })}</p>
              )}
            </div>
          )}

          <div className="mt-4">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
              {t("invImport.preview")}
            </div>
            {rows.length === 0 ? (
              <EmptyCard>{t("invImport.noRows")}</EmptyCard>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-line bg-card">
                <table className="w-full min-w-[820px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                      <th className="px-3 py-2">{t("invImport.colLine")}</th>
                      <th className="px-3 py-2">{t("invImport.colAction")}</th>
                      <th className="px-3 py-2">{t("invImport.colSku")}</th>
                      <th className="px-3 py-2">{t("inventory.colName")}</th>
                      <th className="px-3 py-2">{t("inventory.colCategory")}</th>
                      <th className="px-3 py-2 text-right">{t("invImport.colCost")}</th>
                      <th className="px-3 py-2">{t("invImport.colFlags")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 300).map((r) => {
                      const bad = errorLines.has(r.line);
                      return (
                        <tr key={r.line} className={`border-b border-line/60 last:border-0 ${bad ? "bg-amber/5" : ""}`}>
                          <td className="px-3 py-2 font-mono text-[12px] text-muted">{r.line}</td>
                          <td className="px-3 py-2">
                            {bad ? (
                              <Badge tone="amber">{t("invImport.actionError")}</Badge>
                            ) : r.action === "update" ? (
                              <Badge tone="accent">{t("invImport.actionUpdate")}</Badge>
                            ) : (
                              <Badge tone="success">{t("invImport.actionNew")}</Badge>
                            )}
                          </td>
                          <td className="px-3 py-2 font-mono text-[12px] text-ink">{r.sku}</td>
                          <td className="px-3 py-2 text-ink">{r.name}</td>
                          <td className="px-3 py-2 text-muted">{categoryLabel(t, r.category)}</td>
                          <td className="px-3 py-2 text-right text-muted">
                            {r.defaultCostCents === null ? "—" : `$${(r.defaultCostCents / 100).toFixed(2)}`}
                          </td>
                          <td className="px-3 py-2">
                            <span className="flex flex-wrap gap-1">
                              {r.isSample && <Badge tone="muted">{t("inventory.sample")}</Badge>}
                              {!r.active && <Badge tone="muted">{t("inventory.inactive")}</Badge>}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {rows.length > 300 && (
              <p className="mt-2 text-[11px] text-muted">{t("invImport.previewTruncated", { n: String(rows.length - 300) })}</p>
            )}
          </div>

          <div className="mt-5 rounded-2xl border border-line bg-card p-5">
            {confirming ? (
              <div className="space-y-3">
                <WarnBanner>
                  {t("invImport.confirmBody", {
                    inserted: String(summary.inserts),
                    updated: String(summary.updates),
                  })}
                </WarnBanner>
                <div className="flex gap-2">
                  <button type="button" onClick={commit} disabled={busy} className={BTN_PRIMARY}>
                    {busy ? t("invImport.committing") : t("invImport.confirmCommit")}
                  </button>
                  <button type="button" onClick={() => setConfirming(false)} className={BTN_GHOST}>
                    {t("inventory.cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted">
                  {canCommit ? t("invImport.readyBody") : t("invImport.blockedBody")}
                </p>
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  disabled={!canCommit}
                  className={BTN_PRIMARY}
                >
                  {t("invImport.commit")}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
