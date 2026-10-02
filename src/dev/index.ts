import type { FlightInput } from '../flight/flight';
import { isTyping } from '../ui/input';
import { checkData, GeometryWatch, type Problem } from './checks';
import { FreeCam } from './freecam';
import { RouteEditor } from './routeEditor';
import { makeStats, type FrameStats } from './stats';
import type { DevHost, DevTools } from './types';

const PREFS = 'hollowmere:dev';
const SESSION = 'hollowmere:dev-session';
const KEYS = '` stats · V free camera · R route editor · T pause · . step · G ghost here · K checks';

export interface DevReport {
  problems: Problem[];
  geometry: GeometryWatch['stats'];
  route: { length: number; duration: number; lowestMargin: number };
  frame: FrameStats;
}

export interface Dev extends DevTools {
  /** Re-scan everything and return every problem found so far. */
  report(): DevReport;
  readonly frame: FrameStats;
}

function read<T>(storage: () => Storage, key: string, fallback: T): T {
  try {
    return { ...fallback, ...JSON.parse(storage().getItem(key) ?? '{}') };
  } catch {
    return fallback;
  }
}
function write(storage: () => Storage, key: string, value: unknown) {
  try {
    storage().setItem(key, JSON.stringify(value));
  } catch {
    // Not remembered; fine for dev conveniences.
  }
}

function log(problems: Problem[], title: string) {
  if (!problems.length) return;
  const errors = problems.filter((p) => p.level === 'error');
  const lines = problems.map((p) => `${p.level === 'error' ? '✗' : '!'} ${p.where}: ${p.what}`).join('\n');
  if (errors.length) console.error(`${title}: ${errors.length} error(s)\n${lines}`);
  else console.warn(`${title}: ${problems.length} warning(s)\n${lines}`);
}

/**
 * Dev builds only: stats overlay, free camera, route editor, pause and step, and geometry checks
 * that run before the first frame and then every half second over anything that changed.
 */
