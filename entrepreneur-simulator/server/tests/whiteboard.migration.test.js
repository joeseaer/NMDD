const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.resolve(
  __dirname,
  '../../../supabase/migrations/20260816_add_whiteboards.sql',
);
const sql = fs.readFileSync(migrationPath, 'utf8');
const executableSql = sql.replace(/^\s*--.*$/gm, '');

test('whiteboard migration is additive and creates the board, asset and reference tables', () => {
  for (const table of ['whiteboards', 'whiteboard_assets', 'whiteboard_document_refs']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\b`, 'i'));
  }
  assert.doesNotMatch(executableSql, /DROP\s+TABLE/i);
  assert.match(sql, /REFERENCES public\.whiteboards\(id\) ON DELETE CASCADE/i);
  assert.match(sql, /REFERENCES public\.sops\(id\) ON DELETE CASCADE/i);
});

test('whiteboard migration enforces revisioning, shape checks and owner-only RLS', () => {
  assert.match(sql, /CREATE TRIGGER whiteboards_bump_content_revision/i);
  assert.match(sql, /BEFORE UPDATE OF title, scene_json, scene_schema_version/i);
  assert.match(sql, /jsonb_typeof\(scene_json->'elements'\) = 'array'/i);
  assert.match(sql, /ALTER TABLE public\.whiteboards ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /CREATE POLICY whiteboards_owner_all/i);
  assert.match(sql, /whiteboards\.user_id = auth\.uid\(\)::TEXT/i);
});

test('whiteboard assets are immutable-addressed and cannot inline arbitrary scene binaries', () => {
  assert.match(sql, /sha256 TEXT NOT NULL/i);
  assert.match(sql, /sha256 ~ '\^\[a-f0-9\]\{64\}\$'/i);
  assert.match(sql, /UNIQUE \(whiteboard_id, file_id\)/i);
  assert.match(sql, /scene_json JSONB NOT NULL/i);
});
