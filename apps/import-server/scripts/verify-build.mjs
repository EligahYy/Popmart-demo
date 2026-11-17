import { execFileSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Reproduce Vercel's flattened layout: no parent package.json, source files,
// or data directory. Use the actual emitted artifact and native Node loader.
const directory = mkdtempSync(join(tmpdir(), 'popmart-deployment-'));
try {
  copyFileSync(new URL('../dist/server.mjs', import.meta.url), join(directory, 'server.mjs'));
  symlinkSync(fileURLToPath(new URL('../node_modules', import.meta.url)), join(directory, 'node_modules'), 'dir');
  writeFileSync(join(directory, 'check.mjs'), `
import assert from 'node:assert/strict';
import { Server } from 'node:http';
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => String(url).startsWith('https://www.popmart.com/')
  ? new Response('<urlset/>') : nativeFetch(url, options);
const original = Server.prototype.listen;
let captured;
Server.prototype.listen = function () { captured = this; Server.prototype.listen = original; return this; };
try {
  await import('./server.mjs');
  const end = Date.now() + 1500;
  while (!captured && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(captured, 'Vercel must capture a server during import');
} finally { Server.prototype.listen = original; }
await new Promise(resolve => original.call(captured, 0, '127.0.0.1', resolve));
try {
  const base = 'http://127.0.0.1:' + captured.address().port;
  assert.equal((await nativeFetch(base + '/api/health')).status, 200);
  const search = await nativeFetch(base + '/api/import/search', {
    method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({query:'好好生活'}),
  });
  assert.equal(search.status, 200);
  assert.equal((await search.json()).candidates[0].canonicalKey, 'popmart:ca:9120');
  console.log('PASS: flattened ESM artifact starts and retains embedded search aliases');
} finally { await new Promise(resolve => captured.close(resolve)); }
`);
  const env = { ...process.env, NODE_ENV: 'production', VERCEL: '1' };
  for (const key of ['DATABASE_URL', 'POSTGRES_URL', 'NEON_DATABASE_URL']) delete env[key];
  execFileSync(process.execPath, ['--no-experimental-require-module', join(directory, 'check.mjs')], { env, stdio: 'inherit', timeout: 15000 });
} finally { rmSync(directory, { recursive: true, force: true }); }
