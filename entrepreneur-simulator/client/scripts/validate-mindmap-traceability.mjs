#!/usr/bin/env node

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FULL_PRD_RE = /^PRD-[A-Z0-9]+(?:-[A-Z0-9]+)*-[0-9]{3}$/;
const FULL_ACC_RE = /^ACC-[A-Z0-9]+(?:-[A-Z0-9]+)*-[0-9]{3}$/;
const PRD_SCAN_RE = /PRD-[A-Z0-9]+(?:-[A-Z0-9]+)*-[0-9]{3}/g;
const ACC_SCAN_RE = /ACC-[A-Z0-9]+(?:-[A-Z0-9]+)*-[0-9]{3}/g;
const PRIORITY_RANK = new Map([
  ['P0', 0],
  ['P1', 1],
  ['P2', 2],
]);

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
export const DEFAULT_PATHS = Object.freeze({
  productSpec: path.join(REPO_ROOT, 'docs', 'xmind-parity', 'PRODUCT_SPEC.md'),
  acceptanceSpec: path.join(REPO_ROOT, 'docs', 'xmind-parity', 'INTERACTION_ACCEPTANCE.md'),
  implementationPlan: path.join(REPO_ROOT, 'docs', 'xmind-parity', 'IMPLEMENTATION_PLAN.md'),
  traceability: path.join(REPO_ROOT, 'docs', 'xmind-parity', 'traceability.json'),
  unitTests: path.join(REPO_ROOT, 'client', 'src', 'features', 'mindmap'),
  e2eTests: path.join(REPO_ROOT, 'client', 'e2e'),
});

const TEST_SOURCE_RE = /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/;
const FULL_COVERAGE_DIRECTIVE_RE = /^\s*(?:\/\/|\/\*+|\*)\s*@covers\b([^\r\n*]*)/gm;
const COVERAGE_TOKEN_RE = /ACC-[A-Za-z0-9-]+/g;

function uniqueInOrder(values) {
  return [...new Set(values)];
}

function compareIds(left, right) {
  return left.localeCompare(right, 'en');
}

function portablePath(filePath) {
  return filePath.split(path.sep).join('/');
}

async function findTestSourceFiles(root) {
  const files = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile() && TEST_SOURCE_RE.test(entry.name)) {
        files.push(entryPath);
      }
    }
  }

  await visit(root);
  return files.sort((left, right) => left.localeCompare(right, 'en'));
}

function extractFullCoverageAnnotations(content) {
  const ids = [];
  const invalid = [];
  let directiveCount = 0;

  for (const match of content.matchAll(FULL_COVERAGE_DIRECTIVE_RE)) {
    directiveCount += 1;
    const tokens = match[1].match(COVERAGE_TOKEN_RE) ?? [];
    if (tokens.length === 0) {
      invalid.push({ value: match[0].trim(), reason: 'missing-acc-id' });
      continue;
    }
    for (const token of tokens) {
      if (FULL_ACC_RE.test(token)) ids.push(token);
      else invalid.push({ value: token, reason: 'malformed-acc-id' });
    }
  }

  return { ids, invalid, directiveCount };
}

/**
 * Build two deliberately separate indexes:
 * - every ACC ID mention is a reference and is useful for gap reporting;
 * - only a dedicated test-source comment such as
 *   `// @covers ACC-TOP-001 ACC-KBD-001` is release-qualified evidence.
 *
 * Neither index proves execution. The release annotation is an explicit claim
 * that the named test(s) cover the complete acceptance contract and is therefore
 * intentionally impossible to obtain from an ordinary test title or fixture.
 */
