"use client";

import { useState } from "react";
import { Download, Loader2, RectangleHorizontal, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/components/LanguageProvider";
import type { CardSide } from "@/lib/cards/geometry";

/**
 * One side of the membership card, offered as its own download.
 *
 * FETCHED AND HANDED OVER AS A BLOB rather than linked with `<a download>`.
 * The front is generated on demand — it may have to issue a QR code first —
 * so a plain link would leave the member looking at an unresponsive page for
 * a second or two with nothing to say the press had registered. Fetching lets
 * the button show that it is working, and lets a failure be a message on the
 * page rather than a browser error screen.
 */
export function CardDownloadButton({
  side,
  title,
  body,
  icon,
}: {
  side: CardSide;
  title: string;
  body: string;
  icon: "front" | "back";
}) {
  const { d } = useLanguage();
  const copy = d.account.card;

  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const Icon = icon === "front" ? ScanLine : RectangleHorizontal;

  async function download() {
    setBusy(true);
    setFailed(false);

    try {
      const response = await fetch(`/api/account/card?side=${side}`);
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);

      const blob = await response.blob();

      // The filename the route chose, so a print shop receiving thirty of
      // these can still tell whose is whose.
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const named = /filename="([^"]+)"/.exec(disposition)?.[1];

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = named ?? `rta-card-${side}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Freed on the next tick: revoking synchronously can beat the download
      // in some browsers and produce an empty file.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col rounded-2xl border border-border bg-surface p-5 shadow-card">
      <span className="flex size-10 items-center justify-center rounded-xl bg-primary-50 text-primary">
        <Icon className="size-5" aria-hidden="true" />
      </span>

      <h2 className="mt-3 font-heading text-base font-semibold text-ink">{title}</h2>
      <p className="mt-1.5 flex-1 text-sm leading-relaxed text-ink-muted">{body}</p>

      <Button
        className="mt-4 w-full"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => void download()}
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Download className="size-3.5" aria-hidden="true" />
        )}
        {busy ? copy.preparing : copy.download}
      </Button>

      {failed && (
        <p className="mt-2 text-sm font-medium text-red-600">{copy.failed}</p>
      )}
    </div>
  );
}
