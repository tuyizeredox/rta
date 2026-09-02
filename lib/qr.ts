import "server-only";
import QRCode from "qrcode";

/**
 * QR image rendering.
 *
 * Kept apart from lib/auth/qr-access.ts, which owns the credential. This file
 * knows nothing about sessions — it turns a string into pixels, and that is
 * all — so the module that handles secrets stays readable as a security file.
 *
 * ERROR CORRECTION IS SET HIGH ON PURPOSE. These codes get printed on cheap
 * paper, folded into wallets, and scanned in workshop light. Level Q recovers
 * from roughly a quarter of the image being damaged, at the cost of a denser
 * grid; a code that still scans after six months in a pocket is worth more
 * than a sparser one that does not.
 */

/** Level Q: ~25% of the symbol can be lost and still decode. */
const ERROR_CORRECTION = "Q" as const;

/**
 * Quiet zone, in modules. The specification asks for 4; anything less and some
 * scanners refuse a code printed hard against a border.
 */
const QUIET_ZONE = 4;

/** Inline SVG, for rendering the code directly into a page. */
export async function renderQrSvg(
  value: string,
  options: { size?: number } = {}
): Promise<string> {
  return QRCode.toString(value, {
    type: "svg",
    errorCorrectionLevel: ERROR_CORRECTION,
    margin: QUIET_ZONE,
    width: options.size ?? 320,
    color: { dark: "#111111", light: "#ffffff" },
  });
}

/**
 * PNG bytes, for download.
 *
 * 1024px because the file's job is to survive being printed: a phone-screen
 * sized image reprinted on A4 turns into soft edges that scanners struggle
 * with, and a 1024px QR is still only a few kilobytes.
 */
export async function renderQrPng(
  value: string,
  options: { size?: number } = {}
): Promise<Buffer> {
  return QRCode.toBuffer(value, {
    type: "png",
    errorCorrectionLevel: ERROR_CORRECTION,
    margin: QUIET_ZONE,
    width: options.size ?? 1024,
    color: { dark: "#111111", light: "#ffffff" },
  });
}
