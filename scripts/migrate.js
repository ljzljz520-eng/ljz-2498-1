import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || databaseUrl === 'memory') {
  console.error('请设置 PostgreSQL DATABASE_URL，例如 postgres://user:pass@localhost:5432/contract_layout');
  process.exit(1);
}
const client = new pg.Client(databaseUrl);
await client.connect();
const dir = path.resolve('migrations');
const files = (await readdir(dir)).filter(f => f.endsWith('.sql')).sort();
await client.query(`create table if not exists schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
)`);
for (const file of files) {
  const { rows } = await client.query('select version from schema_migrations where version=$1', [file]);
  if (rows.length) {
    console.log(`skip ${file}`);
    continue;
  }
  const sql = await readFile(path.join(dir, file), 'utf8');
  await client.query('begin');
  try {
    await client.query(sql);
    await client.query('insert into schema_migrations(version) values ($1)', [file]);
    await client.query('commit');
    console.log(`applied ${file}`);
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}
await client.end();
