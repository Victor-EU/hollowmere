import type { LookData } from '../data';
import { look, lookChanged } from '../render/look';

const SAVE_URL = '/__hollowmere/data/look.json';

type Leaf = number | string | number[];
type Group = Record<string, Leaf>;

/** Slider ranges: [min, max, step]. Anything not listed gets 0 to twice its value. */
const RANGES: Record<string, [number, number, number]> = {
  'grade.exposure': [0.5, 3, 0.01],
  'grade.contrast': [0, 1, 0.01],
  'grade.saturation': [0, 2, 0.01],
  'grade.shadows': [0.5, 1.5, 0.01],
  'grade.highlights': [0.5, 1.5, 0.01],
  'grade.vignette': [0, 1, 0.01],
  'grade.grain': [0, 0.15, 0.005],
  'grade.aberration': [0, 0.01, 0.0002],
  'bloom.strength': [0, 2, 0.01],
  'bloom.radius': [0, 1, 0.01],
  'bloom.threshold': [0, 2, 0.01],
  'emissive.towerWindow': [0, 5, 0.05],
  'emissive.hallGlass': [0, 5, 0.05],
  'emissive.pumpkinFace': [0, 5, 0.05],
  'hemisphere.intensity': [0, 8, 0.01],
  'moonlight.intensity': [0, 12, 0.05],
  'fill.intensity': [0, 6, 0.05],
  'fog.density': [0, 0.004, 0.00001],
  'water.tint': [0, 1.5, 0.01],
  'water.reflectivity': [0, 1, 0.01],
  'water.ripple': [0, 2, 0.01],
  'water.scale': [2, 60, 0.5],
  'water.distortion': [0, 0.08, 0.001],
  'water.glitter': [0, 10, 0.05],
  'water.sharpness': [10, 3000, 10],
  'mist.opacity': [0, 3, 0.01],
  'mist.softness': [0.5, 40, 0.5],
  'mist.near': [0, 80, 0.5],
  'mist.moonGlow': [0, 4, 0.05],
};

const clone = <T>(d: T): T => JSON.parse(JSON.stringify(d));
const groups = (d: LookData) => Object.entries(d).filter(([k]) => !k.startsWith('$')) as [string, Group][];

/** The file's layout: short groups and number arrays on one line, long groups one key per line. */
export function formatLook(d: LookData): string {
  const inline = (v: unknown): string =>
    Array.isArray(v) ? `[${v.join(', ')}]` : typeof v === 'object' && v ? `{ ${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(', ')} }` : JSON.stringify(v);
  const lines = Object.entries(d).map(([k, v]) => {
    const one = `  ${JSON.stringify(k)}: ${inline(v)}`;
    if (one.length <= 110 || typeof v !== 'object' || Array.isArray(v)) return one;
    const inner = Object.entries(v as Group).map(([kk, x]) => `    ${JSON.stringify(kk)}: ${inline(x)}`);
    return `  ${JSON.stringify(k)}: {\n${inner.join(',\n')}\n  }`;
  });
  return `{\n${lines.join(',\n')}\n}\n`;
}

/**
 * Dev builds only: sliders and colour pickers for everything in data/look.json, applied live, with
 * save straight back to the file through the dev server. The design doc's rule for the emissive
 * and bloom constants is to change them only while looking at the result; this is where.
 */
export class LookPanel {
  readonly el: HTMLElement;
  private saved: LookData;
  private status: HTMLElement;
  private summary: HTMLElement;
  private inputs: { path: [string, string, number?]; el: HTMLInputElement; out?: HTMLInputElement }[] = [];