export function analyzeAcceptanceEvidence({ acceptancePriorities, sources }) {
  const evidenceById = new Map();
  const unknownReferences = [];
  const invalidCoverageAnnotations = [];
  let referenceCount = 0;
  let qualifiedReferenceCount = 0;
  let referencedSourceFiles = 0;
  let qualifiedSourceFiles = 0;

  for (const source of sources) {
    const ids = source.content.match(ACC_SCAN_RE) ?? [];
    const coverage = extractFullCoverageAnnotations(source.content);
    const qualifiedIdsInSource = new Set(coverage.ids);
    referenceCount += ids.length;
    qualifiedReferenceCount += coverage.ids.length;
    if (ids.length > 0) referencedSourceFiles += 1;
    if (coverage.ids.length > 0) qualifiedSourceFiles += 1;
    invalidCoverageAnnotations.push(...coverage.invalid.map((annotation) => ({
      ...annotation,
      kind: source.kind,
      file: source.file,
    })));

    for (const id of uniqueInOrder(ids)) {
      if (!acceptancePriorities.has(id)) {
        unknownReferences.push({
          id,
          kind: source.kind,
          file: source.file,
          releaseQualified: qualifiedIdsInSource.has(id),
        });
        continue;
      }

      const current = evidenceById.get(id) ?? {
        id,
        priority: acceptancePriorities.get(id),
        unitFiles: new Set(),
        e2eFiles: new Set(),
        unitQualifiedFiles: new Set(),
        e2eQualifiedFiles: new Set(),
      };
      const target = source.kind === 'e2e' ? current.e2eFiles : current.unitFiles;
      target.add(source.file);
      evidenceById.set(id, current);
    }

    for (const id of qualifiedIdsInSource) {
      if (!acceptancePriorities.has(id)) continue;
      const current = evidenceById.get(id);
      if (!current) continue;
      const target = source.kind === 'e2e'
        ? current.e2eQualifiedFiles
        : current.unitQualifiedFiles;
      target.add(source.file);
    }
  }

  const referencedIds = [...evidenceById.keys()].sort(compareIds);
  const qualifiedIds = referencedIds.filter((id) => {
    const evidence = evidenceById.get(id);
    return evidence.unitQualifiedFiles.size > 0 || evidence.e2eQualifiedFiles.size > 0;
  });
  const unreferencedIds = [...acceptancePriorities.keys()]
    .filter((id) => !evidenceById.has(id))
    .sort(compareIds);
  const byPriority = {};

  for (const priority of PRIORITY_RANK.keys()) {
    const definedIds = [...acceptancePriorities]
      .filter(([, value]) => value === priority)
      .map(([id]) => id);
    const referenced = definedIds.filter((id) => evidenceById.has(id));
    const releaseQualified = definedIds.filter((id) => qualifiedIds.includes(id));
    byPriority[priority] = {
      defined: definedIds.length,
      referenced: referenced.length,
      unreferenced: definedIds.length - referenced.length,
      unreferencedIds: definedIds.filter((id) => !evidenceById.has(id)).sort(compareIds),
      releaseQualified: releaseQualified.length,
      missingReleaseQualification: definedIds.length - releaseQualified.length,
      missingReleaseQualificationIds: definedIds
        .filter((id) => !qualifiedIds.includes(id))
        .sort(compareIds),
    };
  }

  const unitReferenced = referencedIds.filter((id) => evidenceById.get(id).unitFiles.size > 0).length;
  const e2eReferenced = referencedIds.filter((id) => evidenceById.get(id).e2eFiles.size > 0).length;
  const unitQualified = qualifiedIds.filter((id) =>
    evidenceById.get(id).unitQualifiedFiles.size > 0).length;
  const e2eQualified = qualifiedIds.filter((id) =>
    evidenceById.get(id).e2eQualifiedFiles.size > 0).length;

  return {
    valid: unknownReferences.length === 0 && invalidCoverageAnnotations.length === 0,
    evidenceById,
    unknownReferences,
    invalidCoverageAnnotations,
    referencedIds,
    qualifiedIds,
    unreferencedIds,
    stats: {
      defined: acceptancePriorities.size,
      referenced: referencedIds.length,
      unreferenced: unreferencedIds.length,
      releaseQualified: qualifiedIds.length,
      missingReleaseQualification: acceptancePriorities.size - qualifiedIds.length,
      references: referenceCount,
      qualifiedReferences: qualifiedReferenceCount,
      referencedSourceFiles,
      qualifiedSourceFiles,
      unitReferenced,
      e2eReferenced,
      unitQualified,
      e2eQualified,
      byPriority,
    },
  };
}

