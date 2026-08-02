"use client";

/**
 * PhotoUpload — the portal's one photo picker (job registration, claims, and whatever needs
 * photos next).
 *
 * CAMERA vs LIBRARY — why there are two inputs, not one.
 * `capture="environment"` does NOT mean "open the camera but let me switch to the library".
 * On iOS Safari and Android Chrome it hands the pick straight to the camera app and the photo
 * library is never offered. An input WITHOUT `capture` is the one that shows the full sheet
 * (Photo Library / Take Photo / Browse). So a single capture input would have cost these
 * users their camera roll — exactly what this change is meant to give them. Two inputs, two
 * buttons, both paths reliable on every platform. On desktop `capture` is ignored and both
 * buttons open the ordinary file picker.
 *
 * Uploads happen as soon as files are chosen, so the contractor sees thumbnails and can
 * review or delete before committing the form. `photos` is the controlled list of public
 * URLs that are already in storage; anything still in flight lives in local state.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Camera, ImageIcon, Loader2, RotateCcw, X, ZoomIn } from "lucide-react";
import { useLanguage } from "@/components/LanguageContext";
import { ACCEPT_ATTR, JOB_PHOTOS_BUCKET, isAcceptedImage, uploadPhotos } from "@/lib/storage";

export type PhotoUploadProps = {
  /** Public URLs already uploaded. Controlled by the parent. */
  photos: string[];
  onPhotosChange: (photos: string[]) => void;
  maxPhotos?: number;
  /** Only drives the "N more required" hint — enforcement stays with the parent's submit. */
  minPhotos?: number;
  label?: string;
  /** Storage path prefix, e.g. `orders/<id>`. */
  storagePrefix: string;
  bucketName?: string;
  /**
   * Rides into the stored filename (before / during / finished / …). Chosen by the parent
   * before the pick, because the name is fixed at upload time.
   */
  tag?: string;
  disabled?: boolean;
};

// A file being uploaded, or one that failed and can be retried.
type Pending = {
  id: string;
  file: File;
  previewUrl: string;
  state: "uploading" | "error";
};

let seq = 0;
const nextId = () => `p${++seq}-${performance.now().toString(36)}`;

