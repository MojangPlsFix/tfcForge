// UI for the TFC Forge Helper. Bundled by esbuild into one IIFE script (`npm run build`), so it works from file://.
import { MAX_WORK, RULE_TYPES, STEPS, arrangeForDisplay, placeRules, runningValues, solve } from './solver.ts';
import type { Rule, RuleType, StepId } from './solver.ts';
import { recognize, type RecognizeError } from './recognize.ts';
import { ANVIL_TEXTURE } from './texture.ts';

type ColumnOrder = 'LAST' | 'SECOND_LAST' | 'THIRD_LAST';
interface RuleSlot { type: RuleType | null; readonly order: ColumnOrder }

const TYPE_LABELS: Record<RuleType, string> = { HIT: 'Hit', DRAW: 'Draw', PUNCH: 'Punch', BEND: 'Bend', UPSET: 'Upset', SHRINK: 'Shrink' };
const TYPE_TITLES: Record<RuleType, string> = { ...TYPE_LABELS, HIT: 'Hit (light, medium or hard)' };
const ORDER_LABELS: Record<ColumnOrder, string> = { LAST: 'Last', SECOND_LAST: '2nd last', THIRD_LAST: '3rd last' };
const POSITION_LABELS = ['Last', '2nd last', '3rd last'];

const state: { rules: RuleSlot[] } = {
  rules: [
    { type: null, order: 'LAST' },
    { type: null, order: 'SECOND_LAST' },
    { type: null, order: 'THIRD_LAST' },
  ],
};

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error('missing #' + id);
  return node as T;
}

const inputs = {
  target: byId<HTMLInputElement>('target'),
  start: byId<HTMLInputElement>('start'),
};
const resultBox = byId<HTMLElement>('result');
const shotStatus = byId<HTMLElement>('shot-status');
const shotFile = byId<HTMLInputElement>('shot-file');

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | ((event: MouseEvent) => void)> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const element: HTMLElement = node; // non-generic type so 'click' resolves to MouseEvent listeners
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === 'function') element.addEventListener('click', value); // only `onclick` carries a handler
    else if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

function img(src: string, width: number, height: number, extra: Record<string, string> = {}): HTMLImageElement {
  return el('img', { src, width: String(width), height: String(height), alt: '', draggable: 'false', ...extra });
}

// ---- Rule columns -------------------------------------------------------

const ruleViews = state.rules.map((rule, index) => {
  const icon = img('', 40, 40, { class: 'slot-icon' });
  const overlay = img('', 80, 88, { class: 'slot-overlay' });
  const preview = el('div', { class: 'slot-preview' }, [icon, overlay]);

  const typeButtons = RULE_TYPES.map((type) =>
    el('button', {
      type: 'button',
      class: 'pick type-pick',
      title: TYPE_TITLES[type],
      'aria-label': TYPE_TITLES[type],
      'data-value': type,
      onclick: () => { rule.type = type; render(); },
    }, [img(`icons/rule_${type}.png`, 32, 32)]),
  );
  const noneButton = el('button', {
    type: 'button',
    class: 'pick text-pick',
    'data-value': '',
    onclick: () => { rule.type = null; render(); },
  }, ['None']);

  const column = el('div', { class: 'col' }, [
    el('h3', { text: POSITION_LABELS[index] }),
    el('div', { class: 'col-head' }, [preview, noneButton]),
    el('div', { class: 'picker' }, typeButtons),
  ]);
  byId('rules').append(column);

  return { rule, preview, icon, overlay, typeButtons: [...typeButtons, noneButton] };
});

function markPressed(buttons: readonly HTMLButtonElement[], value: string | null): void {
  for (const button of buttons) {
    button.setAttribute('aria-pressed', String(button.dataset.value === (value ?? '')));
  }
}

function renderPickers(): void {
  for (const view of ruleViews) {
    const { type, order } = view.rule;
    view.preview.classList.toggle('empty', type === null);
    view.icon.hidden = type === null;
    if (type !== null) view.icon.src = `icons/rule_${type}.png`;
    view.overlay.src = `icons/order_${order}.png`;
    view.preview.title = type === null ? 'No rule' : `${TYPE_LABELS[type]} ${ORDER_LABELS[order].toLowerCase()}`;
    markPressed(view.typeButtons, type);
  }
}

