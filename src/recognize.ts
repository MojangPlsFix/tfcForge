// Reads start, target and rules from a screenshot of the TFC anvil screen (TFC 1.20.x AnvilScreen layout),
// by comparing it against the anvil texture of the active resource pack.
import { ORDERS, RULE_TYPES } from './solver.ts';
import type { Order, Rule, RuleType } from './solver.ts';

export interface RgbaImage { readonly width: number; readonly height: number; readonly data: ArrayLike<number> } // RGBA, row-major; ImageData fits
export type RecognizeError = 'NO_ANVIL' | 'CUT_OFF' | 'NO_MARKERS' | 'NO_RULES' | 'UNREADABLE_RULE';
export type RecognizeResult =
  | { ok: true; scale: number; start: number; target: number; rules: Rule[] } // rules in on-screen order, 1–3 entries
  | { ok: false; error: RecognizeError; rule?: number }; // `rule` (1–3) only for UNREADABLE_RULE

// Step buttons (16x16 at these GUI/texture coordinates) whose main colour appears nowhere else on screen:
// HIT_HARD, PUNCH, BEND, UPSET, SHRINK. HIT_LIGHT/HIT_MEDIUM/DRAW colours also occur in the work bar.
const ANCHOR_BUTTONS = [[53, 68], [89, 50], [107, 50], [89, 68], [107, 68]] as const;
const ICON_SOURCES: Record<RuleType, readonly [number, number]> = {
  HIT: [218, 18],
  DRAW: [224, 224],
  PUNCH: [0, 224],
  BEND: [32, 224],
  UPSET: [64, 224],
  SHRINK: [96, 224],
};
const ORDER_Y: Record<Order, number> = { LAST: 0, SECOND_LAST: 22, THIRD_LAST: 44, NOT_LAST: 66, ANY: 88 };
const ICON_MAX_SCORE = 45, ICON_MIN_MARGIN = 15, ORDER_MAX_SCORE = 4;
const RULE_AREA = [59, 7, 117, 29] as const; // [x0, y0, x1, y1) GUI rect
const BAR_AREA = [13, 94, 168, 105] as const; // [x0, y0, x1, y1) GUI rect
const TINTS = [[1, 0.4, 0], [0, 0.6, 0.2]] as const; // unmet (orange), met (green)

interface Anchor {
  readonly tx0: number; readonly ty0: number; readonly tx1: number; readonly ty1: number;
  minX: number; minY: number; maxX: number; maxY: number; count: number;
}

