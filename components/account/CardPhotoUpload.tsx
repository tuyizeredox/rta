"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/components/LanguageProvider";

/**
 * The photograph that goes on the front of the membership card.
 *
 * THE CROP HAPPENS HERE, IN THE BROWSER, and that is a deliberate division of
 * labour rather than a shortcut. The card renderer draws with pdf-lib, which
 * cannot clip a path — so a square photograph would print as a square sitting
 * on top of the artwork instead of filling the circular frame. Something has
 * to cut the circle, and doing it before upload also means a 6MB photograph
 * straight off a phone camera never crosses a Rwandan mobile connection: what
 * is sent is a 512px PNG of a few tens of kilobytes.
 *
 * The server does not take the client's word for any of it — the bytes are
 * re-identified from their own magic numbers on arrival. This component is
 * about sparing the member a slow upload, not about establishing trust.
 */

/** Matches the card renderer's expectation: square, and big enough for 300dpi. */
const OUTPUT_PX = 512;

export function CardPhotoUpload({ hasPhoto }: { hasPhoto: boolean }) {
  const router = useRouter();
  const { d } = useLanguage();
  const copy = d.account.card;

  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped after every change so the <img> refetches rather than showing the
  // browser's cached copy of the photograph that was just replaced.
  const [version, setVersion] = useState(0);

  /**
   * Centre-crops to a square, scales to 512px, and masks to a circle.
   *
   * `destination-in` is what cuts the circle: it keeps the photograph only
   * where the subsequently drawn disc is opaque, leaving a transparent
   * surround. PNG, not JPEG, because JPEG has no alpha channel and would fill
   * that surround with black.
   */
  async function toCircularPng(file: File): Promise<Blob> {
    const bitmap = await createImageBitmap(file);

    const edge = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - edge) / 2;
    const sy = (bitmap.height - edge) / 2;

    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_PX;
    canvas.height = OUTPUT_PX;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable");

    ctx.drawImage(bitmap, sx, sy, edge, edge, 0, 0, OUTPUT_PX, OUTPUT_PX);

    ctx.globalCompositeOperation = "destination-in";
    ctx.beginPath();
    ctx.arc(OUTPUT_PX / 2, OUTPUT_PX / 2, OUTPUT_PX / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fill();

    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png")
    );
    if (!blob) throw new Error("The image could not be encoded");
    return blob;
  }

  async function upload(file: File) {
    setBusy(true);
    setError(null);

    try {
      const circular = await toCircularPng(file);

      const body = new FormData();
      body.append("file", circular, "card-photo.png");

      const response = await fetch("/api/account/avatar", { method: "POST", body });
      if (!response.ok) {
        // The route explains refusals — too small, wrong format — and that
        // wording is more useful to the member than a generic failure.
        const detail = await response.json().catch(() => null);
        throw new Error(detail?.error?.message ?? "upload failed");
      }

      setVersion((v) => v + 1);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error && cause.message !== "upload failed"
        ? cause.message
        : copy.photoFailed);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/account/avatar", { method: "DELETE" });
      if (!response.ok) throw new Error();
      setVersion((v) => v + 1);
      router.refresh();
    } catch {
      setError(copy.photoFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <h2 className="font-heading text-base font-semibold text-ink">
        {copy.photoTitle}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">{copy.photoBody}</p>

      <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-center">
        <span className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-full border-4 border-primary/30 bg-ink/[0.04]">
          {hasPhoto ? (
            // A plain <img>, not next/image: the bytes come from an
            // authenticated route that the image optimiser cannot fetch on the
            // member's behalf, and the photograph is already 512px.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/account/avatar?v=${version}`}
              alt=""
              className="size-full object-cover"
            />
          ) : (
            <UserRound className="size-9 text-ink-muted" aria-hidden="true" />
          )}
        </span>

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Camera className="size-3.5" aria-hidden="true" />
            )}
            {busy
              ? copy.uploading
              : hasPhoto
                ? copy.replacePhoto
                : copy.choosePhoto}
          </Button>

          {hasPhoto && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              className="text-red-600 hover:bg-red-50"
              onClick={() => void remove()}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              {copy.removePhoto}
            </Button>
          )}
        </div>
      </div>

      {!hasPhoto && !error && (
        <p className="mt-3 text-sm text-ink-muted">{copy.noPhotoYet}</p>
      )}

      {error && <p className="mt-3 text-sm font-medium text-red-600">{error}</p>}

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
    </div>
  );
}
