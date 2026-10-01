#!/usr/bin/env bash
# Apply PG schema (idempotent-ish; safe on a fresh database).
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL}"
psql "$DATABASE_URL" -f "$(dirname "$0")/../db/schema.sql"
