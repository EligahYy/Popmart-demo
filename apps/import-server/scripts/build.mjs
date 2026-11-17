import { fileURLToPath } from 'node:url';
import { rm, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

// A Vercel service may ship only this output directory. Bundle runtime packages
// as well as workspace code so the artifact never needs source node_modules.
await rm(new URL('../dist', import.meta.url), { recursive: true, force: true });
await build({
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  entryPoints: ['src/server.ts'],
  // Vercel can flatten this directory without the parent package.json.
  // .mjs retains ESM semantics even in that standalone layout.
  outfile: 'dist/server.mjs',
  bundle: true,
  banner: { js: `// Bundled from 'fastify'; keep framework discovery available for the standalone artifact.
import { createRequire as __runtime_createRequire } from 'node:module';
import { fileURLToPath as __runtime_fileURLToPath } from 'node:url';
import { dirname as __runtime_dirname } from 'node:path';
const require = __runtime_createRequire(import.meta.url);
const __filename = __runtime_fileURLToPath(import.meta.url);
const __dirname = __runtime_dirname(__filename);` },
  alias: {
    '@my-popmart/contracts': fileURLToPath(new URL('../../../packages/contracts/src/index.ts', import.meta.url)),
  },
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
});

// Keep module semantics inside the output itself, including runtimes that
// normalize the entry filename to server.js while flattening the deployment.
await writeFile(new URL('../dist/package.json', import.meta.url), JSON.stringify({
  name: '@my-popmart/import-server-runtime', private: true, type: 'module',
}, null, 2) + '\n');
