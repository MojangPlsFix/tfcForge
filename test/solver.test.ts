import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/solver.ts';
import type { History, Order, Rule, RuleType, StepId } from '../src/solver.ts';

const stepById = new Map(S.STEPS.map((step) => [step.id, step]));
const typeOf = (id: StepId | null): RuleType | null => (id == null ? null : stepById.get(id)!.type);
const rule = (spec: string): Rule => {
  const [type, order] = spec.split('/') as [RuleType, Order];
  return { type, order };
};
const rulesOf = (...specs: string[]) => specs.map(rule);

/** Applies steps after `history` ([last, 2nd, 3rd] step ids), asserting bounds after every step. */
function replay(start: number, history: History, steps: readonly StepId[]) {
  let work = start;
  let last3: [StepId | null, StepId | null, StepId | null] = [history[0], history[1], history[2]];
  for (const id of steps) {
    work += stepById.get(id)!.value;
    assert.ok(work >= S.MIN_WORK && work <= S.MAX_WORK, `work ${work} out of bounds after ${id}`);
    last3 = [id, last3[0], last3[1]];
  }
  return { work, last3 };
}

function assertCompletes(start: number, target: number, rules: readonly Rule[], history: History, steps: readonly StepId[]) {
  const { work, last3 } = replay(start, history, steps);
  assert.equal(work, target);
  for (const r of rules) {
    assert.ok(S.ruleMatches(r, typeOf(last3[0]), typeOf(last3[1]), typeOf(last3[2])), `rule ${r.type}/${r.order} unmet by ${last3}`);
  }
}

const NO_HISTORY: History = [null, null, null];
const SCREENSHOT_RULES = rulesOf('UPSET/LAST', 'HIT/SECOND_LAST', 'SHRINK/ANY');
const DDP = rulesOf('DRAW/THIRD_LAST', 'DRAW/SECOND_LAST', 'PUNCH/LAST');

interface Case {
  start: number;
  target: number;
  rules: Rule[];
  clicks: number | null;
  history?: History;
  steps?: StepId[];
}

const cases: Case[] = [
  { start: 0, target: 89, rules: SCREENSHOT_RULES, clicks: 8 },
  { start: 0, target: 111, rules: rulesOf('DRAW/LAST'), clicks: 10 },
  { start: 111, target: 106, rules: rulesOf('DRAW/LAST'), clicks: 3 },
  { start: 0, target: 56, rules: rulesOf('HIT/LAST'), clicks: 6 },
  { start: 0, target: 56, rules: DDP, clicks: 9 },
  { start: 56, target: 56, rules: DDP, clicks: 6 },
  { start: 0, target: 61, rules: rulesOf('HIT/THIRD_LAST', 'HIT/SECOND_LAST', 'UPSET/LAST'), clicks: 8 },
  { start: 0, target: 60, rules: rulesOf('HIT/ANY'), clicks: 6 },
  { start: 0, target: 60, rules: rulesOf('HIT/NOT_LAST', 'BEND/LAST'), clicks: 7 },
  { start: 54, target: 56, rules: DDP, history: ['DRAW', 'DRAW', 'BEND'], clicks: 1, steps: ['PUNCH'] },
  { start: 56, target: 56, rules: DDP, history: ['PUNCH', 'DRAW', 'DRAW'], clicks: 0 },
  { start: 0, target: 0, rules: [], clicks: 0 },
  { start: 0, target: 40, rules: rulesOf('HIT/LAST', 'DRAW/LAST'), clicks: null },
];

for (const c of cases) {
  const history = c.history ?? NO_HISTORY;
  const label = `${c.start} -> ${c.target} [${c.rules.map((r) => `${r.type}/${r.order}`).join(', ')}]` +
    (c.history ? ` history ${c.history.join(',')}` : '');
  test(`shortest sequence: ${label}`, () => {
    const result = S.solve({ start: c.start, target: c.target, rules: c.rules, history });
    if (c.clicks === null) {
      assert.deepEqual(result, { ok: false });
      return;
    }
    assert.ok(result.ok);
    assert.equal(result.steps.length, c.clicks);
    if (c.steps) assert.deepEqual(result.steps, c.steps);
    assertCompletes(c.start, c.target, c.rules, history, result.steps);

    const { free, tail } = S.arrangeForDisplay(result.steps, c.start, c.rules.length);
    const arranged = free.concat(tail);
    assert.equal(arranged.length, result.steps.length);
    assertCompletes(c.start, c.target, c.rules, history, arranged);
  });
}

