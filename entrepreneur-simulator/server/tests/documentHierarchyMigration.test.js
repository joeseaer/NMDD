const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.resolve(
  __dirname,
  '../../../supabase/migrations/20260809_add_document_page_hierarchy.sql'
);

test('document hierarchy migration is additive, atomic and legacy-schema compatible', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  assert.match(sql, /BEGIN;[\s\S]*COMMIT;/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS parent_id UUID/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS sort_order BIGINT NOT NULL DEFAULT 0/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS structure_updated_at/i);
  assert.match(sql, /FOREIGN KEY \(parent_id\)[\s\S]*ON DELETE SET NULL/i);
  assert.match(sql, /ON public\.sops\(user_id, parent_id, sort_order\)/i);
  assert.match(sql, /to_regprocedure\('public\.bump_sop_content_revision\(\)'\)/i);
  assert.match(sql, /information_schema\.columns/i);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE TABLE|DELETE FROM/i);
});
