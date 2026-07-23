import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { icons } from 'lucide-react';

import {
  buildStickerCatalogSource,
  ITEMS_PER_CATEGORY,
  STICKER_CATEGORY_SOURCE,
  STICKER_CATALOG_VERSION,
  stickerCatalogFingerprint,
} from './mindmap-sticker-catalog-source.mjs';

const EXPECTED_LUCIDE_VERSION = '0.358.0';
const EXPECTED_LUCIDE_INTEGRITY = 'sha512-rBSptRjZTMBm24zsFhR6pK/NgbT18JegZGKcH4+1H3+UigMSRpeoWLtR/fAwMYwYnlJOZB+y8WpeHne9D6X6Kg==';
const MAX_ASSET_BYTES = 64 * 1024;
const MAX_CATALOG_BYTES = 20 * 1024 * 1024;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const clientRoot = dirname(scriptDirectory);
const publicRoot = resolve(clientRoot, 'public');
const publicManifestPath = join(publicRoot, 'mindmap', 'stickers', 'catalog-manifest.json');
const generatedManifestPath = join(
  clientRoot,
  'src',
  'features',
  'mindmap',
  'catalog',
  'stickerManifest.generated.ts',
);

const fail = (message) => {
  throw new Error(`Mind-map sticker catalog validation failed: ${message}`);
};

const assert = (condition, message) => {
  if (!condition) fail(message);
};

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const manifestFingerprint = (items) => sha256(Buffer.from(JSON.stringify({
  version: STICKER_CATALOG_VERSION,
  manifest: items,
})));

const isFinitePositiveSize = (candidate) => candidate
  && Number.isFinite(candidate.width)
  && Number.isFinite(candidate.height)
  && candidate.width > 0
  && candidate.height > 0;

