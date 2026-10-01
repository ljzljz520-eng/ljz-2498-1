import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createErrorHandler, readJson, sendJson, serveStatic } from './http-utils.js';
import { MemoryStore } from './persistence/memory-store.js';
import { PgStore } from './persistence/pg-store.js';
import { DocumentService } from './services/document-service.js';
import { FontService } from './services/font-service.js';
import { TemplateService } from './services/template-service.js';
import { seedDemoData } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function createApp({ store = null, databaseUrl = process.env.DATABASE_URL, seed = true, requiredFonts = null } = {}) {
  const usePg = databaseUrl && databaseUrl !== 'memory';
  const persistence = store ?? (usePg ? new PgStore(databaseUrl) : new MemoryStore());
  const required = requiredFonts ?? (process.env.REQUIRED_FONTS ? process.env.REQUIRED_FONTS.split(',').map(v => v.trim()).filter(Boolean) : []);
  const fonts = new FontService({ requiredFonts: required });
  await fonts.detectFonts();
  const templateService = new TemplateService(persistence);
  const documentService = new DocumentService(persistence, templateService, fonts);
  if (!usePg && seed) await seedDemoData(templateService, documentService);

  const server = createServer(async (req, res) => {
    const onError = createErrorHandler(res);
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url, { persistence, fonts, templates: templateService, documents: documentService });
      if (process.env.NODE_ENV === 'production') {
        const distDir = path.resolve(__dirname, '../../dist');
        return await serveStatic(req, res, distDir);
      }
      sendJson(res, 200, { name: 'contract-layout-studio', mode: 'api-only', docs: '/api/health' });
    } catch (error) {
      onError(error);
    }
  });

  server.persistence = persistence;
  server.services = { templates: templateService, documents: documentService, fonts };
  return server;
}

async function handleApi(req, res, url, services) {
  const { templates: templateApi, documents, fonts, persistence } = services;
  const body = await readJson(req);
  const pathParts = url.pathname.split('/').filter(Boolean);
  const [, resource, id, sub, subId, subSub] = pathParts;
  const method = req.method;

  if (resource === 'health' && method === 'GET') {
    return sendJson(res, 200, { ok: true, fonts: fonts.availableFonts?.slice(0, 20), requiredFonts: fonts.requiredFonts, missingFonts: fonts.missingRequiredFonts() });
  }
  if (resource === 'fonts' && method === 'POST') {
    fonts.availableFonts = body.fonts;
    return sendJson(res, 200, { fonts: fonts.availableFonts, missingFonts: fonts.missingRequiredFonts() });
  }

  if (resource === 'templates') {
    if (!id && method === 'GET') return sendJson(res, 200, { items: await templateApi.listTemplates() });
    if (!id && method === 'POST') return sendJson(res, 201, await templateApi.createTemplate(body));
    if (id && sub === 'versions' && !subId && method === 'GET') return sendJson(res, 200, { items: await templateApi.listVersions(id) });
    if (id === 'versions' && subId && method === 'GET') return sendJson(res, 200, await templateApi.resolveVersion(subId));
    if (id === 'versions' && subId && sub === 'versions' && method === 'GET') return sendJson(res, 200, await templateApi.resolveVersion(subId));
    if (id && sub === 'child-versions' && method === 'POST') return sendJson(res, 201, await templateApi.createChildVersion({ ...body, parentVersionId: id }));
    if (id === 'fork' && method === 'POST') return sendJson(res, 201, await templateApi.createForkFromTemplate(body));
    if (id && method === 'GET') return sendJson(res, 200, await templateApi.getTemplate(id));
  }

  if (resource === 'documents') {
    if (!id && method === 'GET') return sendJson(res, 200, { items: await documents.listDocuments() });
    if (!id && method === 'POST') return sendJson(res, 201, await documents.createDocument(body));
    if (id && method === 'GET') return sendJson(res, 200, await documents.resolveDocument(id));
    if (id && sub === 'mutate' && method === 'POST') return sendJson(res, 200, await documents.mutateDocument(id, body.operation, body));
    if (id && sub === 'split' && method === 'POST') return sendJson(res, 200, await documents.splitClause(id, body.clauseId, body));
    if (id && sub === 'move' && method === 'POST') return sendJson(res, 200, await documents.moveClause(id, body.clauseId, body.newParentId, body.index, body.actor));
    if (id && sub === 'variables' && method === 'POST') return sendJson(res, 200, await documents.setVariables(id, body.values ?? body, body));
    if (id && sub === 'signoff' && method === 'POST') return sendJson(res, 200, await documents.updateSignoff(id, body.signoff ?? body, body));
    if (id && sub === 'reuse-comparison' && method === 'POST') return sendJson(res, 200, await documents.compareReuse(id, body));
    if (id && sub === 'upgrades' && !subId && method === 'POST') return sendJson(res, 200, await documents.previewUpgrade(id, body.targetVersionId));
    if (id && sub === 'upgrades' && subSub === 'adopt' && method === 'POST') return sendJson(res, 200, await documents.adoptUpgrade(id, subId ?? body.targetVersionId, body.choices ?? {}, body));
    if (id && sub === 'snapshots' && !subId && method === 'POST') return sendJson(res, 201, await documents.createReviewSnapshot(id, body));
    if (id && sub === 'snapshots' && !subId && method === 'GET') return sendJson(res, 200, { items: await documents.listSnapshots(id) });
    if (id && sub === 'snapshots' && subId && subSub === 'render' && method === 'GET') {
      const rendered = await documents.renderSnapshot(subId);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(rendered.html);
    }
    if (id && sub === 'snapshots' && subId && subSub === 'export' && method === 'POST') return sendJson(res, 200, await documents.exportSnapshot(subId, body));
    if (id && sub === 'snapshots' && subId && subSub === 'records' && method === 'GET') return sendJson(res, 200, { items: await documents.listReviewRecords(subId) });
    if (id && sub === 'snapshots' && subId && subSub === 'review' && method === 'POST') return sendJson(res, 201, await documents.addReviewRecord(subId, body));
    if (id && sub === 'snapshots' && subId && method === 'GET') return sendJson(res, 200, await documents.getSnapshot(subId));
  }

  if (resource === 'snapshots' && id) {
    if (sub === 'render' && method === 'GET') {
      const rendered = await documents.renderSnapshot(id);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(rendered.html);
    }
    if (sub === 'export' && method === 'POST') return sendJson(res, 200, await documents.exportSnapshot(id, body));
    if (sub === 'records' && method === 'GET') return sendJson(res, 200, { items: await documents.listReviewRecords(id) });
    if (sub === 'review' && method === 'POST') return sendJson(res, 201, await documents.addReviewRecord(id, body));
    if (method === 'GET') return sendJson(res, 200, await documents.getSnapshot(id));
  }

  sendJson(res, 404, { error: { code: 'NOT_FOUND', message: `No API route: ${method} ${url.pathname}` } });
}
