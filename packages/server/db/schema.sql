-- Contract typesetter schema.
-- Identity principle: clause identity (block_id) is a stable column; display
-- numbering is NEVER stored — it is derived at render time, so inserts/moves
-- renumber without rewriting identity or breaking references.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE templates (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  current_version_id TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE template_versions (
  id                TEXT PRIMARY KEY,
  template_id       TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  parent_version_id TEXT REFERENCES template_versions(id),
  version           TEXT NOT NULL,
  note              TEXT NOT NULL DEFAULT '',
  variables         JSONB NOT NULL DEFAULT '[]',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (template_id, version)
);
CREATE INDEX ix_versions_template ON template_versions(template_id);

-- Version baseline blocks. Provenance origin is preserved across versions.
CREATE TABLE template_blocks (
  id         TEXT PRIMARY KEY,           -- stable clause identity
  version_id TEXT NOT NULL REFERENCES template_versions(id) ON DELETE CASCADE,
  parent_id  TEXT,
  kind       TEXT NOT NULL DEFAULT 'clause',
  title      TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL DEFAULT '',
  page       JSONB,                      -- {orientation,header,footer} scope
  origin     JSONB,                      -- {templateId,versionId,blockId}
  position   DOUBLE PRECISION NOT NULL,  -- baseline sibling order
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_tblocks_version ON template_blocks(version_id);

-- Documents inherit a baseline version and store only a diff layer.
CREATE TABLE documents (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  template_id         TEXT REFERENCES templates(id),
  baseline_version_id TEXT REFERENCES template_versions(id),
  source_doc_id       TEXT REFERENCES documents(id),  -- reuse provenance
  diff                JSONB NOT NULL DEFAULT '{}',    -- edits/deletes/moves/inserts
  values              JSONB NOT NULL DEFAULT '{}',
  var_map             JSONB NOT NULL DEFAULT '{}',
  lineage             JSONB NOT NULL DEFAULT '[]',
  content_hash        TEXT NOT NULL DEFAULT '',
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Immutable review snapshots (print + PDF render one of these).
CREATE TABLE review_snapshots (
  id           TEXT PRIMARY KEY,
  doc_id       TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  payload      JSONB NOT NULL,
  reviewer     TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_snap_doc ON review_snapshots(doc_id);

CREATE TABLE review_records (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  doc_id      TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  snapshot_id TEXT REFERENCES review_snapshots(id),
  action      TEXT NOT NULL CHECK (action IN ('submit','comment','approve','reject','export','print')),
  comment     TEXT NOT NULL DEFAULT '',
  actor       TEXT NOT NULL DEFAULT 'reviewer',
  meta        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_records_doc ON review_records(doc_id);

-- Exports are recorded against a snapshot, never against live content.
CREATE TABLE exports (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  doc_id      TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  snapshot_id TEXT NOT NULL REFERENCES review_snapshots(id),
  format      TEXT NOT NULL CHECK (format IN ('pdf','html','print')),
  status      TEXT NOT NULL DEFAULT 'ok',
  warnings    JSONB NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_documents_touch BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
