// PostgreSQL repository. Same method surface as repo/memory.js so the app is
// storage-agnostic: set CT_STORAGE=pg (and DATABASE_URL) to use it.
// Block id is the stable clause identity column; only version position and
// document diff layers are ever rewritten on moves.
import pg from 'pg';

export class PgRepo {
  constructor(connectionString) {
    this.pool = new pg.Pool({ connectionString: connectionString || process.env.DATABASE_URL });
  }
  async query(q, p) { return this.pool.query(q, p); }

  async init() { /* schema is applied via db/schema.sql */ }

  async listTemplates() { const r = await this.query('SELECT * FROM templates ORDER BY created_at'); return r.rows; }
  async getTemplate(id) { const r = await this.query('SELECT * FROM templates WHERE id=$1', [id]); return r.rows[0] || null; }
  async createTemplate(t) {
    await this.query('INSERT INTO templates(id,name,current_version_id) VALUES($1,$2,$3)', [t.id, t.name, t.currentVersionId]);
    return t;
  }

  async listVersions(templateId) {
    const r = await this.query('SELECT * FROM template_versions WHERE template_id=$1 ORDER BY created_at', [templateId]);
    return r.rows.map(row);
  }
  async getVersion(id) {
    const r = await this.query('SELECT * FROM template_versions WHERE id=$1', [id]);
    const v = r.rows[0]; if (!v) return null;
    const b = await this.query('SELECT * FROM template_blocks WHERE version_id=$1 ORDER BY position', [id]);
    return { ...row(v), blocks: b.rows.map(blockRow) };
  }
  async createVersion(v) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`INSERT INTO template_versions(id,template_id,parent_version_id,version,note,variables)
                     VALUES($1,$2,$3,$4,$5,$6)`, [v.id, v.templateId, v.parentVersionId, v.version, v.note, JSON.stringify(v.variables)]);
      for (let i = 0; i < v.blocks.length; i++) {
        const b = v.blocks[i];
        await c.query(`INSERT INTO template_blocks(id,version_id,parent_id,kind,title,body,page,origin,position)
                       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [b.id, v.id, b.parentId, b.kind, b.title, b.body, JSON.stringify(b.page), JSON.stringify(b.origin), i]);
      }
      await c.query('UPDATE templates SET current_version_id=$1 WHERE id=$2', [v.id, v.templateId]);
      await c.query('COMMIT');
      return v;
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }

  async listDocs() { const r = await this.query('SELECT id,title,template_id,baseline_version_id,content_hash,updated_at FROM documents ORDER BY updated_at DESC'); return r.rows.map(docRow); }
  async getDoc(id) { const r = await this.query('SELECT * FROM documents WHERE id=$1', [id]); return r.rows[0] ? docFull(r.rows[0]) : null; }
  async saveDoc(d) {
    await this.query(`INSERT INTO documents(id,title,template_id,baseline_version_id,source_doc_id,diff,values,var_map,lineage,content_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (id) DO UPDATE SET title=$2, baseline_version_id=$4, diff=$6, values=$7, var_map=$8, lineage=$9, content_hash=$10`,
      [d.id, d.title, d.templateId, d.baselineVersionId, d.sourceDocId || null,
       JSON.stringify(d.diff), JSON.stringify(d.values), JSON.stringify(d.varMap), JSON.stringify(d.lineage), d.contentHash]);
    return this.getDoc(d.id);
  }
  createDoc(d) { return this.saveDoc(d); }

  async getSnapshot(id) { const r = await this.query('SELECT * FROM review_snapshots WHERE id=$1', [id]); return r.rows[0] ? { id: r.rows[0].id, docId: r.rows[0].doc_id, contentHash: r.rows[0].content_hash, payload: r.rows[0].payload, reviewer: r.rows[0].reviewer, at: r.rows[0].created_at } : null; }
  async saveSnapshot(s) {
    await this.query('INSERT INTO review_snapshots(id,doc_id,content_hash,payload,reviewer) VALUES($1,$2,$3,$4,$5)',
      [s.id, s.docId, s.contentHash, JSON.stringify(s.payload), s.reviewer]);
    return s;
  }
  async listSnapshots(docId) { const r = await this.query('SELECT id,content_hash,reviewer,created_at FROM review_snapshots WHERE doc_id=$1 ORDER BY created_at DESC', [docId]); return r.rows; }

  async addRecord(r) {
    const x = await this.query(`INSERT INTO review_records(doc_id,snapshot_id,action,comment,actor,meta)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [r.docId, r.snapshotId || null, r.action, r.comment || '', r.actor || 'reviewer', JSON.stringify(r.meta || {})]);
    return recRow(x.rows[0]);
  }
  async listRecords(docId) { const r = await this.query('SELECT * FROM review_records WHERE doc_id=$1 ORDER BY created_at', [docId]); return r.rows.map(recRow); }
  async addExport(e) {
    const x = await this.query(`INSERT INTO exports(doc_id,snapshot_id,format,status,warnings) VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [e.docId, e.snapshotId, e.format, e.status, JSON.stringify(e.warnings || [])]);
    return x.rows[0];
  }
}

const row = (v) => ({ id: v.id, templateId: v.template_id, parentVersionId: v.parent_version_id, version: v.version, note: v.note, variables: v.variables, createdAt: v.created_at });
const blockRow = (b) => ({ id: b.id, parentId: b.parent_id, kind: b.kind, title: b.title, body: b.body, page: b.page, origin: b.origin });
const docRow = (d) => ({ id: d.id, title: d.title, templateId: d.template_id, baselineVersionId: d.baseline_version_id, contentHash: d.content_hash, updatedAt: d.updated_at });
const docFull = (d) => ({ ...docRow(d), sourceDocId: d.source_doc_id, diff: d.diff, values: d.values, varMap: d.var_map, lineage: d.lineage });
const recRow = (r) => ({ id: r.id, docId: r.doc_id, snapshotId: r.snapshot_id, action: r.action, comment: r.comment, actor: r.actor, meta: r.meta, createdAt: r.created_at });
