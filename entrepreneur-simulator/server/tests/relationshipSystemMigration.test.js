const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.resolve(
  __dirname,
  '../../../supabase/migrations/20260715_add_relationship_system.sql'
);
const sql = fs.readFileSync(migrationPath, 'utf8');
const executableSql = sql.replace(/^\s*--.*$/gm, '');

const expectedTables = [
  'relationship_compasses',
  'relationship_contexts',
  'relationship_interactions',
  'relationship_claims',
  'relationship_claim_evidence',
  'relationship_decisions',
  'relationship_decision_outcomes',
  'relationship_opportunities',
  'relationship_opportunity_experiments',
  'relationship_weekly_reviews',
  'relationship_growth_patterns',
  'relationship_ai_proposals',
];

test('relationship migration is additive and contains every v1 entity', () => {
  for (const table of expectedTables) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, 'i'), table);
  }
  assert.doesNotMatch(executableSql, /DROP\s+TABLE/i);
  assert.doesNotMatch(executableSql, /\bprivate_info\b/i);
  assert.doesNotMatch(executableSql, /\binteraction_logs\b/i);
});

test('relationship migration enables RLS, ownership policies and ownership foreign keys', () => {
  assert.match(sql, /ALTER TABLE %I ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /CREATE POLICY rs_owner_all/i);
  assert.match(sql, /auth\.uid\(\)::text = user_id/i);
  assert.match(sql, /FOREIGN KEY \(person_id, user_id\) REFERENCES people_profiles \(id, user_id\)/i);
  assert.match(sql, /UNIQUE \(user_id, client_idempotency_key\)/i);
});

test('all mutable relationship tables carry optimistic versions', () => {
  const versionDeclarations = sql.match(/version INTEGER NOT NULL DEFAULT 1 CHECK \(version >= 1\)/g) || [];
  assert.equal(versionDeclarations.length, expectedTables.length);
});
