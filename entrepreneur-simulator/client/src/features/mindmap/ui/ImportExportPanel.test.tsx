import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../export/staticFontBundle', async () => {
  const policy = await import('../export/staticFontPolicy');
  return {
    loadMindMapStaticFontBundle: vi.fn(async (
      input: Parameters<
        typeof import('../export/staticFontBundle').loadMindMapStaticFontBundle
      >[0],
    ) => {
      if (input.signal.aborted) {
        throw new DOMException('Static font loading was aborted.', 'AbortError');
      }
      return {
        cssText: '@font-face{font-family:"NMDD Noto Sans SC Export";src:url(data:font/woff2;base64,AA==)}',
        embeddedFontBytes: 1,
        embeddedSerializedBytes: 96,
        faceCount: 1,
        fontFamily: policy.MIND_MAP_STATIC_SANS_STACK,
        fontPolicy: policy.MIND_MAP_STATIC_FONT_POLICY,
        measureText: (value: string, style: { readonly fontSize: number }) => (
          Array.from(value).reduce((total, character) => (
            total + style.fontSize * (/\s/u.test(character)
              ? 0.5
              : /[^\u0000-\u00ff]/u.test(character) ? 1 : 0.56)
          ), 0)
        ),
        release: vi.fn(),
        resolveFontFamily: policy.resolveMindMapStaticFontFamily,
        sourceVersion: '5.3.0' as const,
      };
    }),
  };
});

import { api } from '../../../services/api';
import { createNewMindMapDocument } from '../domain/defaults';
import type * as Domain from '../domain/types';
import {
  exportMindMapToXMind,
  XMIND_WORKER_FALLBACK_DIAGNOSTIC_CODE,
  type XMindAsyncCodecClient,
  type MindMapImportIdFactory,
} from '../io';
import {
  ImportExportPanel,
  mindMapDownloadFileName,
  sanitizeMindMapFileBaseName,
} from './ImportExportPanel';

const id = <K extends string>(counter: number): Domain.Id<K> => (
  `018f7000-0000-7000-8000-${counter.toString(16).padStart(12, '0')}` as Domain.Id<K>
);

const createDocument = (): Domain.MindMapDocumentV1 => createNewMindMapDocument({
  documentId: id<'Document'>(1),
  sheetId: id<'Sheet'>(2),
  rootTopicId: id<'Topic'>(3),
  themeId: id<'Theme'>(4),
  sheetOrderKey: 'a',
  title: '产品/路线:*?',
  sheetTitle: '主画布',
  rootTitle: '创业计划',
});

const createTwoSheetDocument = (): Domain.MindMapDocumentV1 => {
  const first = createDocument();
  const second = createNewMindMapDocument({
    documentId: id<'Document'>(10),
    sheetId: id<'Sheet'>(11),
    rootTopicId: id<'Topic'>(12),
    themeId: id<'Theme'>(13),
    sheetOrderKey: 'b',
    title: first.title,
    sheetTitle: '第二画布',
    rootTitle: '第二主题',
  });
  return {
    ...first,
    sheets: {
      ...first.sheets,
      ...second.sheets,
    },
    themes: {
      ...first.themes,
      ...second.themes,
    },
  };
};

const deterministicIdFactory = (): MindMapImportIdFactory => {
  let counter = 100;
  return () => {
    const value = `018f7000-0000-7000-8000-${counter.toString(16).padStart(12, '0')}`;
    counter += 1;
    return value;
  };
};

const blobText = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.addEventListener('load', () => resolve(String(reader.result ?? '')));
  reader.addEventListener('error', () => reject(reader.error));
  reader.readAsText(blob);
});

const blobBytes = (blob: Blob): Promise<Uint8Array> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.addEventListener('load', () => {
    if (!(reader.result instanceof ArrayBuffer)) {
      reject(new Error('Expected an ArrayBuffer.'));
      return;
    }
    resolve(new Uint8Array(reader.result));
  });
  reader.addEventListener('error', () => reject(reader.error));
  reader.readAsArrayBuffer(blob);
});

let createObjectUrl: ReturnType<typeof vi.fn>;
let revokeObjectUrl: ReturnType<typeof vi.fn>;
let originalCreateObjectUrl: PropertyDescriptor | undefined;
let originalRevokeObjectUrl: PropertyDescriptor | undefined;

