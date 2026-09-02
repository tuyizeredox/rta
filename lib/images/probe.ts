/**
 * Minimal image validation and dimension probing.
 *
 * WHY NOT AN IMAGE LIBRARY. The only thing the server needs to know about an
 * uploaded photograph is "is this really a PNG or a JPEG, and how big is it".
 * Answering that costs a few dozen bytes of header parsing; `sharp` would add
 * a native binary to every build and deploy for it. Resizing and cropping
 * happen in the browser before upload, so nothing here has to decode pixels.
 *
 * THE MAGIC BYTES ARE THE POINT. A client-declared Content-Type is a claim by
 * whoever is uploading, and "image/png" on a file that is not one is the
 * oldest trick there is. What is stored is what these functions recognised,
 * never what the request said it was.
 */

export type ImageKind = "image/png" | "image/jpeg";

export interface ProbedImage {
  mimeType: ImageKind;
  width: number;
  height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length > 24 && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
  );
}

/**
 * PNG dimensions live in the IHDR chunk, which the specification requires to
 * be first: 8 bytes of signature, a 4-byte length, the "IHDR" tag, then width
 * and height as big-endian 32-bit integers.
 */
function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = String.fromCharCode(...bytes.slice(12, 16));
  if (tag !== "IHDR") return null;

  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * JPEG has no fixed header, so the frame marker has to be found by walking the
 * segment chain. Every segment is 0xFF, a marker byte, then a big-endian
 * length; the SOF markers carry the dimensions. SOF4, SOF8 and SOF12 (0xC4,
 * 0xC8, 0xCC) are skipped because they are Huffman and arithmetic-coding
 * tables that happen to sit in the same numeric range, not frame headers.
 */
function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;

  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = bytes[offset + 1];
    const isFrameHeader =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;

    if (isFrameHeader) {
      // Height precedes width inside a start-of-frame segment.
      return {
        height: view.getUint16(offset + 5),
        width: view.getUint16(offset + 7),
      };
    }

    const length = view.getUint16(offset + 2);
    if (length < 2) return null;
    offset += 2 + length;
  }

  return null;
}

/**
 * Identifies an upload, or returns null when it is neither a PNG nor a JPEG.
 *
 * Null means "refuse this" — callers must not fall back to the declared
 * content type, which is exactly the value this exists to distrust.
 */
export function probeImage(bytes: Uint8Array): ProbedImage | null {
  if (isPng(bytes)) {
    const size = pngSize(bytes);
    return size ? { mimeType: "image/png", ...size } : null;
  }

  const jpeg = jpegSize(bytes);
  return jpeg ? { mimeType: "image/jpeg", ...jpeg } : null;
}