export async function scanAcceptanceEvidence(paths, acceptancePriorities) {
  const groups = [
    { kind: 'unit', root: paths.unitTests },
    { kind: 'e2e', root: paths.e2eTests },
  ];
  const sources = [];

  for (const group of groups) {
    const files = await findTestSourceFiles(group.root);
    for (const file of files) {
      sources.push({
        kind: group.kind,
        file: portablePath(path.relative(REPO_ROOT, file)),
        content: await readFile(file, 'utf8'),
      });
    }
  }

  return analyzeAcceptanceEvidence({ acceptancePriorities, sources });
}

export function extractPrdIds(markdown) {
  return uniqueInOrder(markdown.match(PRD_SCAN_RE) ?? []);
}

export function extractAcceptancePriorities(markdown) {
  const priorities = new Map();
  const duplicates = [];
  const rowPattern = /^\|\s*(ACC-[A-Z0-9]+(?:-[A-Z0-9]+)*-[0-9]{3})\s*\|\s*(P[012])\s*\|/gm;

  for (const match of markdown.matchAll(rowPattern)) {
    const [, id, priority] = match;
    if (priorities.has(id)) {
      duplicates.push(id);
    } else {
      priorities.set(id, priority);
    }
  }

  return { priorities, duplicates };
}

function parseIdentifierPart(part, inheritedPrefix, kind) {
  const full = new RegExp(`^(${kind}-[A-Z0-9]+(?:-[A-Z0-9]+)*)-(\\*|[0-9]{3}(?:~[0-9]{3})?)$`).exec(part);
  if (full) {
    return { prefix: full[1], suffix: full[2] };
  }

  if (inheritedPrefix && /^(?:[0-9]{3})(?:~[0-9]{3})?$/.test(part)) {
    return { prefix: inheritedPrefix, suffix: part };
  }

  throw new Error(`无法解析 ${kind} 范围“${part}”`);
}

/**
 * Expand one matrix expression, including wildcard, inclusive ranges and slash
 * shorthand such as ACC-MSE-001~005/009/014/016.
 */
