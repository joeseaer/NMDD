const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.resolve(
  __dirname,
  '../../../supabase/migrations/20260712_add_document_editor_reliability.sql'
);

test('document reliability migration is additive and covers live documents plus history', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  assert.match(sql, /ALTER TABLE sops[\s\S]*ADD COLUMN IF NOT EXISTS content_schema_version/i);
  assert.match(sql, /ALTER TABLE sops[\s\S]*ADD COLUMN IF NOT EXISTS content_revision/i);
  assert.match(sql, /ALTER TABLE sop_versions[\s\S]*ADD COLUMN IF NOT EXISTS content_schema_version/i);
  assert.match(sql, /ALTER TABLE sop_versions[\s\S]*ADD COLUMN IF NOT EXISTS content_revision/i);
  assert.match(sql, /BEFORE UPDATE ON sops/i);
  assert.match(sql, /OLD\.content_revision[\s\S]*\+ 1/i);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE TABLE|DELETE FROM/i);
});
