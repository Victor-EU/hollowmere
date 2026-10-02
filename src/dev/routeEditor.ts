import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { RouteData } from '../data';
import { isTyping } from '../ui/input';
import { clamp } from '../world/math';
import { Flag, sampleRoute, type Problem, type RouteSamples } from './checks';
import type { DevHost } from './types';

type State = Pick<RouteData, 'waypoints' | 'through' | 'named'>;

const SAVE_URL = '/__hollowmere/data/route.json';
const NAME = /^[a-z][a-z0-9-]*$/;

/** Colours stay under the bloom threshold so the overlay doesn't glow. */
const SLOW = new THREE.Color(0.18, 0.62, 0.72);
const FAST = new THREE.Color(0.9, 0.58, 0.22);
const FLAG_COLOURS: Record<Flag, THREE.Color | null> = {
  [Flag.Ok]: null,
  [Flag.Low]: new THREE.Color(0.95, 0.12, 0.08),
  [Flag.Stone]: new THREE.Color(0.8, 0.2, 0.85),
  [Flag.Outside]: new THREE.Color(0.45, 0.45, 0.45),
};
const HANDLE = { plain: new THREE.Color(0.85, 0.82, 0.74), named: new THREE.Color(0.95, 0.62, 0.25), selected: new THREE.Color(0.95, 0.95, 0.95) };

const round = (v: number) => Math.round(v * 10) / 10;
const clone = (s: State): State => JSON.parse(JSON.stringify({ waypoints: s.waypoints, through: s.through, named: s.named }));
const same = (a: State, b: State) => JSON.stringify(a) === JSON.stringify(b);

/** route.json in the hand-written layout: four waypoints a line, columns aligned. */
export function formatRoute(data: RouteData & { $comment?: string }): string {
  const cells = data.waypoints.map((w) => `[${w.map(round).join(', ')}],`);
  const width = Math.max(...cells.map((c) => c.length)) + 1;
  const lines: string[] = [];
  for (let i = 0; i < cells.length; i += 4) {
    const row = cells.slice(i, i + 4);
    if (i + 4 >= cells.length) row[row.length - 1] = row[row.length - 1].slice(0, -1);
    lines.push(`    ${row.map((c, j) => (j < row.length - 1 ? c.padEnd(width) : c)).join('')}`);
  }
  const named = Object.entries(data.named)
    .sort((a, b) => a[1] - b[1])
    .map(([k, v]) => `    ${JSON.stringify(k)}: ${v}`);
  return [
    '{',
    ...(data.$comment ? [`  "$comment": ${JSON.stringify(data.$comment)},`] : []),
    `  "closed": ${data.closed},`,
    '  "waypoints": [',
    ...lines,
    '  ],',
    `  "through": [${[...data.through].sort((a, b) => a - b).join(', ')}],`,
    '  "named": {',
    named.join(',\n'),
    '  }',
    '}',
    '',
  ].join('\n');
}

export interface RouteEditorHooks {
  /** Jump the ghost to waypoint i with autofly on, and follow it. */
  flyFrom(i: number): void;
  /** Point the free camera at a spot. */
  view(p: THREE.Vector3): void;
  /** Problems changed: the route's checks. */
  onProblems(problems: Problem[]): void;
}

/**
 * Dev-only route editor: the curve coloured by speed (red where it dips under the ghost's
 * clearance, violet through stone), draggable waypoint handles, a panel to edit speed, names
 * and pass-through legs, undo, and save straight to data/route.json via the dev server.
 */
export class RouteEditor {
  active = false;
  selected = -1;
  samples!: RouteSamples;
  private group = new THREE.Group();
  private handles: THREE.Mesh[] = [];
  private handleGeo = new THREE.SphereGeometry(1, 14, 10);
  private lineGeo = new LineGeometry();
  private lineFront: Line2;
  private lineBack: Line2;
  private carrot: THREE.Mesh;
  private transform: TransformControls;
  private raycaster = new THREE.Raycaster();
  private labels: HTMLDivElement[] = [];
  private labelLayer: HTMLDivElement;
  private panel: HTMLElement;
  private ui!: Record<string, HTMLElement>;
  private history: State[] = [];
  private future: State[] = [];
  private saved: State;
  private status = '';
  private comment: string | undefined;
  private tmp = new THREE.Vector3();
  private bufferSize = new THREE.Vector2();

