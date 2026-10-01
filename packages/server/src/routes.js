import { renderPDF } from './pdf.js';

export default async function routes(app, svc) {
  app.get('/api/health', async () => ({ ok: true, storage: app.storage }));

  app.get('/api/templates', async () => svc.repo.listTemplates());
  app.post('/api/templates', async (req) => svc.repo.createTemplate(req.body));
  app.get('/api/templates/:id/versions', async (req) => svc.repo.listVersions(req.params.id));
  app.get('/api/versions/:id', async (req) => svc.repo.getVersion(req.params.id));

  app.post('/api/templates/:id/versions', async (req) => {
    const t = await svc.repo.getTemplate(req.params.id);
    if (!t) throw app.httpErr(404, 'template not found');
    const prev = t.currentVersionId ? await svc.repo.getVersion(t.currentVersionId) : null;
    const v = {
      id: req.body.id || `ver_${Date.now().toString(36)}`,
      templateId: t.id, parentVersionId: prev?.id || null,
      version: req.body.version, note: req.body.note || '',
      variables: req.body.variables || prev?.variables || [],
      blocks: req.body.blocks || prev?.blocks || [],
    };
    return svc.repo.createVersion(v);
  });

  app.get('/api/docs', async () => svc.repo.listDocs());
  app.post('/api/docs', async (req) => svc.createDocFromTemplate(req.body || {}));
  app.get('/api/docs/:id', async (req) => {
    const d = await svc.repo.getDoc(req.params.id); if (!d) throw app.httpErr(404, 'doc not found');
    const ver = await svc.repo.getVersion(d.baselineVersionId);
    return { doc: d, version: ver };
  });

  app.patch('/api/docs/:id/diff', async (req) => svc.updateDiff(req.params.id, req.body || {}));
  app.post('/api/docs/:id/blocks', async (req) => svc.insertBlock(req.params.id, req.body || {}));
  app.post('/api/docs/:id/move', async (req) => svc.moveBlock(req.params.id, req.body || {}));
  app.patch('/api/docs/:id/blocks/:bid', async (req) => svc.editBlock(req.params.id, req.params.bid, req.body || {}));
  app.delete('/api/docs/:id/blocks/:bid', async (req) => svc.deleteBlock(req.params.id, req.params.bid));
  app.put('/api/docs/:id/values', async (req) => svc.setValues(req.params.id, req.body?.values || {}));
  app.put('/api/docs/:id/varmap', async (req) => svc.setVarMapping(req.params.id, req.body?.varMap || {}));

  app.get('/api/docs/:id/materialized', async (req) => {
    const d = await svc.repo.getDoc(req.params.id);
    const { blocks, version } = await svc.materializeDoc(d);
    return { blocks, variables: version.variables, contentHash: d.contentHash };
  });
  app.get('/api/docs/:id/preview', async (req) => svc.preview(req.params.id, { strict: req.query.strict === '1' }));
  app.get('/api/docs/:id/validate', async (req) => svc.validate(req.params.id));
  app.get('/api/docs/:id/comparison', async (req) => svc.comparison(req.params.id));

  app.get('/api/docs/:id/upgrade/:vid', async (req) => svc.upgradePreview(req.params.id, req.params.vid));
  app.post('/api/docs/:id/upgrade/:vid', async (req) => svc.upgradeAdopt(req.params.id, req.params.vid, req.body?.decisions || {}));

  app.post('/api/docs/:id/snapshots', async (req) => svc.createSnapshot(req.params.id, req.body || {}));
  app.get('/api/docs/:id/snapshots', async (req) => svc.repo.listSnapshots(req.params.id));
  app.post('/api/snapshots/:sid/review', async (req) => svc.addReview(req.params.sid, req.body || {}));
  app.get('/api/snapshots/:sid/print', async (req, reply) => {
    const html = await svc.printHtml(req.params.sid);
    reply.header('Content-Type', 'text/html; charset=utf-8');
    return html;
  });
  app.get('/api/docs/:id/records', async (req) => svc.repo.listRecords(req.params.id));

  app.post('/api/docs/:id/export', async (req, reply) => {
    const out = await svc.exportDoc(req.params.id, {
      snapshotId: req.body?.snapshotId,
      format: req.body?.format || 'pdf',
      actor: req.body?.actor,
    });
    if (out && (req.body?.format === 'html' || req.body?.format === 'print')) {
      reply.header('Content-Type', 'text/html; charset=utf-8');
      return out.html;
    }
    try {
      const pdf = await renderPDF(out.html);
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `attachment; filename="contract-${req.params.id}.pdf"`);
      return reply.send(Buffer.from(pdf));
    } catch (e) {
      // PDF engine unavailable: still return the exact print HTML snapshot.
      reply.code(200).header('Content-Type', 'application/json');
      return { pdfUnavailable: true, reason: e.message, ...out };
    }
  });
}
