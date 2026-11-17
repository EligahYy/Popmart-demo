import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Bundle workspace TypeScript as executable JS; keep runtime packages traceable
// by Vercel. This avoids depending on Vercel's TS language-service resolution
// of source-only workspace packages and browser/database type declarations.
await build({
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  entryPoints: ['src/server.ts'],
  outfile: 'dist/server.js',
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