const pngSize = (bytes, id) => {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  assert(bytes.byteLength >= 24, `${id} is too short to be a PNG.`);
  assert(signature.every((value, index) => bytes[index] === value), `${id} has invalid PNG magic.`);
  assert(bytes.subarray(12, 16).toString('ascii') === 'IHDR', `${id} has no leading IHDR chunk.`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
};

const safePublicPath = (publicUrl, id) => {
  assert(/^\/mindmap\/stickers\/[a-z0-9/-]+\.png$/u.test(publicUrl), `${id} uses an invalid or external public URL.`);
  const path = resolve(publicRoot, ...publicUrl.slice(1).split('/'));
  assert(path.startsWith(`${publicRoot}${sep}`), `${id} escapes the public directory.`);
  return path;
};

const main = async () => {
  const [
    catalogText,
    generatedModule,
    packageText,
    packageLockText,
    bundledLicense,
    upstreamLicense,
    notices,
  ] = await Promise.all([
    readFile(publicManifestPath, 'utf8'),
    readFile(generatedManifestPath, 'utf8'),
    readFile(join(clientRoot, 'package.json'), 'utf8'),
    readFile(join(clientRoot, 'package-lock.json'), 'utf8'),
    readFile(join(publicRoot, 'licenses', 'lucide-ISC.txt'), 'utf8'),
    readFile(join(clientRoot, 'node_modules', 'lucide-react', 'LICENSE'), 'utf8'),
    readFile(join(publicRoot, 'THIRD_PARTY_NOTICES.txt'), 'utf8'),
  ]);
  const catalog = JSON.parse(catalogText);
  const packageJson = JSON.parse(packageText);
  const packageLock = JSON.parse(packageLockText);
  const expectedSource = buildStickerCatalogSource(Object.keys(icons));
  const expectedSourceFingerprint = stickerCatalogFingerprint(expectedSource);
  const expectedCount = STICKER_CATEGORY_SOURCE.length * ITEMS_PER_CATEGORY;

  assert(catalog.schemaVersion === STICKER_CATALOG_VERSION, 'schema version is not pinned.');
  assert(catalog.sourceFingerprint === expectedSourceFingerprint, 'source fingerprint is stale; regenerate the catalog.');
  assert(Array.isArray(catalog.categories) && catalog.categories.length === STICKER_CATEGORY_SOURCE.length, 'category inventory is incomplete.');
  assert(Array.isArray(catalog.items) && catalog.items.length === expectedCount, `expected ${expectedCount} items.`);
  assert(catalog.manifestFingerprint === manifestFingerprint(catalog.items), 'manifest fingerprint does not match the release entries.');
  assert(generatedModule.includes(`STICKER_CATALOG_SOURCE_FINGERPRINT = '${catalog.sourceFingerprint}'`), 'TypeScript source fingerprint is stale.');
  assert(generatedModule.includes(`STICKER_CATALOG_MANIFEST_FINGERPRINT = '${catalog.manifestFingerprint}'`), 'TypeScript manifest fingerprint is stale.');

  assert(packageJson.dependencies?.['lucide-react'] === EXPECTED_LUCIDE_VERSION, 'lucide-react must be an exact dependency.');
  assert(packageLock.packages?.['']?.dependencies?.['lucide-react'] === EXPECTED_LUCIDE_VERSION, 'package-lock root lucide-react version is not exact.');
  const lockedLucide = packageLock.packages?.['node_modules/lucide-react'];
  assert(lockedLucide?.version === EXPECTED_LUCIDE_VERSION, 'package-lock resolved an unexpected lucide-react version.');
  assert(lockedLucide?.integrity === EXPECTED_LUCIDE_INTEGRITY, 'lucide-react lock integrity changed.');
  assert(lockedLucide?.license === 'ISC', 'lucide-react lock license is not ISC.');
  assert(bundledLicense.trim() === upstreamLicense.trim(), 'bundled Lucide license differs from the pinned package license.');
  assert(notices.includes(`lucide-react@${EXPECTED_LUCIDE_VERSION}`), 'third-party notices omit the pinned Lucide source.');

  const ids = new Set();
  const urls = new Set();
  const hashes = new Set();
  const categoryItems = new Map(STICKER_CATEGORY_SOURCE.map(({ id }) => [id, []]));
  let totalBytes = 0;
  let illustrations = 0;
  const expectedGeneratedFileNames = new Set();
  for (const item of catalog.items) {
    assert(typeof item.id === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(item.id), 'catalog item ID is invalid.');
    assert(!ids.has(item.id), `duplicate item ID ${item.id}.`);
    ids.add(item.id);
    assert(!urls.has(item.publicUrl), `duplicate public URL ${item.publicUrl}.`);
    urls.add(item.publicUrl);
    assert(item.kind === 'sticker' || item.kind === 'illustration', `${item.id} has invalid kind.`);
    if (item.kind === 'illustration') illustrations += 1;
    assert(categoryItems.has(item.categoryId), `${item.id} references an unknown category.`);
    categoryItems.get(item.categoryId).push(item);
    assert(Number.isInteger(item.categoryPosition) && item.categoryPosition >= 0, `${item.id} has invalid category position.`);
    assert(typeof item.label === 'string' && item.label.length > 0 && item.label.length <= 256, `${item.id} has invalid label.`);
    assert(Array.isArray(item.tags) && item.tags.length >= 3 && item.tags.every((tag) => typeof tag === 'string' && tag.length > 0), `${item.id} has invalid search tags.`);
    assert(item.mimeType === 'image/png', `${item.id} is not a release-safe PNG.`);
    assert(isFinitePositiveSize(item.defaultDisplaySize), `${item.id} has invalid default size.`);
    assert(isFinitePositiveSize(item.intrinsicSize), `${item.id} has invalid intrinsic size.`);
    assert(item.provenance === 'licensed-lucide-isc-derived', `${item.id} lacks approved provenance.`);
    assert(item.license?.spdxId === 'ISC', `${item.id} lacks its SPDX license.`);
    assert(item.license?.sourcePackage === 'lucide-react', `${item.id} lacks its source package.`);
    assert(item.license?.sourceVersion === EXPECTED_LUCIDE_VERSION, `${item.id} has a stale source version.`);
    assert(item.license?.noticePath === '/licenses/lucide-ISC.txt', `${item.id} has an invalid notice path.`);
    assert(item.xmindCompatibility === 'canonical-fallback-only', `${item.id} overstates XMind native compatibility.`);
    assert(Number.isInteger(item.byteSize) && item.byteSize > 0 && item.byteSize <= MAX_ASSET_BYTES, `${item.id} exceeds the ${MAX_ASSET_BYTES}-byte asset budget.`);
    assert(/^[a-f0-9]{64}$/u.test(item.sha256), `${item.id} has invalid SHA-256.`);
    assert(!hashes.has(item.sha256), `${item.id} duplicates another release asset's bytes.`);
    hashes.add(item.sha256);

    const path = safePublicPath(item.publicUrl, item.id);
    const bytes = await readFile(path);
    const size = pngSize(bytes, item.id);
    assert(bytes.byteLength === item.byteSize, `${item.id} byteSize does not match its file.`);
    assert(sha256(bytes) === item.sha256, `${item.id} SHA-256 does not match its file.`);
    assert(size.width === item.intrinsicSize.width && size.height === item.intrinsicSize.height, `${item.id} PNG dimensions do not match the manifest.`);
    totalBytes += bytes.byteLength;
    if (item.publicUrl.startsWith('/mindmap/stickers/lucide/')) {
      expectedGeneratedFileNames.add(item.publicUrl.split('/').at(-1));
    }
  }
  assert(totalBytes <= MAX_CATALOG_BYTES, `catalog uses ${totalBytes} bytes, above the ${MAX_CATALOG_BYTES}-byte budget.`);
  assert(illustrations === STICKER_CATEGORY_SOURCE.length * 3, 'each category must contain exactly three illustrations.');

  for (const sourceCategory of STICKER_CATEGORY_SOURCE) {
    const manifestCategory = catalog.categories.find(({ id }) => id === sourceCategory.id);
    assert(manifestCategory?.label === sourceCategory.label, `${sourceCategory.id} category label changed.`);
    assert(manifestCategory?.itemCount === ITEMS_PER_CATEGORY, `${sourceCategory.id} category count is stale.`);
    const items = categoryItems.get(sourceCategory.id).sort((left, right) => left.categoryPosition - right.categoryPosition);
    assert(items.length === ITEMS_PER_CATEGORY, `${sourceCategory.id} does not contain ${ITEMS_PER_CATEGORY} items.`);
    assert(items.every((item, index) => item.categoryPosition === index), `${sourceCategory.id} positions are not contiguous.`);
    assert(items.filter(({ kind }) => kind === 'illustration').length === 3, `${sourceCategory.id} must contain three illustrations.`);
  }

  const actualGeneratedFileNames = new Set((await readdir(
    join(publicRoot, 'mindmap', 'stickers', 'lucide'),
    { withFileTypes: true },
  )).filter((entry) => entry.isFile()).map((entry) => entry.name));
  assert(actualGeneratedFileNames.size === expectedGeneratedFileNames.size, 'generated asset directory contains missing or orphan files.');
  for (const name of expectedGeneratedFileNames) {
    assert(actualGeneratedFileNames.has(name), `generated asset ${name} is missing.`);
  }

  process.stdout.write(`validated ${catalog.items.length} licensed catalog assets in ${catalog.categories.length} categories (${illustrations} illustrations, ${totalBytes} bytes)\n`);
};

await main();