export function installDev(host: DevHost): Dev {
  const { flight, hud, input, scene } = host;
  const prefs = read(() => localStorage, PREFS, { stats: false });
  const session = read(() => sessionStorage, SESSION, { editor: false, editorFreecam: false });

  const dock = document.createElement('div');
  dock.className = 'dev-dock';
  document.body.append(dock);
  const badge = document.createElement('button');
  badge.className = 'dev-badge';
  badge.hidden = true;
  badge.addEventListener('click', () => setStats(true));
  document.body.append(badge);

  const watch = new GeometryWatch();
  const freecam = new FreeCam(host.camera);
  const dataProblems = checkData(host.world, host.routeData, host.zones);
  let routeProblems: Problem[] = [];
  let paused = false;
  let stepOnce = false;
  let frames = 0;
  // Whether opening the editor switched the free camera on, so closing it switches it back.
  let editorFreecam = session.editorFreecam;

  const all = () => [...dataProblems, ...routeProblems, ...watch.problems];
  const count = (level: Problem['level']) => all().filter((p) => p.level === level).length;
  function refreshBadge() {
    const errors = count('error');
    badge.hidden = stats.visible || !errors;
    badge.textContent = `⚠ ${errors} check error${errors === 1 ? '' : 's'} · press \` for details`;
  }

  const stats = makeStats(host, dock, () => {
    const modes = [paused && 'paused', freecam.active && `free camera ${Math.round(freecam.speed)} m/s`, editor.active && 'route editor'].filter(Boolean);
    const errors = count('error');
    const warns = count('warn');
    const g = watch.stats;
    return [
      modes.length ? `<span class="dev-mode">${modes.join(' · ')}</span>` : '',
      `checks <span${errors ? ' class="over"' : ''}>${errors} errors</span> · ${warns} warnings · ${g.geometries} geometries, ${(g.vertices / 1e6).toFixed(2)}M verts`,
      `<span class="keys">${KEYS}</span>`,
    ]
      .filter(Boolean)
      .join('<br>');
  });

  const editor = new RouteEditor(host, dock, {
    flyFrom(i) {
      setFreecam(false);
      const A = flight.auto;
      flight.jump(host.route.tAt(i));
      if (!A.enabled) hud.setAuto(flight.toggleAuto());
      A.override = false;
      A.idle = 0;
      A.t = host.route.tAt(i);
    },
    view(p) {
      freecam.frame(p);
    },
    onProblems(p) {
      routeProblems = p;
      refreshBadge();
    },
  });

  function setStats(on: boolean) {
    stats.visible = on;
    write(() => localStorage, PREFS, { stats: on });
    refreshBadge();
  }
  function setFreecam(on: boolean) {
    if (on === freecam.active) return;
    if (on) freecam.enter();
    else freecam.exit();
  }
  function setEditor(on: boolean) {
    if (on === editor.active) return;
    if (on) {
      editor.open();
      editorFreecam = !freecam.active;
      setFreecam(true);
    } else {
      editor.close();
      if (editorFreecam) setFreecam(false);
      editorFreecam = false;
    }
    write(() => sessionStorage, SESSION, { editor: on, editorFreecam });
  }
  /** Drop the ghost in front of the free camera and hand it over, as if the player had flown there. */
  function ghostHere() {
    if (!freecam.active) return;
    const [yaw, pitch] = freecam.heading;
    flight.place(freecam.ahead(14), yaw, pitch);
    const A = flight.auto;
    A.override = A.enabled;
    A.idle = 0;
    A.w = 0;
    setFreecam(false);
  }
  function fullCheck() {
    const fresh = watch.scan(scene, true);
    log(fresh, 'Geometry check');
    log([...dataProblems, ...routeProblems], 'Data check');
    if (!fresh.length && !dataProblems.length && !routeProblems.length) console.info('Hollowmere checks: all clear');
    refreshBadge();
  }

  addEventListener('keydown', (e) => {
    if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    const actions: Record<string, () => void> = {
      Backquote: () => setStats(!stats.visible),
      KeyV: () => setFreecam(!freecam.active),
      KeyR: () => setEditor(!editor.active),
      KeyT: () => (paused = !paused),
      Period: () => {
        paused = true;
        stepOnce = true;
      },
      KeyG: ghostHere,
      KeyK: fullCheck,
    };
    actions[e.code]?.();
  });
  addEventListener('pagehide', () => freecam.active && freecam.save());

  input.hooks.claimPointer = (e) => editor.claimPointer(e);
  input.hooks.claimWheel = (e) => {
    if (!freecam.active) return false;
    freecam.wheel(e);
    return true;
  };

  // Before the first frame, so anything non-finite is reported before it reaches the GPU.
  log(watch.scan(scene, true), 'Geometry check');
  log([...dataProblems, ...routeProblems], 'Data check');
  stats.visible = prefs.stats || new URLSearchParams(location.search).has('stats');
  if (freecam.restore() && session.editor) {
    editor.open();
  } else if (session.editor) setEditor(true);
  refreshBadge();

  const idle: FlightInput = { forward: 0, strafe: 0, rise: 0, boost: false, lookDX: 0, lookDY: 0, zoom: 1 };
  return {
    frame: stats.frame,
    begin: (now) => stats.begin(now),
    worldDt(dt) {
      if (!paused) return dt;
      if (!stepOnce) return 0;
      stepOnce = false;
      return 1 / 60;
    },
    steer(raw) {
      if (!freecam.active) return raw;
      freecam.steer(raw);
      idle.zoom = raw.zoom;
      return idle;
    },
    update(dt) {
      if (freecam.active) freecam.update(dt);
      editor.update();
      if (++frames % 30 === 0) {
        const fresh = watch.scan(scene);
        if (fresh.length) {
          log(fresh, 'Geometry check');
          refreshBadge();
        }
      }
    },
    end: () => stats.end(),
    report() {
      watch.scan(scene, true);
      const s = editor.samples;
      return {
        problems: all(),
        geometry: watch.stats,
        route: { length: s.length, duration: s.duration, lowestMargin: s.lowest.margin },
        frame: { ...stats.frame },
      };
    },
  };
}
