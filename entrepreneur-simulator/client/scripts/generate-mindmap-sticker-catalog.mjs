import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium } from 'playwright';
import { icons } from 'lucide-react';

import {
  buildStickerCatalogSource,
  STICKER_CATEGORY_SOURCE,
  STICKER_CATALOG_VERSION,
  stickerCatalogFingerprint,
} from './mindmap-sticker-catalog-source.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const clientRoot = dirname(scriptDirectory);
const generatedAssetDirectory = join(clientRoot, 'public', 'mindmap', 'stickers', 'lucide');
const generatedManifestPath = join(
  clientRoot,
  'src',
  'features',
  'mindmap',
  'catalog',
  'stickerManifest.generated.ts',
);
const specialLightbulbPath = join(
  clientRoot,
  'public',
  'mindmap',
  'stickers',
  'lightbulb-84.png',
);
const publicManifestPath = join(
  clientRoot,
  'public',
  'mindmap',
  'stickers',
  'catalog-manifest.json',
);

const sourcePackage = JSON.parse(await readFile(
  join(clientRoot, 'node_modules', 'lucide-react', 'package.json'),
  'utf8',
));
const sourceVersion = String(sourcePackage.version);

const escapeXml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

const iconMarkup = (iconName, options) => {
  const component = icons[iconName];
  if (!component) throw new Error(`Lucide icon ${iconName} is unavailable.`);
  return renderToStaticMarkup(React.createElement(component, {
    'aria-hidden': 'true',
    color: options.color,
    fill: 'none',
    height: options.height,
    strokeWidth: options.strokeWidth,
    width: options.width,
    x: options.x,
    y: options.y,
  }));
};

