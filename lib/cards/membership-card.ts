import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { prisma } from "@/lib/db/prisma";
import { renderQrPng } from "@/lib/qr";
import { getActiveQrCode, issueQrCode, type QrActor } from "@/lib/auth/qr-access";
import { toLocalPhone } from "@/lib/phone";
import { probeImage } from "@/lib/images/probe";
import { CARD, FRONT, TEMPLATE_FILES, type CardSide } from "@/lib/cards/geometry";

/**
 * Membership cards, as printable PDFs.
 *
 * TWO SIDES, TWO FILES, ON PURPOSE. A card is printed in two passes through a
 * card printer — or on two sheets at a print shop — and whoever operates it
 * needs one file per pass. A single two-page PDF invites printing the back
 * onto a second blank card.
 *
 * THE BACK CARRIES NOTHING PERSONAL. Same association, same Kinyarwanda
 * notice, same two numbers to ring if a card is found in the street. It is
 * therefore the artwork and nothing else, which is why `renderCardBack` takes
 * no arguments at all.
 *
 * The front composites five live fields onto the supplied artwork: the name,
 * the office, the holder's own telephone number, their sign-in QR and their
 * photograph. Everything else on that side — logo, header, swoosh, icons,
 * "www.rta.rw", "Kigali/Rwanda", the signature — is identical on every card
 * and belongs in the artwork rather than in this file.
 */

const TEMPLATE_DIR = path.join(process.cwd(), "public");

/** Ink colours sampled from the association's artwork. */
const INK = {
  name: rgb(0.13, 0.13, 0.15),
  body: rgb(0.16, 0.16, 0.18),
  placeholder: rgb(0.85, 0.88, 0.92),
  /// The artwork's mid blue, used for the keyline around the code.
  frame: rgb(0.11, 0.5, 0.83),
} as const;

/** The association's mark, for the middle of the QR. Null if it is missing. */
async function loadLogo(): Promise<Uint8Array | null> {
  try {
    const file = await fs.readFile(path.join(TEMPLATE_DIR, "images", "rtalogo.jpg"));
    return new Uint8Array(file);
  } catch {
    return null;
  }
}

export interface MembershipCardData {
  /// Family name first — the order the printed card reads in, which is the
  /// reverse of how the app addresses someone on screen.
  displayName: string;
  /// Office held, or the role label when the holder has no office.
  title: string;
  /// The holder's own number, in the local 0788… form the card is printed in
  /// rather than the E.164 the database stores. Empty when none is on file.
  phone: string;
  /// URL the QR encodes: the same sign-in link as the account's QR page.
  qrUrl: string;
  /// Circular PNG with an alpha channel, or null when no photograph is set.
  photo: { bytes: Uint8Array; mimeType: string } | null;
}

/**
 * Assembles what the front of one person's card says.
 *
 * `roleLabel` is passed in rather than looked up here because it is
 * translated, and this module cannot see the request's locale. The caller — a
 * route handler already holding the dashboard copy — can.
 *
 * A holder with no live QR is issued one. Printing a card around a code that
 * does not exist would produce a card nobody can scan, and the member would
 * have no way of discovering that until someone tried it.
 */
export async function getMembershipCardData(
  userId: string,
  roleLabel: string
): Promise<MembershipCardData> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      title: true,
      role: true,
      email: true,
      associationId: true,
      avatar: { select: { data: true, mimeType: true } },
    },
  });

  if (!user) throw new Error(`No user ${userId}`);

  const actor: QrActor = {
    id: user.id,
    role: user.role,
    email: user.email,
    associationId: user.associationId,
  };

  const code = (await getActiveQrCode(userId)) ?? (await issueQrCode(userId, actor));

  return {
    // "Nshimiyimana Daniel": family name, then given name.
    displayName: `${user.lastName} ${user.firstName}`.trim(),
    title: user.title?.trim() || roleLabel,
    phone: toLocalPhone(user.phone),
    qrUrl: code.url,
    photo: user.avatar
      ? { bytes: new Uint8Array(user.avatar.data), mimeType: user.avatar.mimeType }
      : null,
  };
}

/**
 * Reads a side's artwork, or null when the association has not supplied it.
 *
 * Null is a supported state rather than a failure: the renderer falls back to
 * a plain ground so the pipeline can be exercised — and a card still produced
 * — before the design files land. A missing template must never be the reason
 * a member cannot get their card.
 */
async function loadTemplate(side: CardSide): Promise<Uint8Array | null> {
  try {
    const file = await fs.readFile(path.join(TEMPLATE_DIR, TEMPLATE_FILES[side]));
    return new Uint8Array(file);
  } catch {
    return null;
  }
}

/** Fits text to a width by stepping the size down, never by clipping it. */
function fitText(
  text: string,
  font: PDFFont,
  startSize: number,
  maxWidthPt: number
): number {
  let size = startSize;
  while (size > 4 && font.widthOfTextAtSize(text, size) > maxWidthPt) {
    size -= 0.5;
  }
  return size;
}

/**
 * The type sizes the front will actually be printed at, as a fraction of card
 * height.
 *
 * THE PREVIEW CALLS THIS TOO, and that is the whole point. A long name is
 * shrunk to fit, and if the on-screen preview did its own guessing the two
 * would disagree exactly when it matters most — which is the moment somebody
 * approves a card for printing. One measurement, two renderers.
 */
