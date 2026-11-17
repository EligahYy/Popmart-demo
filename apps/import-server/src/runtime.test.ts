import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('production dependency compatibility', () => {
  it('loads the static plugin without CommonJS-to-ESM require support', () => {
    // Vercel's loader rejected @fastify/static 10 -> content-disposition 3
    // with ERR_REQUIRE_ESM, even though local Node accepted that dependency.
    const result = spawnSync(process.execPath, [
      '--no-experimental-require-module',
      '--input-type=module',
      '--eval',
      `await import(${JSON.stringify(import.meta.resolve('@fastify/static'))});`,
    ], { encoding: 'utf8', timeout: 10_000 });

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  });
});
