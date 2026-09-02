/**
 * Membership card geometry.
 *
 * CR80 — 85.6 × 54 mm — because that is what card printers, wallets and badge
 * holders are built for. At 300dpi that is 1011 × 638 px, which is within a
 * few pixels of the artwork this was drawn from, so a supplied template drops
 * in without distortion.
 *
 * EVERY POSITION BELOW IS A FRACTION OF THE CARD, not a pixel or a millimetre.
 * The artwork is authored at some resolution nobody here controls and may be
 * re-exported at another; fractions survive that, absolute coordinates do not.
 * They are also what makes the layout tunable — nudging the name is a decimal
 * change here, not arithmetic in the renderer.
 */

/** Millimetres to PDF points (72 per inch). */
const MM_TO_PT = 72 / 25.4;

export const CARD = {
  widthMm: 85.6,
  heightMm: 54,
  get widthPt() {
    return this.widthMm * MM_TO_PT;
  },
  get heightPt() {
    return this.heightMm * MM_TO_PT;
  },
  /** What a supplied template should be exported at, for a 300dpi print. */
  templatePx: { width: 1011, height: 638 },
} as const;

/**
 * Where the live fields sit on the front.
 *
 * `x`/`y` are the top-left of the box as a fraction of card width/height —
 * top-left because that is how the artwork reads, even though PDF measures
 * from the bottom. The renderer does that flip once, so these stay readable
 * against the design.
 *
 * `size` is a fraction of card HEIGHT for text (type scales with the short
 * edge) and of card WIDTH for boxes (the QR is square against the long edge).
 */
export const FRONT = {
  /** Holder's name, family name first, as the printed card reads it. */
  name: { x: 0.061, y: 0.235, size: 0.079, maxWidth: 0.52 },
  /** Office held, or the role label when no office is recorded. */
  title: { x: 0.061, y: 0.352, size: 0.032, maxWidth: 0.34 },
  /** The holder's own number, beside the phone icon drawn in the artwork. */
  phone: { x: 0.125, y: 0.443, size: 0.033, maxWidth: 0.28 },
  /** Sign-in QR. Square, sized against the card's width. */
  qr: { x: 0.268, y: 0.412, size: 0.186 },
  /** Photograph, drawn as a circle. Centre and radius, radius against height. */
  photo: { cx: 0.718, cy: 0.513, r: 0.243 },
} as const;

/**
 * The back carries no per-holder data at all — the same association name, the
 * same Kinyarwanda notice, the same two numbers to ring if a card is found.
 * It is therefore a single flat image, and this file has nothing to say about
 * it beyond the page size above.
 */
export const CARD_SIDES = ["front", "back"] as const;
export type CardSide = (typeof CARD_SIDES)[number];

/** Artwork the renderer composites onto. Supplied by the association. */
export const TEMPLATE_FILES: Record<CardSide, string> = {
  front: "card-front-template.png",
  back: "card-back-template.png",
};
