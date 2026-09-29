/**
 * Client-side image processing for FastFS uploads (browser only).
 *
 * Decodes with EXIF orientation applied, optionally cover-crops (avatar 400×400,
 * banner 1500×500), scales to ≤ 2048 px on the long side and encodes WebP, stepping quality down
 * until the file is ≤ 1,000,000 bytes. Browsers that can't encode WebP (older Safari returns a
 * PNG from `toBlob("image/webp")`) fall back to JPEG. GIFs up to `LIMITS.maxUploadBytes` (8 MiB)
 * pass through untouched, so animations survive (uploaded in 1 MiB chunks when over 1 MiB);
 * larger GIFs are flattened like any other image.
 */
import { bytesToHex } from "@noble/hashes/utils";
import { sha256 } from "@noble/hashes/sha2";
import { LIMITS } from "@/lib/social/standard";
import type { ProcessedMedia } from "./fastfs";

export interface ProcessOptions {
  /** Cover-crop to exactly this output size. */
  crop?: { width: number; height: number };
  /** Long-side limit when not cropping. */
  maxDim?: number;
  maxBytes?: number;
}

export interface ProcessedImage extends ProcessedMedia {
  /** The encoded file, for previews. */
  blob: Blob;
}

export const AVATAR_CROP = { width: 400, height: 400 } as const;
export const BANNER_CROP = { width: 1500, height: 500 } as const;

const GIF_PASSTHROUGH_BYTES = LIMITS.maxUploadBytes;
const QUALITIES = [0.9, 0.82, 0.74, 0.66, 0.58, 0.5, 0.42];

type Drawable = ImageBitmap | HTMLImageElement;

function sizeOf(src: Drawable): { w: number; h: number } {
  return src instanceof HTMLImageElement
    ? { w: src.naturalWidth || 300, h: src.naturalHeight || 150 }
    : { w: src.width, h: src.height };
}

async function decode(blob: Blob): Promise<Drawable> {
  try {
    return await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    // e.g. SVG, which createImageBitmap can't decode from a Blob in some browsers.
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      await img.decode();
      return img;
    } catch {
      throw new Error("This file isn't an image this browser can read.");
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Image encoding failed."))), type, quality),
  );
}

async function finish(blob: Blob, mime: string, ext: string, w: number, h: number) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { blob, bytes, mime, ext, w, h, sha256hex: bytesToHex(sha256(bytes)) };
}

export async function processImage(input: Blob, opts: ProcessOptions = {}): Promise<ProcessedImage> {
  const maxBytes = opts.maxBytes ?? LIMITS.mediaBytes;
  const maxDim = opts.maxDim ?? LIMITS.mediaMaxDim;

  if (!opts.crop && input.type === "image/gif" && input.size <= GIF_PASSTHROUGH_BYTES) {
    const bmp = await decode(input);
    const { w, h } = sizeOf(bmp);
    if ("close" in bmp) bmp.close();
    if (w <= LIMITS.mediaDimMax && h <= LIMITS.mediaDimMax) {
      return finish(input, "image/gif", "gif", w, h);
    }
  }

  const source = await decode(input);
  const { w: sw, h: sh } = sizeOf(source);

  // Source rectangle (cover-crop centred) and output size.
  let sx = 0;
  let sy = 0;
  let sWidth = sw;
  let sHeight = sh;
  let outW: number;
  let outH: number;
  if (opts.crop) {
    const target = opts.crop.width / opts.crop.height;
    if (sw / sh > target) {
      sWidth = Math.round(sh * target);
      sx = Math.round((sw - sWidth) / 2);
    } else {
      sHeight = Math.round(sw / target);
      sy = Math.round((sh - sHeight) / 2);
    }
    outW = opts.crop.width;
    outH = opts.crop.height;
  } else {
    const scale = Math.min(1, maxDim / Math.max(sw, sh));
    outW = Math.max(1, Math.round(sw * scale));
    outH = Math.max(1, Math.round(sh * scale));
  }

  let mime: "image/webp" | "image/jpeg" = "image/webp";
  let shrink = 1;
  try {
    let pass = 0;
    while (pass < 6) {
      const w = Math.max(1, Math.round(outW * shrink));
      const h = Math.max(1, Math.round(outH * shrink));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas isn't available.");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      if (mime === "image/jpeg") {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
      }
      ctx.drawImage(source, sx, sy, sWidth, sHeight, 0, 0, w, h);

      let switchedToJpeg = false;
      for (const q of QUALITIES) {
        const blob = await toBlob(canvas, mime, q);
        if (mime === "image/webp" && blob.type !== "image/webp") {
          // No WebP encoder (Safari): redo this size as JPEG on a white background.
          mime = "image/jpeg";
          switchedToJpeg = true;
          break;
        }
        if (blob.size <= maxBytes) {
          return await finish(blob, mime, mime === "image/webp" ? "webp" : "jpg", w, h);
        }
      }
      if (switchedToJpeg) continue;
      // Still too large at the lowest quality: shrink the dimensions and try again.
      shrink *= 0.8;
      pass++;
    }
  } finally {
    if ("close" in source) source.close();
  }
  throw new Error("This image is too large to upload, even after compression.");
}