test('screenshot case is arranged into grouped free steps and an ordered tail', () => {
  const result = S.solve({ start: 0, target: 89, rules: SCREENSHOT_RULES });
  assert.ok(result.ok);
  assert.deepEqual(result.steps, ['PUNCH', 'UPSET', 'SHRINK', 'SHRINK', 'SHRINK', 'SHRINK', 'HIT_LIGHT', 'UPSET']);
  const { free, tail } = S.arrangeForDisplay(result.steps, 0, SCREENSHOT_RULES.length);
  assert.deepEqual(free, ['SHRINK', 'SHRINK', 'SHRINK', 'UPSET', 'PUNCH']);
  assert.deepEqual(tail, ['SHRINK', 'HIT_LIGHT', 'UPSET']);
  assert.deepEqual(S.runningValues(0, free.concat(tail)), [16, 32, 48, 61, 63, 79, 76, 89]);
});

test('rejects start/target outside 0..150', () => {
  assert.throws(() => S.solve({ start: 0, target: 151 }), RangeError);
  assert.throws(() => S.solve({ start: -1, target: 50 }), RangeError);
  assert.throws(() => S.solve({ start: 1.5, target: 50 }), RangeError);
});

// Independent oracle (empty history): any solution of length >= 3 is a bounded free prefix
// (shortest = plain value BFS) followed by a rule-checked 3-step suffix; shorter ones are brute-forced.
function oracle(start: number, target: number, rules: readonly Rule[]): number | null {
  const values = S.STEPS.map((s) => s.value);
  const types = S.STEPS.map((s) => s.type);
  const inRange = (v: number) => v >= S.MIN_WORK && v <= S.MAX_WORK;
  const replayBounded = (from: number, seq: readonly number[]) => {
    let w = from;
    for (const i of seq) {
      w += values[i];
      if (!inRange(w)) return null;
    }
    return w;
  };
  const rulesHold = (seq: readonly number[]) => {
    const [l1, l2, l3] = [seq[seq.length - 1], seq[seq.length - 2], seq[seq.length - 3]]
      .map((i) => (i === undefined ? null : types[i]));
    return rules.every((r) => S.ruleMatches(r, l1, l2, l3));
  };

  const seqs: number[][] = [[]];
  for (let len = 1; len <= 3; len++) {
    for (const s of seqs.filter((x) => x.length === len - 1)) {
      for (let i = 0; i < values.length; i++) seqs.push([...s, i]);
    }
  }

  let best = Infinity;
  for (const s of seqs) {
    if (replayBounded(start, s) === target && rulesHold(s)) best = Math.min(best, s.length);
  }

  const dist: number[] = new Array(S.MAX_WORK + 1).fill(Infinity);
  dist[start] = 0;
  for (let frontier = [start], d = 1; frontier.length; d++) {
    const next: number[] = [];
    for (const w of frontier) {
      for (const v of values) {
        const n = w + v;
        if (inRange(n) && dist[n] === Infinity) {
          dist[n] = d;
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  for (const s of seqs.filter((x) => x.length === 3)) {
    if (!rulesHold(s)) continue;
    const v = target - s.reduce((sum, i) => sum + values[i], 0);
    if (!inRange(v) || dist[v] === Infinity || replayBounded(v, s) !== target) continue;
    best = Math.min(best, dist[v] + 3);
  }
  return best === Infinity ? null : best;
}

test('solver matches an independent oracle on single rules and random rule triples', () => {
  const singles: Rule[][] = [];
  for (const type of S.RULE_TYPES) for (const order of S.ORDERS) singles.push([{ type, order }]);

  let seed = 12345;
  const next = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  const triples: Rule[][] = [];
  for (let k = 0; k < 60; k++) {
    triples.push([0, 1, 2].map(() => {
      const type = S.RULE_TYPES[next(6)];
      const order = S.ORDERS[next(5)];
      return { type, order };
    }));
  }

  const sweeps = [
    { starts: [0, 75], ruleSets: singles },
    { starts: [0], ruleSets: triples },
  ];
  for (const { starts, ruleSets } of sweeps) {
    for (const start of starts) {
      for (const rules of ruleSets) {
        for (let target = 40; target <= 113; target++) {
          const result = S.solve({ start, target, rules });
          const got = result.ok ? result.steps.length : null;
          const want = oracle(start, target, rules);
          if (got !== want) {
            assert.fail(`start ${start} target ${target} rules ${JSON.stringify(rules)}: solver ${got}, oracle ${want}`);
          }
        }
      }
    }
  }
});

const toPositionCases: [string[], (RuleType | null)[]][] = [
  [['UPSET/LAST', 'HIT/SECOND_LAST', 'SHRINK/ANY'], ['UPSET', 'HIT', 'SHRINK']],
  [['BEND/ANY', 'DRAW/ANY', 'HIT/ANY'], ['HIT', 'DRAW', 'BEND']],
  [['PUNCH/LAST', 'DRAW/NOT_LAST', 'BEND/NOT_LAST'], ['PUNCH', 'BEND', 'DRAW']],
  [['HIT/ANY', 'HIT/ANY', 'DRAW/LAST'], ['DRAW', null, 'HIT']],
  [['HIT/LAST', 'HIT/NOT_LAST', 'DRAW/NOT_LAST'], ['HIT', 'DRAW', 'HIT']],
];

for (const [specs, positions] of toPositionCases) {
  test(`toPositions places ${specs.join(', ')} as [${positions.join(', ')}]`, () => {
    assert.deepEqual(S.toPositions(rulesOf(...specs)), { ok: true, positions });
  });
}

test('toPositions rejects rules that do not fit three positions', () => {
  assert.deepEqual(S.toPositions(rulesOf('HIT/LAST', 'DRAW/LAST')), { ok: false });
  assert.deepEqual(S.toPositions(rulesOf('HIT/SECOND_LAST', 'DRAW/THIRD_LAST', 'BEND/NOT_LAST')), { ok: false });
});

const fixedRules = (positions: S.Positions): Rule[] => {
  const orders: Order[] = ['LAST', 'SECOND_LAST', 'THIRD_LAST'];
  return positions.flatMap((type, i) => (type === null ? [] : [{ type, order: orders[i] }]));
};
const clicks = (result: S.SolveResult) => (result.ok ? result.steps.length : null);

test('placeRules keeps the shortest finish for a nonzero start', () => {
  for (const [start, target, specs, want] of [
    [42, 60, ['PUNCH/LAST', 'SHRINK/NOT_LAST'], 2],
    [79, 61, ['HIT/ANY', 'HIT/ANY', 'DRAW/LAST'], 2],
  ] as const) {
    const placed = S.placeRules(rulesOf(...specs), start, target);
    assert.ok(placed.ok);
    assert.equal(clicks(S.solve({ start, target, rules: fixedRules(placed.positions) })), want, `${specs} ${start} -> ${target}`);
  }
});

test('placeRules puts Not last into 2nd last when that costs no clicks', () => {
  assert.deepEqual(S.placeRules(rulesOf('PUNCH/LAST', 'HIT/NOT_LAST'), 0, 57), { ok: true, positions: ['PUNCH', 'HIT', null] });
});

test('placing TFC recipe rules into fixed positions costs no clicks', () => {
  const recipes = [
    ['BEND/ANY', 'DRAW/ANY', 'HIT/ANY'],
    ['DRAW/ANY', 'PUNCH/LAST', 'PUNCH/NOT_LAST'],
    ['DRAW/LAST', 'BEND/NOT_LAST'],
    ['DRAW/NOT_LAST', 'BEND/ANY', 'HIT/ANY'],
    ['HIT/ANY', 'HIT/ANY', 'DRAW/LAST'],
    ['HIT/LAST', 'DRAW/NOT_LAST', 'PUNCH/NOT_LAST'],
    ['HIT/LAST', 'HIT/NOT_LAST', 'DRAW/NOT_LAST'],
    ['HIT/LAST', 'SHRINK/NOT_LAST', 'BEND/NOT_LAST'],
    ['PUNCH/LAST', 'BEND/NOT_LAST', 'DRAW/NOT_LAST'],
    ['PUNCH/LAST', 'DRAW/NOT_LAST', 'BEND/NOT_LAST'],
    ['PUNCH/LAST', 'HIT/NOT_LAST'],
    ['PUNCH/LAST', 'HIT/NOT_LAST', 'BEND/NOT_LAST'],
    ['PUNCH/LAST', 'SHRINK/NOT_LAST'],
  ];
  for (const specs of recipes) {
    const rules = rulesOf(...specs);
    for (const start of [0, 42, 79]) {
      for (let target = 40; target <= 113; target++) {
        const placed = S.placeRules(rules, start, target);
        assert.ok(placed.ok, `${specs} did not fit`);
        const real = S.solve({ start, target, rules });
        const mapped = S.solve({ start, target, rules: fixedRules(placed.positions) });
        assert.equal(clicks(mapped), clicks(real), `${specs} ${start} -> ${target}`);
      }
    }
  }
});
