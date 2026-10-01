// File-backed development repository with the SAME interface as repo/pg.js.
// Stores documents as baseline + diff layer; seeds a demo template on boot.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { seedTemplate, contentHash, newId, canonical } from '@ct/core';

export class MemoryRepo {
  constructor(file) {
    this.file = file || null;
    this.db = { templates: new Map(), versions: new Map(), blocks: new Map(), docs: new Map(), snapshots: new Map(), records: [], exports: [] };
  }

  async init({ seed = true } = {}) {
    if (this.file) {
      try {
        const raw = JSON.parse(await fs.readFile(this.file, 'utf8'));
        for (const [k, v] of Object.entries(raw.templates || {})) this.db.templates.set(k, v);
        for (const [k, v] of Object.entries(raw.versions || {})) this.db.versions.set(k, v);
        for (const [k, v] of Object.entries(raw.blocks || {})) this.db.blocks.set(k, v);
        for (const [k, v] of Object.entries(raw.docs || {})) this.db.docs.set(k, v);
        for (const [k, v] of Object.entries(raw.snapshots || {})) this.db.snapshots.set(k, v);
        this.db.records = raw.records || [];
        this.db.exports = raw.exports || [];
        return;
      } catch { /* fresh */ }
    }
    if (seed) await this.seed();
  }

  async seed() {
    const { template: t, version: v } = seedTemplate();
    this.db.templates.set(t.id, t);
    this.db.versions.set(v.id, v);
    this.db.blocks.set(v.id, v.blocks);
    await this.persist();
    this._seedIds = { templateId: t.id, versionId: v.id };
  }

  async persist() {
    if (!this.file) return;
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const obj = {
      templates: Object.fromEntries(this.db.templates),
      versions: Object.fromEntries(this.db.versions),
      blocks: Object.fromEntries(this.db.blocks),
      docs: Object.fromEntries(this.db.docs),
      snapshots: Object.fromEntries(this.db.snapshots),
      records: this.db.records, exports: this.db.exports,
    };
    await fs.writeFile(this.file, JSON.stringify(obj));
  }

  listTemplates() { return [...this.db.templates.values()]; }
  getTemplate(id) { return this.db.templates.get(id) || null; }
  createTemplate(t) { this.db.templates.set(t.id, t); return this.persist().then(() => t); }

  listVersions(templateId) { return [...this.db.versions.values()].filter((v) => v.templateId === templateId); }
  getVersion(id) {
    const v = this.db.versions.get(id);
    if (!v) return null;
    return { ...v, blocks: this.db.blocks.get(id) || [] };
  }
  async createVersion(v) {
    this.db.versions.set(v.id, v);
    this.db.blocks.set(v.id, v.blocks);
    const t = this.db.templates.get(v.templateId);
    if (t) { t.currentVersionId = v.id; }
    await this.persist();
    return { ...v };
  }

  listDocs() { return [...this.db.docs.values()].map(strip); }
  getDoc(id) { const d = this.db.docs.get(id); return d ? structuredClone(d) : null; }
  async saveDoc(d) {
    d.contentHash = contentHash({ diff: d.diff, values: d.values, title: d.title });
    d.updatedAt = new Date().toISOString();
    this.db.docs.set(d.id, structuredClone(d));
    await this.persist();
    return this.getDoc(d.id);
  }

  async createDoc(d) { return this.saveDoc(d); }

  getSnapshot(id) { const s = this.db.snapshots.get(id); return s ? structuredClone(s) : null; }
  async saveSnapshot(s) { this.db.snapshots.set(s.id, structuredClone(s)); await this.persist(); return s; }
  listSnapshots(docId) { return [...this.db.snapshots.values()].filter((s) => s.docId === docId).map((s) => ({ id: s.id, at: s.at, contentHash: s.contentHash, reviewer: s.reviewer })); }

  async addRecord(r) { const rec = { id: newId('rec'), createdAt: new Date().toISOString(), ...r }; this.db.records.push(rec); await this.persist(); return rec; }
  listRecords(docId) { return this.db.records.filter((r) => r.docId === docId); }
  async addExport(e) { const rec = { id: newId('exp'), createdAt: new Date().toISOString(), ...e }; this.db.exports.push(rec); await this.persist(); return rec; }
}

function strip(d) {
  return { id: d.id, title: d.title, templateId: d.templateId, baselineVersionId: d.baselineVersionId, contentHash: d.contentHash, updatedAt: d.updatedAt };
}
