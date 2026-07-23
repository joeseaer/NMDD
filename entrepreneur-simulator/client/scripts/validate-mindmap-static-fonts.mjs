import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const clientRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const exactVersion = '5.3.0';
const exactMonoIntegrity = 'sha512-EgozyWG4nG2U1OT+zfdyHP1L8O0fUFMUBOilVF9urTshqIdfeGV9/FUQxaNHdPvHtV1cQCs1Ql0W1q93SiPK2w==';
const sources = Object.freeze({
  emoji: '@fontsource-variable/noto-emoji',
  mono: '@fontsource-variable/noto-sans-mono',
  sans: '@fontsource-variable/noto-sans-sc',
});

const fail = (message) => {
  throw new Error(`Static font validation failed: ${message}`);
};

const manifestPath = join(
  clientRoot,
  'src',
  'features',
  'mindmap',
  'export',
  'staticFontManifest.generated.ts',
);
const manifest = await readFile(manifestPath, 'utf8');
if (!manifest.includes(`MIND_MAP_STATIC_FONT_SOURCE_VERSION = "${exactVersion}"`)) {
  fail(`generated source version is not ${exactVersion}`);
}

for (const packageName of Object.values(sources)) {
  const packageJson = JSON.parse(await readFile(
    join(clientRoot, 'node_modules', packageName, 'package.json'),
    'utf8',
  ));
  if (packageJson.version !== exactVersion) {
    fail(`${packageName} must be exactly ${exactVersion}`);
  }
}

const rows = manifest
  .split('\n')
  .filter((line) => line.startsWith('  Object.freeze({'))
  .map((line) => {
    const fileName = /fileName:"([^"]+)"/u.exec(line)?.[1];
    const kind = /kind:"(emoji|mono|sans)"/u.exec(line)?.[1];
    const sha256 = /sha256:"([a-f0-9]{64})"/u.exec(line)?.[1];
    if (!fileName || !kind || !sha256) fail('a generated face row is malformed');
    return { fileName, kind, sha256 };
  });
if (rows.length !== 118) fail(`expected 118 generated faces, found ${rows.length}`);
if (rows.filter((row) => row.kind === 'sans').length !== 101) fail('expected 101 Sans SC faces');
if (rows.filter((row) => row.kind === 'emoji').length !== 10) fail('expected 10 Emoji faces');
if (rows.filter((row) => row.kind === 'mono').length !== 7) fail('expected 7 Sans Mono faces');
if (new Set(rows.map((row) => row.fileName)).size !== rows.length) fail('face filenames are not unique');
const expectedMonoFiles = [
  'noto-sans-mono-cyrillic-ext-standard-normal.woff2',
  'noto-sans-mono-cyrillic-standard-normal.woff2',
  'noto-sans-mono-greek-ext-standard-normal.woff2',
  'noto-sans-mono-greek-standard-normal.woff2',
  'noto-sans-mono-vietnamese-standard-normal.woff2',
  'noto-sans-mono-latin-ext-standard-normal.woff2',
  'noto-sans-mono-latin-standard-normal.woff2',
];
if (JSON.stringify(rows.filter((row) => row.kind === 'mono').map((row) => row.fileName))
  !== JSON.stringify(expectedMonoFiles)) fail('Sans Mono standard face inventory drifted');

let monoBytes = 0;
for (const row of rows) {
  const bytes = await readFile(join(clientRoot, 'node_modules', sources[row.kind], 'files', row.fileName));
  if (row.kind === 'mono') monoBytes += bytes.byteLength;
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== row.sha256) fail(`${row.fileName} does not match its generated SHA-256`);
}
if (monoBytes !== 562_856) fail(`expected 562856 Sans Mono bytes, found ${monoBytes}`);

const packageLock = JSON.parse(await readFile(join(clientRoot, 'package-lock.json'), 'utf8'));
const lockedMono = packageLock.packages?.['node_modules/@fontsource-variable/noto-sans-mono'];
if (lockedMono?.version !== exactVersion || lockedMono?.integrity !== exactMonoIntegrity) {
  fail('Noto Sans Mono package-lock version or integrity drifted');
}

const notice = await readFile(join(clientRoot, 'public', 'THIRD_PARTY_NOTICES.txt'), 'utf8');
for (const required of [
  `@fontsource-variable/noto-sans-sc@${exactVersion}`,
  `@fontsource-variable/noto-sans-mono@${exactVersion}`,
  `@fontsource-variable/noto-emoji@${exactVersion}`,
  'SIL Open Font License 1.1',
]) {
  if (!notice.includes(required)) fail(`third-party notice is missing ${required}`);
}
await Promise.all([
  readFile(join(clientRoot, 'public', 'licenses', 'noto-sans-sc-OFL-1.1.txt'), 'utf8'),
  readFile(join(clientRoot, 'public', 'licenses', 'noto-sans-mono-OFL-1.1.txt'), 'utf8'),
  readFile(join(clientRoot, 'public', 'licenses', 'noto-emoji-OFL-1.1.txt'), 'utf8'),
]);

process.stdout.write(`validated ${rows.length} pinned static font faces (${exactVersion})\n`);
