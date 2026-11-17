import { fileURLToPath } from 'node:url';
import { rm } from 'node:fs/promises';
import { build } from 'esbuild';

// Bundle workspace TypeScript as executable JS; keep runtime packages traceable
// by Vercel. This avoids depending on Vercel's TS language-service resolution
// of source-only workspace packages and browser/database type declarations.
await rm(new URL('../dist', import.meta.url), { recursive: true, force: true });
await build({
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  entryPoints: ['src/server.ts'],
  // Vercel can flatten this directory without the parent package.json.
  // .mjs retains ESM semantics even in that standalone layout.
  outfile: 'dist/server.mjs',
  bundle: true,
  packages: 'external',
  alias: {
    '@my-popmart/contracts': fileURLToPath(new URL('../../../packages/contracts/src/index.ts', import.meta.url)),
  },
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
});