const stickerSvg = (descriptor, category) => {
  const [surface, accent, ink] = category.palette;
  const width = descriptor.intrinsicSize.width;
  const height = descriptor.intrinsicSize.height;
  if (descriptor.id === 'idea-lightbulb') {
    const icon = iconMarkup(descriptor.sourceIconName, {
      color: ink,
      height: 46,
      strokeWidth: 2.4,
      width: 46,
      x: 19,
      y: 17,
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" width="84" height="84" viewBox="0 0 84 84"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${surface}"/><stop offset="1" stop-color="${accent}"/></linearGradient><filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="3" stdDeviation="2.5" flood-color="#0f172a" flood-opacity=".18"/></filter></defs><g filter="url(#s)"><rect x="7" y="7" width="70" height="70" rx="23" fill="url(#g)" stroke="#fff" stroke-width="3"/><circle cx="66" cy="20" r="7" fill="#fff" opacity=".55"/></g>${icon}</svg>`;
  }
  if (descriptor.kind === 'illustration') {
    const icon = iconMarkup(descriptor.sourceIconName, {
      color: ink,
      height: 102,
      strokeWidth: 2.15,
      width: 102,
      x: 77,
      y: 37,
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="g" x1=".08" y1=".05" x2=".92" y2=".95"><stop stop-color="${surface}"/><stop offset="1" stop-color="${accent}"/></linearGradient><filter id="s" x="-10%" y="-15%" width="120%" height="135%"><feDropShadow dx="0" dy="7" stdDeviation="6" flood-color="#0f172a" flood-opacity=".16"/></filter></defs><g filter="url(#s)"><rect x="10" y="12" width="236" height="166" rx="35" fill="url(#g)" stroke="#fff" stroke-width="4"/><circle cx="47" cy="47" r="19" fill="#fff" opacity=".48"/><path d="M25 141c33-24 63-18 91 5s65 24 116-4v36H25Z" fill="#fff" opacity=".3"/><circle cx="218" cy="51" r="10" fill="${ink}" opacity=".16"/></g>${icon}</svg>`;
  }
  const rotation = (descriptor.categoryPosition % 5) - 2;
  const icon = iconMarkup(descriptor.sourceIconName, {
    color: ink,
    height: 88,
    strokeWidth: 2.3,
    width: 88,
    x: 40,
    y: 39,
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="g" x1=".08" y1=".02" x2=".9" y2=".98"><stop stop-color="${surface}"/><stop offset="1" stop-color="${accent}"/></linearGradient><filter id="s" x="-20%" y="-20%" width="140%" height="145%"><feDropShadow dx="0" dy="6" stdDeviation="5" flood-color="#0f172a" flood-opacity=".17"/></filter></defs><g filter="url(#s)" transform="rotate(${rotation} 84 84)"><rect x="19" y="18" width="130" height="130" rx="42" fill="url(#g)" stroke="#fff" stroke-width="4"/><circle cx="126" cy="43" r="15" fill="#fff" opacity=".45"/><path d="M31 123c25-18 47-13 68 4 15 12 29 13 38 8" fill="none" stroke="#fff" stroke-linecap="round" stroke-width="8" opacity=".28"/></g>${icon}</svg>`;
};

const svgToPngDataUrls = async (page, artwork) => page.evaluate(async (items) => Promise.all(
  items.map(async (item) => {
    const blob = new Blob([item.svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = item.width;
      canvas.height = item.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas 2D is unavailable.');
      context.clearRect(0, 0, item.width, item.height);
      context.drawImage(image, 0, 0, item.width, item.height);
      return { id: item.id, dataUrl: canvas.toDataURL('image/png') };
    } finally {
      URL.revokeObjectURL(url);
    }
  }),
), artwork);

const pngBytes = (dataUrl) => {
  const prefix = 'data:image/png;base64,';
  if (!dataUrl.startsWith(prefix)) throw new Error('Chromium did not return PNG data.');
  return Buffer.from(dataUrl.slice(prefix.length), 'base64');
};

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const prepareGeneratedAssetDirectory = async () => {
  const resolvedTarget = resolve(generatedAssetDirectory);
  const approvedParent = `${resolve(clientRoot, 'public', 'mindmap', 'stickers')}${sep}`;
  if (!resolvedTarget.startsWith(approvedParent) || basename(resolvedTarget) !== 'lucide') {
    throw new Error(`Refusing to clean unexpected generated asset path: ${resolvedTarget}`);
  }
  await rm(resolvedTarget, { force: true, recursive: true });
  await mkdir(resolvedTarget, { recursive: true });
};

const renderAssets = async (descriptors) => {
  await prepareGeneratedAssetDirectory();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    const categoryById = new Map(STICKER_CATEGORY_SOURCE.map((category) => [category.id, category]));
    const chunks = [];
    for (let offset = 0; offset < descriptors.length; offset += 24) {
      chunks.push(descriptors.slice(offset, offset + 24));
    }
    let completed = 0;
    for (const chunk of chunks) {
      const artwork = chunk.map((descriptor) => {
        const category = categoryById.get(descriptor.categoryId);
        if (!category) throw new Error(`Unknown sticker category ${descriptor.categoryId}.`);
        return {
          id: descriptor.id,
          height: descriptor.intrinsicSize.height,
          svg: stickerSvg(descriptor, category),
          width: descriptor.intrinsicSize.width,
        };
      });
      const rendered = await svgToPngDataUrls(page, artwork);
      for (const result of rendered) {
        const descriptor = chunk.find(({ id }) => id === result.id);
        if (!descriptor) throw new Error(`Unexpected rendered sticker ${result.id}.`);
        const bytes = pngBytes(result.dataUrl);
        const outputPath = descriptor.id === 'idea-lightbulb'
          ? specialLightbulbPath
          : join(generatedAssetDirectory, `${descriptor.id}.png`);
        await writeFile(outputPath, bytes);
      }
      completed += chunk.length;
      process.stdout.write(`rendered ${completed}/${descriptors.length} licensed catalog assets\n`);
    }
  } finally {
    await browser.close();
  }
};

const enrichManifest = async (descriptors) => Promise.all(descriptors.map(async (descriptor) => {
  const path = descriptor.id === 'idea-lightbulb'
    ? specialLightbulbPath
    : join(generatedAssetDirectory, `${descriptor.id}.png`);
  const bytes = await readFile(path);
  return {
    id: descriptor.id,
    label: descriptor.label,
    kind: descriptor.kind,
    categoryId: descriptor.categoryId,
    categoryPosition: descriptor.categoryPosition,
    tags: descriptor.tags,
    fileName: descriptor.fileName,
    mimeType: descriptor.mimeType,
    publicUrl: descriptor.publicUrl,
    defaultDisplaySize: descriptor.defaultDisplaySize,
    intrinsicSize: descriptor.intrinsicSize,
    byteSize: bytes.byteLength,
    sha256: sha256(bytes),
    provenance: descriptor.provenance,
    license: {
      spdxId: 'ISC',
      attribution: 'Lucide Contributors 2022; portions copyright Cole Bemis 2013–2022.',
      noticePath: '/licenses/lucide-ISC.txt',
      sourceUrl: 'https://lucide.dev/',
      sourcePackage: 'lucide-react',
      sourceVersion,
    },
    xmindCompatibility: 'canonical-fallback-only',
  };
}));

const createCatalogDocument = (manifest, sourceFingerprint) => {
  const manifestFingerprint = sha256(Buffer.from(JSON.stringify({
    version: STICKER_CATALOG_VERSION,
    manifest,
  })));
  const categories = STICKER_CATEGORY_SOURCE.map(({ id, label }) => ({
    id,
    label,
    itemCount: manifest.filter((item) => item.categoryId === id).length,
  }));
  return {
    schemaVersion: STICKER_CATALOG_VERSION,
    sourceFingerprint,
    manifestFingerprint,
    categories,
    items: manifest,
  };
};

const generatedModule = (catalog) => {
  const ids = catalog.items.map(({ id }) => id);
  return `/* eslint-disable */\n// This file is generated by scripts/generate-mindmap-sticker-catalog.mjs.\n// Source fingerprint: ${catalog.sourceFingerprint}\nimport type { StickerCatalogCategory, StickerCatalogItem } from './types';\n\nexport const STICKER_CATALOG_VERSION = ${catalog.schemaVersion} as const;\nexport const STICKER_CATALOG_SOURCE_FINGERPRINT = '${catalog.sourceFingerprint}' as const;\nexport const STICKER_CATALOG_MANIFEST_FINGERPRINT = '${catalog.manifestFingerprint}' as const;\n\nexport const STICKER_CATEGORIES = ${JSON.stringify(catalog.categories, null, 2)} as const satisfies readonly StickerCatalogCategory[];\n\nexport const BUILT_IN_STICKER_IDS = ${JSON.stringify(ids, null, 2)} as const;\nexport type BuiltInStickerId = (typeof BUILT_IN_STICKER_IDS)[number];\n\nexport const BUILT_IN_STICKERS = ${JSON.stringify(catalog.items, null, 2)} as const satisfies readonly StickerCatalogItem[];\n`;
};

const main = async () => {
  const descriptors = buildStickerCatalogSource(Object.keys(icons));
  const sourceFingerprint = stickerCatalogFingerprint(descriptors);
  await renderAssets(descriptors);
  const manifest = await enrichManifest(descriptors);
  const catalog = createCatalogDocument(manifest, sourceFingerprint);
  await mkdir(dirname(generatedManifestPath), { recursive: true });
  await writeFile(generatedManifestPath, generatedModule(catalog), 'utf8');
  await writeFile(publicManifestPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  const illustrations = manifest.filter(({ kind }) => kind === 'illustration').length;
  const totalBytes = manifest.reduce((sum, { byteSize }) => sum + byteSize, 0);
  process.stdout.write(`generated ${manifest.length} catalog entries (${illustrations} illustrations, ${totalBytes} bytes, ${escapeXml(sourceFingerprint)})\n`);
};

await main();
