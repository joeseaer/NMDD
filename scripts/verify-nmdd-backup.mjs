#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

const requestedRoot = process.argv[2];
if (!requestedRoot) {
  console.error('Usage: node scripts/verify-nmdd-backup.mjs <backup-directory>');
  process.exit(2);
}

const backupRoot = path.resolve(requestedRoot);
const dataRoot = path.basename(backupRoot) === 'data-export'
  ? backupRoot
  : path.join(backupRoot, 'data-export');

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function verifyChecksums() {
  const checksumPath = path.join(dataRoot, 'checksums.sha256');
  const lines = (await fs.readFile(checksumPath, 'utf8')).split(/\r?\n/).filter(Boolean);
  const failures = [];

  for (const line of lines) {
    const match = line.match(/^([0-9a-f]{64})  (.+)$/i);
    if (!match) {
      failures.push({ file: line, reason: 'invalid checksum line' });
      continue;
    }
    const filePath = path.join(dataRoot, ...match[2].split('/'));
    try {
      const actual = digest(await fs.readFile(filePath));
      if (actual.toLowerCase() !== match[1].toLowerCase()) {
        failures.push({ file: match[2], reason: 'sha256 mismatch' });
      }
    } catch (error) {
      failures.push({ file: match[2], reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { checked: lines.length, failures };
}

async function verifyTables(manifest) {
  const failures = [];
  let rowCount = 0;
  for (const [table, metadata] of Object.entries(manifest.tables || {})) {
    const rows = await readJson(path.join(dataRoot, 'tables', `${table}.json`));
    if (!Array.isArray(rows)) failures.push({ table, reason: 'export is not an array' });
    else if (rows.length !== metadata.row_count) {
      failures.push({ table, reason: `row count ${rows.length} != ${metadata.row_count}` });
    }
    rowCount += Array.isArray(rows) ? rows.length : 0;
  }
  return { tableCount: Object.keys(manifest.tables || {}).length, rowCount, failures };
}

async function verifyStorage(manifest) {
  const objects = await readJson(path.join(dataRoot, 'storage', 'objects.json'));
  const failures = [];
  let bytes = 0;
  for (const object of objects) {
    const objectPath = path.join(
      dataRoot,
      'storage',
      'objects',
      String(object.bucket_id).replace(/[^a-zA-Z0-9._-]/g, '_'),
      object.sha256,
    );
    try {
      const content = await fs.readFile(objectPath);
      bytes += content.length;
      if (digest(content) !== object.sha256) failures.push({ path: object.path, reason: 'sha256 mismatch' });
      if (content.length !== object.byte_count) failures.push({ path: object.path, reason: 'byte count mismatch' });
    } catch (error) {
      failures.push({ path: object.path, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  if (objects.length !== manifest.storage.object_count) {
    failures.push({ path: 'storage/objects.json', reason: 'manifest object count mismatch' });
  }
  if (bytes !== manifest.storage.byte_count) {
    failures.push({ path: 'storage/objects.json', reason: 'manifest byte count mismatch' });
  }
  return { objectCount: objects.length, bytes, failures };
}

async function verifyLocalRelationships(manifest) {
  const metadata = manifest.local_relationships;
  if (!metadata || metadata.status === 'not_yet_created') {
    return { status: metadata?.status || 'not_in_manifest', failures: [] };
  }
  const filePath = path.join(dataRoot, 'local', 'relationship-system.local.json');
  try {
    const bytes = await fs.readFile(filePath);
    const parsed = JSON.parse(bytes.toString('utf8'));
    const failures = [];
    if (!parsed || typeof parsed !== 'object' || !parsed.tables) {
      failures.push({ file: 'local/relationship-system.local.json', reason: 'invalid local relationship data shape' });
    }
    if (typeof metadata.byte_count === 'number' && bytes.length !== metadata.byte_count) {
      failures.push({ file: 'local/relationship-system.local.json', reason: 'byte count mismatch' });
    }
    return { status: failures.length ? 'failed' : 'complete', failures };
  } catch (error) {
    return {
      status: 'failed',
      failures: [{ file: 'local/relationship-system.local.json', reason: error instanceof Error ? error.message : String(error) }],
    };
  }
}

function verifyGitBundle() {
  if (path.basename(backupRoot) === 'data-export') return { status: 'not_in_scope' };
  const bundle = path.join(backupRoot, 'NMDD_repository_all_refs.bundle');
  try {
    execFileSync('git', ['bundle', 'verify', bundle], { stdio: 'pipe' });
    return { status: 'complete' };
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
  }
}

async function main() {
  const manifest = await readJson(path.join(dataRoot, 'manifest.json'));
  const [checksums, tables, storage, localRelationships] = await Promise.all([
    verifyChecksums(),
    verifyTables(manifest),
    verifyStorage(manifest),
    verifyLocalRelationships(manifest),
  ]);
  const bundle = verifyGitBundle();
  const failures = [
    ...checksums.failures,
    ...tables.failures,
    ...storage.failures,
    ...localRelationships.failures,
    ...(bundle.status === 'failed' ? [{ file: 'NMDD_repository_all_refs.bundle', reason: bundle.error }] : []),
  ];

  console.log(JSON.stringify({
    status: failures.length ? 'failed' : 'verified',
    backup_root: backupRoot,
    checksum_files: checksums.checked,
    tables: tables.tableCount,
    rows: tables.rowCount,
    storage_objects: storage.objectCount,
    storage_bytes: storage.bytes,
    git_bundle: bundle.status,
    chroma: manifest.chroma,
    local_relationships: localRelationships.status,
    failures,
  }, null, 2));
  if (failures.length) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
