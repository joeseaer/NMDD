import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  DEFAULT_PATHS,
  analyzeAcceptanceEvidence,
  expandAcceptanceExpression,
  extractAcceptancePriorities,
  loadDocuments,
  runCli,
  validateTraceability,
} from './validate-mindmap-traceability.mjs';

async function loadFixture() {
  const documents = await loadDocuments();
  const traceability = JSON.parse(await readFile(DEFAULT_PATHS.traceability, 'utf8'));
  return { documents, traceability };
}

function mutate(traceability, callback) {
  const copy = structuredClone(traceability);
  callback(copy);
  return copy;
}

function assertRejected(documents, traceability, pattern) {
  const result = validateTraceability({ ...documents, traceability });
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), pattern);
}

test('canonical traceability structurally maps all 211 PRDs and 300 ACC definitions', async () => {
  const { documents, traceability } = await loadFixture();
  const result = validateTraceability({ ...documents, traceability });

  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
  assert.deepEqual(result.stats, {
    prd: 211,
    acceptance: 300,
    items: 211,
    links: 9304,
  });
});

test('ordinary references and explicit full-coverage annotations are indexed separately', () => {
  const acceptancePriorities = new Map([
    ['ACC-CORE-001', 'P0'],
    ['ACC-DESKTOP-001', 'P1'],
    ['ACC-EXT-001', 'P2'],
  ]);
  const result = analyzeAcceptanceEvidence({
    acceptancePriorities,
    sources: [
      {
        kind: 'unit',
        file: 'unit/example.test.ts',
        content: [
          '// @covers ACC-CORE-001',
          "it('ACC-CORE-001 and ACC-EXT-001', () => {});",
          "const nonComment = '// @covers ACC-EXT-001';",
          '// @covers ACC-BAD-01',
        ].join('\n'),
      },
      {
        kind: 'e2e',
        file: 'e2e/example.spec.ts',
        content: [
          '// @covers ACC-DESKTOP-001 ACC-UNKNOWN-998',
          "test('ACC-DESKTOP-001 and ACC-UNKNOWN-999', () => {});",
        ].join('\n'),
      },
    ],
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.referencedIds, ['ACC-CORE-001', 'ACC-DESKTOP-001', 'ACC-EXT-001']);
  assert.deepEqual(result.qualifiedIds, ['ACC-CORE-001', 'ACC-DESKTOP-001']);
  assert.deepEqual(result.unknownReferences, [
    {
      id: 'ACC-UNKNOWN-998',
      kind: 'e2e',
      file: 'e2e/example.spec.ts',
      releaseQualified: true,
    },
    {
      id: 'ACC-UNKNOWN-999',
      kind: 'e2e',
      file: 'e2e/example.spec.ts',
      releaseQualified: false,
    },
  ]);
  assert.deepEqual(result.invalidCoverageAnnotations, [{
    value: 'ACC-BAD-01',
    reason: 'malformed-acc-id',
    kind: 'unit',
    file: 'unit/example.test.ts',
  }]);
  assert.equal(result.stats.defined, 3);
  assert.equal(result.stats.referenced, 3);
  assert.equal(result.stats.releaseQualified, 2);
  assert.equal(result.stats.unitReferenced, 2);
  assert.equal(result.stats.e2eReferenced, 1);
  assert.equal(result.stats.unitQualified, 1);
  assert.equal(result.stats.e2eQualified, 1);
  assert.deepEqual(result.stats.byPriority.P0, {
    defined: 1,
    referenced: 1,
    unreferenced: 0,
    unreferencedIds: [],
    releaseQualified: 1,
    missingReleaseQualification: 0,
    missingReleaseQualificationIds: [],
  });
  assert.deepEqual(
    result.stats.byPriority.P2.missingReleaseQualificationIds,
    ['ACC-EXT-001'],
  );
});

test('range parser expands wildcards, ranges, shorthand and a changed prefix', async () => {
  const documents = await loadDocuments();
  const { priorities } = extractAcceptancePriorities(documents.acceptanceSpec);
  const known = new Set(priorities.keys());

  assert.equal(expandAcceptanceExpression('ACC-TOP-*', known).length, 16);
  assert.deepEqual(
    expandAcceptanceExpression('ACC-MSE-001~003/009/ACC-NAV-006~007', known),
    [
      'ACC-MSE-001',
      'ACC-MSE-002',
      'ACC-MSE-003',
      'ACC-MSE-009',
      'ACC-NAV-006',
      'ACC-NAV-007',
    ],
  );
  assert.throws(
    () => expandAcceptanceExpression('ACC-MSE-001~099', known),
    /引用不存在的 ID/,
  );
});

test('validator rejects missing, duplicate and unknown PRD records', async () => {
  const { documents, traceability } = await loadFixture();

  assertRejected(documents, mutate(traceability, (copy) => copy.items.pop()), /缺少 PRD/);
  assertRejected(documents, mutate(traceability, (copy) => {
    copy.items.push(structuredClone(copy.items[0]));
  }), /重复 PRD/);
  assertRejected(documents, mutate(traceability, (copy) => {
    copy.items[0].id = 'PRD-UNKNOWN-999';
  }), /未知 PRD/);
});

test('validator rejects missing or unknown ACC, priority drift and empty phases', async () => {
  const { documents, traceability } = await loadFixture();

  assertRejected(documents, mutate(traceability, (copy) => {
    copy.items[0].acceptanceIds = [];
  }), /至少需要一个 acceptanceIds/);
  assertRejected(documents, mutate(traceability, (copy) => {
    copy.items[0].acceptanceIds[0] = 'ACC-UNKNOWN-999';
  }), /未知 ACC/);
  assertRejected(documents, mutate(traceability, (copy) => {
    copy.items[0].priority = 'P2';
  }), /priority 应为 P0/);
  assertRejected(documents, mutate(traceability, (copy) => {
    copy.items[0].ownerPhases = [];
  }), /ownerPhases 必须是非空/);
});

test('CLI returns a non-zero code for an invalid traceability asset', async () => {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'mindmap-traceability-'));
  const traceabilityPath = path.join(temporaryDirectory, 'traceability.json');
  try {
    await writeFile(traceabilityPath, JSON.stringify({ schemaVersion: 1, items: [] }), 'utf8');
    const sink = { write() {} };
    const exitCode = await runCli(
      [],
      { ...DEFAULT_PATHS, traceability: traceabilityPath },
      { stdout: sink, stderr: sink },
    );
    assert.equal(exitCode, 1);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('CLI reports evidence gaps by default and release mode fails when P0 evidence is missing', async () => {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'mindmap-evidence-'));
  const unitTests = path.join(temporaryDirectory, 'unit');
  const e2eTests = path.join(temporaryDirectory, 'e2e');
  try {
    await Promise.all([
      mkdir(unitTests, { recursive: true }),
      mkdir(e2eTests, { recursive: true }),
    ]);
    await writeFile(
      path.join(unitTests, 'evidence.test.ts'),
      "it('ACC-SEM-015 and ACC-IO-020 are ordinary references only', () => {});",
      'utf8',
    );

    const stdout = [];
    const stderr = [];
    const paths = { ...DEFAULT_PATHS, unitTests, e2eTests };
    const io = {
      stdout: { write(value) { stdout.push(value); } },
      stderr: { write(value) { stderr.push(value); } },
    };

    assert.equal(await runCli([], paths, io), 0);
    assert.match(stdout.join(''), /规格结构校验通过/);
    assert.match(stdout.join(''), /Referenced 证据索引.*2\/300 ACC/);
    assert.match(stdout.join(''), /P0 1\/102/);
    assert.match(stdout.join(''), /Release-qualified 证据.*0\/300 ACC/);
    assert.match(stdout.join(''), /P0 0\/102/);
    assert.match(stdout.join(''), /默认模式仅报告差距/);

    assert.equal(await runCli(['--release'], paths, io), 1);
    assert.match(stderr.join(''), /Release 自动化证据门禁失败：102 条 P0 ACC 缺少 @covers/);

    await writeFile(
      path.join(unitTests, 'evidence.test.ts'),
      [
        '// @covers ACC-IO-020',
        "it('ACC-SEM-015 and ACC-IO-020', () => {});",
      ].join('\n'),
      'utf8',
    );
    assert.equal(await runCli(['--release'], paths, io), 1);
    assert.match(stderr.join(''), /Release 自动化证据门禁失败：101 条 P0 ACC/);

    await writeFile(
      path.join(e2eTests, 'unknown.spec.ts'),
      [
        '// @covers ACC-UNKNOWN-998',
        "test('ACC-UNKNOWN-999 must not silently pass', () => {});",
      ].join('\n'),
      'utf8',
    );
    assert.equal(await runCli([], paths, io), 1);
    assert.match(stderr.join(''), /未知 @covers：ACC-UNKNOWN-998/);
    assert.match(stderr.join(''), /未知普通 ACC 引用：ACC-UNKNOWN-999/);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