export async function getCardTextSizes(data: MembershipCardData): Promise<{
  name: number;
  title: number;
  phone: number;
}> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const fit = (text: string, font: PDFFont, box: { size: number; maxWidth: number }) =>
    fitText(text, font, box.size * CARD.heightPt, box.maxWidth * CARD.widthPt) /
    CARD.heightPt;

  return {
    name: fit(data.displayName, regular, FRONT.name),
    title: fit(data.title, bold, FRONT.title),
    phone: fit(data.phone, regular, FRONT.phone),
  };
}

/**
 * Draws a value at a top-left anchor expressed in card fractions.
 *
 * PDF measures from the bottom of the page and text from its baseline, so the
 * flip and the ascent offset happen here, once, rather than in every caller.
 */
function drawFieldText(
  page: PDFPage,
  text: string,
  box: { x: number; y: number; size: number; maxWidth: number },
  font: PDFFont,
  colour: ReturnType<typeof rgb>
): void {
  if (!text) return;

  const startSize = box.size * CARD.heightPt;
  const size = fitText(text, font, startSize, box.maxWidth * CARD.widthPt);

  page.drawText(text, {
    x: box.x * CARD.widthPt,
    y: CARD.heightPt - box.y * CARD.heightPt - size,
    size,
    font,
    color: colour,
  });
}

/** Draws a side's artwork, or a plain white ground when none is supplied. */
async function drawGround(
  doc: PDFDocument,
  page: PDFPage,
  side: CardSide
): Promise<void> {
  const template = await loadTemplate(side);

  if (!template) {
    page.drawRectangle({
      x: 0,
      y: 0,
      width: CARD.widthPt,
      height: CARD.heightPt,
      color: rgb(1, 1, 1),
    });
    return;
  }

  // The artwork's format is whatever the association exported, so it is read
  // from the bytes rather than assumed from the extension — embedPng on a JPEG
  // throws, and a card that fails to render is worse than one drawn plain.
  const probed = probeImage(template);
  const art =
    probed?.mimeType === "image/jpeg"
      ? await doc.embedJpg(template)
      : await doc.embedPng(template);

  page.drawImage(art, { x: 0, y: 0, width: CARD.widthPt, height: CARD.heightPt });
}

/** The front of one member's card. */
export async function renderCardFront(data: MembershipCardData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`RTA membership card — ${data.displayName}`);
  doc.setProducer("RTA Savings & Loans");

  const page = doc.addPage([CARD.widthPt, CARD.heightPt]);
  await drawGround(doc, page, "front");

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  drawFieldText(page, data.displayName, FRONT.name, regular, INK.name);
  drawFieldText(page, data.title, FRONT.title, bold, INK.name);
  drawFieldText(page, data.phone, FRONT.phone, regular, INK.body);

  // --- Sign-in QR ----------------------------------------------------------
  // Generated at 1024px and scaled down by the PDF rather than produced at the
  // final size: a QR is all hard edges, and handing the printer a large one
  // keeps the modules crisp at 300dpi.
  const qrPng = await renderQrPng(data.qrUrl, { size: 1024 });
  const qr = await doc.embedPng(new Uint8Array(qrPng));
  const qrSize = FRONT.qr.size * CARD.widthPt;
  const qrX = FRONT.qr.x * CARD.widthPt;
  const qrY = CARD.heightPt - FRONT.qr.y * CARD.heightPt - qrSize;

  page.drawImage(qr, { x: qrX, y: qrY, width: qrSize, height: qrSize });

  // The blue keyline, drawn over the code's own white quiet zone so the frame
  // sits tight against the modules exactly as it does in the artwork.
  const stroke = FRONT.qrFrame.stroke * CARD.widthPt;
  page.drawRectangle({
    x: qrX,
    y: qrY,
    width: qrSize,
    height: qrSize,
    borderColor: INK.frame,
    borderWidth: stroke,
  });

  // The association's mark in the middle of the code, on its own white ground
  // so it reads as placed rather than as damage to the symbol.
  const mark = await loadLogo();
  if (mark) {
    const markSize = FRONT.qrLogo.size * qrSize;
    const markX = qrX + (qrSize - markSize) / 2;
    const markY = qrY + (qrSize - markSize) / 2;
    const pad = markSize * 0.08;

    page.drawRectangle({
      x: markX - pad,
      y: markY - pad,
      width: markSize + pad * 2,
      height: markSize + pad * 2,
      color: rgb(1, 1, 1),
    });

    const logo = await doc.embedJpg(mark);
    page.drawImage(logo, { x: markX, y: markY, width: markSize, height: markSize });
  }

  // --- Photograph ----------------------------------------------------------
  // The stored image is already a circle on a transparent ground, cropped in
  // the browser at upload. That matters here: pdf-lib cannot clip, so a square
  // photograph would print as a square sitting on top of the artwork.
  const r = FRONT.photo.r * CARD.heightPt;
  const cx = FRONT.photo.cx * CARD.widthPt;
  const cy = CARD.heightPt - FRONT.photo.cy * CARD.heightPt;

  if (data.photo) {
    const image =
      data.photo.mimeType === "image/jpeg"
        ? await doc.embedJpg(data.photo.bytes)
        : await doc.embedPng(data.photo.bytes);

    page.drawImage(image, { x: cx - r, y: cy - r, width: r * 2, height: r * 2 });
  } else {
    // Nothing to print. A soft disc reads as "photograph missing" rather than
    // leaving a hole in the artwork.
    page.drawCircle({ x: cx, y: cy, size: r, color: INK.placeholder });
  }

  return doc.save();
}

/** The back of the card — identical for every member, so it takes no data. */
export async function renderCardBack(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("RTA membership card — back");
  doc.setProducer("RTA Savings & Loans");

  const page = doc.addPage([CARD.widthPt, CARD.heightPt]);
  await drawGround(doc, page, "back");

  return doc.save();
}
