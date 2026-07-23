#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceDir = path.resolve(scriptDir, '..');
const serverDir = path.join(workspaceDir, 'entrepreneur-simulator', 'server');
const serverRequire = createRequire(path.join(serverDir, 'package.json'));
const dotenv = serverRequire('dotenv');
const { createClient } = serverRequire('@supabase/supabase-js');
const { ChromaClient } = serverRequire('chromadb');

dotenv.config({ path: path.join(serverDir, '.env') });

const localRelationshipFile = path.resolve(
  process.env.RELATIONSHIP_LOCAL_FILE
    || path.join(serverDir, 'data', 'relationship-system.local.json'),
);

const PAGE_SIZE = 1000;
const startedAt = new Date();
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const defaultStamp = startedAt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const outputDir = path.resolve(
  outputIndex >= 0 && args[outputIndex + 1]
    ? args[outputIndex + 1]
    : path.join(path.dirname(workspaceDir), 'NMDD_LOCAL_BACKUPS', `${defaultStamp}_nmdd_data`),
);

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !serviceKey) {
  throw new Error('SUPABASE_URL or SUPABASE_SERVICE_KEY is missing.');
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const manifest = {
  format_version: 1,
  started_at: startedAt.toISOString(),
  completed_at: null,
  source: {
    workspace: workspaceDir,
    git_commit: null,
    supabase_host: new URL(supabaseUrl).host,
  },
  tables: {},
  auth: { status: 'pending', user_count: 0 },
  storage: { status: 'pending', bucket_count: 0, object_count: 0, byte_count: 0 },
  chroma: { status: 'pending', collection_count: 0, record_count: 0 },
  local_relationships: { status: 'pending', byte_count: 0, backup_included: false },
  warnings: [],
};

function safeSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, '_');
}

function jsonReplacer(_key, value) {
  return typeof value === 'bigint' ? value.toString() : value;
}

