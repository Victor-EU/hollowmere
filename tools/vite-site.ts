// What the site carries besides the app: `licenses.txt`, which the build writes next to the page and
// the dev server serves (the Controls list links to it), and, when SITE_URL is set (the deploy
// workflow sets it), the tags that give a shared link its title, description and picture.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { HtmlTagDescriptor, Plugin } from 'vite';

const root = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8').trim();
const heading = (title: string) => `${title}\n${'='.repeat(title.length)}`;
const REPO = 'https://github.com/Victor-EU/hollowmere';
const DESCRIPTION = 'Drift as a ghost through a haunted castle above a moonlit lake.';

/** Credits, Hollowmere's own licenses, then the full text of every third-party license the site ships. */
export function licensesText(): string {
  return `${[
    heading('Hollowmere'),
    `By Victor Zhang, with Claude. Source and history: ${REPO}`,
    'Hollowmere, its code, textures and music alike, is under the MIT License, below.',
    [
      'Type: IM Fell English SC by Igino Marini, and Alegreya Sans by Juan Pablo del Peral (Huerta',
      'Tipográfica), both under the SIL Open Font License 1.1 and served by Google Fonts.',
    ].join('\n'),
    read('LICENSE'),
    heading('Third-party code in this site'),
    `three.js (https://github.com/mrdoob/three.js)\n\n${read('node_modules/three/LICENSE')}`,
    `zstddec, with the Zstandard decoder it compiles (https://github.com/donmccurdy/zstddec)\n\n${read('licenses/zstddec.txt')}`,
    read('licenses/basis-universal.txt'),
  ].join('\n\n\n')}\n`;
}

export function site(): Plugin {
  return {
    name: 'hollowmere-site',
    configureServer(server) {
      server.middlewares.use('/licenses.txt', (_req, res) => {
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        res.end(licensesText());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'licenses.txt', source: licensesText() });
    },
    transformIndexHtml(): HtmlTagDescriptor[] {
      const at = process.env.SITE_URL;
      if (!at) return [];
      const url = at.endsWith('/') ? at : `${at}/`;
      const meta = (attrs: Record<string, string>): HtmlTagDescriptor => ({ tag: 'meta', attrs, injectTo: 'head' });
      return [
        { tag: 'link', attrs: { rel: 'canonical', href: url }, injectTo: 'head' },
        meta({ property: 'og:type', content: 'website' }),
        meta({ property: 'og:site_name', content: 'Hollowmere' }),
        meta({ property: 'og:title', content: 'Hollowmere' }),
        meta({ property: 'og:description', content: DESCRIPTION }),
        meta({ property: 'og:url', content: url }),
        meta({ property: 'og:image', content: `${url}social.jpg` }),
        meta({ property: 'og:image:width', content: '1200' }),
        meta({ property: 'og:image:height', content: '630' }),
        meta({ property: 'og:image:alt', content: 'A castle on a cliff above a moonlit lake, lit windows reflected in the water, a dragon over its spires and a ghost drifting toward it' }),
        meta({ name: 'twitter:card', content: 'summary_large_image' }),
      ];
    },
  };
}
