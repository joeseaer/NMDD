#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceDir = path.resolve(scriptDir, '..');
const serverDir = path.join(workspaceDir, 'entrepreneur-simulator', 'server');
const serverRequire = createRequire(path.join(serverDir, 'package.json'));
const dotenv = serverRequire('dotenv');
const { createClient } = serverRequire('@supabase/supabase-js');

dotenv.config({ path: path.join(serverDir, '.env') });

const localRelationshipFile = path.resolve(
  process.env.RELATIONSHIP_LOCAL_FILE
    || path.join(serverDir, 'data', 'relationship-system.local.json'),
);

const args = process.argv.slice(2);
const backupArg = args.find((arg) => !arg.startsWith('--'));
const execute = args.includes('--execute');
const allowNonempty = args.includes('--allow-nonempty');

if (!backupArg) {
  console.error('Usage: node scripts/restore-nmdd-data.mjs <backup-directory> [--execute] [--allow-nonempty]');
  process.exit(2);
}

const backupRoot = path.resolve(backupArg);
const dataRoot = path.basename(backupRoot) === 'data-export'
  ? backupRoot
  : path.join(backupRoot, 'data-export');
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !serviceKey) {
  throw new Error('SUPABASE_URL or SUPABASE_SERVICE_KEY is missing.');
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const preferredOrder = [
  'people_profiles',
  'scenes',
  'sops',
  'whiteboards',
  'planner_lists',
  'planner_tags',
  'interaction_logs',
  'review_sessions',
  'sop_versions',
  'sop_usage_logs',
  'scene_sop_rel',
  'people_sop_rel',
  'whiteboard_assets',
  'whiteboard_document_refs',
  'planner_items',
  'planner_item_tags',
];

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(dataRoot, relativePath), 'utf8'));
}

async function inspectTarget(tables) {
  const counts = {};
  for (const table of tables) {
    const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
    if (error) throw new Error(`Target schema is not ready for ${table}: ${error.message}`);
    counts[table] = count || 0;
  }
  return counts;
}

async function insertRows(table, rows) {
  for (let offset = 0; offset < rows.length; offset += 250) {
    const batch = rows.slice(offset, offset + 250);
    const { error } = await supabase.from(table).insert(batch);
    if (error) throw new Error(`Restore failed for ${table} at row ${offset}: ${error.message}`);
  }
}

async function restoreStorage() {
  const buckets = await readJson(path.join('storage', 'buckets.json'));
  const objects = await readJson(path.join('storage', 'objects.json'));
  const { data: targetBuckets, error: bucketListError } = await supabase.storage.listBuckets();
  if (bucketListError) throw new Error(`Could not inspect target storage: ${bucketListError.message}`);
  const targetIds = new Set((targetBuckets || []).map((bucket) => bucket.id));

  for (const bucket of buckets) {
    if (!targetIds.has(bucket.id)) {
      const { error } = await supabase.storage.createBucket(bucket.id, {
        public: Boolean(bucket.public),
        fileSizeLimit: bucket.file_size_limit || undefined,
        allowedMimeTypes: bucket.allowed_mime_types || undefined,
      });
      if (error) throw new Error(`Could not create bucket ${bucket.id}: ${error.message}`);
    }
  }

  for (const object of objects) {
    const bytes = await fs.readFile(path.join(
      dataRoot,
      'storage',
      'objects',
      String(object.bucket_id).replace(/[^a-zA-Z0-9._-]/g, '_'),
      object.sha256,
    ));
    const contentType = object.metadata?.metadata?.mimetype
      || object.metadata?.metadata?.contentType
      || 'application/octet-stream';
    const { error } = await supabase.storage.from(object.bucket_id).upload(object.path, bytes, {
      contentType,
      upsert: allowNonempty,
    });
    if (error) throw new Error(`Could not restore ${object.bucket_id}/${object.path}: ${error.message}`);
  }
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function restoreLocalRelationshipData(sourceExists) {
  if (!sourceExists) return { status: 'not_in_backup' };
  await fs.mkdir(path.dirname(localRelationshipFile), { recursive: true });
  const targetExists = await pathExists(localRelationshipFile);
  if (targetExists && !allowNonempty) {
    throw new Error(`Local relationship data already exists at ${localRelationshipFile}. Restore aborted.`);
  }
  if (targetExists) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await fs.copyFile(localRelationshipFile, `${localRelationshipFile}.pre-restore-${stamp}.bak`);
  }
  const source = path.join(dataRoot, 'local', 'relationship-system.local.json');
  const temp = `${localRelationshipFile}.${process.pid}.restore.tmp`;
  await fs.copyFile(source, temp);
  if (targetExists) await fs.rm(localRelationshipFile, { force: true });
  await fs.rename(temp, localRelationshipFile);
  return { status: 'restored', target: localRelationshipFile };
}

async function main() {
  const manifest = await readJson('manifest.json');
  const available = Object.keys(manifest.tables || {});
  const tables = [
    ...preferredOrder.filter((table) => available.includes(table)),
    ...available.filter((table) => !preferredOrder.includes(table)).sort(),
  ];
  const targetCounts = await inspectTarget(tables);
  const occupied = Object.entries(targetCounts).filter(([, count]) => count > 0);
  const localSourceExists = await pathExists(path.join(dataRoot, 'local', 'relationship-system.local.json'));
  const localTargetExists = await pathExists(localRelationshipFile);

  const plan = {
    mode: execute ? 'execute' : 'dry-run',
    backup_root: backupRoot,
    target_host: new URL(supabaseUrl).host,
    table_rows: Object.fromEntries(tables.map((table) => [table, manifest.tables[table].row_count])),
    target_counts: targetCounts,
    storage_buckets: manifest.storage.bucket_count,
    storage_objects: manifest.storage.object_count,
    auth_users: manifest.auth.user_count,
    local_relationships: {
      included: localSourceExists,
      target: localRelationshipFile,
      target_exists: localTargetExists,
    },
    warning: 'Auth exports are archival metadata only; this tool does not recreate login credentials.',
  };
  console.log(JSON.stringify(plan, null, 2));

  if (!execute) {
    console.log('Dry run only. Re-run with --execute after verifying the target project and schema.');
    return;
  }
  if (occupied.length && !allowNonempty) {
    throw new Error(`Target is not empty (${occupied.map(([table, count]) => `${table}:${count}`).join(', ')}). Restore aborted.`);
  }
  if (localSourceExists && localTargetExists && !allowNonempty) {
    throw new Error(`Local relationship data already exists at ${localRelationshipFile}. Restore aborted.`);
  }

  for (const table of tables) {
    const rows = await readJson(path.join('tables', `${table}.json`));
    await insertRows(table, rows);
  }
  await restoreStorage();
  const localRestore = await restoreLocalRelationshipData(localSourceExists);

  const finalCounts = await inspectTarget(tables);
  for (const table of tables) {
    const expectedMinimum = targetCounts[table] + manifest.tables[table].row_count;
    if (!allowNonempty && finalCounts[table] !== expectedMinimum) {
      throw new Error(`Post-restore row count mismatch for ${table}: ${finalCounts[table]} != ${expectedMinimum}`);
    }
  }

  console.log(JSON.stringify({ status: 'restored', final_counts: finalCounts, local_relationships: localRestore }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
