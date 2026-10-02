import './dev.css';
import type { DevHost, DevTools } from './types';

/** Design doc §8 budgets. */
const BUDGET = { calls: 300, triangles: 1_500_000 };

export interface FrameStats {
  fps: number;
  /** Mean frame interval, CPU time in the frame, and GPU time when the timer query exists. */
  ms: number;
  cpu: number;
  gpu: number | null;
  calls: number;
  triangles: number;
  points: number;
  lines: number;
}

interface GpuTimer {
  begin(): void;
  end(): void;
  /** Most recent finished measurement, ms. */
  ms: number | null;
}

/** GPU time per frame from EXT_disjoint_timer_query_webgl2, read a few frames late. */
function makeGpuTimer(gl: WebGL2RenderingContext): GpuTimer | null {
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  if (!ext) return null;
  const pending: WebGLQuery[] = [];
  const free: WebGLQuery[] = [];
  let active: WebGLQuery | null = null;
  const timer: GpuTimer = {
    ms: null,
    begin() {
      while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
        const q = pending.shift()!;
        const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
        if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) timer.ms = ns / 1e6;
        free.push(q);
      }
      if (pending.length > 5) return;
      active = free.pop() ?? gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, active);
    },
    end() {
      if (!active) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push(active);
      active = null;
    },
  };
  return timer;
}

const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`);
const f1 = (n: number) => n.toFixed(1);

export interface Stats {
  readonly el: HTMLElement;
  /** The last frame's numbers, smoothed over the display window. */
  readonly frame: FrameStats;
  visible: boolean;
  begin(now: number): void;
  end(): void;
}

/**
 * Frame time, GPU time, draw calls and triangles against the design budgets, memory, resolution,
 * and where the ghost is. `extra` adds rows (dev flags, geometry check status).
 */
export function makeStats(host: DevHost, parent: HTMLElement, extra: () => string = () => ''): Stats {
  const { renderer } = host;
  // The composer renders several times a frame; count the whole frame.
  renderer.info.autoReset = false;
  const gpu = makeGpuTimer(renderer.getContext() as WebGL2RenderingContext);

  const el = document.createElement('section');
  el.className = 'dev-panel dev-stats';
  el.setAttribute('aria-label', 'Frame statistics');
  const text = document.createElement('div');
  const graph = document.createElement('canvas');
  graph.width = 240;
  graph.height = 44;
  el.append(graph, text);
  parent.prepend(el);
  const g2 = graph.getContext('2d')!;

  const history = new Float32Array(120);
  let head = 0;
  let start = 0;
  let last = 0;
  // Accumulated over the display window.
  let n = 0;
  let sumMs = 0;
  let sumCpu = 0;
  let sumGpu = 0;
  let nGpu = 0;
  let windowStart = performance.now();
  const frame: FrameStats = { fps: 0, ms: 0, cpu: 0, gpu: null, calls: 0, triangles: 0, points: 0, lines: 0 };
  let visible = false;

  function draw() {
    const w = graph.width;
    const h = graph.height;
    g2.clearRect(0, 0, w, h);
    const y = (ms: number) => h - Math.min(ms, 50) * (h / 50);
    g2.fillStyle = 'rgba(235,224,200,.12)';
    g2.fillRect(0, y(16.7), w, 1);
    g2.fillRect(0, y(33.3), w, 1);
    const bw = w / history.length;
    for (let i = 0; i < history.length; i++) {
      const ms = history[(head + i) % history.length];
      if (!ms) continue;
      g2.fillStyle = ms > 33.4 ? '#e2574c' : ms > 17.5 ? '#f2a65a' : '#8fb7a0';
      g2.fillRect(i * bw, y(ms), Math.max(1, bw - 0.5), h - y(ms));
    }
  }

  function render() {
    const info = renderer.info;
    const { flight } = host;
    const q = host.quality();
    const A = flight.auto;
    const buf = renderer.domElement;
    const over = (v: number, b: number) => (v > b ? ' class="over"' : '');
    const progs = info.programs?.length ?? 0;
    text.innerHTML = [
      `<b>${Math.round(frame.fps)}</b> fps · ${f1(frame.ms)} ms · cpu ${f1(frame.cpu)} · gpu ${frame.gpu == null ? 'n/a' : f1(frame.gpu)}`,
      `draws <span${over(frame.calls, BUDGET.calls)}>${frame.calls}</span> / ${BUDGET.calls} · tris <span${over(frame.triangles, BUDGET.triangles)}>${fmt(frame.triangles)}</span> / 1.5M`,
      `points ${fmt(frame.points)} · geoms ${info.memory.geometries} · tex ${info.memory.textures} · progs ${progs}`,
      `${q.name}${q.pinned ? ' (pinned)' : ''} · buffer ${buf.width}×${buf.height} @${q.dpr.toFixed(2)} · ${(q.streamed / 1048576).toFixed(1)} MB streamed`,
      q.log.length ? `<span class="dim">${q.log.at(-1)}</span>` : '',
      `ghost ${f1(flight.pos.x)} ${f1(flight.pos.y)} ${f1(flight.pos.z)} · ${f1(flight.vel.length())} m/s`,
      `autofly ${A.enabled ? (A.override ? `waiting ${flight.returnsIn} s` : 'on') : 'off'} · w ${A.w.toFixed(2)} · t ${A.t.toFixed(3)} (wp ${(A.t * host.route.count).toFixed(1)})`,
      `${flight.where ? `in ${flight.where} · ` : ''}zone ${host.zoneLabel() ?? '—'}`,
      extra(),
    ]
      .filter(Boolean)
      .join('<br>');
    draw();
  }

  return {
    el,
    frame,
    get visible() {
      return visible;
    },
    set visible(v: boolean) {
      visible = v;
      el.hidden = !v;
      if (v) render();
    },
    begin(now) {
      if (last) {
        const ms = now - last;
        history[head] = ms;
        head = (head + 1) % history.length;
        sumMs += ms;
        n++;
      }
      last = now;
      start = performance.now();
      renderer.info.reset();
      gpu?.begin();
    },
    end() {
      gpu?.end();
      sumCpu += performance.now() - start;
      if (gpu?.ms != null) {
        sumGpu += gpu.ms;
        nGpu++;
      }
      const r = renderer.info.render;
      frame.calls = r.calls;
      frame.triangles = r.triangles;
      frame.points = r.points;
      frame.lines = r.lines;
      const now = performance.now();
      if (now - windowStart < 250 || !n) return;
      frame.ms = sumMs / n;
      frame.fps = 1000 / frame.ms;
      frame.cpu = sumCpu / n;
      frame.gpu = nGpu ? sumGpu / nGpu : null;
      n = nGpu = 0;
      sumMs = sumCpu = sumGpu = 0;
      windowStart = now;
      if (visible) render();
    },
  };
}

/** Production builds with ?stats: just the overlay, for checking performance on real devices. */
export function statsOnly(host: DevHost): DevTools {
  const dock = document.createElement('div');
  dock.className = 'dev-dock';
  document.body.append(dock);
  const stats = makeStats(host, dock);
  stats.visible = true;
  return {
    begin: (now) => stats.begin(now),
    worldDt: (dt) => dt,
    steer: (input) => input,
    update: () => {},
    end: () => stats.end(),
  };
}
