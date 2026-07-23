const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.resolve(
  __dirname,
  '../../../supabase/migrations/20260718_add_relationship_compass_planning_state.sql'
);

test('planning migration is additive, backfills the former route and keeps JSON object integrity', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /ALTER TABLE relationship_compasses/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS planning_state JSONB NOT NULL DEFAULT/i);
  assert.match(sql, /"current_node_id"\s*:\s*"paid-need"/i);
  assert.match(sql, /"parent_id"\s*:\s*"paid-need"/i);
  assert.match(sql, /"stage_gaps"/i);
  assert.match(sql, /"target_value"\s*:\s*5/i);
  assert.match(sql, /jsonb_typeof\(planning_state\)\s*=\s*'object'/i);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE/i);
});
