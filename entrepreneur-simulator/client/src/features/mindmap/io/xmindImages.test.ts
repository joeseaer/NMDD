import { describe, expect, it } from 'vitest';

import {
  hasSignedRemoteCredential,
  inspectXMindRaster,
  redactSensitiveRemoteUrl,
  xmindImageSourceToPackagePath,
} from './xmindImages';

describe('XMind image resource safety helpers', () => {
  const pngHeader = (width: number, height: number): Uint8Array => Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
    (width >>> 24) & 0xff, (width >>> 16) & 0xff, (width >>> 8) & 0xff, width & 0xff,
    (height >>> 24) & 0xff, (height >>> 16) & 0xff, (height >>> 8) & 0xff, height & 0xff,
  ]);

  it('sniffs allowed raster MIME and intrinsic dimensions from bytes, not extensions', () => {
    const cases = [
      {
        bytes: [
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
          0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 3,
        ],
        mimeType: 'image/png',
        size: { height: 3, width: 2 },
      },
      {
        bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 4, 0, 5, 0],
        mimeType: 'image/gif',
        size: { height: 5, width: 4 },
      },
      {
        bytes: [0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 6, 0, 7, 3, 1, 0x11, 0],
        mimeType: 'image/jpeg',
        size: { height: 6, width: 7 },
      },
      {
        bytes: [
          0x52, 0x49, 0x46, 0x46, 22, 0, 0, 0,
          0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58,
          10, 0, 0, 0, 0, 0, 0, 0, 7, 0, 0, 8, 0, 0,
        ],
        mimeType: 'image/webp',
        size: { height: 9, width: 8 },
      },
    ] as const;
    for (const item of cases) {
      expect(inspectXMindRaster(Uint8Array.from(item.bytes))).toEqual(expect.objectContaining({
        intrinsicSize: item.size,
        mimeType: item.mimeType,
      }));
    }
    expect(inspectXMindRaster(Uint8Array.from([0xff, 0xd8, 0xff, 0x00])))
      .toBeNull();
  });

  it('bounds decoded raster edges and pixels before browser or export use', () => {
    expect(inspectXMindRaster(pngHeader(32_768, 1_220))).not.toBeNull();
    expect(inspectXMindRaster(pngHeader(32_768, 1_221))).toBeNull();
    expect(inspectXMindRaster(pngHeader(32_769, 1))).toBeNull();
  });

  it.each([
    'token',
    'access_token',
    'apikey',
    'api_key',
    'authorization',
    'sig',
    'signature',
    'x-amz-signature',
    'x-amz-credential',
    'x-amz-security-token',
    'x-goog-signature',
    'x-goog-credential',
    'key-pair-id',
  ])('detects and redacts signed remote credential parameter %s', (parameter) => {
    const url = `https://assets.example/image.png?width=320&${parameter}=private-value`;
    expect(hasSignedRemoteCredential(url)).toBe(true);
    expect(redactSensitiveRemoteUrl(url)).not.toContain('private-value');
  });

  it('accepts only safe package-local Resources paths', () => {
    expect(xmindImageSourceToPackagePath('xap:Resources/a%20b.png'))
      .toBe('Resources/a b.png');
    for (const source of [
      'xap:resources/../secret.png',
      'xap:/resources/absolute.png',
      'xap:resources\\backslash.png',
      'https://assets.example/image.png',
      'C:/resources/image.png',
    ]) expect(xmindImageSourceToPackagePath(source)).toBeNull();
  });
});
