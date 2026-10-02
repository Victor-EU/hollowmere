// The production build, served the way a static host would: gzip for text and WebAssembly, over
// HTTP/1.1. Shared by the tools that judge what visitors get (load time, accessibility) rather than
// the dev server's unbundled modules.

import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { createGzip } from 'node:zlib';
import { build } from 'vite';

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ktx2': 'image/ktx2',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
};
/** What GitHub Pages and Cloudflare compress; KTX2, images and audio are compressed already. */
const GZIP = new Set(['.html', '.js', '.css', '.json', '.txt', '.svg', '.wasm']);

export interface Site {
  /** Ends in a slash. */
  url: string;
  close(): void;
}

/** Builds the site into a temporary folder and serves it on a free port until closed. */
export async function buildAndServe(): Promise<Site> {
  const root = resolve(import.meta.dirname, '..');
  const dir = mkdtempSync(join(tmpdir(), 'hollowmere-site-'));
  await build({ root, logLevel: 'error', build: { outDir: dir, emptyOutDir: true } });
  const server = createServer((req, res) => {
    let path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
    if (path.endsWith('/')) path += 'index.html';
    const file = join(dir, path);
    if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    const ext = extname(file);
    const gzip = GZIP.has(ext) && /\bgzip\b/.test(String(req.headers['accept-encoding']));
    res.writeHead(200, { 'content-type': TYPES[ext] ?? 'application/octet-stream', ...(gzip ? { 'content-encoding': 'gzip' } : { 'content-length': statSync(file).size }) });
    const body = createReadStream(file);
    (gzip ? body.pipe(createGzip({ level: 9 })) : body).pipe(res);
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
    close() {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