  constructor(
    private host: DevHost,
    dock: HTMLElement,
    private hooks: RouteEditorHooks,
  ) {
    const { routeData, camera, canvas } = host;
    this.comment = (routeData as RouteData & { $comment?: string }).$comment;
    this.saved = clone(routeData);
    this.history.push(clone(routeData));

    this.group.name = 'dev-route-editor';
    this.group.userData.devOverlay = true;
    const lineMat = (width: number, front: boolean) =>
      new LineMaterial({ linewidth: width, vertexColors: true, transparent: !front, opacity: front ? 1 : 0.35, depthTest: front, depthWrite: false, fog: false });
    this.lineFront = new Line2(this.lineGeo, lineMat(3, true));
    this.lineBack = new Line2(this.lineGeo, lineMat(1.5, false));
    this.lineFront.name = 'route-line';
    this.lineBack.name = 'route-line-hidden';
    this.lineBack.renderOrder = 9;
    this.carrot = new THREE.Mesh(this.handleGeo, new THREE.MeshBasicMaterial({ color: FAST, fog: false, depthTest: false, transparent: true, opacity: 0.8 }));
    this.carrot.name = 'route-carrot';
    this.carrot.renderOrder = 11;
    this.group.add(this.lineFront, this.lineBack, this.carrot);

    this.transform = new TransformControls(camera, canvas);
    this.transform.setSpace('world');
    this.transform.setTranslationSnap(1);
    this.transform.size = 0.8;
    this.transform.enabled = false;
    this.transform.addEventListener('objectChange', () => this.dragged());
    this.transform.addEventListener('dragging-changed', (e) => {
      if (!(e as unknown as { value: boolean }).value) this.commit();
    });
    const helper = this.transform.getHelper();
    helper.name = 'route-gizmo';
    this.group.add(helper);

    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'dev-labels';
    this.labelLayer.hidden = true;
    document.body.append(this.labelLayer);

    this.panel = this.buildPanel();
    this.panel.hidden = true;
    dock.append(this.panel);

    addEventListener('keydown', (e) => this.onKey(e));
    this.rebuild();
  }

  get dirty(): boolean {
    return !same(this.current(), this.saved);
  }

  open() {
    this.active = true;
    this.host.scene.add(this.group);
    this.transform.enabled = true;
    this.labelLayer.hidden = false;
    this.panel.hidden = false;
    this.rebuild();
  }

  close() {
    this.active = false;
    this.select(-1);
    this.host.scene.remove(this.group);
    this.transform.enabled = false;
    this.labelLayer.hidden = true;
    this.panel.hidden = true;
  }

