import { type NextRequest } from "next/server";
import { requireApiAuth } from "@/lib/auth/guards";
import { getDashboardCopy } from "@/lib/i18n/server";
import {
  getMembershipCardData,
  renderCardFront,
  renderCardBack,
} from "@/lib/cards/membership-card";
import { withErrorHandling } from "@/lib/api/response";

/**
 * GET /api/account/card?side=front|back — the caller's own membership card.
 *
 * ONE SIDE PER REQUEST, ONE FILE PER SIDE. A card is printed in two passes,
 * and the person at the printer needs to hand over the front on one and the
 * back on the other. Returning both pages in a single PDF would make the
 * common case — print thirty fronts, then reload and print thirty backs —
 * fiddlier than it needs to be.
 *
 * No user id parameter, deliberately: the session decides whose card this is,
 * so there is nothing to tamper with and no ownership check to forget. Admins
 * printing on someone else's behalf go through the admin route instead, which
 * is scoped to their association and audited.
 */

// The front embeds a sign-in credential; never cached, never prerendered.
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (request: NextRequest) => {
  const context = await requireApiAuth();
  const side = request.nextUrl.searchParams.get("side") === "back" ? "back" : "front";

  const slug =
    context.member?.memberNumber ??
    context.user.fullName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");

  const headers = {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="rta-card-${side}-${slug}.pdf"`,
    // The front carries a scannable credential, so no shared cache may hold a
    // copy. The back is impersonal, but it travels the same route and is not
    // worth a second caching policy.
    "Cache-Control": "no-store, private",
  };

  if (side === "back") {
    return new Response(new Uint8Array(await renderCardBack()), { headers });
  }

  // The office printed under the name falls back to the role, which is
  // translated — so the copy is resolved here, where the request's locale is
  // visible, rather than inside the renderer.
  const { d } = await getDashboardCopy();
  const roleLabel =
    context.user.role === "SUPER_ADMIN"
      ? d.shell.superAdmin
      : context.user.role === "ADMIN"
        ? d.shell.admin
        : d.shell.member;

  const data = await getMembershipCardData(context.user.id, roleLabel);

  return new Response(new Uint8Array(await renderCardFront(data)), { headers });
});