beforeEach(() => {
  originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
  originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
  createObjectUrl = vi.fn((_blob: Blob) => `blob:mind-map-${createObjectUrl.mock.calls.length}`);
  revokeObjectUrl = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: createObjectUrl,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: revokeObjectUrl,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (originalCreateObjectUrl) Object.defineProperty(URL, 'createObjectURL', originalCreateObjectUrl);
  else delete (URL as { createObjectURL?: unknown }).createObjectURL;
  if (originalRevokeObjectUrl) Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectUrl);
  else delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
});

describe('ImportExportPanel file naming', () => {
  it('creates portable, bounded download names with a useful fallback', () => {
    expect(sanitizeMindMapFileBaseName('  产品 / 路线:*?  ')).toBe('产品 - 路线-');
    expect(sanitizeMindMapFileBaseName('CON')).toBe('_CON');
    expect(sanitizeMindMapFileBaseName('LPT1.plan')).toBe('_LPT1.plan');
    expect(sanitizeMindMapFileBaseName(' .. ')).toBe('mind-map');
    expect(Array.from(sanitizeMindMapFileBaseName('图'.repeat(120)))).toHaveLength(96);
    expect(mindMapDownloadFileName('Roadmap', 'markdown')).toBe('Roadmap.md');
    expect(mindMapDownloadFileName('Roadmap', 'opml')).toBe('Roadmap.opml');
    expect(mindMapDownloadFileName('Roadmap', 'task-csv')).toBe('Roadmap.csv');
    expect(mindMapDownloadFileName('Roadmap', 'task-ics')).toBe('Roadmap.ics');
    expect(mindMapDownloadFileName('Roadmap', 'svg')).toBe('Roadmap.svg');
    expect(mindMapDownloadFileName('Roadmap', 'png')).toBe('Roadmap.png');
    expect(mindMapDownloadFileName('Roadmap', 'jpeg')).toBe('Roadmap.jpg');
    expect(mindMapDownloadFileName('Roadmap', 'xmind')).toBe('Roadmap.xmind');
  });
});

