import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { SHARED_COMMANDS, MEDIA_CHUNK_BYTES } from '@my-popmart/contracts';
import { CommandError } from '../../../web/src/db/commands.js';
import { BackupError } from '../../../web/src/backup/format.js';
import { createSharedService, SharedError } from './service.js';
import type { SharedStore } from './store.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const packet = z.object({
  requestId: z.string().uuid(), name: z.enum(SHARED_COMMANDS),
  payload: z.object({ datasetId: z.string().uuid() }).passthrough(),
});
const mediaPart = z.object({
  parts: z.number().int().min(1).max(60),
  mime: z.string().regex(/^(image|video|application)\/[a-zA-Z0-9.+-]+$/).max(100),
  bytes: z.string().max(Math.ceil(MEDIA_CHUNK_BYTES / 3) * 4).regex(/^[a-zA-Z0-9+/]*={0,2}$/),
});

export function registerSharedRoutes(app: FastifyInstance, store: SharedStore | undefined, mode: 'local' | 'shared') {
  const service = store ? createSharedService(store) : undefined;
  const fail = (reply: FastifyReply, error: unknown) => {
    if (error instanceof SharedError) return reply.code(error.status).send({ code: error.code, message: error.message });
    if (error instanceof CommandError || error instanceof BackupError) {
      return reply.code(400).send({ code: error.code, message: error.message });
    }
    if (error instanceof z.ZodError || error instanceof TypeError) {
      return reply.code(400).send({ code: 'INVALID_INPUT', message: '提交内容不完整，请重新打开表单' });
    }
    app.log.error(error);
    return reply.code(503).send({ code: 'SHARED_UNAVAILABLE', message: '暂时无法连接共享数据库，请稍后重试' });
  };
  const unavailable = (reply: FastifyReply) => reply.code(503).send({
    code: 'DATABASE_NOT_CONFIGURED',
    message: '共享数据库尚未配置。请在 Vercel 连接 Neon，确认 DATABASE_URL 环境变量后重新部署。',
  });
  app.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/api/shared/') && !reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
    return payload;
  });
  app.get('/api/shared/config', async () => ({ mode, configured: Boolean(store) }));
  app.get<{ Querystring: { revision?: string; instanceId?: string } }>('/api/shared/state', async (request, reply) => {
    if (!service) return unavailable(reply);
    try {
      const state = await service.read();
      if (request.query.revision === String(state.revision) &&
        (!request.query.instanceId || request.query.instanceId === state.snapshot.instanceId)) {
        return reply.code(204).send();
      }
      return reply.send(state);
    } catch (error) { return fail(reply, error); }
  });
  app.post('/api/shared/commands', { bodyLimit: 3 * 1024 * 1024 }, async (request, reply) => {
    if (!service) return unavailable(reply);
    try {
      const { name, payload, requestId } = packet.parse(request.body);
      if (name === 'savePersonalAsset' || name === 'clearPersonalAssets') {
        z.enum(['idle', 'greeting', 'greetingPoster']).parse(payload.role);
        if (name === 'savePersonalAsset') {
          hash.parse(payload.hash);
          z.string().regex(/^(image|video)\//).parse(payload.mime);
        }
      } else if (name === 'restoreBackup') {
        z.array(hash).max(200).parse(payload.media);
        z.record(z.string(), z.array(z.unknown()).max(20000)).parse(payload.data);
      } else {
        z.string().uuid().parse(payload.commandId);
      }
      return reply.send(await service.execute(name, payload, requestId));
    } catch (error) { return fail(reply, error); }
  });
  app.put<{ Params: { id: string; part: string } }>('/api/shared/media/:id/:part', { bodyLimit: 800 * 1024 }, async (request, reply) => {
    if (!store) return unavailable(reply);
    try {
      const id = hash.parse(request.params.id);
      const part = z.coerce.number().int().min(0).max(59).parse(request.params.part);
      const item = mediaPart.parse(request.body);
      const bytes = Buffer.from(item.bytes, 'base64');
      if (part >= item.parts || !bytes.length || bytes.length > MEDIA_CHUNK_BYTES ||
        bytes.toString('base64') !== item.bytes || (part < item.parts - 1 && bytes.length !== MEDIA_CHUNK_BYTES)) {
        throw new SharedError(400, 'INVALID_MEDIA', '素材分片不完整');
      }
      await store.putMedia({ id, part, ...item });
      return reply.code(204).send();
    } catch (error) { return fail(reply, error); }
  });
  app.get<{ Params: { id: string; part: string } }>('/api/shared/media/:id/:part', async (request, reply) => {
    if (!store) return unavailable(reply);
    try {
      const id = hash.parse(request.params.id);
      const part = z.coerce.number().int().min(0).max(59).parse(request.params.part);
      const item = await store.readMediaPart(id, part);
      if (!item) return reply.code(404).send({ code: 'MEDIA_NOT_FOUND', message: '云端素材不存在' });
      return reply.header('cache-control', 'public, max-age=604800, immutable')
        .header('vercel-cdn-cache-control', 'public, max-age=604800')
        .type('application/octet-stream').send(Buffer.from(item.bytes, 'base64'));
    } catch (error) { return fail(reply, error); }
  });
}
