// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { limits, parseBundle, rebuildBundle, validateItems, imageMime } from '../../src/features/wardrobe/bundle';
const fixture = new Uint8Array(readFileSync(resolve('../server/tests/fixtures/wardrobe/mock-ten.zip')));
const provided = new Uint8Array(readFileSync(resolve('../server/tests/fixtures/wardrobe/provided-demo.zip')));
function changed(change: (files: Record<string, Uint8Array>, items: Record<string, unknown>[], manifest: Record<string, unknown>) => void) {
  const files = unzipSync(fixture), items = JSON.parse(strFromU8(files['items.json'])), manifest = JSON.parse(strFromU8(files['manifest.json']));
  change(files, items, manifest); files['items.json'] = strToU8(JSON.stringify(items)); files['manifest.json'] = strToU8(JSON.stringify(manifest)); return zipSync(files);
}
describe('wardrobe v1 local preview contract', () => {
  it('reads provided demo and ten synthetic photos', async () => { expect((await parseBundle(provided)).items).toHaveLength(1); expect((await parseBundle(fixture)).items).toHaveLength(10); });
  it('rebuilds corrected data with the original image bytes', async () => {
    const bundle = await parseBundle(fixture); bundle.items[0].name = '手工校正的会议外套'; bundle.items[0].category = 'outerwear';
    const blob = await rebuildBundle(bundle);
    const bytes = await blob.arrayBuffer();
    const rebuilt = await parseBundle(new Uint8Array(bytes));
    expect(rebuilt.items[0].name).toBe('手工校正的会议外套'); expect(rebuilt.items[0].category).toBe('outerwear'); expect(rebuilt.files[bundle.items[0].image_path]).toEqual(bundle.files[bundle.items[0].image_path]);
  });
  it.each([
    ['schema version', changed((_f,_i,m) => { m.schema_version = 2; })],
    ['missing photo', changed((f,i) => { delete f[i[0].image_path as string]; })],
    ['traversal', changed((_f,i) => { i[0].image_path = '../photo.png'; })],
    ['duplicate id', changed((_f,i) => { i[1].external_id = i[0].external_id; })],
    ['MIME mismatch', changed((f,i) => { f[i[0].image_path as string] = strToU8('<svg><script/></svg>'); })],
    ['invalid category', changed((_f,i) => { i[0].category = 'dress'; })],
    ['invalid optional enum', changed((_f,i) => { i[0].fit = 'bad'; })],
    ['invalid array', changed((_f,i) => { i[0].occasions = ['hack']; })],
    ['too many items', changed((_f,i) => { while (i.length <= 100) i.push({ ...i[0], external_id: String(i.length) }); })],
    ['oversized image', changed(f => { f['images/large.png'] = new Uint8Array(limits.image + 1); })],
    ['oversized JSON', changed((_f,_i,m) => { m.extra = 'x'.repeat(limits.json + 1); })],
  ])('rejects %s before submission', async (_label, bytes) => { await expect(parseBundle(bytes)).rejects.toThrow(); });
  it('rejects malformed zip, absolute paths and links', async () => {
    await expect(parseBundle(new Uint8Array([1,2,3]))).rejects.toThrow();
    await expect(parseBundle(zipSync({ ...unzipSync(fixture), '/bad.png': new Uint8Array([1]) }))).rejects.toThrow();
    const linked = fixture.slice(); const view = new DataView(linked.buffer);
    for (let i = 0; i < linked.length - 46; i++) if (view.getUint32(i, true) === 0x02014b50) { view.setUint32(i + 38, 0xa1ff0000, true); break; }
    await expect(parseBundle(linked)).rejects.toThrow(/链接/);
  });
  it('applies null defaults, preserves stable ids and reports ignored extra fields', async () => {
    const bytes = changed((_f,i) => { i[0].status = null; i[0].seasons = null; i[0].custom = 'extra'; });
    const result = await parseBundle(bytes); expect(result.items[0].status).toBe('active'); expect(result.items[0].seasons).toEqual([]); expect(result.warnings).toHaveLength(1); expect(result.items[0].external_id).toBe('mock_001');
    expect(() => validateItems([{ name:'missing' }])).toThrow(); expect(() => imageMime(strToU8('<html/>'), 'image.jpg')).toThrow();
  });
  it('checks CRC even when image_sha256 was omitted', async () => {
    const bundle = unzipSync(fixture); const items = JSON.parse(strFromU8(bundle['items.json'])); items.forEach((item: Record<string,unknown>) => { delete item.image_sha256; }); bundle['items.json'] = strToU8(JSON.stringify(items));
    const stored = zipSync(bundle, { level: 0 }), image = bundle['images/mock_001.png'];
    const start = stored.findIndex((_, index) => image.slice(0, 24).every((byte, i) => stored[index+i] === byte)); expect(start).toBeGreaterThan(0); stored[start+40] ^= 1;
    await expect(parseBundle(stored)).rejects.toThrow(/CRC/);
  });
});
