import { describe, expect, it } from 'vitest';

import { createNewMindMapDocument } from '../domain/defaults';
import type { Id, MindMapDocumentV1 } from '../domain/types';
import { executeXMindWorkerRequest } from './xmindWorkerRuntime';
import {
  XMIND_WORKER_PROTOCOL_VERSION,
  deserializeXMindWorkerError,
  isXMindWorkerResponse,
  serializeXMindWorkerError,
} from './xmindWorkerProtocol';

const id = <K extends string>(counter: number): Id<K> => (
  `018f7000-0000-7000-8000-${counter.toString(16).padStart(12, '0')}` as Id<K>
);

const createDocument = (): MindMapDocumentV1 => createNewMindMapDocument({
  documentId: id<'Document'>(1),
  rootTopicId: id<'Topic'>(3),
  sheetId: id<'Sheet'>(2),
  sheetOrderKey: 'a',
  themeId: id<'Theme'>(4),
  title: 'Worker round trip',
});

describe('XMind worker protocol runtime', () => {
  it('exports and imports through request-id-correlated protocol responses', () => {
    const exported = executeXMindWorkerRequest({
      kind: 'xmind-worker-request',
      operation: 'export',
      payload: { document: createDocument() },
      protocolVersion: XMIND_WORKER_PROTOCOL_VERSION,
      requestId: 'export-42',
    });
    expect(exported).toMatchObject({
      kind: 'xmind-worker-response',
      ok: true,
      operation: 'export',
      requestId: 'export-42',
    });
    if (!exported.ok || exported.operation !== 'export' || !exported.result.bytes) {
      throw new Error('Expected a successful XMind export response.');
    }

    const exactBytes = exported.result.bytes.slice().buffer;
    const imported = executeXMindWorkerRequest({
      kind: 'xmind-worker-request',
      operation: 'import',
      payload: { bytes: exactBytes, options: {} },
      protocolVersion: XMIND_WORKER_PROTOCOL_VERSION,
      requestId: 'import-43',
    });
    expect(imported).toMatchObject({
      kind: 'xmind-worker-response',
      ok: true,
      operation: 'import',
      requestId: 'import-43',
      result: { report: { success: true } },
    });
  });

  it('serializes useful Error metadata without sending Error objects across realms', () => {
    const source = Object.assign(new TypeError('bad archive'), { code: 'ZIP_BAD' });
    const serialized = serializeXMindWorkerError(source);
    expect(serialized).toMatchObject({
      code: 'ZIP_BAD',
      message: 'bad archive',
      name: 'TypeError',
    });
    expect(serialized).not.toBeInstanceOf(Error);

    const restored = deserializeXMindWorkerError(serialized);
    expect(restored).toBeInstanceOf(Error);
    expect(restored).toMatchObject({
      code: 'ZIP_BAD',
      message: 'bad archive',
      name: 'TypeError',
    });
  });

  it('rejects malformed protocol requests as a correlated failure response', () => {
    const response = executeXMindWorkerRequest({
      kind: 'xmind-worker-request',
      operation: 'export',
      payload: {},
      protocolVersion: 999,
      requestId: 'bad-1',
    });
    expect(response).toMatchObject({
      error: { code: 'xmind.worker-protocol-invalid-request' },
      ok: false,
      operation: 'export',
      requestId: 'bad-1',
    });
  });

  it('rejects malformed success payloads before UI code can consume them', () => {
    expect(isXMindWorkerResponse({
      kind: 'xmind-worker-response',
      ok: true,
      operation: 'export',
      protocolVersion: XMIND_WORKER_PROTOCOL_VERSION,
      requestId: 'malformed-success',
      result: {
        bytes: null,
        report: { success: true },
      },
    })).toBe(false);
  });
});