// ---- Inputs -------------------------------------------------------------

/** Parses a work input; empty text gives `emptyValue`. Shows the error next to the input. */
function parseWork<E extends number | null>(
  input: HTMLInputElement,
  label: string,
  emptyValue: E,
): { ok: true; value: number | E } | { ok: false; error: string } {
  const text = input.value.trim();
  const errorBox = byId(`${input.id}-error`);
  let parsed: { ok: true; value: number | E } | { ok: false; error: string };
  if (text === '') parsed = { ok: true, value: emptyValue };
  else if (/^\d+$/.test(text) && Number(text) <= MAX_WORK) parsed = { ok: true, value: Number(text) };
  else parsed = { ok: false, error: `${label} must be a whole number from 0 to ${MAX_WORK}.` };

  errorBox.textContent = parsed.ok ? '' : parsed.error;
  if (parsed.ok) input.removeAttribute('aria-invalid');
  else input.setAttribute('aria-invalid', 'true');
  return parsed;
}

// ---- Result -------------------------------------------------------------

function message(text: string, className = 'note'): void {
  resultBox.replaceChildren(el('p', { class: className, text }));
}

function chip(
  id: StepId,
  value: number,
  { count = 1, caption = null, tail = false }: { count?: number; caption?: string | null; tail?: boolean } = {},
): HTMLDivElement {
  const step = STEPS.find((s) => s.id === id)!;
  const children: (Node | string)[] = [img(`icons/step_${id}.png`, 64, 64)];
  if (count > 1) children.push(el('span', { class: 'count', text: '\u00d7' + count }));
  children.push(el('span', { class: 'value', text: String(value) }));
  if (caption) children.push(el('span', { class: 'caption', text: caption }));
  const title = `${step.name} (${step.value > 0 ? '+' + step.value : String(step.value)})`;
  return el('div', { class: tail ? 'chip tail' : 'chip', title }, children);
}

function renderSolution(steps: readonly StepId[], start: number, target: number, ruleCount: number): void {
  const { free, tail } = arrangeForDisplay(steps, start, ruleCount);
  const values = runningValues(start, free.concat(tail));
  const n = steps.length;
  const parts: Node[] = [
    el('p', { class: 'summary' }, [
      el('strong', { text: `${n} click${n === 1 ? '' : 's'}` }),
      el('span', { class: 'route', text: `${start} \u2192 ${target}` }),
    ]),
  ];

  if (free.length > 0) {
    const groups: { id: StepId; count: number; value: number }[] = [];
    free.forEach((id, i) => {
      const group = groups[groups.length - 1];
      if (group && group.id === id) {
        group.count++;
        group.value = values[i];
      } else {
        groups.push({ id, count: 1, value: values[i] });
      }
    });
    parts.push(el('h2', { text: 'Work towards' }));
    parts.push(el('div', { class: 'chips' }, groups.map((g) => chip(g.id, g.value, { count: g.count }))));
  }

  parts.push(el('h2', { text: 'Finish with, in this order' }));
  parts.push(el('div', { class: 'chips' }, tail.map((id, i) =>
    chip(id, values[free.length + i], { caption: POSITION_LABELS[tail.length - 1 - i], tail: true }),
  )));
  resultBox.replaceChildren(...parts);
}

function renderResult(): void {
  const target = parseWork(inputs.target, 'Target', null);
  const start = parseWork(inputs.start, 'Start', 0);
  if (!target.ok || !start.ok) {
    resultBox.replaceChildren();
    return;
  }
  if (target.value === null) {
    message('Enter the target (red marker) to get a plan.');
    return;
  }

  const rules: Rule[] = state.rules.flatMap(({ type, order }) => (type === null ? [] : [{ type, order }]));
  const result = solve({ start: start.value, target: target.value, rules });
  if (!result.ok) {
    message(`No sequence reaches ${target.value} with these rules without leaving 0\u2013${MAX_WORK}.`, 'note bad');
  } else if (result.steps.length === 0) {
    message(`Nothing to do: already at ${target.value} with all rules met.`);
  } else {
    renderSolution(result.steps, start.value, target.value, rules.length);
  }
}