describe('ImportExportPanel', () => {
  it('downloads Markdown and OPML with safe names and always revokes Blob URLs', async () => {
    const downloads: Array<{ download: string; href: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(
      this: HTMLAnchorElement,
    ) {
      downloads.push({ download: this.download, href: this.href });
    });
    const onDownload = vi.fn();
    render(
      <ImportExportPanel
        document={createDocument()}
        onImportResult={vi.fn()}
        onDownload={onDownload}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '导出 Markdown' }));
    fireEvent.click(screen.getByRole('button', { name: '导出 OPML' }));

    expect(downloads).toEqual([
      { download: '产品-路线-.md', href: 'blob:mind-map-1' },
      { download: '产品-路线-.opml', href: 'blob:mind-map-2' },
    ]);
    expect(createObjectUrl).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(revokeObjectUrl).toHaveBeenCalledTimes(2));
    expect(revokeObjectUrl.mock.calls).toEqual([
      ['blob:mind-map-1'],
      ['blob:mind-map-2'],
    ]);
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
    expect(onDownload.mock.calls).toEqual([
      [{ fileName: '产品-路线-.md', format: 'markdown' }],
      [{ fileName: '产品-路线-.opml', format: 'opml' }],
    ]);

    const markdown = await blobText(createObjectUrl.mock.calls[0][0] as Blob);
    const opml = await blobText(createObjectUrl.mock.calls[1][0] as Blob);
    expect(markdown).toContain('# 产品/路线:\\*?');
    expect(markdown).toContain('## 主画布');
    expect(markdown).toContain('- 创业计划');
    expect(opml).toContain('<opml version="2.0"');
    expect(opml).toContain('<title>产品/路线:*?</title>');
    expect(opml).toContain('text="创业计划"');
  });

  it('ACC-IO-008 downloads legal Task CSV/ICS files and reports their format', async () => {
    const downloads: Array<{ download: string; href: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(
      this: HTMLAnchorElement,
    ) {
      downloads.push({ download: this.download, href: this.href });
    });
    const onDownload = vi.fn();
    render(
      <ImportExportPanel
        document={createDocument()}
        onImportResult={vi.fn()}
        onDownload={onDownload}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '导出 Task CSV' }));
    fireEvent.click(screen.getByRole('button', { name: '导出 Task ICS' }));

    expect(downloads).toEqual([
      { download: '产品-路线-.csv', href: 'blob:mind-map-1' },
      { download: '产品-路线-.ics', href: 'blob:mind-map-2' },
    ]);
    expect(onDownload.mock.calls).toEqual([
      [{ fileName: '产品-路线-.csv', format: 'task-csv' }],
      [{ fileName: '产品-路线-.ics', format: 'task-ics' }],
    ]);
    const csvBlob = createObjectUrl.mock.calls[0][0] as Blob;
    const icsBlob = createObjectUrl.mock.calls[1][0] as Blob;
    expect(csvBlob.type).toBe('text/csv;charset=utf-8');
    expect(icsBlob.type).toBe('text/calendar;charset=utf-8');
    const csvBytes = await blobBytes(csvBlob);
    expect([...csvBytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect([...csvBytes.slice(-2)]).toEqual([0x0d, 0x0a]);
    expect(new TextDecoder().decode(csvBytes)).toBe(
      'Task ID,Sheet,Task,Task Path,Status,Progress,Priority,Assignees,Start Date,Due Date,Duration (minutes),Milestone,Dependencies\r\n',
    );
    expect(await blobText(icsBlob)).toContain('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n');
    await waitFor(() => expect(revokeObjectUrl).toHaveBeenCalledTimes(2));
  });

  it('downloads a real XMind ZIP and exposes its structured export report', async () => {
    const downloads: Array<{ download: string; href: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(
      this: HTMLAnchorElement,
    ) {
      downloads.push({ download: this.download, href: this.href });
    });
    const onDownload = vi.fn();
    render(
      <ImportExportPanel
        document={createDocument()}
        onImportResult={vi.fn()}
        onDownload={onDownload}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '导出 XMind' }));
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads).toEqual([
      { download: '产品-路线-.xmind', href: 'blob:mind-map-1' },
    ]);
    const blob = createObjectUrl.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('application/x-xmind');
    const bytes = await blobBytes(blob);
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(onDownload).toHaveBeenCalledWith(expect.objectContaining({
      fileName: '产品-路线-.xmind',
      format: 'xmind',
      report: expect.objectContaining({ success: true }),
    }));
    expect(screen.getByTestId('mindmap-xmind-export-report'))
      .toHaveTextContent('XMind 导出完成');
  });

  it('downloads a self-contained, script-free SVG and reports its format', async () => {
    const downloads: Array<{ download: string; href: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(
      this: HTMLAnchorElement,
    ) {
      downloads.push({ download: this.download, href: this.href });
    });
    const onDownload = vi.fn();
    render(
      <ImportExportPanel
        document={createDocument()}
        onImportResult={vi.fn()}
        onDownload={onDownload}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '导出 SVG' }));
    await waitFor(() => expect(downloads).toHaveLength(1));

    expect(downloads).toEqual([
      { download: '产品-路线-.svg', href: 'blob:mind-map-1' },
    ]);
    const blob = createObjectUrl.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('image/svg+xml;charset=utf-8');
    const svg = await blobText(blob);
    expect(svg).toContain('<svg');
    expect(svg).toContain('data-mindmap-static-export="ready"');
    expect(svg).not.toMatch(/<script|javascript:|\/api\/mindmap/iu);
    expect(onDownload).toHaveBeenCalledWith({
      fileName: '产品-路线-.svg',
      format: 'svg',
    });
    expect(await screen.findByText('SVG 导出完成。')).toBeInTheDocument();
  });

  it('applies scope-independent SVG scale and appearance settings from accessible controls', async () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const canonical = createDocument();
    const sheet = Object.values(canonical.sheets)[0];
    render(
      <ImportExportPanel
        document={canonical}
        activeSheetId={sheet.id}
        branchRootTopicId={sheet.rootTopicId}
        onImportResult={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('图片导出范围'), {
      target: { value: 'sheet' },
    });
    fireEvent.click(screen.getByRole('radio', { name: '3×' }));
    fireEvent.click(screen.getByRole('radio', { name: '透明' }));
    fireEvent.change(screen.getByLabelText('图片导出内边距'), {
      target: { value: '40' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: '添加 Sheet 画框与标题' }));
    fireEvent.click(screen.getByRole('button', { name: '导出 SVG' }));
    await waitFor(() => expect(createObjectUrl).toHaveBeenCalledTimes(1));

    const svg = await blobText(createObjectUrl.mock.calls[0][0] as Blob);
    expect(svg).toContain('data-export-scale="3"');
    expect(svg).toContain('data-export-background="transparent"');
    expect(svg).toContain('data-export-frame="none"');
    expect(svg).toContain('data-export-padding="40"');
    expect(svg).not.toContain('mindmap-full-sheet-title');
    const width = Number(svg.match(/<svg[^>]*\swidth="([0-9.]+)"/u)?.[1]);
    const viewBoxWidth = Number(svg.match(/viewBox="0 0 ([0-9.]+) [0-9.]+"/u)?.[1]);
    expect(width).toBe(viewBoxWidth * 3);
  });

  it('exports only the checked Sheets and prevents an empty selected-Sheet scope', async () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const canonical = createTwoSheetDocument();
    const [firstSheet] = Object.values(canonical.sheets)
      .sort((left, right) => left.orderKey.localeCompare(right.orderKey));
    render(
      <ImportExportPanel
        document={canonical}
        activeSheetId={firstSheet.id}
        onImportResult={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('图片导出范围'), {
      target: { value: 'selected-sheets' },
    });
    const firstCheckbox = screen.getByRole('checkbox', { name: '导出 Sheet：主画布' });
    const secondCheckbox = screen.getByRole('checkbox', { name: '导出 Sheet：第二画布' });
    expect(firstCheckbox).toBeChecked();
    expect(firstCheckbox).toBeDisabled();

    fireEvent.click(secondCheckbox);
    fireEvent.click(firstCheckbox);
    expect(firstCheckbox).not.toBeChecked();
    expect(secondCheckbox).toBeChecked();
    expect(secondCheckbox).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '导出 SVG' }));
    await waitFor(() => expect(createObjectUrl).toHaveBeenCalledTimes(1));
    const svg = await blobText(createObjectUrl.mock.calls[0][0] as Blob);
    expect(svg).toContain('第二画布');
    expect(svg).toContain('第二主题');
    expect(svg).not.toContain('主画布');
    expect(svg).not.toContain('创业计划');
  });

  it('passes mounted XMind resource bytes to the Worker export without canonicalizing them', async () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const sha256 = 'a930c2bb4e61c0682068f71c4ef427eefbb07098ecea9390e445e7af4b66a384';
    const digest = Uint8Array.from(
      sha256.match(/.{2}/g) ?? [],
      (value) => Number.parseInt(value, 16),
    );
    vi.stubGlobal('crypto', {
      subtle: { digest: vi.fn(async () => Uint8Array.from(digest).buffer) },
    });
    const pngBytes = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    ]);
    const resourceBytes = {
      'resources/pixel.png': pngBytes,
    };
    const exportXMind = vi.fn(async (
      _document: Domain.MindMapDocumentV1,
      _options?: Parameters<XMindAsyncCodecClient['exportXMind']>[1],
    ) => ({
      bytes: Uint8Array.from([0x50, 0x4b, 0x03, 0x04]),
      report: {
        degradedItems: 0,
        diagnostics: [],
        exportedSheets: 1,
        exportedTopics: 1,
        format: 'xmind-content-json' as const,
        preservedAttributes: 0,
        success: true,
      },
    }));
    const client: XMindAsyncCodecClient = {
      busy: false,
      cancel: vi.fn(),
      dispose: vi.fn(),
      exportXMind,
      importXMind: async () => {
        throw new Error('Not used by this test.');
      },
    };
    const canonical = createDocument();
    const sheetId = Object.keys(canonical.sheets)[0] as Domain.SheetId;
    const assetId = id<'Asset'>(20) as Domain.AssetId;
    const imageId = id<'Image'>(21) as Domain.ImageId;
    canonical.assets[assetId] = {
      id: assetId,
      fileName: 'pixel.png',
      mimeType: 'image/png',
      byteSize: pngBytes.byteLength,
      sha256,
      source: { kind: 'embedded', relativePath: 'resources/pixel.png' },
      intrinsicSize: { width: 1, height: 1 },
    };
    canonical.sheets[sheetId].images[imageId] = {
      id: imageId,
      topicId: canonical.sheets[sheetId].rootTopicId,
      assetId,
      orderKey: 'z',
      role: 'inline',
      placement: { side: 'top', align: 'center', offset: { x: 0, y: 0 } },
    };
    const before = JSON.stringify(canonical);
    render(
      <ImportExportPanel
        document={canonical}
        onImportResult={vi.fn()}
        xmindClientFactory={() => client}
        xmindResourceBytes={resourceBytes}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '导出 XMind' }));
    await waitFor(() => expect(exportXMind).toHaveBeenCalledTimes(1));

    expect(exportXMind.mock.calls[0][0]).toBe(canonical);
    expect(exportXMind.mock.calls[0][1]).toEqual(expect.objectContaining({
      resourceBytes: { [assetId]: pngBytes },
      signal: expect.any(AbortSignal),
    }));
    expect(JSON.stringify(canonical)).toBe(before);
  });

  it('imports an XMind ZIP as a parsed report without mutating the source document', async () => {
    const currentDocument = createDocument();
    const before = JSON.stringify(currentDocument);
    const exported = exportMindMapToXMind(currentDocument);
    expect(exported.bytes).not.toBeNull();
    const onImportResult = vi.fn();
    render(
      <ImportExportPanel
        document={currentDocument}
        importOptions={{ idFactory: deterministicIdFactory() }}
        onImportResult={onImportResult}
      />,
    );
    const file = new File(
      [new Uint8Array(exported.bytes!).buffer],
      'roundtrip.xmind',
      { type: 'application/x-xmind' },
    );

    fireEvent.change(screen.getByLabelText('选择 XMind 文件'), {
      target: { files: [file] },
    });

    await waitFor(() => expect(onImportResult).toHaveBeenCalledTimes(1));
    const [result, source] = onImportResult.mock.calls[0];
    expect(result.report).toMatchObject({
      format: 'xmind-content-json',
      importedSheets: 1,
      importedTopics: 1,
      success: true,
    });
    expect(result.report.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: XMIND_WORKER_FALLBACK_DIAGNOSTIC_CODE }),
    ]));
    expect(source).toEqual({
      fileName: 'roundtrip.xmind',
      fileSize: file.size,
      format: 'xmind-content-json',
    });
    expect(screen.getByTestId('mindmap-import-report')).toHaveTextContent('XMind');
    expect(screen.getByRole('list', { name: '导入诊断' }))
      .toHaveTextContent(XMIND_WORKER_FALLBACK_DIAGNOSTIC_CODE);
    expect(JSON.stringify(currentDocument)).toBe(before);
  });

  it('rejects an oversized XMind archive before reading or posting it to a Worker', async () => {
    const importXMind = vi.fn();
    const client: XMindAsyncCodecClient = {
      busy: false,
      cancel: vi.fn(),
      dispose: vi.fn(),
      exportXMind: async () => {
        throw new Error('Not used by this test.');
      },
      importXMind,
    };
    const onImportResult = vi.fn();
    render(
      <ImportExportPanel
        document={createDocument()}
        importOptions={{ limits: { maxInputBytes: 4 } }}
        onImportResult={onImportResult}
        xmindClientFactory={() => client}
      />,
    );
    const file = new File([new Uint8Array(8)], 'too-large.xmind', {
      type: 'application/x-xmind',
    });
    const arrayBufferSpy = vi.fn();
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: arrayBufferSpy,
    });

    fireEvent.change(screen.getByLabelText('选择 XMind 文件'), {
      target: { files: [file] },
    });

    expect(await screen.findByRole('alert'))
      .toHaveTextContent('XMind 文件超过 4 字节的安全读取上限');
    expect(arrayBufferSpy).not.toHaveBeenCalled();
    expect(importXMind).not.toHaveBeenCalled();
    expect(onImportResult).not.toHaveBeenCalled();
  });

  it('cancels an in-progress XMind file read before starting the Worker codec', async () => {
    const originalFileReader = globalThis.FileReader;
    let latestReader: PendingFileReader | undefined;
    class PendingFileReader extends EventTarget {
      static readonly EMPTY = 0;
      static readonly LOADING = 1;
      static readonly DONE = 2;
      readonly error = null;
      result: string | ArrayBuffer | null = null;
      readyState = PendingFileReader.EMPTY;
      aborted = false;

      constructor() {
        super();
        latestReader = this;
      }

      abort(): void {
        this.aborted = true;
        this.readyState = PendingFileReader.DONE;
        this.dispatchEvent(new ProgressEvent('abort'));
      }

      readAsArrayBuffer(): void {
        this.readyState = PendingFileReader.LOADING;
      }
    }
    Object.defineProperty(globalThis, 'FileReader', {
      configurable: true,
      value: PendingFileReader,
    });
    const importXMind = vi.fn();
    const client: XMindAsyncCodecClient = {
      busy: false,
      cancel: vi.fn(),
      dispose: vi.fn(),
      exportXMind: async () => {
        throw new Error('Not used by this test.');
      },
      importXMind,
    };
    try {
      render(
        <ImportExportPanel
          document={createDocument()}
          onImportResult={vi.fn()}
          xmindClientFactory={() => client}
        />,
      );
      fireEvent.change(screen.getByLabelText('选择 XMind 文件'), {
        target: {
          files: [new File([new Uint8Array(8)], 'pending.xmind')],
        },
      });

      fireEvent.click(await screen.findByRole('button', { name: '取消 XMind 导入' }));
      expect(await screen.findByText('XMind 导入已取消。')).toBeInTheDocument();
      expect(latestReader?.aborted).toBe(true);
      expect(importXMind).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, 'FileReader', {
        configurable: true,
        value: originalFileReader,
      });
    }
  });

  it('parses a selected Markdown file, reports it, and leaves the current document untouched', async () => {
    const currentDocument = createDocument();
    const before = JSON.stringify(currentDocument);
    const onImportResult = vi.fn();
    render(
      <ImportExportPanel
        document={currentDocument}
        importOptions={{ idFactory: deterministicIdFactory() }}
        onImportResult={onImportResult}
      />,
    );
    const file = new File([
      '# Imported plan\n\n## Sheet A\n\n- Root\n  - Child\n',
    ], 'plan.md', { type: 'text/markdown' });

    fireEvent.change(screen.getByLabelText('选择 Markdown 文件'), {
      target: { files: [file] },
    });

    await waitFor(() => expect(onImportResult).toHaveBeenCalledTimes(1));
    const [result, source] = onImportResult.mock.calls[0];
    expect(result.document).not.toBeNull();
    expect(result.report).toMatchObject({
      format: 'markdown-outline',
      importedSheets: 1,
      importedTopics: 2,
      success: true,
    });
    expect(source).toEqual({
      fileName: 'plan.md',
      fileSize: file.size,
      format: 'markdown-outline',
    });
    expect(screen.getByTestId('mindmap-import-report')).toHaveTextContent('解析成功');
    expect(screen.getByTestId('mindmap-import-report')).toHaveTextContent('plan.md');
    expect(JSON.stringify(currentDocument)).toBe(before);
  });

  it('parses OPML and exposes structured preservation diagnostics to the parent and UI', async () => {
    const onImportResult = vi.fn();
    render(
      <ImportExportPanel
        document={createDocument()}
        importOptions={{ idFactory: deterministicIdFactory() }}
        onImportResult={onImportResult}
      />,
    );
    const file = new File([
      '<?xml version="1.0"?><opml version="2.0"><head><title>Imported</title></head>',
      '<body><outline text="Root" custom-flag="yes"><outline text="Child"/></outline></body></opml>',
    ], 'outline.opml', { type: 'application/xml' });

    fireEvent.change(screen.getByLabelText('选择 OPML 文件'), {
      target: { files: [file] },
    });

    await waitFor(() => expect(onImportResult).toHaveBeenCalledTimes(1));
    const [result, source] = onImportResult.mock.calls[0];
    expect(source.format).toBe('opml-2.0');
    expect(result.report.success).toBe(true);
    expect(result.report.preservedAttributes).toBe(1);
    expect(result.report.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'opml.unknown-attributes-preserved',
        disposition: 'preserved',
      }),
    ]));
    expect(screen.getByRole('list', { name: '导入诊断' }))
      .toHaveTextContent('opml.unknown-attributes-preserved');
  });

  it('returns parser failures as reports and displays their diagnostics', async () => {
    const onImportResult = vi.fn();
    render(
      <ImportExportPanel
        document={createDocument()}
        importOptions={{ idFactory: deterministicIdFactory() }}
        onImportResult={onImportResult}
      />,
    );
    const file = new File(['# Heading only\n\nNo outline here.'], 'empty.md', {
      type: 'text/markdown',
    });

    fireEvent.change(screen.getByLabelText('选择 Markdown 文件'), {
      target: { files: [file] },
    });

    await waitFor(() => expect(onImportResult).toHaveBeenCalledTimes(1));
    const result = onImportResult.mock.calls[0][0];
    expect(result.document).toBeNull();
    expect(result.report.success).toBe(false);
    expect(result.report.diagnostics.map((item: { code: string }) => item.code))
      .toContain('markdown.no-outline');
    expect(screen.getByTestId('mindmap-import-report')).toHaveTextContent('无法导入');
    expect(screen.getByRole('list', { name: '导入诊断' }))
      .toHaveTextContent('markdown.no-outline');
  });

  it('shows file-read and download failures without calling the import callback', async () => {
    const onImportResult = vi.fn();
    render(
      <ImportExportPanel
        document={createDocument()}
        onImportResult={onImportResult}
      />,
    );
    const unreadable = new File(['content'], 'broken.md', { type: 'text/markdown' });
    Object.defineProperty(unreadable, 'text', {
      configurable: true,
      value: vi.fn().mockRejectedValue(new Error('磁盘读取失败')),
    });

    fireEvent.change(screen.getByLabelText('选择 Markdown 文件'), {
      target: { files: [unreadable] },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('导入失败：磁盘读取失败');
    expect(onImportResult).not.toHaveBeenCalled();

    createObjectUrl.mockImplementationOnce(() => {
      throw new Error('Blob 不可用');
    });
    fireEvent.click(screen.getByRole('button', { name: '导出 OPML' }));
    expect(screen.getByRole('alert')).toHaveTextContent('导出失败：Blob 不可用');
  });

  it('shows Worker busy state and lets the user cancel an active XMind export', async () => {
    const dispose = vi.fn();
    const client: XMindAsyncCodecClient = {
      busy: false,
      cancel: vi.fn(),
      dispose,
      exportXMind: (_document, options = {}) => new Promise((_resolve, reject) => {
        const rejectAbort = (): void => reject(new DOMException(
          'The XMind operation was cancelled.',
          'AbortError',
        ));
        if (options.signal?.aborted) rejectAbort();
        else options.signal?.addEventListener('abort', rejectAbort, { once: true });
      }),
      importXMind: async () => {
        throw new Error('Not used by this test.');
      },
    };
    const { unmount } = render(
      <ImportExportPanel
        document={createDocument()}
        onImportResult={vi.fn()}
        xmindClientFactory={() => client}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '导出 XMind' }));
    const cancel = await screen.findByRole('button', { name: '取消 XMind 导出' });
    expect(screen.getByTestId('mindmap-import-export-panel'))
      .toHaveAttribute('data-xmind-busy', 'export');
    expect(screen.getByRole('button', { name: '正在生成 XMind…' })).toBeDisabled();

    fireEvent.click(cancel);
    expect(await screen.findByText('XMind 导出已取消。')).toBeInTheDocument();
    expect(screen.getByTestId('mindmap-import-export-panel'))
      .toHaveAttribute('data-xmind-busy', 'false');
    expect(screen.getByRole('button', { name: '导出 XMind' })).toBeEnabled();

    unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('shows static-export busy state and cancels managed-resource resolution', async () => {
    const canonical = createDocument();
    const sheet = Object.values(canonical.sheets)[0];
    const assetId = id<'Asset'>(30) as Domain.AssetId;
    const imageId = id<'Image'>(31) as Domain.ImageId;
    const sha256 = 'a'.repeat(64);
    const objectKey = `mindmap-images/sha256/${sha256}.png`;
    canonical.assets[assetId] = {
      id: assetId,
      fileName: 'pending.png',
      mimeType: 'image/png',
      byteSize: 24,
      sha256,
      source: { kind: 'managed', objectKey },
      intrinsicSize: { width: 1, height: 1 },
    };
    sheet.images[imageId] = {
      id: imageId,
      topicId: sheet.rootTopicId,
      assetId,
      orderKey: 'pending-managed-image',
      role: 'inline',
      placement: { side: 'top', align: 'center', offset: { x: 0, y: 0 } },
    };
    const readManagedResource = vi.spyOn(api, 'getMindMapImageAssetBytes')
      .mockImplementation((_resourceName, options = {}) => new Promise((_resolve, reject) => {
        const rejectAbort = (): void => reject(new DOMException(
          'Static export was cancelled.',
          'AbortError',
        ));
        if (options.signal?.aborted) rejectAbort();
        else options.signal?.addEventListener('abort', rejectAbort, { once: true });
      }));

    render(
      <ImportExportPanel
        document={canonical}
        onImportResult={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '导出 SVG' }));
    const cancel = await screen.findByRole('button', { name: '取消 SVG 导出' });
    await waitFor(() => expect(readManagedResource).toHaveBeenCalledWith(objectKey, {
      signal: expect.any(AbortSignal),
    }));
    expect(screen.getByTestId('mindmap-import-export-panel'))
      .toHaveAttribute('data-static-busy', 'svg');
    expect(screen.getByRole('button', { name: '正在生成 SVG…' })).toBeDisabled();

    fireEvent.click(cancel);
    expect(await screen.findByText('SVG 导出已取消。')).toBeInTheDocument();
    expect(screen.getByTestId('mindmap-import-export-panel'))
      .toHaveAttribute('data-static-busy', 'false');
    expect(screen.getByRole('button', { name: '导出 SVG' })).toBeEnabled();
    expect(createObjectUrl).not.toHaveBeenCalled();
    readManagedResource.mockRestore();
  });

  it('fails closed without downloading when a managed static-export resource is unavailable', async () => {
    const canonical = createDocument();
    const sheet = Object.values(canonical.sheets)[0];
    const assetId = id<'Asset'>(32) as Domain.AssetId;
    const imageId = id<'Image'>(33) as Domain.ImageId;
    const sha256 = 'b'.repeat(64);
    canonical.assets[assetId] = {
      id: assetId,
      fileName: 'unavailable.png',
      mimeType: 'image/png',
      byteSize: 24,
      sha256,
      source: {
        kind: 'managed',
        objectKey: `mindmap-images/sha256/${sha256}.png`,
      },
      intrinsicSize: { width: 1, height: 1 },
    };
    sheet.images[imageId] = {
      id: imageId,
      topicId: sheet.rootTopicId,
      assetId,
      orderKey: 'unavailable-managed-image',
      role: 'inline',
      placement: { side: 'top', align: 'center', offset: { x: 0, y: 0 } },
    };
    const readManagedResource = vi.spyOn(api, 'getMindMapImageAssetBytes')
      .mockRejectedValue(new Error('托管图片资源不可用'));

    render(
      <ImportExportPanel
        document={canonical}
        onImportResult={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '导出 SVG' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '导出失败：托管图片资源不可用或完整性校验失败。',
    );
    expect(screen.getByTestId('mindmap-import-export-panel'))
      .toHaveAttribute('data-static-busy', 'false');
    expect(screen.getByRole('button', { name: '导出 SVG' })).toBeEnabled();
    expect(createObjectUrl).not.toHaveBeenCalled();
    readManagedResource.mockRestore();
  });

  it('does not expose canonical entity IDs from a full-canvas export failure', async () => {
    const canonical = createDocument();
    const sheet = Object.values(canonical.sheets)[0];
    const missingAssetId = id<'Asset'>(34) as Domain.AssetId;
    const imageId = id<'Image'>(35) as Domain.ImageId;
    sheet.images[imageId] = {
      id: imageId,
      topicId: sheet.rootTopicId,
      assetId: missingAssetId,
      orderKey: 'missing-image-asset',
      role: 'inline',
      placement: { side: 'top', align: 'center', offset: { x: 0, y: 0 } },
    };

    render(
      <ImportExportPanel
        document={canonical}
        onImportResult={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '导出 SVG' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      '导出失败：完整画布超过安全导出限制，或包含无法完整验证的内容。',
    );
    expect(alert).not.toHaveTextContent(String(imageId));
    expect(alert).not.toHaveTextContent(String(missingAssetId));
    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  it('keeps exports and disclosure keyboard-accessible while disabling import in read-only mode', async () => {
    const user = userEvent.setup();
    render(
      <ImportExportPanel
        document={createDocument()}
        readOnly
        onImportResult={vi.fn()}
      />,
    );

    expect(screen.getByTestId('mindmap-import-export-panel'))
      .toHaveAttribute('data-readonly', 'true');
    expect(screen.getByRole('button', { name: '导出 Markdown' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '导出 OPML' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '导出 Task CSV' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '导出 Task ICS' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '导出 SVG' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '导出 PNG' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '导出 JPEG' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '导出 XMind' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '导入 Markdown' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '导入 OPML' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '导入 XMind' })).toBeDisabled();
    expect(screen.getByLabelText('选择 Markdown 文件')).toBeDisabled();
    expect(screen.getByLabelText('选择 OPML 文件')).toBeDisabled();
    expect(screen.getByLabelText('选择 XMind 文件')).toBeDisabled();
    expect(screen.getByText('只读模式下不能导入文件。')).toBeInTheDocument();

    const disclosure = screen.getByRole('button', { name: '导入与导出' });
    disclosure.focus();
    await user.keyboard('{Enter}');
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: '导出 Markdown' })).not.toBeInTheDocument();
    await user.keyboard(' ');
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: '导出 Markdown' })).toBeEnabled();
  });
});