export function recognize(shot: RgbaImage, texture: RgbaImage): RecognizeResult {
  const S = shot.data, T = texture.data;
  const texAt = (u: number, v: number) => (v * texture.width + u) * 4;
  const shotAt = (x: number, y: number) => (y * shot.width + x) * 4;
  const diff = (i: number, r: number, g: number, b: number) =>
    Math.abs(S[i] - r) + Math.abs(S[i + 1] - g) + Math.abs(S[i + 2] - b);

  // 1. Locate the panel from the anchor buttons' main colours.
  const anchors = new Map<number, Anchor>();
  const shared = new Set<number>();
  for (const [bx, by] of ANCHOR_BUTTONS) {
    const counts = new Map<number, number>();
    for (let v = by; v < by + 16; v++) {
      for (let u = bx; u < bx + 16; u++) {
        const t = texAt(u, v);
        const colour = (T[t] << 16) | (T[t + 1] << 8) | T[t + 2];
        counts.set(colour, (counts.get(colour) ?? 0) + 1);
      }
    }
    let main = -1, mainCount = 0;
    for (const [colour, n] of counts) if (n > mainCount) [main, mainCount] = [colour, n];
    let tx0 = Infinity, ty0 = Infinity, tx1 = -Infinity, ty1 = -Infinity;
    for (let v = by; v < by + 16; v++) {
      for (let u = bx; u < bx + 16; u++) {
        const t = texAt(u, v);
        if (((T[t] << 16) | (T[t + 1] << 8) | T[t + 2]) !== main) continue;
        tx0 = Math.min(tx0, u); ty0 = Math.min(ty0, v);
        tx1 = Math.max(tx1, u + 1); ty1 = Math.max(ty1, v + 1);
      }
    }
    if (anchors.has(main)) shared.add(main);
    anchors.set(main, { tx0, ty0, tx1, ty1, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, count: 0 });
  }
  for (const colour of shared) anchors.delete(colour);

  for (let y = 0; y < shot.height; y++) {
    for (let x = 0; x < shot.width; x++) {
      const i = shotAt(x, y);
      const anchor = anchors.get((S[i] << 16) | (S[i + 1] << 8) | S[i + 2]);
      if (!anchor) continue;
      anchor.minX = Math.min(anchor.minX, x); anchor.minY = Math.min(anchor.minY, y);
      anchor.maxX = Math.max(anchor.maxX, x); anchor.maxY = Math.max(anchor.maxY, y);
      anchor.count++;
    }
  }

  const groups = new Map<string, { s: number; ox: number; oy: number; size: number }>();
  for (const a of anchors.values()) {
    if (a.count === 0) continue;
    const s = (a.maxX - a.minX + 1) / (a.tx1 - a.tx0);
    if (!Number.isInteger(s) || s < 1 || a.maxY - a.minY + 1 !== (a.ty1 - a.ty0) * s) continue;
    const ox = a.minX - a.tx0 * s, oy = a.minY - a.ty0 * s;
    const key = `${s},${ox},${oy}`;
    const group = groups.get(key) ?? { s, ox, oy, size: 0 };
    group.size++;
    groups.set(key, group);
  }
  let panel = { s: 0, ox: 0, oy: 0, size: 0 };
  for (const group of groups.values()) if (group.size > panel.size) panel = group;
  if (panel.size < 2) return { ok: false, error: 'NO_ANVIL' };
  const { s, ox, oy } = panel;

  // 2. The rules and the work bar must be fully on screen.
  for (const [x0, y0, x1, y1] of [RULE_AREA, BAR_AREA]) {
    if (ox + x0 * s < 0 || oy + y0 * s < 0 || ox + x1 * s > shot.width || oy + y1 * s > shot.height) {
      return { ok: false, error: 'CUT_OFF' };
    }
  }

  // 3. Centre of a GUI pixel.
  const guiAt = (gx: number, gy: number) => shotAt(ox + gx * s + (s >> 1), oy + gy * s + (s >> 1));

  // 4. Markers: 5x5 sprites drawn at GUI (13 + value, y), matched exactly.
  const findMarker = (u: number, y: number): number | null => {
    for (let value = 0; value <= 150; value++) {
      let match = true;
      for (let r = 0; r < 5 && match; r++) {
        for (let c = 0; c < 5 && match; c++) {
          const t = texAt(u + c, r);
          if (T[t + 3] > 0 && diff(guiAt(13 + value + c, y + r), T[t], T[t + 1], T[t + 2]) !== 0) match = false;
        }
      }
      if (match) return value;
    }
    return null;
  };
  const start = findMarker(176, 100);
  const target = findMarker(181, 94);
  if (start === null || target === null) return { ok: false, error: 'NO_MARKERS' };

  // 5. Rules: a 10x10 icon (scaled from 32x32) inside a 20x22 tinted order overlay, 19 GUI pixels apart.
  const iconScore = (i: number, source: readonly [number, number] | null): number => {
    const n = 10 * s, x0 = ox + (64 + 19 * i) * s, y0 = oy + 10 * s;
    let total = 0;
    for (let dy = 0; dy < n; dy++) {
      for (let dx = 0; dx < n; dx++) {
        let e = texAt(64 + 19 * i + Math.floor(dx / s), 10 + Math.floor(dy / s));
        if (source) {
          const t = texAt(source[0] + Math.floor(((dx + 0.5) * 32) / n), source[1] + Math.floor(((dy + 0.5) * 32) / n));
          if (T[t + 3] > 0) e = t;
        }
        total += diff(shotAt(x0 + dx, y0 + dy), T[e], T[e + 1], T[e + 2]);
      }
    }
    return total / (n * n);
  };
  const orderScore = (i: number, order: Order | null, tint: readonly [number, number, number]): number => {
    let total = 0, count = 0;
    for (let r = 0; r < 22; r++) {
      for (let c = 0; c < 20; c++) {
        if (c >= 5 && c < 15 && r >= 3 && r < 13) continue;
        const si = guiAt(59 + 19 * i + c, 7 + r);
        const o = order === null ? -1 : texAt(198 + c, ORDER_Y[order] + r);
        if (o >= 0 && T[o + 3] > 0) {
          total += diff(si, Math.round(T[o] * tint[0]), Math.round(T[o + 1] * tint[1]), Math.round(T[o + 2] * tint[2]));
        } else {
          const b = texAt(59 + 19 * i + c, 7 + r);
          total += diff(si, T[b], T[b + 1], T[b + 2]);
        }
        count++;
      }
    }
    return total / count;
  };

  const rules: Rule[] = [];
  for (let i = 0; i < 3; i++) {
    const icons = [...RULE_TYPES, null]
      .map((type) => ({ type, score: iconScore(i, type === null ? null : ICON_SOURCES[type]) }))
      .sort((a, b) => a.score - b.score);
    let order: Order | null = null;
    let orderBest = orderScore(i, null, TINTS[0]);
    for (const candidate of ORDERS) {
      for (const tint of TINTS) {
        const score = orderScore(i, candidate, tint);
        if (score < orderBest) [order, orderBest] = [candidate, score];
      }
    }
    const type = icons[0].type;
    if (
      icons[0].score > ICON_MAX_SCORE ||
      icons[1].score - icons[0].score < ICON_MIN_MARGIN ||
      orderBest > ORDER_MAX_SCORE ||
      (type === null) !== (order === null)
    ) {
      return { ok: false, error: 'UNREADABLE_RULE', rule: i + 1 };
    }
    if (type !== null && order !== null) rules.push({ type, order });
  }
  if (rules.length === 0) return { ok: false, error: 'NO_RULES' };
  return { ok: true, scale: s, start, target, rules };
}