  /** A press on a handle selects it; a press on the gizmo moves it. Anything else is a look drag. */
  claimPointer(e: PointerEvent): boolean {
    if (!this.active || e.button !== 0) return false;
    if (this.transform.axis !== null) return true;
    const r = this.host.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.host.camera);
    const hit = this.raycaster.intersectObjects(this.handles, false)[0];
    if (!hit) return false;
    this.select(this.handles.indexOf(hit.object as THREE.Mesh));
    return true;
  }

  update() {
    if (!this.active) return;
    const { camera, renderer, flight, route } = this.host;
    renderer.getDrawingBufferSize(this.bufferSize);
    for (const l of [this.lineFront, this.lineBack]) l.material.resolution.copy(this.bufferSize);
    // Handles keep a constant size on screen.
    const k = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * 0.016;
    for (const h of this.handles) h.scale.setScalar(Math.max(0.15, h.position.distanceTo(camera.position) * k * (h.userData.i === this.selected ? 1.4 : 1)));
    if (flight.auto.enabled) {
      route.point(flight.auto.t, this.carrot.position);
      this.carrot.scale.setScalar(this.carrot.position.distanceTo(camera.position) * k * 0.6);
      this.carrot.visible = true;
    } else this.carrot.visible = false;

    const w = innerWidth;
    const h = innerHeight;
    camera.updateMatrixWorld();
    this.handles.forEach((m, i) => {
      const label = this.labels[i];
      const p = this.tmp.copy(m.position).project(camera);
      const show = p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1;
      label.hidden = !show;
      if (show) label.style.transform = `translate(${((p.x + 1) / 2) * w + 10}px, ${((1 - p.y) / 2) * h - 8}px)`;
    });
  }

  select(i: number) {
    this.selected = i;
    const h = this.handles[i];
    if (h) this.transform.attach(h);
    else this.transform.detach();
    this.paintHandles();
    this.renderPanel();
  }

  // --- Editing ---

  private current(): State {
    return clone(this.host.routeData);
  }

  private apply(s: State) {
    const d = this.host.routeData;
    d.waypoints = s.waypoints;
    d.through = s.through;
    d.named = s.named;
    this.host.route.setWaypoints(d.waypoints);
    this.host.flight.resync();
    if (this.selected >= d.waypoints.length) this.selected = d.waypoints.length - 1;
    this.rebuild();
  }

  /** Record the current state as one undo step, if it changed. */
  private commit() {
    const s = this.current();
    if (same(s, this.history[this.history.length - 1])) return;
    this.history.push(s);
    if (this.history.length > 200) this.history.shift();
    this.future = [];
    this.host.flight.resync();
    this.renderPanel();
  }

  private undo() {
    this.commit();
    if (this.history.length < 2) return;
    this.future.push(this.history.pop()!);
    this.apply(clone(this.history[this.history.length - 1]));
    this.setStatus('Undone');
  }

  private redo() {
    const s = this.future.pop();
    if (!s) return;
    this.history.push(s);
    this.apply(clone(s));
    this.setStatus('Redone');
  }

  /** Live update while the gizmo drags a handle. */
  private dragged() {
    const i = this.selected;
    const h = this.handles[i];
    if (!h) return;
    const w = this.host.routeData.waypoints[i];
    w[0] = round(h.position.x);
    w[1] = round(h.position.y);
    w[2] = round(h.position.z);
    this.host.route.setWaypoints(this.host.routeData.waypoints);
    this.refreshLine();
    this.renderPanel();
  }

  private setWaypoint(i: number, axis: number, v: number, commit: boolean) {
    if (!Number.isFinite(v)) return;
    const w = this.host.routeData.waypoints[i];
    w[axis] = axis === 3 ? clamp(v, 1, 40) : v;
    this.host.route.setWaypoints(this.host.routeData.waypoints);
    this.handles[i].position.set(w[0], w[1], w[2]);
    this.refreshLine();
    if (commit) this.commit();
  }

  /** Shift every stored index at or past `from` by `by`; drop names pointing at `removed`. */
  private reindex(s: State, from: number, by: number, removed = -1): string[] {
    const dropped: string[] = [];
    for (const [k, v] of Object.entries(s.named)) {
      if (v === removed) {
        delete s.named[k];
        dropped.push(k);
      } else if (v >= from) s.named[k] = v + by;
    }
    s.through = s.through.filter((v) => v !== removed).map((v) => (v >= from ? v + by : v));
    return dropped;
  }

  private insertAfter(i: number) {
    const s = this.current();
    const n = s.waypoints.length;
    if (i < 0) i = n - 1;
    const p = this.host.route.point((i + 0.5) / n);
    const speed = (s.waypoints[i][3] + s.waypoints[(i + 1) % n][3]) / 2;
    this.reindex(s, i + 1, 1);
    s.waypoints.splice(i + 1, 0, [Math.round(p.x), Math.round(p.y), Math.round(p.z), round(speed)]);
    this.apply(s);
    this.commit();
    this.select(i + 1);
    this.setStatus(`Inserted waypoint ${i + 1}`);
  }

  private remove(i: number) {
    const s = this.current();
    if (i < 0 || s.waypoints.length <= 4) {
      this.setStatus('A route needs at least 4 waypoints');
      return;
    }
    s.waypoints.splice(i, 1);
    const dropped = this.reindex(s, i + 1, -1, i);
    this.apply(s);
    this.commit();
    this.select(Math.min(i, s.waypoints.length - 1));
    this.setStatus(`Deleted waypoint ${i}${dropped.length ? `; removed the name ${dropped.join(', ')}` : ''}`);
  }

  private rename(i: number, name: string) {
    const s = this.current();
    name = name.trim().toLowerCase();
    if (name && !NAME.test(name)) {
      this.setStatus('Names are lower-case letters, digits and dashes (they become ?at= links)');
      this.renderPanel();
      return;
    }
    for (const [k, v] of Object.entries(s.named)) if (v === i) delete s.named[k];
    const moved = name && name in s.named ? s.named[name] : -1;
    if (name) s.named[name] = i;
    this.apply(s);
    this.commit();
    this.setStatus(moved >= 0 ? `Moved "${name}" from waypoint ${moved}` : name ? `Named waypoint ${i} "${name}"` : `Waypoint ${i} has no name now`);
  }

  private setThrough(i: number, on: boolean) {
    const s = this.current();
    s.through = on ? [...new Set([...s.through, i])] : s.through.filter((v) => v !== i);
    this.apply(s);
    this.commit();
  }

  // --- Export ---

  private json(): string {
    return formatRoute({ ...this.host.routeData, $comment: this.comment });
  }

  private async save() {
    this.commit();
    try {
      const res = await fetch(SAVE_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: this.json() });
      if (!res.ok) throw new Error((await res.text()) || res.statusText);
      this.saved = this.current();
      this.setStatus('Saved data/route.json');
    } catch (err) {
      this.setStatus(`Could not save: ${(err as Error).message}. Copy or download the JSON instead.`);
    }
  }

  private async copy() {
    try {
      await navigator.clipboard.writeText(this.json());
      this.setStatus('Copied route.json to the clipboard');
    } catch {
      this.setStatus('The clipboard is not available here; use Download');
    }
  }

  private download() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([this.json()], { type: 'application/json' }));
    a.download = 'route.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  private revert() {
    this.apply(clone(this.saved));
    this.commit();
    this.setStatus('Reverted to the saved route');
  }

  // --- Scene objects ---

  private rebuild() {
    const wps = this.host.routeData.waypoints;
    while (this.handles.length > wps.length) {
      const h = this.handles.pop()!;
      if (this.transform.object === h) this.transform.detach();
      this.group.remove(h);
      (h.material as THREE.Material).dispose();
      this.labels.pop()!.remove();
    }
    while (this.handles.length < wps.length) {
      const m = new THREE.Mesh(this.handleGeo, new THREE.MeshBasicMaterial({ fog: false, depthTest: false, transparent: true }));
      m.renderOrder = 10;
      m.userData.i = this.handles.length;
      m.name = `waypoint ${this.handles.length}`;
      this.group.add(m);
      this.handles.push(m);
      const label = document.createElement('div');
      label.className = 'dev-label';
      this.labelLayer.append(label);
      this.labels.push(label);
    }
    const names = this.namesByIndex();
    wps.forEach((w, i) => {
      this.handles[i].position.set(w[0], w[1], w[2]);
      this.labels[i].textContent = names[i] ? `${i} ${names[i]}` : `${i}`;
      this.labels[i].classList.toggle('named', !!names[i]);
    });
    if (this.selected >= 0 && this.handles[this.selected]) this.transform.attach(this.handles[this.selected]);
    this.paintHandles();
    this.refreshLine();
    this.renderPanel();
  }

  private paintHandles() {
    const names = this.namesByIndex();
    this.handles.forEach((h, i) => {
      const m = h.material as THREE.MeshBasicMaterial;
      m.color.copy(i === this.selected ? HANDLE.selected : names[i] ? HANDLE.named : HANDLE.plain);
      m.opacity = i === this.selected ? 1 : 0.85;
    });
    this.labels.forEach((l, i) => l.classList.toggle('selected', i === this.selected));
  }

  private refreshLine() {
    const { route, routeData, world, heights, colliders } = this.host;
    this.samples = sampleRoute(route, routeData, world, heights, colliders);
    const { points, speeds, flags } = this.samples;
    const lo = Math.min(...routeData.waypoints.map((w) => w[3]));
    const hi = Math.max(...routeData.waypoints.map((w) => w[3]), lo + 1);
    const pos: number[] = [];
    const col: number[] = [];
    const c = new THREE.Color();
    for (let i = 0; i <= points.length; i++) {
      const j = i % points.length;
      const p = points[j];
      pos.push(p.x, p.y, p.z);
      const flagged = FLAG_COLOURS[flags[j]];
      if (flagged) c.copy(flagged);
      else c.copy(SLOW).lerp(FAST, (speeds[j] - lo) / (hi - lo));
      col.push(c.r, c.g, c.b);
    }
    // LineGeometry can't grow in place; a new one per edit is cheap at this size.
    const g = new LineGeometry();
    g.setPositions(pos);
    g.setColors(col);
    this.lineGeo.dispose();
    this.lineGeo = g;
    this.lineFront.geometry = g;
    this.lineBack.geometry = g;
    this.hooks.onProblems(this.samples.problems);
  }

  private namesByIndex(): string[] {
    const out: string[] = [];
    for (const [k, v] of Object.entries(this.host.routeData.named)) out[v] = out[v] ? `${out[v]}, ${k}` : k;
    return out;
  }

  // --- Panel ---

  private buildPanel(): HTMLElement {
    const el = document.createElement('section');
    el.className = 'dev-panel dev-route';
    el.setAttribute('aria-label', 'Route editor');
    el.innerHTML = `
      <header><b>Route editor</b><span data-k="summary"></span></header>
      <div class="dev-route-list" data-k="list" role="listbox" aria-label="Waypoints"></div>
      <div class="dev-route-edit" data-k="edit">
        <div class="dev-row"><b data-k="title"></b>
          <button data-a="prev" title="Previous ( [ )">◀</button><button data-a="next" title="Next ( ] )">▶</button></div>
        <div class="dev-fields">
          <label>x <input data-f="0" type="number" step="1"></label>
          <label>y <input data-f="1" type="number" step="1"></label>
          <label>z <input data-f="2" type="number" step="1"></label>
          <label>m/s <input data-f="3" type="number" step="0.5" min="1" max="40"></label>
        </div>
        <div class="dev-row">
          <label>name <input data-k="name" type="text" placeholder="for ?at= links" spellcheck="false"></label>
          <label title="The leg arriving at this waypoint may pass through stone, like the hall glass"><input data-k="through" type="checkbox"> through stone</label>
        </div>
        <div class="dev-row">
          <button data-a="insert" title="I">Insert after</button><button data-a="delete" title="Delete">Delete</button>
          <button data-a="fly" title="J">Fly from here</button><button data-a="view">View</button>
        </div>
      </div>
      <ul class="dev-issues" data-k="issues"></ul>
      <div class="dev-row">
        <button data-a="undo" title="⌘Z">Undo</button><button data-a="redo" title="⇧⌘Z">Redo</button><button data-a="revert">Revert</button>
      </div>
      <div class="dev-row">
        <button data-a="save" title="⌘S">Save to data/route.json</button><button data-a="copy">Copy</button><button data-a="download">Download</button>
      </div>
      <p class="dev-status" data-k="status" role="status" aria-live="polite"></p>
      <p class="dev-hint">Click a handle to select it, drag the arrows to move it (1 m snap). Line colour is speed; red dips under the ghost's clearance, violet goes through stone.</p>`;
    const ui: Record<string, HTMLElement> = {};
    el.querySelectorAll<HTMLElement>('[data-k]').forEach((n) => (ui[n.dataset.k!] = n));
    this.ui = ui;

    const actions: Record<string, () => void> = {
      prev: () => this.step(-1),
      next: () => this.step(1),
      insert: () => this.insertAfter(this.selected),
      delete: () => this.remove(this.selected),
      fly: () => this.selected >= 0 && this.hooks.flyFrom(this.selected),
      view: () => this.selected >= 0 && this.hooks.view(this.handles[this.selected].position.clone()),
      undo: () => this.undo(),
      redo: () => this.redo(),
      revert: () => this.revert(),
      save: () => void this.save(),
      copy: () => void this.copy(),
      download: () => this.download(),
    };
    el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
      if (b) actions[b.dataset.a!]?.();
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
      if (row) this.select(Number(row.dataset.i));
    });
    el.addEventListener('dblclick', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
      if (row) this.hooks.view(this.handles[Number(row.dataset.i)].position.clone());
    });
    el.querySelectorAll<HTMLInputElement>('[data-f]').forEach((input) => {
      const axis = Number(input.dataset.f);
      input.addEventListener('input', () => this.selected >= 0 && this.setWaypoint(this.selected, axis, input.valueAsNumber, false));
      input.addEventListener('change', () => this.selected >= 0 && this.setWaypoint(this.selected, axis, input.valueAsNumber, true));
    });
    (ui.name as HTMLInputElement).addEventListener('change', (e) => this.selected >= 0 && this.rename(this.selected, (e.target as HTMLInputElement).value));
    (ui.through as HTMLInputElement).addEventListener('change', (e) => this.selected >= 0 && this.setThrough(this.selected, (e.target as HTMLInputElement).checked));
    // Enter commits a field and hands the keys back to flying.
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target instanceof HTMLInputElement) e.target.blur();
    });
    return el;
  }

  private step(by: number) {
    const n = this.handles.length;
    this.select(this.selected < 0 ? (by > 0 ? 0 : n - 1) : (this.selected + by + n) % n);
  }

  private setStatus(s: string) {
    this.status = s;
    this.renderPanel();
  }

  private renderPanel() {
    if (!this.ui || this.panel.hidden) return;
    const { ui } = this;
    const d = this.host.routeData;
    const s = this.samples;
    const names = this.namesByIndex();
    const m = Math.floor(s.duration / 60);
    ui.summary.textContent = `${d.waypoints.length} points · ${(s.length / 1000).toFixed(2)} km · ${m} min ${Math.round(s.duration - m * 60)} s${this.dirty ? ' · unsaved' : ''}`;

    const legIssues = new Set(s.problems.map((p) => Number(/leg (\d+)/.exec(p.where)?.[1])));
    ui.list.innerHTML = d.waypoints
      .map(
        (w, i) =>
          `<div data-i="${i}" role="option" aria-selected="${i === this.selected}"${i === this.selected ? ' class="sel"' : ''}>` +
          `<span>${i}</span><span>${names[i] ?? ''}${d.through.includes(i) ? ' ⇢' : ''}</span>` +
          `<span>${w.slice(0, 3).map(round).join(' ')}</span><span>${round(w[3])}</span><span>${legIssues.has(i) ? '⚠' : ''}</span></div>`,
      )
      .join('');
    ui.list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });

    const i = this.selected;
    ui.edit.hidden = i < 0;
    if (i >= 0) {
      const w = d.waypoints[i];
      ui.title.textContent = `Waypoint ${i}${names[i] ? ` · ${names[i]}` : ''}`;
      this.panel.querySelectorAll<HTMLInputElement>('[data-f]').forEach((input) => {
        if (document.activeElement !== input) input.value = String(round(w[Number(input.dataset.f)]));
      });
      const name = ui.name as HTMLInputElement;
      if (document.activeElement !== name) name.value = Object.entries(d.named).find(([, v]) => v === i)?.[0] ?? '';
      (ui.through as HTMLInputElement).checked = d.through.includes(i);
    }

    const lowest = s.lowest.margin;
    ui.issues.innerHTML =
      s.problems.map((p) => `<li>${p.where.replace('route ', '')}: ${p.what}</li>`).join('') ||
      `<li class="ok">No route problems. Lowest point is ${lowest.toFixed(1)} m above the clearance floor (leg ${s.lowest.leg}).</li>`;
    ui.status.textContent = this.status;
  }

  private onKey(e: KeyboardEvent) {
    if (!this.active || isTyping(e)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.code === 'KeyZ') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
    } else if (mod && e.code === 'KeyY') {
      e.preventDefault();
      this.redo();
    } else if (mod && e.code === 'KeyS') {
      e.preventDefault();
      void this.save();
    } else if (mod || e.altKey) {
      return;
    } else if (e.code === 'BracketLeft') this.step(-1);
    else if (e.code === 'BracketRight') this.step(1);
    else if (e.code === 'KeyI') this.insertAfter(this.selected);
    else if ((e.code === 'Delete' || e.code === 'Backspace') && this.selected >= 0) this.remove(this.selected);
    else if (e.code === 'KeyJ' && this.selected >= 0) this.hooks.flyFrom(this.selected);
    else if (e.code === 'Escape') this.select(-1);
  }
}

