// Dev server only: lets the in-app route editor and look panel write their data files.
//
//   POST /__hollowmere/data/route.json   body: the formatted file
//   POST /__hollowmere/data/look.json
//
// The write doesn't trigger a page reload, because the app already has the new data live.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

type Check = (data: Record<string, unknown>, file: string) => string | null;

const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const isIndex = (v: unknown, n: number) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < n;

/** Where `data` differs in shape from `ref`: keys, value types, array lengths; numbers must be finite. */
function shapeProblem(data: unknown, ref: unknown, path: string): string | null {
  if (typeof ref === 'number') return isNum(data) ? null : `${path} must be a finite number`;
  if (typeof ref === 'string') return typeof data === 'string' ? null : `${path} must be a string`;
  if (Array.isArray(ref)) {
    if (!Array.isArray(data) || data.length !== ref.length) return `${path} must be an array of ${ref.length}`;
    for (let i = 0; i < ref.length; i++) {
      const p = shapeProblem(data[i], ref[i], `${path}[${i}]`);
      if (p) return p;
    }
    return null;
  }
  if (typeof ref === 'object' && ref) {
    if (typeof data !== 'object' || !data || Array.isArray(data)) return `${path} must be an object`;
    const keys = Object.keys(ref);
    const extra = Object.keys(data).find((k) => !keys.includes(k));
    if (extra) return `unexpected key ${path}.${extra}`;
    for (const k of keys) {
      const p = shapeProblem((data as Record<string, unknown>)[k], (ref as Record<string, unknown>)[k], `${path}.${k}`);
      if (p) return p;
    }
    return null;
  }
  return null;
}

const checks: Record<string, Check> = {
  'look.json'(d, file) {
    // Same keys and types as the file on disk: the panel tunes values, it doesn't add any.
    return shapeProblem(d, JSON.parse(readFileSync(file, 'utf8')), 'look');
  },
  'route.json'(d) {
    const w = d.waypoints;
    if (d.closed !== true) return '"closed" must be true';
    if (!Array.isArray(w) || w.length < 4) return 'needs at least 4 waypoints';
    if (!w.every((p) => Array.isArray(p) && p.length === 4 && p.every(isNum) && p[3] > 0)) return 'every waypoint must be [x, y, z, speed > 0]';
    if (!Array.isArray(d.through) || !d.through.every((i) => isIndex(i, w.length))) return '"through" must list waypoint indices';
    const named = d.named as Record<string, unknown> | undefined;
    if (!named || typeof named !== 'object' || !Object.values(named).every((i) => isIndex(i, w.length))) return '"named" must map names to waypoint indices';
    return null;
  },
};

export function devData(): Plugin {
  let root = process.cwd();
  /** Files this plugin just wrote, and when; their change events are ours, not edits to reload for. */
  const written = new Map<string, number>();
  return {
    name: 'hollowmere-dev-data',
    apply: 'serve',
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      server.middlewares.use('/__hollowmere/data/', (req, res) => {
        const name = (req.url ?? '').replace(/^\//, '').split('?')[0];
        const check = checks[name];
        const reply = (code: number, text: string) => {
          res.statusCode = code;
          res.setHeader('content-type', 'text/plain');
          res.end(text);
        };
        if (req.method !== 'POST' || !check) return reply(404, `Only POST to ${Object.keys(checks).join(' or ')} is supported`);
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (chunk: string) => {
          body += chunk;
          if (body.length > 1e6) req.destroy();
        });
        req.on('end', () => {
          let data: Record<string, unknown>;
          try {
            data = JSON.parse(body);
          } catch (err) {
            return reply(400, `Not JSON: ${(err as Error).message}`);
          }
          const file = resolve(root, 'data', name);
          const problem = check(data, file);
          if (problem) return reply(400, `data/${name}: ${problem}`);
          written.set(file, Date.now());
          writeFileSync(file, body.endsWith('\n') ? body : `${body}\n`);
          server.config.logger.info(`  wrote data/${name} from the dev tools`, { timestamp: true });
          reply(200, 'saved');
        });
      });
    },
    handleHotUpdate({ file }) {
      const at = written.get(file);
      if (at && Date.now() - at < 2000) {
        written.delete(file);
        return [];
      }
    },
  };
}
