// Extract TFC anvil step/rule icons from a resource pack (or anvil.png) into ../icons,
// and embed the texture for screenshot recognition as src/texture.ts.
//
// Usage: node tools/extract-icons.ts [SOURCE]
//
// SOURCE is a resource pack .zip containing assets/tfc/textures/gui/anvil.png, or a
// 256x256 anvil.png. Defaults to the "Perfected Anvil Helper" pack of the
// TerraFirmaGreg-Modern Prism instance. Coordinates follow TFC 1.20.x ForgeStep,
// ForgeRule and AnvilScreen.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { decodePng, encodePng, type PngImage } from './png.ts';

const MEMBER = 'assets/tfc/textures/gui/anvil.png';

// id: [button bg x, button bg y, icon x]; icons sit at y=224, 32x32.
const STEPS: Record<string, readonly [number, number, number]> = {
  HIT_LIGHT: [53, 50, 128],
  HIT_MEDIUM: [71, 50, 160],
  HIT_HARD: [53, 68, 192],
  DRAW: [71, 68, 224],
  PUNCH: [89, 50, 0],
  BEND: [107, 50, 32],
  UPSET: [89, 68, 64],
  SHRINK: [107, 68, 96],
};
const ICON_Y = 224;

// Rule types other than HIT reuse their step icon; HIT uses the generic hammer.
const RULE_ICONS: Record<string, readonly [number, number]> = {
  HIT: [218, 18],
  DRAW: [STEPS.DRAW[2], ICON_Y],
  PUNCH: [STEPS.PUNCH[2], ICON_Y],
  BEND: [STEPS.BEND[2], ICON_Y],
  UPSET: [STEPS.UPSET[2], ICON_Y],
  SHRINK: [STEPS.SHRINK[2], ICON_Y],
};

// Order overlays at x=198, 20x22; tinted like an unsatisfied rule in AnvilScreen.
const ORDER_Y: Record<string, number> = { LAST: 0, SECOND_LAST: 22, THIRD_LAST: 44, NOT_LAST: 66, ANY: 88 };
const OVERLAY_TINT = [1.0, 0.4, 0.0] as const;

const RULE_SLOT = [59, 7, 79, 29] as const;

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

/** Reads one entry of a zip archive (stored or deflated), or null when absent. */
function readZipEntry(zip: Buffer, name: string): Buffer | null {
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('not a zip file');
  const count = zip.readUInt16LE(end + 10);
  let entry = zip.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(entry) !== 0x02014b50) throw new Error('corrupt zip central directory');
    const method = zip.readUInt16LE(entry + 10);
    const size = zip.readUInt32LE(entry + 20);
    const nameLen = zip.readUInt16LE(entry + 28);
    const extraLen = zip.readUInt16LE(entry + 30);
    const commentLen = zip.readUInt16LE(entry + 32);
    const local = zip.readUInt32LE(entry + 42);
    if (zip.toString('utf8', entry + 46, entry + 46 + nameLen) === name) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return zlib.inflateRawSync(data);
      throw new Error(`unsupported zip compression ${method}`);
    }
    entry += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

function crop(img: PngImage, x: number, y: number, w: number, h: number): PngImage {
  const data = new Uint8Array(w * h * 4);
  for (let r = 0; r < h; r++) {
    data.set(img.data.subarray(((y + r) * img.width + x) * 4, ((y + r) * img.width + x + w) * 4), r * w * 4);
  }
  return { width: w, height: h, data };
}

function scaleNearest2x(img: PngImage): PngImage {
  const width = img.width * 2, height = img.height * 2;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = ((y >> 1) * img.width + (x >> 1)) * 4;
      data.set(img.data.subarray(from, from + 4), (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

/** Composites `src` over `dst` in place (same size), like Pillow's alpha_composite. */
function composite(dst: PngImage, src: PngImage): void {
  for (let i = 0; i < dst.data.length; i += 4) {
    const sA = src.data[i + 3];
    if (sA === 0) continue;
    if (sA === 255) {
      dst.data.set(src.data.subarray(i, i + 4), i);
      continue;
    }
    const a = sA / 255;
    const dA = dst.data[i + 3];
    for (let c = 0; c < 3; c++) dst.data[i + c] = Math.round(src.data[i + c] * a + dst.data[i + c] * (1 - a));
    dst.data[i + 3] = Math.round(255 * (a + (dA / 255) * (1 - a)));
  }
}

/** Multiplies RGB by `factors`, truncating like Python's int(). */
function tint(img: PngImage, factors: readonly [number, number, number]): PngImage {
  const data = img.data.slice();
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) data[i + c] = Math.floor(data[i + c] * factors[c]);
  }
  return { width: img.width, height: img.height, data };
}

function buildIcons(texture: PngImage): Map<string, PngImage> {
  const icons = new Map<string, PngImage>();
  for (const [stepId, [bx, by, ix]] of Object.entries(STEPS)) {
    const icon = scaleNearest2x(crop(texture, bx, by, 16, 16));
    composite(icon, crop(texture, ix, ICON_Y, 32, 32));
    icons.set(`step_${stepId}.png`, icon);
  }
  for (const [ruleType, [x, y]] of Object.entries(RULE_ICONS)) icons.set(`rule_${ruleType}.png`, crop(texture, x, y, 32, 32));
  for (const [order, y] of Object.entries(ORDER_Y)) icons.set(`order_${order}.png`, tint(crop(texture, 198, y, 20, 22), OVERLAY_TINT));
  const [x0, y0, x1, y1] = RULE_SLOT;
  icons.set('rule_slot.png', crop(texture, x0, y0, x1 - x0, y1 - y0));
  return icons;
}

function main(): void {
  const source = process.argv[2] ?? path.join(
    process.env.APPDATA ?? '',
    'PrismLauncher/instances/TerraFirmaGreg-Modern/minecraft/resourcepacks/Perfected Anvil Helper.zip',
  );
  if (!existsSync(source) || !statSync(source).isFile()) fail(`${source} not found`);
  const bytes = source.toLowerCase().endsWith('.zip')
    ? readZipEntry(readFileSync(source), MEMBER) ?? fail(`${MEMBER} not in ${source}`)
    : readFileSync(source);
  const texture = decodePng(bytes);
  if (texture.width !== 256 || texture.height !== 256) {
    fail(`expected 256x256 anvil.png, got ${texture.width}x${texture.height}`);
  }

  const outDir = fileURLToPath(new URL('../icons/', import.meta.url));
  mkdirSync(outDir, { recursive: true });
  const icons = buildIcons(texture);
  for (const [name, image] of icons) {
    writeFileSync(path.join(outDir, name), encodePng(image));
    console.log(`wrote ${name} (${image.width}x${image.height})`);
  }
  console.log(`wrote ${icons.size} icons to ${outDir}`);

  const texturePath = fileURLToPath(new URL('../src/texture.ts', import.meta.url));
  const module =
    `// Generated by tools/extract-icons.ts from ${path.basename(source)}. Do not edit.\n` +
    `export const ANVIL_TEXTURE = 'data:image/png;base64,${bytes.toString('base64')}';\n`;
  writeFileSync(texturePath, module);
  console.log(`wrote src/texture.ts (${Buffer.byteLength(module)} bytes)`);
}

main();
