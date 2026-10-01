create extension if not exists pgcrypto;

create table templates (
  id text primary key,
  name text not null,
  description text not null default '',
  current_version_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table template_versions (
  id text primary key,
  template_id text not null references templates(id) on delete cascade,
  version text not null,
  parent_version_id text references template_versions(id) on delete set null,
  base_nodes jsonb not null default '[]'::jsonb,
  operations jsonb not null default '[]'::jsonb,
  variables jsonb not null default '[]'::jsonb,
  styles jsonb not null default '{}'::jsonb,
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (template_id, version)
);

alter table templates add constraint templates_current_version_fk
  foreign key (current_version_id) references template_versions(id) on delete set null;

create table clause_identities (
  id text primary key,
  template_version_id text references template_versions(id) on delete cascade,
  document_id text,
  source_clause_id text,
  source_template_id text,
  source_version_id text,
  kind text not null default 'clause',
  first_seen_at timestamptz not null default now()
);

create index clause_identities_document_idx on clause_identities(document_id);
create index clause_identities_template_idx on clause_identities(template_version_id);
create index clause_identities_source_idx on clause_identities(source_clause_id);

create table documents (
  id text primary key,
  title text not null,
  template_id text references templates(id) on delete set null,
  base_version_id text references template_versions(id) on delete set null,
  current_version_id text references template_versions(id) on delete set null,
  version integer not null default 1,
  local_operations jsonb not null default '[]'::jsonb,
  variables jsonb not null default '[]'::jsonb,
  variable_values jsonb not null default '{}'::jsonb,
  scope jsonb not null default '{}'::jsonb,
  signoff jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table document_changes (
  id uuid primary key default gen_random_uuid(),
  document_id text not null references documents(id) on delete cascade,
  document_version integer not null,
  operation jsonb not null,
  actor text not null default 'anonymous',
  reason text not null default '',
  created_at timestamptz not null default now()
);
create index document_changes_doc_idx on document_changes(document_id, document_version);

create table review_snapshots (
  id text primary key,
  document_id text not null references documents(id) on delete cascade,
  document_version integer not null,
  reason text not null default 'manual',
  payload jsonb not null,
  validation jsonb not null,
  signoff jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index review_snapshots_doc_idx on review_snapshots(document_id, created_at desc);

create table review_records (
  id text primary key,
  snapshot_id text not null references review_snapshots(id) on delete cascade,
  action text not null check (action in ('created','approved','rejected','commented','exported','printed')),
  comment text not null default '',
  actor text not null default 'anonymous',
  created_at timestamptz not null default now()
);
create index review_records_snapshot_idx on review_records(snapshot_id, created_at);

create table export_jobs (
  id text primary key,
  snapshot_id text not null references review_snapshots(id) on delete restrict,
  format text not null check (format in ('print','pdf','html')),
  status text not null check (status in ('pending','rendered','completed','blocked','failed')),
  artifact_path text,
  error jsonb,
  actor text not null default 'anonymous',
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index export_jobs_snapshot_idx on export_jobs(snapshot_id);