export function PhotoUpload({
  photos,
  onPhotosChange,
  maxPhotos = 10,
  minPhotos = 0,
  label,
  storagePrefix,
  bucketName = JOB_PHOTOS_BUCKET,
  tag,
  disabled = false,
}: PhotoUploadProps) {
  const { t } = useLanguage();
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [notice, setNotice] = useState<string>("");
  const [storageDown, setStorageDown] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const dropId = useId();

  // Uploads resolve one at a time; reading `photos` from a ref keeps each append based on the
  // newest list rather than the one captured when the batch started.
  const photosRef = useRef(photos);
  photosRef.current = photos;

  // Object URLs are a real allocation — release them when the component goes away.
  const objectUrls = useRef<string[]>([]);
  useEffect(() => () => { objectUrls.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  const total = photos.length + pending.length;
  const remaining = Math.max(0, maxPhotos - total);
  const atCapacity = remaining === 0;

  const uploadOne = useCallback(
    async (item: Pending) => {
      const res = await uploadPhotos(storagePrefix, [{ file: item.file, tag }], undefined, bucketName);
      if (res.urls.length > 0) {
        onPhotosChange([...photosRef.current, res.urls[0]]);
        setPending((prev) => prev.filter((p) => p.id !== item.id));
        URL.revokeObjectURL(item.previewUrl);
        objectUrls.current = objectUrls.current.filter((u) => u !== item.previewUrl);
      } else {
        // A missing bucket is a setup problem, not a bad file — say so once, distinctly.
        if (res.bucketMissing) setStorageDown(true);
        setPending((prev) => prev.map((p) => (p.id === item.id ? { ...p, state: "error" } : p)));
      }
    },
    [storagePrefix, tag, bucketName, onPhotosChange],
  );

  const addFiles = useCallback(
    (list: FileList | File[] | null) => {
      if (!list || disabled) return;
      const all = Array.from(list);
      const images = all.filter(isAcceptedImage);
      const room = Math.max(0, maxPhotos - (photosRef.current.length + pending.length));
      const accepted = images.slice(0, room);

      setNotice(
        images.length < all.length
          ? t("photo.errNotImage")
          : accepted.length < images.length
            ? t("photo.errMax", { max: String(maxPhotos) })
            : "",
      );
      if (accepted.length === 0) return;

      const items: Pending[] = accepted.map((file) => {
        const previewUrl = URL.createObjectURL(file);
        objectUrls.current.push(previewUrl);
        return { id: nextId(), file, previewUrl, state: "uploading" as const };
      });
      setPending((prev) => [...prev, ...items]);
      // Sequential: keeps ordering stable and avoids a burst of parallel PUTs from a tablet
      // on site wifi.
      void (async () => { for (const item of items) await uploadOne(item); })();
    },
    [disabled, maxPhotos, pending.length, t, uploadOne],
  );

  // Re-picking the same file fires no change event unless the value is cleared.
  const pick = (ref: React.RefObject<HTMLInputElement | null>) => {
    if (ref.current) { ref.current.value = ""; ref.current.click(); }
  };

  const removeUploaded = (url: string) => onPhotosChange(photos.filter((u) => u !== url));
  const removePending = (item: Pending) => {
    setPending((prev) => prev.filter((p) => p.id !== item.id));
    URL.revokeObjectURL(item.previewUrl);
    objectUrls.current = objectUrls.current.filter((u) => u !== item.previewUrl);
  };
  const retry = (item: Pending) => {
    setStorageDown(false);
    setPending((prev) => prev.map((p) => (p.id === item.id ? { ...p, state: "uploading" } : p)));
    void uploadOne({ ...item, state: "uploading" });
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  const uploading = pending.some((p) => p.state === "uploading");
  const shortBy = Math.max(0, minPhotos - photos.length);

  return (
    <div>
      {/* Both inputs carry `multiple` so a gallery pick can bring several photos at once. */}
      <input
        ref={cameraRef}
        type="file"
        accept={ACCEPT_ATTR}
        capture="environment"
        multiple
        onChange={(e) => addFiles(e.target.files)}
        className="hidden"
        tabIndex={-1}
        aria-hidden
      />
      <input
        ref={libraryRef}
        type="file"
        accept={ACCEPT_ATTR}
        multiple
        onChange={(e) => addFiles(e.target.files)}
        className="hidden"
        tabIndex={-1}
        aria-hidden
      />

      <div
        onDragOver={(e) => { e.preventDefault(); if (!disabled && !atCapacity) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        aria-describedby={dropId}
        className={`rounded-xl border-2 border-dashed p-3 transition ${
          dragging ? "border-accent bg-accent-soft/40" : "border-line bg-paper/50"
        } ${disabled || atCapacity ? "opacity-60" : ""}`}
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => pick(cameraRef)}
            disabled={disabled || atCapacity}
            className="inline-flex min-h-[60px] flex-1 items-center justify-center gap-2 rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Camera className="h-5 w-5 shrink-0" /> {t("photo.takePhoto")}
          </button>
          <button
            type="button"
            onClick={() => pick(libraryRef)}
            disabled={disabled || atCapacity}
            className="inline-flex min-h-[60px] flex-1 items-center justify-center gap-2 rounded-lg border border-line bg-card px-4 py-3 text-sm font-semibold text-ink transition hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ImageIcon className="h-5 w-5 shrink-0" /> {t("photo.chooseLibrary")}
          </button>
        </div>
        <p id={dropId} className="mt-2 text-center text-xs text-muted">
          {label ?? t("photo.hint")}
        </p>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
          {t("photo.count", { n: String(total), max: String(maxPhotos) })}
        </span>
        {uploading && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-accent">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("photo.uploading")}
          </span>
        )}
        {shortBy > 0 && (
          <span className="text-[11px] text-amber">{t("photo.minRequired", { n: String(shortBy) })}</span>
        )}
      </div>

      {notice && <p className="mt-1.5 text-xs text-amber">{notice}</p>}
      {storageDown && <p className="mt-1.5 text-xs text-amber">{t("photo.errStorage")}</p>}

      {(photos.length > 0 || pending.length > 0) && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {photos.map((url, i) => (
            <li key={url} className="relative">
              <button
                type="button"
                onClick={() => setPreview(url)}
                aria-label={t("photo.openPreview", { n: String(i + 1) })}
                className="group block h-20 w-20 overflow-hidden rounded-lg border border-line bg-white"
              >
                <Thumb src={url} />
                <span className="pointer-events-none absolute inset-0 hidden place-items-center bg-ink/30 group-hover:grid">
                  <ZoomIn className="h-5 w-5 text-white" />
                </span>
              </button>
              <RemoveButton onClick={() => removeUploaded(url)} label={t("photo.remove")} disabled={disabled} />
            </li>
          ))}

          {pending.map((p) => (
            <li key={p.id} className="relative">
              <div className="h-20 w-20 overflow-hidden rounded-lg border border-line bg-white">
                <Thumb src={p.previewUrl} name={p.file.name} />
              </div>
              <span
                className={`absolute inset-0 grid place-items-center rounded-lg ${
                  p.state === "error" ? "bg-amber/35" : "bg-ink/45"
                }`}
              >
                {p.state === "uploading" ? (
                  <Loader2 className="h-5 w-5 animate-spin text-white" />
                ) : (
                  <button
                    type="button"
                    onClick={() => retry(p)}
                    aria-label={t("photo.retry")}
                    title={t("photo.errUpload")}
                    className="grid h-11 w-11 place-items-center rounded-md text-white"
                  >
                    <RotateCcw className="h-5 w-5" />
                  </button>
                )}
              </span>
              <RemoveButton onClick={() => removePending(p)} label={t("photo.remove")} disabled={false} />
            </li>
          ))}
        </ul>
      )}

      {preview && <PreviewOverlay src={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

// A browser that can't decode HEIC renders nothing for it — fall back to a labelled tile so
// the photo still reads as present rather than as a broken image.
function Thumb({ src, name }: { src: string; name?: string }) {
  const [failed, setFailed] = useState(false);
  const { t } = useLanguage();
  if (failed) {
    return (
      <span className="grid h-full w-full place-items-center bg-ink/5 p-1 text-center">
        <ImageIcon className="h-5 w-5 text-muted" />
        <span className="truncate text-[9px] leading-tight text-muted">{name ?? t("photo.noPreview")}</span>
      </span>
    );
  }
  return <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />;
}

// Sits half outside the 80px thumbnail; the button itself is a full 44px target.
function RemoveButton({ onClick, label, disabled }: { onClick: () => void; label: string; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="absolute -right-2 -top-2 grid h-11 w-11 place-items-center rounded-full disabled:opacity-40"
    >
      <span className="grid h-6 w-6 place-items-center rounded-full border border-line bg-card text-ink shadow-sm">
        <X className="h-3.5 w-3.5" />
      </span>
    </button>
  );
}

/**
 * Full-screen preview. Pinch to zoom (two pointers), drag to pan once zoomed, double-tap to
 * toggle 2x, and a downward swipe at 1x dismisses. Implemented on pointer events rather than
 * relying on native pinch: the browser would zoom the whole visual viewport, which leaves the
 * overlay's own chrome scaled and the page in a zoomed state after closing.
 */
function PreviewOverlay({ src, onClose }: { src: string; onClose: () => void }) {
  const { t } = useLanguage();
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; scale: number } | null>(null);
  const pan = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const lastTap = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const dist = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      gesture.current = { dist: dist(), scale };
      pan.current = null;
    } else if (pointers.current.size === 1) {
      pan.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
      const now = Date.now();
      if (now - lastTap.current < 300) {
        setScale((s) => (s > 1 ? 1 : 2));
        setOffset({ x: 0, y: 0 });
      }
      lastTap.current = now;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && gesture.current) {
      const next = Math.min(4, Math.max(1, (dist() / gesture.current.dist) * gesture.current.scale));
      setScale(next);
      if (next === 1) setOffset({ x: 0, y: 0 });
    } else if (pointers.current.size === 1 && pan.current && scale > 1) {
      setOffset({ x: pan.current.ox + (e.clientX - pan.current.x), y: pan.current.oy + (e.clientY - pan.current.y) });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const start = pan.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
    // Swipe down to dismiss, but only when not zoomed in — otherwise it's a pan.
    if (start && scale === 1 && e.clientY - start.y > 100) onClose();
    if (pointers.current.size === 0) pan.current = null;
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("photo.previewTitle")}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/90"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={t("photo.closePreview")}
        className="absolute right-3 top-3 z-10 grid h-11 w-11 place-items-center rounded-full bg-ink/70 text-white transition hover:bg-ink"
      >
        <X className="h-5 w-5" />
      </button>
      <img
        src={src}
        alt=""
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        // none: this element handles its own pinch/pan, so the browser must not also scroll.
        style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`, touchAction: "none" }}
        className="max-h-[88vh] max-w-[94vw] select-none object-contain"
        draggable={false}
      />
      <p className="pointer-events-none absolute bottom-4 left-0 right-0 text-center text-[11px] text-white/70">
        {t("photo.previewHint")}
      </p>
    </div>
  );
}