export function expandIdentifierExpression(expression, knownIds, kind) {
  const known = knownIds instanceof Set ? knownIds : new Set(knownIds);
  const parts = expression.replace(/`/g, '').trim().split('/').map((part) => part.trim()).filter(Boolean);
  const expanded = [];
  let inheritedPrefix;

  for (const part of parts) {
    const parsed = parseIdentifierPart(part, inheritedPrefix, kind);
    inheritedPrefix = parsed.prefix;

    if (parsed.suffix === '*') {
      const matches = [...known].filter((id) => id.startsWith(`${parsed.prefix}-`)).sort(compareIds);
      if (matches.length === 0) {
        throw new Error(`通配符“${part}”未匹配任何 ${kind} ID`);
      }
      expanded.push(...matches);
      continue;
    }

    const range = /^([0-9]{3})(?:~([0-9]{3}))?$/.exec(parsed.suffix);
    const start = Number(range[1]);
    const end = Number(range[2] ?? range[1]);
    if (end < start) {
      throw new Error(`倒序范围“${part}”无效`);
    }

    for (let value = start; value <= end; value += 1) {
      const id = `${parsed.prefix}-${String(value).padStart(3, '0')}`;
      if (!known.has(id)) {
        throw new Error(`范围“${expression}”引用不存在的 ID ${id}`);
      }
      expanded.push(id);
    }
  }

  return uniqueInOrder(expanded);
}

export function expandAcceptanceExpression(expression, knownIds) {
  return expandIdentifierExpression(expression, knownIds, 'ACC');
}

export function extractDeclaredPhases(implementationPlan) {
  const sectionStart = implementationPlan.search(/^##\s+4\./m);
  const sectionTail = sectionStart >= 0 ? implementationPlan.slice(sectionStart) : implementationPlan;
  const nextSection = sectionTail.slice(1).search(/^##\s+/m);
  const section = nextSection >= 0 ? sectionTail.slice(0, nextSection + 1) : sectionTail;
  const phases = [];

  for (const match of section.matchAll(/^\|\s*([0-9]+(?:[A-Z])?)\s*\|/gm)) {
    if (!phases.includes(match[1])) phases.push(match[1]);
  }

  if (phases.length === 0) {
    throw new Error('IMPLEMENTATION_PLAN 未声明 Phase 路线表');
  }
  return phases;
}

export function expandPhaseCell(cell, declaredPhases) {
  const expanded = [];
  const add = (phase) => {
    if (!declaredPhases.includes(phase)) {
      throw new Error(`追踪矩阵引用不存在的 Phase ${phase}`);
    }
    if (!expanded.includes(phase)) expanded.push(phase);
  };

  for (const token of cell.split(/[、,，]/).map((part) => part.trim()).filter(Boolean)) {
    const range = /^([0-9]+(?:[A-Z])?)[–—-]([0-9]+(?:[A-Z])?)$/.exec(token);
    if (!range) {
      add(token);
      continue;
    }

    const start = declaredPhases.indexOf(range[1]);
    const end = declaredPhases.indexOf(range[2]);
    if (start < 0 || end < start) {
      throw new Error(`追踪矩阵 Phase 范围“${token}”无效`);
    }
    for (const phase of declaredPhases.slice(start, end + 1)) add(phase);
  }

  return expanded.map((phase) => `Phase ${phase}`);
}

function matrixSection(implementationPlan) {
  const heading = /^##\s+\d+\.\s+PRD\s*→\s*Phase\s*→\s*ACC\s+追踪矩阵\s*$/m;
  const match = heading.exec(implementationPlan);
  if (!match) throw new Error('IMPLEMENTATION_PLAN 缺少 PRD → Phase → ACC 追踪矩阵');
  const tail = implementationPlan.slice(match.index + match[0].length);
  const nextHeading = tail.search(/^##\s+/m);
  return nextHeading >= 0 ? tail.slice(0, nextHeading) : tail;
}

function codeExpressions(cell, kind) {
  const values = [];
  for (const match of cell.matchAll(/`([^`]+)`/g)) {
    if (match[1].startsWith(`${kind}-`)) values.push(match[1]);
  }
  return values;
}

export function deriveMatrixTrace({ productSpec, acceptanceSpec, implementationPlan }) {
  const prdIds = extractPrdIds(productSpec);
  const prdSet = new Set(prdIds);
  const { priorities: acceptancePriorities, duplicates } = extractAcceptancePriorities(acceptanceSpec);
  if (duplicates.length > 0) {
    throw new Error(`INTERACTION_ACCEPTANCE 存在重复 ID：${uniqueInOrder(duplicates).join(', ')}`);
  }

  const acceptanceSet = new Set(acceptancePriorities.keys());
  const declaredPhases = extractDeclaredPhases(implementationPlan);
  const assignments = new Map();
  const section = matrixSection(implementationPlan);

  for (const line of section.split(/\r?\n/)) {
    if (!line.trim().startsWith('|') || /^\|\s*[-:]+/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 3 || !cells[0].includes('PRD-')) continue;

    const prdExpressions = codeExpressions(cells[0], 'PRD');
    const prds = uniqueInOrder(prdExpressions.flatMap((expression) =>
      expandIdentifierExpression(expression, prdSet, 'PRD')));
    if (prds.length === 0) throw new Error(`矩阵行没有可展开 PRD：${line}`);

    const acceptanceExpressions = codeExpressions(cells[2], 'ACC');
    let acceptanceIds;
    if (acceptanceExpressions.length === 0 && /P0\s*\/\s*P1/.test(cells[2])) {
      acceptanceIds = [...acceptancePriorities]
        .filter(([, priority]) => priority === 'P0' || priority === 'P1')
        .map(([id]) => id);
    } else {
      acceptanceIds = uniqueInOrder(acceptanceExpressions.flatMap((expression) =>
        expandAcceptanceExpression(expression, acceptanceSet)));
    }
    if (acceptanceIds.length === 0) throw new Error(`矩阵行没有完整 ACC 映射：${line}`);

    const ownerPhases = expandPhaseCell(cells[1], declaredPhases);
    const exactSelector = prdExpressions.length === 1
      && prds.length === 1
      && FULL_PRD_RE.test(prdExpressions[0]);
    const source = exactSelector ? 'exact-matrix' : 'group-matrix';

    for (const id of prds) {
      if (assignments.has(id)) {
        throw new Error(`追踪矩阵重复覆盖 ${id}`);
      }
      assignments.set(id, { acceptanceIds, ownerPhases, source });
    }
  }

  const missing = prdIds.filter((id) => !assignments.has(id));
  if (missing.length > 0) {
    throw new Error(`追踪矩阵未覆盖 ${missing.length} 个 PRD：${missing.join(', ')}`);
  }

  return { prdIds, acceptancePriorities, declaredPhases, assignments };
}

export function highestPriority(acceptanceIds, acceptancePriorities) {
  const priorities = acceptanceIds.map((id) => acceptancePriorities.get(id)).filter(Boolean);
  if (priorities.length === 0) return undefined;
  return priorities.reduce((highest, priority) =>
    PRIORITY_RANK.get(priority) < PRIORITY_RANK.get(highest) ? priority : highest);
}

export function buildTraceability(documents) {
  const derived = deriveMatrixTrace(documents);
  const items = derived.prdIds.map((id) => {
    const assignment = derived.assignments.get(id);
    return {
      id,
      priority: highestPriority(assignment.acceptanceIds, derived.acceptancePriorities),
      ownerPhases: assignment.ownerPhases,
      acceptanceIds: assignment.acceptanceIds,
      source: assignment.source,
    };
  });

  return {
    schemaVersion: 1,
    sourceDocuments: [
      'PRODUCT_SPEC.md',
      'INTERACTION_ACCEPTANCE.md',
      'IMPLEMENTATION_PLAN.md',
    ],
    counts: {
      prd: items.length,
      acceptance: derived.acceptancePriorities.size,
      links: items.reduce((total, item) => total + item.acceptanceIds.length, 0),
    },
    items,
  };
}

function sameSet(left, right) {
  return left.length === right.length && left.every((value) => right.includes(value));
}

export function validateTraceability({ productSpec, acceptanceSpec, implementationPlan, traceability }) {
  const errors = [];
  const prdOccurrences = productSpec.match(PRD_SCAN_RE) ?? [];
  const prdIds = uniqueInOrder(prdOccurrences);
  const prdSet = new Set(prdIds);
  const duplicatedPrdsInSpec = uniqueInOrder(prdOccurrences.filter((id, index) => prdOccurrences.indexOf(id) !== index));
  if (prdIds.length === 0) errors.push('PRODUCT_SPEC 至少应定义一个唯一 PRD');
  if (duplicatedPrdsInSpec.length > 0) errors.push(`PRODUCT_SPEC 存在重复 PRD：${duplicatedPrdsInSpec.join(', ')}`);

  const { priorities: acceptancePriorities, duplicates: duplicatedAcceptances } = extractAcceptancePriorities(acceptanceSpec);
  if (duplicatedAcceptances.length > 0) {
    errors.push(`INTERACTION_ACCEPTANCE 存在重复 ACC：${uniqueInOrder(duplicatedAcceptances).join(', ')}`);
  }

  let derived;
  try {
    derived = deriveMatrixTrace({ productSpec, acceptanceSpec, implementationPlan });
  } catch (error) {
    errors.push(`无法解析追踪矩阵：${error.message}`);
  }

  if (!traceability || typeof traceability !== 'object' || Array.isArray(traceability)) {
    errors.push('traceability.json 顶层必须是对象');
    return { valid: false, errors, stats: { prd: prdIds.length, acceptance: acceptancePriorities.size, items: 0, links: 0 } };
  }
  if (!Array.isArray(traceability.items)) {
    errors.push('traceability.items 必须是数组');
    return { valid: false, errors, stats: { prd: prdIds.length, acceptance: acceptancePriorities.size, items: 0, links: 0 } };
  }

  const seenPrds = new Set();
  let links = 0;
  for (const [index, item] of traceability.items.entries()) {
    const label = item && typeof item.id === 'string' ? item.id : `items[${index}]`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(`items[${index}] 必须是对象`);
      continue;
    }
    if (!FULL_PRD_RE.test(item.id ?? '')) {
      errors.push(`${label} 的 id 不是完整 PRD ID`);
    } else {
      if (seenPrds.has(item.id)) errors.push(`traceability 存在重复 PRD：${item.id}`);
      seenPrds.add(item.id);
      if (!prdSet.has(item.id)) errors.push(`traceability 引用未知 PRD：${item.id}`);
    }

    if (!Array.isArray(item.ownerPhases) || item.ownerPhases.length === 0
      || item.ownerPhases.some((phase) => typeof phase !== 'string' || phase.trim() === '')) {
      errors.push(`${label} 的 ownerPhases 必须是非空字符串数组`);
    }

    if (!Array.isArray(item.acceptanceIds) || item.acceptanceIds.length === 0) {
      errors.push(`${label} 至少需要一个 acceptanceIds`);
      continue;
    }

    links += item.acceptanceIds.length;
    const seenAcceptances = new Set();
    for (const acceptanceId of item.acceptanceIds) {
      if (typeof acceptanceId !== 'string' || !FULL_ACC_RE.test(acceptanceId)) {
        errors.push(`${label} 含非完整 ACC ID：${String(acceptanceId)}`);
        continue;
      }
      if (seenAcceptances.has(acceptanceId)) errors.push(`${label} 重复引用 ACC：${acceptanceId}`);
      seenAcceptances.add(acceptanceId);
      if (!acceptancePriorities.has(acceptanceId)) errors.push(`${label} 引用未知 ACC：${acceptanceId}`);
    }

    const expectedPriority = highestPriority(item.acceptanceIds, acceptancePriorities);
    if (!PRIORITY_RANK.has(item.priority)) {
      errors.push(`${label} 的 priority 必须为 P0/P1/P2`);
    } else if (expectedPriority && item.priority !== expectedPriority) {
      errors.push(`${label} priority 应为 ${expectedPriority}，实际 ${item.priority}`);
    }

    if (derived?.assignments.has(item.id)) {
      const expected = derived.assignments.get(item.id);
      if (!sameSet(item.acceptanceIds, expected.acceptanceIds)) {
        const missing = expected.acceptanceIds.filter((id) => !item.acceptanceIds.includes(id));
        const extra = item.acceptanceIds.filter((id) => !expected.acceptanceIds.includes(id));
        errors.push(`${label} 未忠实展开矩阵（缺少 ${missing.join(', ') || '无'}；多出 ${extra.join(', ') || '无'}）`);
      }
      if (!sameSet(item.ownerPhases ?? [], expected.ownerPhases)) {
        errors.push(`${label} ownerPhases 与矩阵不一致`);
      }
      if (item.source !== expected.source) {
        errors.push(`${label} source 应为 ${expected.source}`);
      }
    }
  }

  for (const id of prdIds) {
    if (!seenPrds.has(id)) errors.push(`traceability 缺少 PRD：${id}`);
  }
  if (traceability.items.length !== prdIds.length) {
    errors.push(`traceability.items 应与 PRODUCT_SPEC 的 ${prdIds.length} 个 PRD 一一对应，实际 ${traceability.items.length}`);
  }

  if (traceability.counts) {
    if (traceability.counts.prd !== traceability.items.length) errors.push('counts.prd 与 items 数量不一致');
    if (traceability.counts.acceptance !== acceptancePriorities.size) errors.push('counts.acceptance 与 ACC 数量不一致');
    if (traceability.counts.links !== links) errors.push('counts.links 与实际链接数不一致');
  }

  return {
    valid: errors.length === 0,
    errors,
    stats: {
      prd: prdIds.length,
      acceptance: acceptancePriorities.size,
      items: traceability.items.length,
      links,
    },
  };
}

