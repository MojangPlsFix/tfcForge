// Shortest TerraFirmaCraft anvil click sequence (TFC 1.20.x ForgeStep / ForgeRule semantics).

export type RuleType = 'HIT' | 'DRAW' | 'PUNCH' | 'BEND' | 'UPSET' | 'SHRINK';
export type Order = 'LAST' | 'SECOND_LAST' | 'THIRD_LAST' | 'NOT_LAST' | 'ANY';
export type StepId = 'HIT_LIGHT' | 'HIT_MEDIUM' | 'HIT_HARD' | 'DRAW' | 'PUNCH' | 'BEND' | 'UPSET' | 'SHRINK';
export interface Step { readonly id: StepId; readonly name: string; readonly value: number; readonly type: RuleType }
export interface Rule { readonly type: RuleType; readonly order: Order }
/** Step ids of the last, 2nd last and 3rd last step (null when empty). */
export type History = readonly [StepId | null, StepId | null, StepId | null];
/** Rule types required at [last, 2nd last, 3rd last]. */
export type Positions = [RuleType | null, RuleType | null, RuleType | null];
export type SolveResult = { ok: true; steps: StepId[] } | { ok: false };

export const MIN_WORK = 0;
export const MAX_WORK = 150;

export const STEPS: readonly Step[] = [
  { id: 'HIT_LIGHT', name: 'Light Hit', value: -3, type: 'HIT' },
  { id: 'HIT_MEDIUM', name: 'Medium Hit', value: -6, type: 'HIT' },
  { id: 'HIT_HARD', name: 'Hard Hit', value: -9, type: 'HIT' },
  { id: 'DRAW', name: 'Draw', value: -15, type: 'DRAW' },
  { id: 'PUNCH', name: 'Punch', value: 2, type: 'PUNCH' },
  { id: 'BEND', name: 'Bend', value: 7, type: 'BEND' },
  { id: 'UPSET', name: 'Upset', value: 13, type: 'UPSET' },
  { id: 'SHRINK', name: 'Shrink', value: 16, type: 'SHRINK' },
];
export const RULE_TYPES: readonly RuleType[] = ['HIT', 'DRAW', 'PUNCH', 'BEND', 'UPSET', 'SHRINK'];
export const ORDERS: readonly Order[] = ['LAST', 'SECOND_LAST', 'THIRD_LAST', 'NOT_LAST', 'ANY'];

const STEP_BY_ID = Object.fromEntries(STEPS.map((step) => [step.id, step])) as Record<StepId, Step>;
const NONE = RULE_TYPES.length; // class index for "no step"
const CLASSES = RULE_TYPES.length + 1;
const HISTORY_STATES = CLASSES * CLASSES * CLASSES;
const STEP_CLASS = STEPS.map((step) => RULE_TYPES.indexOf(step.type));

function stepOf(id: StepId): Step {
  const step = STEP_BY_ID[id] as Step | undefined;
  if (!step) throw new Error('Unknown step: ' + id);
  return step;
}

/** Whether `rule` holds for the last three steps (rule types, or null when empty). */
export function ruleMatches(rule: Rule, last: RuleType | null, secondLast: RuleType | null, thirdLast: RuleType | null): boolean {
  const t = rule.type;
  switch (rule.order) {
    case 'LAST': return last === t;
    case 'SECOND_LAST': return secondLast === t;
    case 'THIRD_LAST': return thirdLast === t;
    case 'NOT_LAST': return secondLast === t || thirdLast === t;
    case 'ANY': return last === t || secondLast === t || thirdLast === t;
    default: throw new Error('Unknown rule order: ' + String(rule.order));
  }
}

function historyClass(stepId: StepId | null): number {
  if (stepId == null) return NONE;
  return RULE_TYPES.indexOf(stepOf(stepId).type);
}

/**
 * Breadth-first search over (work, classes of the last three steps).
 * Returns { ok: true, steps } with the shortest step-id sequence, or { ok: false }.
 */
