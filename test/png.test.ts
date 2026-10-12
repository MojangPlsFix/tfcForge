import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { decodePng, encodePng } from '../tools/png.ts';
import { ANVIL_TEXTURE } from '../src/texture.ts';

const textureBytes = Buffer.from(ANVIL_TEXTURE.slice(ANVIL_TEXTURE.indexOf(',') + 1), 'base64');

test('expands the palette texture to 256x256 RGBA with transparency', () => {
  const png = decodePng(textureBytes);
  assert.equal(png.width, 256);
  assert.equal(png.height, 256);
  assert.equal(png.data.length, 256 * 256 * 4);
  const alphas = new Set(png.data.filter((_, i) => i % 4 === 3));
  assert.deepEqual([...alphas].sort((a, b) => a - b), [0, 255]);
});

test('encode then decode round-trips RGBA pixels', () => {
  const data = Uint8Array.from({ length: 3 * 2 * 4 }, (_, i) => (i * 37) % 256);
  const image = { width: 3, height: 2, data };
  assert.deepEqual(decodePng(encodePng(image)), image);
});

test('decodes an RGBA screenshot fixture', () => {
  const png = decodePng(readFileSync(new URL('./fixtures/javaw_t2QkvNc8La.png', import.meta.url)));
  assert.deepEqual([png.width, png.height, png.data.length], [1069, 759, 1069 * 759 * 4]);
});

test('rejects a PNG with a corrupt chunk checksum', () => {
  const bytes = Uint8Array.from(textureBytes);
  bytes[8 + 8 + 13] ^= 0xff; // first byte of the IHDR CRC
  assert.throws(() => decodePng(bytes));
});

test('rejects bytes that are not a PNG', () => {
  assert.throws(() => decodePng(strToU8('not a png at all')));
});

test('extracts one member from a deflated zip', () => {
  const zip = zipSync({ 'assets/tfc/textures/gui/anvil.png': textureBytes, 'other.txt': strToU8('x') });
  const member = 'assets/tfc/textures/gui/anvil.png';
  const files = unzipSync(zip, { filter: (f) => f.name === member });
  assert.deepEqual(Object.keys(files), [member]);
  assert.deepEqual(Buffer.from(files[member]), textureBytes);
});