async function writeJson(relativePath, value) {
  const target = path.join(outputDir, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(value, jsonReplacer, 2)}\n`, 'utf8');
}

async function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function exportOpenApiAndTables() {
  const response = await fetch(`${supabaseUrl}/rest/v1/`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: 'application/openapi+json',
    },
  });

  if (!response.ok) {
    throw new Error(`Supabase OpenAPI export failed with HTTP ${response.status}.`);
  }

  const openApi = await response.json();
  await writeJson(path.join('schema', 'postgrest-openapi.json'), openApi);

  const tables = Object.keys(openApi.definitions || {}).sort();
  for (const table of tables) {
    const rows = [];
    let exactCount = null;
    let offset = 0;

    while (true) {
      const options = offset === 0 ? { count: 'exact' } : {};
      const { data, error, count } = await supabase
        .from(table)
        .select('*', options)
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) {
        throw new Error(`Table export failed for ${table}: ${error.message}`);
      }

      if (offset === 0 && typeof count === 'number') exactCount = count;
      rows.push(...(data || []));
      if (!data || data.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    if (exactCount !== null && exactCount !== rows.length) {
      throw new Error(`Table ${table} count changed during backup (${exactCount} != ${rows.length}).`);
    }

    await writeJson(path.join('tables', `${safeSegment(table)}.json`), rows);
    manifest.tables[table] = { row_count: rows.length };
  }
}

async function exportAuthUsers() {
  const users = [];
  let page = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) throw new Error(`Auth user export failed: ${error.message}`);
    const batch = data?.users || [];
    users.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    page += 1;
  }

  await writeJson(path.join('auth', 'users.json'), users);
  manifest.auth = { status: 'complete', user_count: users.length };
}

async function listStorageObjects(bucketId) {
  const objects = [];
  const visited = new Set();

  async function walk(prefix = '') {
    if (visited.has(prefix)) return;
    visited.add(prefix);
    let offset = 0;

    while (true) {
      const { data, error } = await supabase.storage.from(bucketId).list(prefix, {
        limit: PAGE_SIZE,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw new Error(`Storage list failed for ${bucketId}/${prefix}: ${error.message}`);

      const batch = data || [];
      for (const item of batch) {
        const objectPath = prefix ? `${prefix}/${item.name}` : item.name;
        const isFolder = !item.id && !item.metadata;
        if (isFolder) {
          await walk(objectPath);
        } else {
          objects.push({ ...item, path: objectPath });
        }
      }

      if (batch.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
  }

  await walk();
  return objects;
}

async function exportStorage() {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) throw new Error(`Storage bucket export failed: ${error.message}`);

  await writeJson(path.join('storage', 'buckets.json'), buckets || []);
  const objectManifest = [];

  for (const bucket of buckets || []) {
    const objects = await listStorageObjects(bucket.id);
    for (const object of objects) {
      const { data, error: downloadError } = await supabase.storage
        .from(bucket.id)
        .download(object.path);
      if (downloadError) {
        throw new Error(`Storage download failed for ${bucket.id}/${object.path}: ${downloadError.message}`);
      }

      const bytes = Buffer.from(await data.arrayBuffer());
      const digest = await sha256(bytes);
      const bucketDir = path.join('storage', 'objects', safeSegment(bucket.id));
      const target = path.join(outputDir, bucketDir, digest);
      await fs.mkdir(path.dirname(target), { recursive: true });
      try {
        await fs.access(target);
      } catch {
        await fs.writeFile(target, bytes);
      }

      objectManifest.push({
        bucket_id: bucket.id,
        path: object.path,
        sha256: digest,
        byte_count: bytes.length,
        metadata: object,
      });
      manifest.storage.object_count += 1;
      manifest.storage.byte_count += bytes.length;
    }
  }

  await writeJson(path.join('storage', 'objects.json'), objectManifest);
  manifest.storage.status = 'complete';
  manifest.storage.bucket_count = (buckets || []).length;
}

async function exportChroma() {
  if (!process.env.CHROMA_URL) {
    manifest.chroma.status = 'not_configured';
    return;
  }

  try {
    const client = new ChromaClient({ path: process.env.CHROMA_URL });
    const collectionEntries = await client.listCollections();
    const names = collectionEntries.map((entry) => (typeof entry === 'string' ? entry : entry.name));

    for (const name of names) {
      const collection = await client.getCollection({ name });
      const count = await collection.count();
      const chunks = [];
      for (let offset = 0; offset < count; offset += PAGE_SIZE) {
        const data = await collection.get({
          limit: PAGE_SIZE,
          offset,
          include: ['documents', 'metadatas', 'embeddings'],
        });
        chunks.push(data);
      }
      await writeJson(path.join('chroma', `${safeSegment(name)}.json`), {
        name,
        count,
        chunks,
      });
      manifest.chroma.collection_count += 1;
      manifest.chroma.record_count += count;
    }
    manifest.chroma.status = 'complete';
  } catch (error) {
    manifest.chroma.status = 'unavailable';
    manifest.chroma.error = error instanceof Error ? error.message : String(error);
    manifest.warnings.push('Configured Chroma storage could not be exported; relational source data remains backed up.');
  }
}

async function exportLocalRelationshipData() {
  const targetDir = path.join(outputDir, 'local');
  try {
    const bytes = await fs.readFile(localRelationshipFile);
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(targetDir, 'relationship-system.local.json'), bytes);
    manifest.local_relationships.status = 'complete';
    manifest.local_relationships.byte_count = bytes.length;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    manifest.local_relationships.status = 'not_yet_created';
    return;
  }

  try {
    const backupBytes = await fs.readFile(`${localRelationshipFile}.bak`);
    await fs.writeFile(path.join(targetDir, 'relationship-system.local.json.bak'), backupBytes);
    manifest.local_relationships.backup_included = true;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function listFiles(root, current = root) {
  const entries = await fs.readdir(current, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) result.push(...(await listFiles(root, fullPath)));
    else result.push(path.relative(root, fullPath));
  }
  return result.sort();
}

async function writeChecksums() {
  const files = (await listFiles(outputDir)).filter((file) => file !== 'checksums.sha256');
  const lines = [];
  for (const relativePath of files) {
    const bytes = await fs.readFile(path.join(outputDir, relativePath));
    lines.push(`${await sha256(bytes)}  ${relativePath.replaceAll('\\', '/')}`);
  }
  await fs.writeFile(path.join(outputDir, 'checksums.sha256'), `${lines.join('\n')}\n`, 'utf8');
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  try {
    manifest.source.git_commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: workspaceDir,
      encoding: 'utf8',
    }).trim();
  } catch {
    manifest.warnings.push('Git commit could not be recorded.');
  }

  await exportOpenApiAndTables();
  await exportAuthUsers();
  await exportStorage();
  await exportChroma();
  await exportLocalRelationshipData();

  manifest.completed_at = new Date().toISOString();
  await writeJson('manifest.json', manifest);
  await writeChecksums();

  const summary = {
    output_dir: outputDir,
    table_count: Object.keys(manifest.tables).length,
    total_rows: Object.values(manifest.tables).reduce((sum, table) => sum + table.row_count, 0),
    auth_users: manifest.auth.user_count,
    storage_buckets: manifest.storage.bucket_count,
    storage_objects: manifest.storage.object_count,
    chroma_status: manifest.chroma.status,
    local_relationships_status: manifest.local_relationships.status,
    warnings: manifest.warnings,
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(async (error) => {
  manifest.completed_at = new Date().toISOString();
  manifest.failure = error instanceof Error ? error.message : String(error);
  try {
    await writeJson('manifest.incomplete.json', manifest);
  } catch {
    // Preserve the original failure when even the failure manifest cannot be written.
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
