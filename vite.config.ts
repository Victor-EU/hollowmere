import { defineConfig } from 'vite';
import { devData } from './tools/vite-dev-data.ts';
import { site } from './tools/vite-site.ts';

export default defineConfig({
  base: './',
  plugins: [devData(), site()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: Number(process.env.PORT) || 5173,
  },
});