export async function loadDocuments(paths = DEFAULT_PATHS) {
  const [productSpec, acceptanceSpec, implementationPlan] = await Promise.all([
    readFile(paths.productSpec, 'utf8'),
    readFile(paths.acceptanceSpec, 'utf8'),
    readFile(paths.implementationPlan, 'utf8'),
  ]);
  return { productSpec, acceptanceSpec, implementationPlan };
}

export async function runCli(
  argv = process.argv.slice(2),
  paths = DEFAULT_PATHS,
  io = { stdout: process.stdout, stderr: process.stderr },
) {
  const documents = await loadDocuments(paths);
  if (argv.includes('--print-generated')) {
    io.stdout.write(`${JSON.stringify(buildTraceability(documents), null, 2)}\n`);
    return 0;
  }

  let traceability;
  try {
    traceability = JSON.parse(await readFile(paths.traceability, 'utf8'));
  } catch (error) {
    io.stderr.write(`traceability.json 读取失败：${error.message}\n`);
    return 1;
  }

  const result = validateTraceability({ ...documents, traceability });
  if (!result.valid) {
    io.stderr.write(`Mind-map traceability 校验失败（${result.errors.length} 项）：\n`);
    for (const error of result.errors) io.stderr.write(`- ${error}\n`);
    return 1;
  }

  const { priorities: acceptancePriorities } = extractAcceptancePriorities(documents.acceptanceSpec);
  let evidence;
  try {
    evidence = await scanAcceptanceEvidence(paths, acceptancePriorities);
  } catch (error) {
    io.stderr.write(`自动化证据源码扫描失败：${error.message}\n`);
    return 1;
  }

  if (!evidence.valid) {
    const errorCount = evidence.unknownReferences.length + evidence.invalidCoverageAnnotations.length;
    io.stderr.write(`自动化证据引用校验失败（${errorCount} 项）：\n`);
    for (const reference of evidence.unknownReferences) {
      const kind = reference.releaseQualified ? '未知 @covers' : '未知普通 ACC 引用';
      io.stderr.write(`- ${reference.file} 包含${kind}：${reference.id}\n`);
    }
    for (const annotation of evidence.invalidCoverageAnnotations) {
      io.stderr.write(`- ${annotation.file} 包含无效 @covers 声明：${annotation.value}\n`);
    }
    return 1;
  }

  io.stdout.write(
    `规格结构校验通过：${result.stats.items}/${result.stats.prd} PRD 已映射到 `
    + `${result.stats.acceptance} 条 ACC（${result.stats.links} 条规格链接）。\n`,
  );
  io.stdout.write(
    'Referenced 证据索引（测试源码中的普通 ACC 提及，不代表完整覆盖或测试通过）：'
    + `${evidence.stats.referenced}/${evidence.stats.defined} ACC；`
    + `unit ${evidence.stats.unitReferenced}，E2E ${evidence.stats.e2eReferenced}；`
    + [...PRIORITY_RANK.keys()]
      .map((priority) => {
        const stats = evidence.stats.byPriority[priority];
        return `${priority} ${stats.referenced}/${stats.defined}`;
      })
      .join('，')
    + '。\n',
  );
  io.stdout.write(
    'Release-qualified 证据（仅专用注释行的 @covers 完整验收声明）：'
    + `${evidence.stats.releaseQualified}/${evidence.stats.defined} ACC；`
    + `unit ${evidence.stats.unitQualified}，E2E ${evidence.stats.e2eQualified}；`
    + [...PRIORITY_RANK.keys()]
      .map((priority) => {
        const stats = evidence.stats.byPriority[priority];
        return `${priority} ${stats.releaseQualified}/${stats.defined}`;
      })
      .join('，')
    + '。\n',
  );

  if (argv.includes('--release')) {
    const missingP0 = evidence.stats.byPriority.P0.missingReleaseQualificationIds;
    if (missingP0.length > 0) {
      const preview = missingP0.slice(0, 20).join(', ');
      const remainder = missingP0.length > 20 ? `（另有 ${missingP0.length - 20} 条）` : '';
      io.stderr.write(
        `Release 自动化证据门禁失败：${missingP0.length} 条 P0 ACC 缺少 @covers 完整验收声明：`
        + `${preview}${remainder}\n`,
      );
      return 1;
    }
    io.stdout.write('Release 自动化证据门禁通过：所有 P0 ACC 均有 @covers 完整验收声明。\n');
  } else if (evidence.stats.missingReleaseQualification > 0) {
    io.stdout.write(
      `提示：仍有 ${evidence.stats.missingReleaseQualification} 条 ACC 缺少 @covers 完整验收声明；`
      + '默认模式仅报告差距，发布门禁请运行 --release。\n',
    );
  }

  return 0;
}

const isMain = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  runCli().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