function render(): void {
  renderPickers();
  renderResult();
}

inputs.target.addEventListener('input', renderResult);
inputs.start.addEventListener('input', renderResult);

// ---- Screenshot ---------------------------------------------------------

const SHOT_ERRORS: Record<RecognizeError, string> = {
  NO_ANVIL: "Couldn't find the anvil screen in this image. Use an original (not resized) screenshot.",
  CUT_OFF: 'The anvil is cut off. Capture the whole anvil window.',
  NO_MARKERS: "Couldn't find the green and red markers. Put the item on the anvil and pick a plan.",
  NO_RULES: 'No rules found. Pick a plan in the anvil first.',
  UNREADABLE_RULE: "Couldn't read rule {rule}. Move the mouse away from the rules and try again.",
};

let shotToken = 0;
let texturePromise: Promise<ImageData> | null = null;

function setShotStatus(text: string, kind: '' | 'ok' | 'error'): void {
  shotStatus.textContent = text;
  shotStatus.className = 'shot-status ' + kind;
}

async function toImageData(blob: Blob): Promise<ImageData> {
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('2D canvas unavailable');
  context.drawImage(bmp, 0, 0);
  bmp.close();
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function loadTexture(): Promise<ImageData> {
  if (!texturePromise) {
    texturePromise = fetch(ANVIL_TEXTURE).then((r) => r.blob()).then(toImageData);
    texturePromise.catch(() => { texturePromise = null; });
  }
  return texturePromise;
}

async function readScreenshot(blob: Blob): Promise<void> {
  const token = ++shotToken;
  setShotStatus('Reading screenshot\u2026', '');
  let shot: ImageData, texture: ImageData;
  try {
    [shot, texture] = await Promise.all([toImageData(blob), loadTexture()]);
  } catch {
    if (token === shotToken) setShotStatus("Couldn't open this image.", 'error');
    return;
  }
  if (token !== shotToken) return;

  const r = recognize(shot, texture);
  if (!r.ok) {
    setShotStatus(SHOT_ERRORS[r.error].replace('{rule}', String(r.rule)), 'error');
    return;
  }
  const p = placeRules(r.rules, r.start, r.target);
  if (!p.ok) {
    setShotStatus("These rules don't fit into Last / 2nd last / 3rd last.", 'error');
    return;
  }
  inputs.target.value = String(r.target);
  inputs.start.value = String(r.start);
  state.rules.forEach((slot, i) => { slot.type = p.positions[i]; });
  render();
  const moved = r.rules.some((rule) => rule.order === 'NOT_LAST' || rule.order === 'ANY');
  setShotStatus(
    `Read from screenshot: target ${r.target}, start ${r.start}.` + (moved ? ' Any / Not last rules were put into free positions.' : ''),
    'ok',
  );
}

document.addEventListener('paste', (event) => {
  const item = Array.from(event.clipboardData?.items ?? []).find((it) => it.kind === 'file' && it.type.startsWith('image/'));
  if (!item) return;
  event.preventDefault();
  const file = item.getAsFile();
  if (file) void readScreenshot(file);
});

document.addEventListener('dragover', (event) => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault();
  document.body.classList.add('dragging');
});

document.addEventListener('dragleave', (event) => {
  if (event.relatedTarget === null) document.body.classList.remove('dragging');
});

document.addEventListener('drop', (event) => {
  event.preventDefault();
  document.body.classList.remove('dragging');
  const file = Array.from(event.dataTransfer?.files ?? []).find((f) => f.type.startsWith('image/'));
  if (file) void readScreenshot(file);
  else setShotStatus('Drop an image file.', 'error');
});

shotFile.addEventListener('change', () => {
  const file = shotFile.files?.[0];
  if (file) void readScreenshot(file);
  shotFile.value = '';
});

render();
