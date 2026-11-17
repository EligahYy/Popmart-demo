import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { z } from 'zod';
import { ImportError, PARSER_VERSION, createPopmartProvider, type AliasEntry } from './providers/popmart.js';
import { createNeonStore, type SharedStore } from './shared/store.js';
import { registerSharedRoutes } from './shared/routes.js';

export interface BuildAppOptions {
  readonly signingSecret?: string;
  readonly fetchImpl?: typeof fetch;
  readonly aliasesPath?: string;
  readonly aliases?: readonly AliasEntry[];
  readonly now?: () => number;
  readonly logger?: boolean;
  readonly staticDir?: string;
  readonly sharedStore?: SharedStore;
  readonly dataMode?: 'local' | 'shared';
}

const resolveBody = z.object({ input: z.string().min(1).max(2048) });
const searchBody = z.object({ query: z.string().min(1).max(200) });
const previewBody = z.object({ candidateId: z.string().min(10).max(8192) });
const imageQuery = z.object({
  src: z.string().min(1).max(2048),
  w: z.enum(['384', '768']).optional(),
});

function sendError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof ImportError) {
    const status = error.code === 'INVALID_INPUT' ? 400 : error.code === 'TOKEN_INVALID' ? 400 : 422;
    return reply.code(status).send({
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    });
  }
  return reply.code(500).send({
    code: 'INTERNAL' as const,
    message: '导入服务内部错误',
    retryable: true,
  });
}

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data: https://prod-global-biz.popmart.com https://global-static.popmart.com https://prod-america-res.popmart.com https://cdn-global-naus.popmart.com",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    routerOptions: { maxParamLength: 4096 },
  });
  const signingSecret = options.signingSecret ?? 'dev-secret-change-me';
  const databaseUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? process.env.NEON_DATABASE_URL;
  const store = options.sharedStore ?? (databaseUrl ? createNeonStore(databaseUrl, process.env.SHARED_SPACE_ID ?? 'public') : undefined);
  registerSharedRoutes(app, store, options.dataMode ?? (process.env.DATA_MODE === 'local' ? 'local' : 'shared'));
  const provider = createPopmartProvider({
    signingSecret,
    ...(options.aliases ? { aliases: options.aliases } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.aliasesPath ? { aliasesPath: options.aliasesPath } : {}),
    ...(options.now ? { now: options.now } : {}),
  });

  const hasStatic = Boolean(options.staticDir && existsSync(options.staticDir));
  if (hasStatic && options.staticDir) {
    app.register(fastifyStatic, {
      root: options.staticDir,
      wildcard: false,
      index: ['index.html'],
    });

    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/') || /\.[a-z0-9]+$/i.test(request.url)) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: '资源不存在', retryable: false });
      }
      return reply.sendFile('index.html');
    });
  }

  app.addHook('onSend', async (_request, reply, payload) => {
    const contentType = String(reply.getHeader('content-type') ?? '');
    if (contentType.includes('text/html') || _request.url.endsWith('/sw.js')) {
      reply.header('cache-control', 'no-cache, no-store, must-revalidate');
    }
    if (contentType.includes('text/html')) {
      reply.header('content-security-policy', CONTENT_SECURITY_POLICY);
      reply.header('x-content-type-options', 'nosniff');
      reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    }
    return payload;
  });

  app.get('/api/health', async () => ({ status: 'ok', parserVersion: PARSER_VERSION }));

  app.post('/api/import/resolve', async (request, reply) => {
    const parsed = resolveBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: 'INVALID_INPUT', message: '链接格式不正确', retryable: false });
    }

    const kind = provider.classify(parsed.data.input);
    if (kind === 'miniapp_text') {
      return reply.send({
        status: 'needs_name',
        reason: '小程序分享码无法直接解析，请输入系列名称',
      });
    }

    try {
      const candidates = await provider.resolve(parsed.data.input);
      return reply.send({ status: 'candidates', candidates });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/api/import/search', async (request, reply) => {
    const parsed = searchBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: 'INVALID_INPUT', message: '请输入系列名称', retryable: false });
    }
    try {
      const candidates = await provider.search(parsed.data.query);
      return reply.send({ candidates });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/api/import/preview', async (request, reply) => {
    const parsed = previewBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: 'INVALID_INPUT', message: '候选标识无效', retryable: false });
    }
    try {
      const preview = await provider.preview(parsed.data.candidateId);
      return reply.send(preview);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get('/api/import/image', async (request, reply) => {
    const parsed = imageQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ code: 'INVALID_INPUT', message: '图片地址无效', retryable: false });
    }
    try {
      const result = await provider.imageByUrl(parsed.data.src, parsed.data.w === '384' ? 384 : parsed.data.w === '768' ? 768 : undefined);
      return reply
        .type(result.contentType)
        .header('cache-control', 'public, max-age=604800, immutable')
        .header('cdn-cache-control', 'public, max-age=604800, stale-while-revalidate=86400')
        .header('vercel-cdn-cache-control', 'public, max-age=604800, stale-while-revalidate=86400')
        .send(Buffer.from(result.bytes));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get<{ Params: { token: string } }>('/api/import/media/:token', async (request, reply) => {
    try {
      const result = await provider.media(request.params.token);
      return reply
        .type(result.contentType)
        .header('cache-control', 'public, max-age=604800, immutable')
        .send(Buffer.from(result.bytes));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  return app;
}
