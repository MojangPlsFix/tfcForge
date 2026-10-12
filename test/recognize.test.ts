import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodePng } from '../tools/png.ts';
import { ANVIL_TEXTURE } from '../src/texture.ts';
import { recognize, type RecognizeResult } from '../src/recognize.ts';
import type { Order, Rule, RuleType } from '../src/solver.ts';

const texture = decodePng(Buffer.from(ANVIL_TEXTURE.slice(ANVIL_TEXTURE.indexOf(',') + 1), 'base64'));
const fixture = (name: string) => decodePng(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const rulesOf = (...specs: string[]): Rule[] => specs.map((spec) => {
  const [type, order] = spec.split('/') as [RuleType, Order];
  return { type, order };
});

const fixtures: [string, RecognizeResult][] = [
  ['javaw_t2QkvNc8La.png', { ok: true, scale: 6, start: 0, target: 89, rules: rulesOf('UPSET/LAST', 'HIT/SECOND_LAST', 'SHRINK/ANY') }],
  ['javaw_0KNYVdoTIi.png', { ok: true, scale: 2, start: 0, target: 101, rules: rulesOf('BEND/ANY', 'DRAW/ANY', 'HIT/ANY') }],
  ['javaw_tDqhpFnsXr.png', { ok: true, scale: 2, start: 59, target: 59, rules: rulesOf('PUNCH/LAST', 'DRAW/NOT_LAST', 'BEND/NOT_LAST') }],
  ['javaw_ec1ieEbzSU.png', { ok: true, scale: 2, start: 0, target: 106, rules: rulesOf('DRAW/LAST') }],
  ['javaw_T4gLmmKP7e.png', { ok: true, scale: 2, start: 56, target: 61, rules: rulesOf('HIT/LAST', 'HIT/SECOND_LAST', 'UPSET/THIRD_LAST') }],
  ['javaw_WaueUUxQqo.png', { ok: true, scale: 2, start: 86, target: 61, rules: rulesOf('HIT/LAST', 'HIT/SECOND_LAST', 'UPSET/THIRD_LAST') }],
  ['javaw_4ojcz9sg2X.png', { ok: true, scale: 2, start: 0, target: 99, rules: rulesOf('HIT/LAST', 'HIT/SECOND_LAST', 'HIT/THIRD_LAST') }],
  ['javaw_K75e25ONzE.png', { ok: true, scale: 2, start: 0, target: 66, rules: rulesOf('BEND/LAST', 'BEND/SECOND_LAST', 'SHRINK/THIRD_LAST') }],
  ['javaw_hnkuAUhTwF.png', { ok: false, error: 'NO_ANVIL' }],
];

for (const [name, expected] of fixtures) {
  test(`recognizes ${name}`, () => {
    assert.deepStrictEqual(recognize(fixture(name), texture), expected);
  });
}

// javaw_t2QkvNc8La.png: GUI scale 6, panel origin (-2, -3), 1069x759.
const scale6 = fixture('javaw_t2QkvNc8La.png');
const paint = (x0: number, y0: number, x1: number, y1: number, rgba: readonly number[]) => {
  const data = scale6.data.slice();
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data.set(rgba, (y * scale6.width + x) * 4);
  return { width: scale6.width, height: scale6.height, data };
};

test('reports a cut-off anvil', () => {
  const height = scale6.height - 200;
  const data = scale6.data.slice(200 * scale6.width * 4);
  assert.deepStrictEqual(recognize({ width: scale6.width, height, data }, texture), { ok: false, error: 'CUT_OFF' });
});

test('reports missing markers', () => {
  const shot = paint(0, 597, scale6.width, 627, [198, 198, 198, 255]); // GUI rows 100-104: the green marker
  assert.deepStrictEqual(recognize(shot, texture), { ok: false, error: 'NO_MARKERS' });
});

test('reports an unreadable rule by number', () => {
  const shot = paint(382, 57, 442, 117, [255, 0, 255, 255]); // rule 1 icon
  assert.deepStrictEqual(recognize(shot, texture), { ok: false, error: 'UNREADABLE_RULE', rule: 1 });
});
