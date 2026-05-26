import { defineConfig } from 'tsdown';

import { rawTextPlugin } from '../build/raw-text-plugin.mjs';

export default defineConfig([
  {
    entry: ['src/main/index.ts'],
    outDir: 'dist/main',
    format: 'esm',
    platform: 'node',
    noExternal: [/^@moonshot-ai\//],
    external: ['electron'],
    clean: true,
    plugins: [rawTextPlugin()],
  },
  {
    entry: ['src/preload/index.ts'],
    outDir: 'dist/preload',
    format: 'cjs',
    platform: 'node',
    external: ['electron'],
    clean: true,
  },
]);
