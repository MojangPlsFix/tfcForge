// Minimal PNG codec on node:zlib: decodes 8-bit RGB / palette / RGBA (non-interlaced), encodes RGBA.
import zlib from 'node:zlib';

export interface PngImage { width: number; height: number; data: Uint8Array } // RGBA, row-major

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const BYTES_PER_PIXEL: Partial<Record<number, number>> = { 2: 3, 3: 1, 6: 4 };

export function decodePng(bytes: Uint8Array): PngImage {
  if (bytes.length < 8 || SIGNATURE.some((b, i) => bytes[i] !== b)) throw new Error('not a PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0, bitDepth = 0, colourType = 0, interlace = 0;
  let palette: Uint8Array = new Uint8Array(0);
  let alphas: Uint8Array = new Uint8Array(0);
  const idat: Uint8Array[] = [];
  for (let pos = 8; pos + 8 <= bytes.length;) {
    const length = view.getUint32(pos);
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    const start = pos + 8;
    const body = bytes.subarray(start, start + length);
    pos = start + length + 4; // skip CRC
    if (type === 'IHDR') {
      width = view.getUint32(start);
      height = view.getUint32(start + 4);
      [bitDepth, colourType, interlace] = [body[8], body[9], body[12]];
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') alphas = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
  }
  const bpp = BYTES_PER_PIXEL[colourType];
  if (bitDepth !== 8 || bpp === undefined || interlace !== 0) throw new Error('unsupported PNG');

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? pixels[row + x - bpp] : 0;
      const b = y > 0 ? pixels[row - stride + x] : 0;
      const c = x >= bpp && y > 0 ? pixels[row - stride + x - bpp] : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pixels[row + x] = (raw[src + x] + predictor) & 0xff;
    }
  }

  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    if (colourType === 3) {
      const k = pixels[i];
      data.set(palette.subarray(3 * k, 3 * k + 3), 4 * i);
      data[4 * i + 3] = alphas[k] ?? 255;
    } else if (colourType === 2) {
      data.set(pixels.subarray(3 * i, 3 * i + 3), 4 * i);
      data[4 * i + 3] = 255;
    } else {
      data.set(pixels.subarray(4 * i, 4 * i + 4), 4 * i);
    }
  }
  return { width, height, data };
}

function chunk(type: string, body: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'latin1');
  out.set(body, 8);
  out.writeUInt32BE(zlib.crc32(out.subarray(4, 8 + body.length)) >>> 0, 8 + body.length);
  return out;
}

export function encodePng(image: PngImage): Buffer {
  const { width, height, data } = image;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8); // bit depth 8, RGBA, deflate, filter method 0, no interlace
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) raw.set(data.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  return Buffer.concat([
    Buffer.from(SIGNATURE),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}
