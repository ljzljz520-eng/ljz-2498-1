import { nowIso } from '../../../shared/src/index.js';

export class MemoryStore {
  constructor() {
    this.data = {
      templates: new Map(),
      templateVersions: new Map(),
      clauseIdentities: new Map(),
      documents: new Map(),
      documentChanges: new Map(),
      reviewSnapshots: new Map(),
      reviewRecords: new Map(),
      exportJobs: new Map()
    };
  }

  async put(table, entity) {
    const now = nowIso();
    const value = { createdAt: now, updatedAt: now, ...structuredClone(entity) };
    const key = value.id ?? globalThis.crypto.randomUUID();
    this.data[table] ??= new Map();
    if (this.data[table].has(key) && table !== 'documentChanges') {
      const existing = this.data[table].get(key);
      this.data[table].set(key, { ...existing, ...structuredClone(entity), updatedAt: now });
    } else {
      this.data[table].set(key, { ...value, id: key });
    }
    return this.get(table, key);
  }

  async get(table, id) {
    const value = this.data[table]?.get(id);
    return value ? structuredClone(value) : null;
  }

  async list(table, predicate = null) {
    const values = [...(this.data[table]?.values() ?? [])].map(v => structuredClone(v));
    return predicate ? values.filter(predicate) : values;
  }

  async query(table, predicate) {
    return this.list(table, predicate);
  }

  async delete(table, id) {
    return this.data[table]?.delete(id) ?? false;
  }

  async transaction(callback) {
    // In-process writes are atomic from the event loop perspective; retain the same API so
    // services can run unchanged against PostgreSQL.
    return callback(this);
  }
}
