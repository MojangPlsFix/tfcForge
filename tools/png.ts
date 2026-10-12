// PNG helpers on fast-png that always work in 8-bit RGBA.
import { convertIndexedToRgb, decode, encode } from 'fast-png';

export interface PngImage { width: number; height: number; data: Uint8Array } // RGBA, row-major

export function decodePng(bytes: Uint8Array): PngImage {
  const png = decode(bytes, { checkCrc: true });
  const pixels = png.palette ? convertIndexedToRgb(png) : png.data;
  const channels = pixels.length / (png.width * png.height);
  if (png.depth !== 8 || channels < 3) throw new Error('unsupported PNG');
  if (channels === 4) return { width: png.width, height: png.height, data: Uint8Array.from(pixels) };
  const data = new Uint8Array(png.width * png.height * 4).fill(255);
  for (let i = 0; i < png.width * png.height; i++) data.set(pixels.subarray(i * 3, i * 3 + 3), i * 4);
  return { width: png.width, height: png.height, data };
}

export const encodePng = (image: PngImage) => encode({ ...image, channels: 4, depth: 8 });