  constructor(dock: HTMLElement) {
    this.saved = clone(look);
    const el = document.createElement('section');
    el.className = 'dev-panel dev-route dev-look';
    el.hidden = true;
    el.setAttribute('aria-label', 'Look panel');
    el.innerHTML = `
      <header><b>Look</b><span data-k="summary"></span></header>
      <div data-k="groups"></div>
      <div class="dev-row">
        <button data-a="save" title="⌘S">Save to data/look.json</button><button data-a="revert">Revert</button><button data-a="copy">Copy</button>
      </div>
      <p class="dev-status" data-k="status" role="status" aria-live="polite"></p>
      <p class="dev-hint">Changes apply live. Emissive and bloom were tuned together (design doc §8): change them only while looking at the result.</p>`;
    const q = (k: string) => el.querySelector<HTMLElement>(`[data-k="${k}"]`)!;
    this.status = q('status');
    this.summary = q('summary');
    this.build(q('groups'));
    el.querySelector('[data-a="save"]')!.addEventListener('click', () => void this.save());
    el.querySelector('[data-a="revert"]')!.addEventListener('click', () => this.revert());
    el.querySelector('[data-a="copy"]')!.addEventListener('click', () => {
      void navigator.clipboard.writeText(formatLook(look)).then(() => this.setStatus('Copied look.json to the clipboard'));
    });
    el.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        void this.save();
      }
    });
    dock.append(el);
    this.el = el;
    this.refresh();
  }

  get active() {
    return !this.el.hidden;
  }
  open() {
    this.el.hidden = false;
  }
  close() {
    this.el.hidden = true;
  }

  private get dirty() {
    return JSON.stringify(look) !== JSON.stringify(this.saved);
  }

  private build(root: HTMLElement) {
    for (const [name, group] of groups(look)) {
      const details = document.createElement('details');
      details.innerHTML = `<summary>${name}</summary>`;
      const grid = document.createElement('div');
      grid.className = 'dev-look-grid';
      for (const [key, value] of Object.entries(group)) {
        const parts = Array.isArray(value) ? value.map((_, i) => i) : [undefined];
        parts.forEach((i) => {
          const label = document.createElement('label');
          label.textContent = i === undefined ? key : `${key} ${'rgb'[i] ?? i}`;
          const path: [string, string, number?] = [name, key, i];
          const v = this.get(path);
          if (typeof v === 'string') {
            const input = document.createElement('input');
            input.type = 'color';
            input.addEventListener('input', () => this.set(path, input.value));
            grid.append(label, input, document.createElement('span'));
            this.inputs.push({ path, el: input });
          } else {
            const [min, max, step] = RANGES[`${name}.${key}`] ?? [0, Math.max(1, v * 2), 0.01];
            const range = document.createElement('input');
            range.type = 'range';
            Object.assign(range, { min, max, step });
            const out = document.createElement('input');
            out.type = 'number';
            out.step = String(step);
            range.addEventListener('input', () => this.set(path, Number(range.value)));
            out.addEventListener('change', () => Number.isFinite(out.valueAsNumber) && this.set(path, out.valueAsNumber));
            grid.append(label, range, out);
            this.inputs.push({ path, el: range, out });
          }
        });
      }
      details.append(grid);
      root.append(details);
    }
  }

  private get([g, k, i]: [string, string, number?]): number | string {
    const v = (look as unknown as Record<string, Group>)[g][k];
    return i === undefined ? (v as number | string) : (v as number[])[i];
  }

  private set([g, k, i]: [string, string, number?], value: number | string) {
    const group = (look as unknown as Record<string, Group>)[g];
    if (i === undefined) group[k] = value;
    else (group[k] as number[])[i] = value as number;
    lookChanged();
    this.refresh();
  }

  private refresh() {
    for (const { path, el, out } of this.inputs) {
      const v = this.get(path);
      if (el.type === 'color') el.value = v as string;
      else {
        if (document.activeElement !== el) el.value = String(v);
        if (out && document.activeElement !== out) out.value = String(v);
      }
    }
    this.summary.textContent = this.dirty ? 'unsaved changes' : 'as saved in data/look.json';
  }

  private setStatus(text: string) {
    this.status.textContent = text;
  }

  private async save() {
    this.setStatus('Saving…');
    try {
      const res = await fetch(SAVE_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: formatLook(look) });
      if (!res.ok) throw new Error(await res.text());
      this.saved = clone(look);
      this.setStatus('Saved data/look.json');
    } catch (err) {
      this.setStatus(`Could not save: ${(err as Error).message}. Copy the JSON instead.`);
    }
    this.refresh();
  }

  private revert() {
    for (const [name, group] of groups(this.saved)) Object.assign((look as unknown as Record<string, Group>)[name], clone(group));
    lookChanged();
    this.refresh();
    this.setStatus('Reverted to the saved look');
  }
}
