import pg from 'pg';

const TABLES = new Set([
  'templates', 'templateVersions', 'clauseIdentities', 'documents',
  'documentChanges', 'reviewSnapshots', 'reviewRecords', 'exportJobs'
]);

const SQL_TABLE = {
  templateVersions: 'template_versions',
  clauseIdentities: 'clause_identities',
  documentChanges: 'document_changes',
  reviewSnapshots: 'review_snapshots',
  reviewRecords: 'review_records',
  exportJobs: 'export_jobs'
};

const FIELD_MAP = {
  templateVersions: {
    templateId: 'template_id', parentVersionId: 'parent_version_id', baseNodes: 'base_nodes',
    operations: 'operations', variables: 'variables', styles: 'styles', createdAt: 'created_at'
  },
  clauseIdentities: {
    templateVersionId: 'template_version_id', documentId: 'document_id', sourceClauseId: 'source_clause_id',
    sourceTemplateId: 'source_template_id', sourceVersionId: 'source_version_id', firstSeenAt: 'first_seen_at'
  },
  documents: {
    templateId: 'template_id', baseVersionId: 'base_version_id', currentVersionId: 'current_version_id',
    localOperations: 'local_operations', variableValues: 'variable_values', createdAt: 'created_at', updatedAt: 'updated_at'
  },
  documentChanges: {
    documentId: 'document_id', documentVersion: 'document_version', createdAt: 'created_at'
  },
  reviewSnapshots: {
    documentId: 'document_id', documentVersion: 'document_version', payload: 'payload', createdAt: 'created_at'
  },
  reviewRecords: { snapshotId: 'snapshot_id', createdAt: 'created_at' },
  exportJobs: { snapshotId: 'snapshot_id', artifactPath: 'artifact_path', completedAt: 'completed_at', createdAt: 'created_at' }
};

function tableName(table) {
  if (!TABLES.has(table)) throw new Error(`Unknown table: ${table}`);
  return SQL_TABLE[table] ?? table;
}

function toRow(table, entity) {
  const map = FIELD_MAP[table] ?? {};
  const row = {};
  for (const [key, value] of Object.entries(entity)) {
    const column = map[key] ?? camelToSnake(key);
    if (['baseNodes','operations','variables','styles','scope','signoff','localOperations','variableValues','payload','validation','error','operation'].includes(key) && value !== undefined) {
      row[column] = JSON.stringify(value);
    } else {
      row[column] = value;
    }
  }
  return row;
}

function fromRow(table, row) {
  if (!row) return null;
  const reverseMap = Object.fromEntries(Object.entries(FIELD_MAP[table] ?? {}).map(([k, v]) => [v, k]));
  const entity = {};
  for (const [column, value] of Object.entries(row)) {
    const key = reverseMap[column] ?? snakeToCamel(column);
    if (typeof value === 'string' && ['base_nodes','operations','variables','styles','scope','signoff','local_operations','variable_values','payload','validation','error','operation'].includes(column)) {
      try { entity[key] = JSON.parse(value); } catch { entity[key] = value; }
    } else entity[key] = value;
  }
  return entity;
}

function camelToSnake(input) { return input.replace(/[A-Z]/g, m => `_${m.toLowerCase()}`); }
function snakeToCamel(input) { return input.replace(/_([a-z])/g, (_, m) => m.toUpperCase()); }

export class PgStore {
  constructor(connectionString) {
    this.pool = new pg.Pool({ connectionString });
  }

  async put(table, entity) {
    const sqlTable = tableName(table);
    const row = toRow(table, entity);
    const columns = Object.keys(row);
    const values = columns.map(c => row[c]);
    const placeholders = values.map((_, i) => `$${i + 1}`);
    const updates = columns.filter(c => c !== 'id').map(c => `${c}=EXCLUDED.${c}`);
    const sql = `insert into ${sqlTable} (${columns.join(',')}) values (${placeholders.join(',')})
                 on conflict (id) do update set ${updates.join(',')}
                 returning *`;
    const result = await this.pool.query(sql, values);
    return fromRow(table, result.rows[0]);
  }

  async get(table, id) {
    const result = await this.pool.query(`select * from ${tableName(table)} where id=$1`, [id]);
    return fromRow(table, result.rows[0]);
  }

  async list(table, predicate = null) {
    const result = await this.pool.query(`select * from ${tableName(table)} order by created_at asc`);
    let rows = result.rows.map(row => fromRow(table, row));
    if (predicate) rows = rows.filter(predicate);
    return rows;
  }

  async query(table, predicate) { return this.list(table, predicate); }

  async delete(table, id) {
    const result = await this.pool.query(`delete from ${tableName(table)} where id=$1`, [id]);
    return result.rowCount > 0;
  }

  async transaction(callback) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const tx = Object.create(this);
      tx.pool = client;
      const result = await callback(tx);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async close() { await this.pool.end(); }
}

