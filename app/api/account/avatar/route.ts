import { type NextRequest } from "next/server";
import { requireApiAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/prisma";
import { probeImage } from "@/lib/images/probe";
import {
  apiBadRequest,
  apiNoContent,
  apiNotFound,
  apiSuccess,
  withErrorHandling,
} from "@/lib/api/response";

/**
 * The photograph printed on a membership card.
 *
 * GET    /api/account/avatar — the caller's own photograph, as an image.
 * POST   /api/account/avatar — replaces it. multipart/form-data, field "file".
 * DELETE /api/account/avatar — removes it.
 *
 * THE IMAGE IS CROPPED AND RESIZED IN THE BROWSER, not here. A card photograph
 * is a circle, and the card renderer cannot clip — so what is stored has to
 * already be a circle on a transparent ground. Doing that on the client also
 * means a 6MB phone photograph never crosses the network: it arrives as a
 * 512px PNG of a few tens of kilobytes.
 *
 * That makes the client a participant in a decision, so nothing it says is
 * trusted. The bytes are re-identified from their own magic numbers, the
 * declared content type is discarded, and anything that is not a real PNG or
 * JPEG is refused.
 */

export const dynamic = "force-dynamic";

/** Generous for a 512px PNG with alpha, mean for anything that is not one. */
const MAX_BYTES = 2 * 1024 * 1024;

/** Below this the photograph is too soft to print at 300dpi on a card. */
const MIN_EDGE_PX = 128;

/** Above this someone is storing a wallpaper in the accounts database. */
const MAX_EDGE_PX = 2048;

export const GET = withErrorHandling(async () => {
  const context = await requireApiAuth();

  const avatar = await prisma.userAvatar.findUnique({
    where: { userId: context.user.id },
    select: { data: true, mimeType: true, updatedAt: true },
  });

  if (!avatar) return apiNotFound("No photograph on file");

  return new Response(new Uint8Array(avatar.data), {
    headers: {
      "Content-Type": avatar.mimeType,
      // A person's own face, on their own session. Private, but re-fetching it
      // on every render of the card page is wasteful, so allow the browser
      // itself to hold it briefly.
      "Cache-Control": "private, max-age=60",
      ETag: `"${avatar.updatedAt.getTime()}"`,
    },
  });
});

export const POST = withErrorHandling(async (request: NextRequest) => {
  const context = await requireApiAuth();

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");

  if (!(file instanceof File)) {
    return apiBadRequest("Attach the photograph as a file field named 'file'.");
  }

  if (file.size > MAX_BYTES) {
    return apiBadRequest("That photograph is too large. The limit is 2MB.");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  // What the upload actually is, rather than what it claimed to be.
  const probed = probeImage(bytes);
  if (!probed) {
    return apiBadRequest("That file is not a PNG or JPEG image.");
  }

  const longestEdge = Math.max(probed.width, probed.height);
  if (longestEdge < MIN_EDGE_PX) {
    return apiBadRequest(
      `That image is only ${probed.width}×${probed.height}. A card photograph needs to be at least ${MIN_EDGE_PX} pixels across.`
    );
  }
  if (longestEdge > MAX_EDGE_PX) {
    return apiBadRequest(
      `That image is ${probed.width}×${probed.height}, which is larger than a card needs.`
    );
  }

  await prisma.userAvatar.upsert({
    where: { userId: context.user.id },
    create: {
      userId: context.user.id,
      data: Buffer.from(bytes),
      mimeType: probed.mimeType,
      sizeBytes: bytes.length,
      width: probed.width,
      height: probed.height,
    },
    update: {
      data: Buffer.from(bytes),
      mimeType: probed.mimeType,
      sizeBytes: bytes.length,
      width: probed.width,
      height: probed.height,
    },
  });

  return apiSuccess({
    mimeType: probed.mimeType,
    width: probed.width,
    height: probed.height,
    sizeBytes: bytes.length,
  });
});

export const DELETE = withErrorHandling(async () => {
  const context = await requireApiAuth();

  // deleteMany rather than delete: removing a photograph that is already gone
  // is the outcome the caller wanted, not a 404.
  await prisma.userAvatar.deleteMany({ where: { userId: context.user.id } });

  return apiNoContent();
});
