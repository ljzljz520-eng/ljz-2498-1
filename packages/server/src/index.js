import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { Services, httpErr } from './services.js';
import { MemoryRepo } from './repo/memory.js';
import { PgRepo } from './repo/pg.js';
import routes from './routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function buildServer() {
  const app = Fastify({ logger: true });
  app.storage = process.env.CT_STORAGE === 'pg' ? 'pg' : 'file';
  const repo = app.storage === 'pg'
    ? new PgRepo(process.env.DATABASE_URL)
    : new MemoryRepo(process.env.CT_DATA || path.join(__dirname, '..', 'data', 'dev.json'));
  await repo.init({ seed: true });
  const svc = new Services(repo, {
    fonts: ['DejaVu Serif'],
    requiredFonts: [{ family: 'Noto Serif CJK SC', why: '中文正文', fallback: 'DejaVu Serif' }],
  });
  app.httpErr = httpErr;
  app.setErrorHandler((err, req, reply) => {
    const status = err.statusCode || 500;
    reply.code(status).send({ error: err.code || err.message, status, details: err.details });
  });
  await app.register(routes, svc);

  const dist = path.join(__dirname, '..', '..', 'web', 'dist');
  if (existsSync(dist)) {
    await app.register(fastifyStatic, { root: dist, prefix: '/' });
    app.setNotFoundHandler((req, reply) => reply.sendFile('index.html'));
  }
  return { app, svc, repo };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { app } = await buildServer();
  const port = Number(process.env.PORT || 8787);
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`contract typesetter on http://localhost:${port} (storage=${app.storage})`);
}
