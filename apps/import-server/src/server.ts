import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './buildApp.js';
import aliases from '../data/aliases.zh.json' with { type: 'json' };

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';
const signingSecret = process.env.IMPORT_SIGNING_SECRET ?? 'dev-secret-change-me';

const staticDir =
  process.env.VERCEL ? undefined :
    process.env.STATIC_DIR ?? fileURLToPath(new URL('../../web/dist', import.meta.url));

const app: FastifyInstance = buildApp({ signingSecret, aliases, logger: true, ...(staticDir ? { staticDir } : {}) });

// Vercel 的 Fastify 运行时通过拦截 listen() 获取 Node HTTP server。
// 生产环境也必须调用；导出 Fastify 实例不能替代这个启动步骤。
app.listen({ port, host }).catch((error: unknown) => {
  app.log.error(error);
  process.exit(1);
});
