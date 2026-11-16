import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';
const signingSecret = process.env.IMPORT_SIGNING_SECRET ?? 'dev-secret-change-me';

const aliasesPath = fileURLToPath(new URL('../data/aliases.zh.json', import.meta.url));

const staticDir =
  process.env.STATIC_DIR ?? fileURLToPath(new URL('../../web/dist', import.meta.url));

const app = buildApp({ signingSecret, aliasesPath, logger: true, staticDir });

app
  .listen({ port, host })
  .then(() => {
    app.log.info(`import server listening on http://${host}:${port}`);
  })
  .catch((error: unknown) => {
    app.log.error(error);
    process.exit(1);
  });
