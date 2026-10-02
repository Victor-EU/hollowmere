// Dev server only: lets the in-app route editor write data/route.json.
//
//   POST /__hollowmere/data/route.json   body: the formatted file
//
// The write doesn't trigger a page reload, because the editor already has the new route live.

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

type Check = (data: Record<string, unknown>) => string | null;

const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const isIndex = (v: unknown, n: number) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < n;

const checks: Record<string, Check> = {
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
        if (req.method !== 'POST' || !check) return reply(404, 'Only POST to route.json is supported');
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
          const problem = check(data);
          if (problem) return reply(400, `data/${name}: ${problem}`);
          const file = resolve(root, 'data', name);
          written.set(file, Date.now());
          writeFileSync(file, body.endsWith('\n') ? body : `${body}\n`);
          server.config.logger.info(`  wrote data/${name} from the route editor`, { timestamp: true });
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
