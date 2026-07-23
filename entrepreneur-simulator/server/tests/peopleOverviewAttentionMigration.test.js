const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.resolve(
  __dirname,
  '../../../supabase/migrations/20260718_add_people_overview_attention.sql'
);

test('people overview migration is additive and keeps recommendation decisions atomic', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /CREATE INDEX IF NOT EXISTS relationship_ai_proposals_attention_run_idx/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION decide_relationship_attention_recommendation/i);
  assert.match(sql, /proposal_type\s*=\s*'attention_recommendation'/i);
  assert.match(sql, /attention_status\s*=\s*'focus'/i);
  assert.match(sql, /urgency.*observe_next/is);
  assert.match(sql, /FOR UPDATE/i);
  assert.match(sql, /RS_VERSION_CONFLICT/i);
  assert.match(sql, /USER_DISMISSED/i);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE/i);
});