export function solve({ start, target, rules = [], history = [null, null, null] }: {
  start: number;
  target: number;
  rules?: readonly Rule[];
  history?: History;
}): SolveResult {
  if (![start, target].every((v) => Number.isInteger(v) && v >= MIN_WORK && v <= MAX_WORK)) {
    throw new RangeError('start/target must be integers in 0..150');
  }

  const typeOf = (c: number): RuleType | null => (c === NONE ? null : RULE_TYPES[c]);
  const goal = new Uint8Array(HISTORY_STATES);
  for (let h = 0; h < HISTORY_STATES; h++) {
    const c1 = Math.floor(h / (CLASSES * CLASSES));
    const c2 = Math.floor(h / CLASSES) % CLASSES;
    const c3 = h % CLASSES;
    goal[h] = rules.every((rule) => ruleMatches(rule, typeOf(c1), typeOf(c2), typeOf(c3))) ? 1 : 0;
  }

  const startHistory =
    (historyClass(history[0]) * CLASSES + historyClass(history[1])) * CLASSES + historyClass(history[2]);
  if (start === target && goal[startHistory]) return { ok: true, steps: [] };

  const stateCount = (MAX_WORK + 1) * HISTORY_STATES;
  const prev = new Int32Array(stateCount).fill(-1);
  const prevStep = new Int8Array(stateCount);
  const queue = new Int32Array(stateCount);
  const s0 = start * HISTORY_STATES + startHistory;
  prev[s0] = s0;
  let head = 0;
  let tail = 0;
  queue[tail++] = s0;

  while (head < tail) {
    const state = queue[head++];
    const work = Math.floor(state / HISTORY_STATES);
    const hist = state % HISTORY_STATES;
    const c1 = Math.floor(hist / (CLASSES * CLASSES));
    const c2 = Math.floor(hist / CLASSES) % CLASSES;

    for (let i = 0; i < STEPS.length; i++) {
      const nextWork = work + STEPS[i].value;
      if (nextWork < MIN_WORK || nextWork > MAX_WORK) continue;
      const nextHist = (STEP_CLASS[i] * CLASSES + c1) * CLASSES + c2;
      const next = nextWork * HISTORY_STATES + nextHist;
      if (prev[next] !== -1) continue;
      prev[next] = state;
      prevStep[next] = i;

      if (nextWork === target && goal[nextHist]) {
        const steps: StepId[] = [];
        for (let s = next; s !== s0; s = prev[s]) steps.push(STEPS[prevStep[s]].id);
        return { ok: true, steps: steps.reverse() };
      }
      queue[tail++] = next;
    }
  }
  return { ok: false };
}

/** Work value after each step. */
export function runningValues(start: number, steps: readonly StepId[]): number[] {
  let work = start;
  return steps.map((id) => (work += stepOf(id).value));
}

/**
 * Splits a solution into freely orderable steps and the rule-relevant last three,
 * grouping the free steps (largest first, else smallest first) when that stays in bounds.
 */
export function arrangeForDisplay(steps: readonly StepId[], start: number, ruleCount: number): { free: StepId[]; tail: StepId[] } {
  const k = ruleCount > 0 ? Math.max(0, steps.length - 3) : steps.length;
  const free = steps.slice(0, k);
  const tail = steps.slice(k);
  const candidates = [
    free.slice().sort((a, b) => stepOf(b).value - stepOf(a).value),
    free.slice().sort((a, b) => stepOf(a).value - stepOf(b).value),
  ];
  for (const candidate of candidates) {
    if (runningValues(start, candidate.concat(tail)).every((v) => v >= MIN_WORK && v <= MAX_WORK)) {
      return { free: candidate, tail };
    }
  }
  return { free, tail };
}

const POSITION_OF: Partial<Record<Order, number>> = { LAST: 0, SECOND_LAST: 1, THIRD_LAST: 2 };

/**
 * Places rules into [last, 2nd last, 3rd last] like TFC's ForgeRule.calculateOptimalStepsToTarget:
 * exact orders first, then NOT_LAST / ANY into the latest free allowed position.
 */
export function toPositions(rules: readonly Rule[]): { ok: true; positions: Positions } | { ok: false } {
  const positions: Positions = [null, null, null];
  for (const rule of rules) {
    const i = POSITION_OF[rule.order];
    if (i === undefined) continue;
    if (positions[i] !== null && positions[i] !== rule.type) return { ok: false };
    positions[i] = rule.type;
  }
  for (const rule of rules) {
    if (POSITION_OF[rule.order] !== undefined) continue;
    const anyPosition = rule.order === 'ANY';
    let placed = false;
    for (let i = 2; i >= 0 && !placed; i--) {
      if ((anyPosition || i > 0) && positions[i] === rule.type) placed = true;
    }
    for (let i = 2; i >= 0 && !placed; i--) {
      if ((anyPosition || i > 0) && positions[i] === null) {
        positions[i] = rule.type;
        placed = true;
      }
    }
    if (!placed) return { ok: false };
  }
  return { ok: true, positions };
}

// Positions each order can be met at, latest first (matching toPositions' scan order).
const ALLOWED_POSITIONS: Record<Order, readonly number[]> = {
  LAST: [0], SECOND_LAST: [1], THIRD_LAST: [2], NOT_LAST: [2, 1], ANY: [2, 1, 0],
};

/**
 * Places game rules (which may use NOT_LAST / ANY) into fixed [last, 2nd last, 3rd last] positions
 * without losing clicks for this start/target: every rule goes where a shortest solution's ending meets it.
 * Fixed positions only narrow the rules, and that solution still meets them, so the minimum is unchanged.
 * Falls back to TFC's placement (toPositions) when the rules cannot be met at all.
 */
export function placeRules(rules: readonly Rule[], start: number, target: number): { ok: true; positions: Positions } | { ok: false } {
  const result = solve({ start, target, rules });
  if (!result.ok) return toPositions(rules);
  const ending = result.steps.slice(-3).reverse().map((id) => stepOf(id).type); // [last, 2nd last, 3rd last]
  const positions: Positions = [null, null, null];
  for (const rule of rules) {
    const allowed = ALLOWED_POSITIONS[rule.order];
    const i = allowed.find((p) => positions[p] === rule.type) ?? allowed.find((p) => ending[p] === rule.type);
    if (i === undefined) throw new Error('solution does not meet rule ' + rule.type + '/' + rule.order);
    positions[i] = rule.type;
  }
  return { ok: true, positions };
}
