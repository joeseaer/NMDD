import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  ChevronDown,
  ChevronRight,
  Download,
  FileInput,
  Upload,
  X,
} from 'lucide-react';

import type { MindMapDocumentV1, SheetId, TopicId } from '../domain/types';
import { getMindMapSheetsInViewOrder } from '../view/ordering';
import {
  rasterizeMindMapSvg,
  serializeMindMapSvgSpec,
  type MindMapRasterScale,
} from '../export/staticDownload';
import {
  assertFullMindMapSvgSerializedByteLength,
  createFullMindMapSvgExport,
  FullMindMapSvgExportError,
  type FullMindMapSvgBackground,
} from '../export/fullCanvasSvg';
import {
  exportMindMapToMarkdown,
  exportMindMapToOpml,
  exportMindMapToTaskCsv,
  exportMindMapToTaskIcs,
  createXMindWorkerClient,
  importMindMapFromMarkdown,
  importMindMapFromOpml,
  isXMindWorkerAbortError,
  resolveXMindArchiveByteLimit,
  resolveXMindExportResourceBytes,
  XMindManagedResourceUnavailableError,
  type XMindAsyncCodecClient,
  type MindMapImportResult,
  type MindMapOutlineFormat,
  type XMindExportReport,
  type XMindImportOptions,
} from '../io';
import { api } from '../../../services/api';

export type MindMapDownloadFormat =
  | 'markdown'
  | 'opml'
  | 'task-csv'
  | 'task-ics'
  | 'svg'
  | 'png'
  | 'jpeg'
  | 'xmind';

export interface MindMapImportSource {
  readonly fileName: string;
  readonly fileSize: number;
  readonly format: MindMapOutlineFormat;
}

export interface MindMapDownloadInfo {
  readonly fileName: string;
  readonly format: MindMapDownloadFormat;
  readonly report?: XMindExportReport;
}

export interface ImportExportPanelProps {
  readonly document: MindMapDocumentV1;
  readonly activeSheetId?: SheetId;
  readonly branchRootTopicId?: TopicId;
  /** Read-only documents remain exportable, but cannot start an import. */
  readonly readOnly?: boolean;
  readonly defaultExpanded?: boolean;
  readonly className?: string;
  readonly importOptions?: XMindImportOptions;
  /** Mounted-session XMind resources; never serialized into canonical content. */
  readonly xmindResourceBytes?: Readonly<Record<string, Uint8Array>>;
  /** Optional dependency injection for deterministic Worker/UI tests. */
  readonly xmindClientFactory?: () => XMindAsyncCodecClient;
  /**
   * Receives the parser result without mutating the current canonical document.
   * The parent decides whether and how to apply a successful document.
   */
  onImportResult(result: MindMapImportResult, source: MindMapImportSource): void;
  onDownload?(info: MindMapDownloadInfo): void;
}

const INVALID_FILE_NAME_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/g;
const WINDOWS_RESERVED_FILE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const MAX_FILE_BASE_CODE_POINTS = 96;

/** Produces a portable base name suitable for browser downloads on all desktop OSes. */
export function sanitizeMindMapFileBaseName(title: string): string {
  let value = title
    .normalize('NFKC')
    .replace(INVALID_FILE_NAME_CHARACTERS, '-')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .trim()
    .replace(/^[. ]+|[. ]+$/g, '');

  value = Array.from(value).slice(0, MAX_FILE_BASE_CODE_POINTS).join('')
    .replace(/[. ]+$/g, '');
  if (value === '' || value === '.' || value === '..') value = 'mind-map';
  if (WINDOWS_RESERVED_FILE_NAME.test(value)) value = `_${value}`;
  return value;
}

export function mindMapDownloadFileName(
  title: string,
  format: MindMapDownloadFormat,
): string {
  const extension = format === 'markdown' ? 'md'
    : format === 'opml' ? 'opml'
      : format === 'task-csv' ? 'csv'
        : format === 'task-ics' ? 'ics'
          : format === 'svg' ? 'svg'
            : format === 'png' ? 'png'
              : format === 'jpeg' ? 'jpg'
              : 'xmind';
  return `${sanitizeMindMapFileBaseName(title)}.${extension}`;
}

function triggerDownload(
  content: string | Uint8Array | Blob,
  fileName: string,
  mimeType: string,
): void {
  if (typeof URL.createObjectURL !== 'function') {
    throw new Error('当前浏览器不支持本地文件下载。');
  }

  const blob = content instanceof Blob
    ? content
    : new Blob([
        typeof content === 'string' ? content : new Uint8Array(content).buffer,
      ], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = globalThis.document.createElement('a');
  try {
    anchor.href = url;
    anchor.download = fileName;
    anchor.hidden = true;
    globalThis.document.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    // Safari and embedded WebViews may not start consuming the Blob until the
    // click task returns; revoking synchronously can cancel an otherwise valid download.
    globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function readFileAsText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result ?? '')));
    reader.addEventListener('error', () => {
      reject(reader.error ?? new Error('无法读取所选文件。'));
    });
    reader.addEventListener('abort', () => reject(new Error('文件读取已取消。')));
    reader.readAsText(file, 'utf-8');
  });
}

function readFileAsBytes(file: File, signal?: AbortSignal): Promise<Uint8Array> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('文件读取已取消。', 'AbortError'));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const cleanup = (): void => signal?.removeEventListener('abort', abortRead);
    const abortRead = (): void => {
      if (reader.readyState === FileReader.LOADING) reader.abort();
      else {
        cleanup();
        reject(new DOMException('文件读取已取消。', 'AbortError'));
      }
    };
    reader.addEventListener('load', () => {
      cleanup();
      if (!(reader.result instanceof ArrayBuffer)) {
        reject(new Error('所选文件不是有效的二进制文件。'));
        return;
      }
      resolve(new Uint8Array(reader.result));
    });
    reader.addEventListener('error', () => {
      cleanup();
      reject(reader.error ?? new Error('无法读取所选文件。'));
    });
    reader.addEventListener('abort', () => {
      cleanup();
      reject(new DOMException('文件读取已取消。', 'AbortError'));
    });
    signal?.addEventListener('abort', abortRead, { once: true });
    try {
      reader.readAsArrayBuffer(file);
    } catch (caught) {
      cleanup();
      reject(caught);
    }
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof XMindManagedResourceUnavailableError) {
    return '托管图片资源不可用或完整性校验失败。';
  }
  if (error instanceof FullMindMapSvgExportError) {
    return '完整画布超过安全导出限制，或包含无法完整验证的内容。';
  }
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return '发生未知错误。';
}

const formatLabel = (format: MindMapOutlineFormat): string =>
  format === 'markdown-outline' ? 'Markdown'
    : format === 'opml-2.0' ? 'OPML 2.0'
      : 'XMind';

const diagnosticSeverityLabel = {
  error: '错误',
  info: '信息',
  warning: '警告',
} as const;

interface ImportFeedback {
  readonly result: MindMapImportResult;
  readonly source: MindMapImportSource;
}

interface XMindExportFeedback {
  readonly fileName: string;
  readonly report: XMindExportReport;
}

export const ImportExportPanel = ({
  document,
  activeSheetId,
  branchRootTopicId,
  readOnly = false,
  defaultExpanded = true,
  className = '',
  importOptions,
  xmindResourceBytes,
  xmindClientFactory = createXMindWorkerClient,
  onImportResult,
  onDownload,
}: ImportExportPanelProps) => {
  const contentId = useId();
  const readOnlyDescriptionId = useId();
  const markdownInputRef = useRef<HTMLInputElement>(null);
  const opmlInputRef = useRef<HTMLInputElement>(null);
  const xmindInputRef = useRef<HTMLInputElement>(null);
  const importGenerationRef = useRef(0);
  const xmindClientFactoryRef = useRef(xmindClientFactory);
  const xmindAbortRef = useRef<AbortController>();
  const staticAbortRef = useRef<AbortController>();
  const xmindClientRef = useRef<XMindAsyncCodecClient>();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [busyFormat, setBusyFormat] = useState<MindMapOutlineFormat>();
  const [busyXMindOperation, setBusyXMindOperation] = useState<'export' | 'import'>();
  const [busyStaticFormat, setBusyStaticFormat] = useState<'svg' | 'png' | 'jpeg'>();
  const staticSheetOptions = useMemo(
    () => getMindMapSheetsInViewOrder(document),
    [document],
  );
  const [staticScope, setStaticScope] = useState<
    'all-sheets' | 'branch' | 'selected-sheets' | 'sheet'
  >(
    activeSheetId ? 'sheet' : 'all-sheets',
  );
  const [selectedStaticSheetIds, setSelectedStaticSheetIds] = useState<readonly SheetId[]>(
    () => {
      if (activeSheetId && document.sheets[activeSheetId]) return [activeSheetId];
      const firstSheetId = staticSheetOptions[0]?.id;
      return firstSheetId ? [firstSheetId] : [];
    },
  );
  const [staticScale, setStaticScale] = useState<MindMapRasterScale>(1);
  const [staticBackground, setStaticBackground] = useState<'source' | 'solid' | 'transparent'>(
    'source',
  );
  const [staticBackgroundColor, setStaticBackgroundColor] = useState('#ffffff');
  const [staticPadding, setStaticPadding] = useState(24);
  const [staticFrame, setStaticFrame] = useState(true);
  const [feedback, setFeedback] = useState<ImportFeedback>();
  const [xmindExportFeedback, setXMindExportFeedback] = useState<XMindExportFeedback>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    const client = xmindClientFactoryRef.current();
    xmindClientRef.current = client;
    return () => {
      importGenerationRef.current += 1;
      xmindAbortRef.current?.abort();
      xmindAbortRef.current = undefined;
      staticAbortRef.current?.abort();
      staticAbortRef.current = undefined;
      client.dispose();
      if (xmindClientRef.current === client) xmindClientRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (staticScope === 'branch' && (!activeSheetId || !branchRootTopicId)) {
      setStaticScope(activeSheetId ? 'sheet' : 'all-sheets');
    } else if (staticScope === 'sheet' && !activeSheetId) {
      setStaticScope('all-sheets');
    }
  }, [activeSheetId, branchRootTopicId, staticScope]);

  useEffect(() => {
    setSelectedStaticSheetIds((current) => {
      const currentSet = new Set(current);
      const orderedValid = staticSheetOptions
        .map((sheet) => sheet.id)
        .filter((sheetId) => currentSet.has(sheetId));
      const fallbackId = activeSheetId && document.sheets[activeSheetId]
        ? activeSheetId
        : staticSheetOptions[0]?.id;
      const next = orderedValid.length > 0
        ? orderedValid
        : fallbackId
          ? [fallbackId]
          : [];
      return next.length === current.length
        && next.every((sheetId, index) => sheetId === current[index])
        ? current
        : next;
    });
  }, [activeSheetId, document.sheets, staticSheetOptions]);

  const exportDocument = async (format: MindMapDownloadFormat): Promise<void> => {
    if (
      busyFormat !== undefined
      || busyXMindOperation !== undefined
      || busyStaticFormat !== undefined
    ) return;
    setError(undefined);
    setNotice(undefined);
    setXMindExportFeedback(undefined);
    let generation: number | undefined;
    let controller: AbortController | undefined;
    try {
      const fileName = mindMapDownloadFileName(document.title, format);
      if (format === 'markdown') {
        triggerDownload(
          exportMindMapToMarkdown(document),
          fileName,
          'text/markdown;charset=utf-8',
        );
        onDownload?.({ fileName, format });
      } else if (format === 'opml') {
        triggerDownload(
          exportMindMapToOpml(document),
          fileName,
          'application/xml;charset=utf-8',
        );
        onDownload?.({ fileName, format });
      } else if (format === 'task-csv') {
        triggerDownload(
          exportMindMapToTaskCsv(document),
          fileName,
          'text/csv;charset=utf-8',
        );
        onDownload?.({ fileName, format });
      } else if (format === 'task-ics') {
        triggerDownload(
          exportMindMapToTaskIcs(document),
          fileName,
          'text/calendar;charset=utf-8',
        );
        onDownload?.({ fileName, format });
      } else if (format === 'svg' || format === 'png' || format === 'jpeg') {
        generation = importGenerationRef.current + 1;
        importGenerationRef.current = generation;
        controller = new AbortController();
        staticAbortRef.current = controller;
        setBusyStaticFormat(format);
        if (!Number.isInteger(staticPadding) || staticPadding < 0 || staticPadding > 512) {
          throw new Error('图片导出内边距必须是 0 到 512 的整数。');
        }
        const scope = staticScope === 'all-sheets'
          ? { kind: 'all-sheets' as const }
          : staticScope === 'sheet' && activeSheetId
            ? { kind: 'sheet' as const, sheetId: activeSheetId }
            : staticScope === 'selected-sheets' && selectedStaticSheetIds.length > 0
              ? {
                  kind: 'selected-sheets' as const,
                  sheetIds: selectedStaticSheetIds,
                }
            : staticScope === 'branch' && activeSheetId && branchRootTopicId
              ? {
                  kind: 'branch' as const,
                  sheetId: activeSheetId,
                  rootTopicId: branchRootTopicId,
                }
              : undefined;
        if (!scope) throw new Error('当前导出范围不可用，请重新选择。');
        const forcedJpegBackground = format === 'jpeg' && staticBackground !== 'solid';
        const resolvedBackground: FullMindMapSvgBackground = forcedJpegBackground
          ? { kind: 'solid' as const, color: '#ffffff' }
          : staticBackground === 'solid'
            ? { kind: 'solid' as const, color: staticBackgroundColor }
            : staticBackground === 'transparent'
              ? { kind: 'transparent' as const }
              : { kind: 'source' as const };
        if (forcedJpegBackground) {
          setStaticBackground('solid');
          setStaticBackgroundColor('#ffffff');
        }
        const staticExport = await createFullMindMapSvgExport(document, {
          signal: controller.signal,
          scope,
          appearance: {
            background: resolvedBackground,
            frame: staticFrame ? 'sheet-card' : 'none',
            padding: staticPadding,
          },
          ...(xmindResourceBytes === undefined ? {} : { resourceBytes: xmindResourceBytes }),
          readManagedResource: (objectKey, options) => (
            api.getMindMapImageAssetBytes(objectKey, options)
          ),
          ...(typeof globalThis.fetch === 'function'
            ? { fetchRemote: globalThis.fetch.bind(globalThis) }
            : {}),
        });
        if (importGenerationRef.current !== generation) return;
        const svg = serializeMindMapSvgSpec(staticExport.spec, {
          scale: format === 'svg' ? staticScale : 1,
        });
        assertFullMindMapSvgSerializedByteLength(svg, staticExport.serializedByteLimit);
        if (format === 'svg') {
          triggerDownload(svg, fileName, 'image/svg+xml;charset=utf-8');
        } else {
          const raster = await rasterizeMindMapSvg(
            svg,
            staticExport.width,
            staticExport.height,
            {
              format: format === 'jpeg' ? 'jpeg' : 'png',
              scale: staticScale,
              signal: controller.signal,
              ...(format === 'jpeg'
                ? { backgroundColor: resolvedBackground.kind === 'solid'
                    ? resolvedBackground.color
                    : '#ffffff' }
                : {}),
            },
          );
          if (importGenerationRef.current !== generation) return;
          triggerDownload(raster.blob, fileName, raster.mimeType);
        }
        setNotice(forcedJpegBackground
          ? 'JPEG 导出完成；透明/画布背景已改为白色不透明背景。'
          : `${format.toUpperCase()} 导出完成。`);
        onDownload?.({ fileName, format });
      } else {
        generation = importGenerationRef.current + 1;
        importGenerationRef.current = generation;
        controller = new AbortController();
        xmindAbortRef.current = controller;
        setBusyXMindOperation('export');
        const client = xmindClientRef.current;
        if (!client) throw new Error('XMind Worker 客户端尚未就绪。');
        const resolvedResourceBytes = await resolveXMindExportResourceBytes({
          document,
          signal: controller.signal,
          ...(xmindResourceBytes === undefined ? {} : { resourceBytes: xmindResourceBytes }),
          readManagedResource: (objectKey, options) => (
            api.getMindMapImageAssetBytes(objectKey, options)
          ),
          ...(typeof globalThis.fetch === 'function'
            ? { fetchRemote: globalThis.fetch.bind(globalThis) }
            : {}),
        });
        if (importGenerationRef.current !== generation) return;
        const result = await client.exportXMind(document, {
          signal: controller.signal,
          ...(resolvedResourceBytes === undefined
            ? {}
            : { resourceBytes: resolvedResourceBytes }),
        });
        if (importGenerationRef.current !== generation) return;
        if (!result.report.success || !result.bytes) {
          const reason = result.report.diagnostics[0]?.message ?? '无法生成 XMind 文件。';
          throw new Error(reason);
        }
        triggerDownload(result.bytes, fileName, 'application/x-xmind');
        setXMindExportFeedback({ fileName, report: result.report });
        onDownload?.({ fileName, format, report: result.report });
      }
    } catch (caught) {
      if (generation !== undefined && importGenerationRef.current !== generation) return;
      if (isXMindWorkerAbortError(caught)) {
        setNotice(format === 'svg' || format === 'png' || format === 'jpeg'
          ? `${format.toUpperCase()} 导出已取消。`
          : 'XMind 导出已取消。');
      }
      else setError(`导出失败：${errorMessage(caught)}`);
    } finally {
      if (generation !== undefined && importGenerationRef.current === generation) {
        setBusyXMindOperation(undefined);
        if (xmindAbortRef.current === controller) xmindAbortRef.current = undefined;
        setBusyStaticFormat(undefined);
        if (staticAbortRef.current === controller) staticAbortRef.current = undefined;
      }
    }
  };

  const importFile = async (
    format: MindMapOutlineFormat,
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (
      !file
      || readOnly
      || busyFormat !== undefined
      || busyXMindOperation !== undefined
      || busyStaticFormat !== undefined
    ) return;

    const generation = importGenerationRef.current + 1;
    importGenerationRef.current = generation;
    setBusyFormat(format);
    setError(undefined);
    setNotice(undefined);
    setFeedback(undefined);
    setXMindExportFeedback(undefined);
    const controller = format === 'xmind-content-json'
      ? new AbortController()
      : undefined;
    if (controller) {
      xmindAbortRef.current = controller;
      setBusyXMindOperation('import');
    }

    try {
      const result = format === 'xmind-content-json'
        ? (() => {
            const client = xmindClientRef.current;
            if (!client) throw new Error('XMind Worker 客户端尚未就绪。');
            const maximumArchiveBytes = resolveXMindArchiveByteLimit(importOptions);
            if (file.size > maximumArchiveBytes) {
              throw new Error(
                `XMind 文件超过 ${maximumArchiveBytes} 字节的安全读取上限。`,
              );
            }
            return readFileAsBytes(file, controller?.signal).then((bytes) => client.importXMind(
              bytes,
              importOptions,
              { signal: controller?.signal },
            ));
          })()
        : (() => readFileAsText(file).then((sourceText) => (
            format === 'markdown-outline'
              ? importMindMapFromMarkdown(sourceText, importOptions)
              : importMindMapFromOpml(sourceText, importOptions)
          )))();
      const resolvedResult = await result;
      if (importGenerationRef.current !== generation) return;
      const source: MindMapImportSource = {
        fileName: file.name,
        fileSize: file.size,
        format,
      };
      setFeedback({ result: resolvedResult, source });
      onImportResult(resolvedResult, source);
    } catch (caught) {
      if (importGenerationRef.current === generation) {
        if (isXMindWorkerAbortError(caught)) setNotice('XMind 导入已取消。');
        else setError(`导入失败：${errorMessage(caught)}`);
      }
    } finally {
      if (importGenerationRef.current === generation) {
        setBusyFormat(undefined);
        if (format === 'xmind-content-json') setBusyXMindOperation(undefined);
        if (xmindAbortRef.current === controller) xmindAbortRef.current = undefined;
      }
    }
  };

  const importDisabled = readOnly
    || busyFormat !== undefined
    || busyXMindOperation !== undefined
    || busyStaticFormat !== undefined;
  const exportDisabled = busyFormat !== undefined
    || busyXMindOperation !== undefined
    || busyStaticFormat !== undefined;
  const cancelXMindOperation = (): void => {
    xmindAbortRef.current?.abort();
    xmindClientRef.current?.cancel();
  };
  const cancelStaticOperation = (): void => staticAbortRef.current?.abort();
  const clearFeedback = (): void => {
    setFeedback(undefined);
    setXMindExportFeedback(undefined);
    setError(undefined);
    setNotice(undefined);
  };

  return (
    <aside
      className={`nowheel nodrag flex w-80 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white/95 shadow-xl backdrop-blur ${className}`}
      aria-label="导入与导出"
      data-testid="mindmap-import-export-panel"
      data-readonly={readOnly ? 'true' : 'false'}
      data-xmind-busy={busyXMindOperation ?? 'false'}
      data-static-busy={busyStaticFormat ?? 'false'}
      aria-busy={busyXMindOperation !== undefined || busyStaticFormat !== undefined}
      onMouseDown={(event: ReactMouseEvent<HTMLElement>) => event.stopPropagation()}
    >
      <div className="flex h-11 items-center px-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-slate-50 focus:ring-2 focus:ring-blue-100"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded
            ? <ChevronDown size={15} aria-hidden="true" />
            : <ChevronRight size={15} aria-hidden="true" />}
          <FileInput size={15} aria-hidden="true" />
          <span className="font-semibold text-slate-700">导入与导出</span>
        </button>
      </div>

      {expanded && (
        <div id={contentId} className="min-h-0 overflow-y-auto border-t border-slate-100 px-3 pb-3">
          <section className="space-y-2 py-3" aria-labelledby={`${contentId}-export-title`}>
            <div>
              <h3
                id={`${contentId}-export-title`}
                className="text-[11px] font-semibold uppercase tracking-wide text-slate-500"
              >
                导出
              </h3>
              <p className="mt-1 text-[10px] leading-4 text-slate-400">
                导出当前文档的全部 Sheet 与主题层级。
              </p>
            </div>
            <fieldset
              className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/70 p-2 disabled:opacity-60"
              disabled={exportDisabled}
              aria-label="图片导出设置"
            >
              <legend className="px-1 text-[10px] font-semibold text-slate-600">
                图片导出设置
              </legend>
              <label className="block text-[10px] text-slate-500">
                <span className="mb-1 block">导出范围</span>
                <select
                  className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-blue-100"
                  aria-label="图片导出范围"
                  value={staticScope}
                  onChange={(event) => setStaticScope(
                    event.currentTarget.value as typeof staticScope,
                  )}
                >
                  <option value="branch" disabled={!activeSheetId || !branchRootTopicId}>
                    当前分支
                  </option>
                  <option value="sheet" disabled={!activeSheetId}>当前 Sheet</option>
                  <option value="selected-sheets">选定 Sheet</option>
                  <option value="all-sheets">全部 Sheet</option>
                </select>
              </label>
              {!branchRootTopicId && (
                <p className="text-[9px] leading-3 text-slate-400">
                  选择一个主题后可导出当前分支。
                </p>
              )}
              {staticScope === 'selected-sheets' && (
                <fieldset className="space-y-1 rounded-md border border-slate-200 bg-white p-2">
                  <legend className="px-1 text-[10px] text-slate-500">选择 Sheet</legend>
                  {staticSheetOptions.map((sheet) => {
                    const checked = selectedStaticSheetIds.includes(sheet.id);
                    return (
                      <label
                        key={sheet.id}
                        className="flex items-center gap-2 text-[10px] text-slate-600"
                      >
                        <input
                          type="checkbox"
                          aria-label={`导出 Sheet：${sheet.title}`}
                          checked={checked}
                          disabled={checked && selectedStaticSheetIds.length === 1}
                          onChange={(event) => {
                            const shouldSelect = event.currentTarget.checked;
                            setSelectedStaticSheetIds((current) => {
                              if (!shouldSelect) {
                                return current.length > 1
                                  ? current.filter((sheetId) => sheetId !== sheet.id)
                                  : current;
                              }
                              const selectedSet = new Set([...current, sheet.id]);
                              return staticSheetOptions
                                .map((option) => option.id)
                                .filter((sheetId) => selectedSet.has(sheetId));
                            });
                          }}
                        />
                        <span className="min-w-0 truncate">{sheet.title}</span>
                      </label>
                    );
                  })}
                  <p className="text-[9px] leading-3 text-slate-400">
                    至少选择一个；导出顺序跟随文档中的 Sheet 顺序。
                  </p>
                </fieldset>
              )}
              <div className="grid grid-cols-2 gap-2">
                <fieldset>
                  <legend className="text-[10px] text-slate-500">清晰度</legend>
                  <div className="mt-1 flex rounded-md border border-slate-200 bg-white p-0.5">
                    {([1, 2, 3] as const).map((scale) => (
                      <label key={scale} className="relative flex flex-1 cursor-pointer items-center justify-center">
                        <input
                          className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                          type="radio"
                          name={`${contentId}-static-scale`}
                          value={scale}
                          checked={staticScale === scale}
                          onChange={() => setStaticScale(scale)}
                        />
                        <span className={`w-full rounded px-1 py-1 text-center text-[10px] peer-focus-visible:ring-2 peer-focus-visible:ring-blue-300 ${
                          staticScale === scale ? 'bg-blue-100 font-semibold text-blue-700' : 'text-slate-500'
                        }`}>
                          {scale}×
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="text-[10px] text-slate-500">
                  <span className="mb-1 block">内边距（px）</span>
                  <input
                    className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-blue-100"
                    type="number"
                    min={0}
                    max={512}
                    step={4}
                    aria-label="图片导出内边距"
                    value={staticPadding}
                    onChange={(event) => setStaticPadding(
                      Number.isNaN(event.currentTarget.valueAsNumber)
                        ? 0
                        : event.currentTarget.valueAsNumber,
                    )}
                  />
                </label>
              </div>
              <fieldset>
                <legend className="text-[10px] text-slate-500">背景</legend>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-600">
                  {([
                    ['source', '跟随画布'],
                    ['transparent', '透明'],
                    ['solid', '自定义'],
                  ] as const).map(([value, label]) => (
                    <label key={value} className="flex items-center gap-1">
                      <input
                        type="radio"
                        name={`${contentId}-static-background`}
                        value={value}
                        checked={staticBackground === value}
                        onChange={() => setStaticBackground(value)}
                      />
                      {label}
                    </label>
                  ))}
                  <input
                    type="color"
                    aria-label="图片导出背景色"
                    disabled={staticBackground !== 'solid'}
                    value={staticBackgroundColor}
                    onChange={(event) => setStaticBackgroundColor(event.currentTarget.value)}
                    className="h-5 w-8 rounded border border-slate-200 bg-white p-0"
                  />
                </div>
              </fieldset>
              <label className="flex items-center gap-2 text-[10px] text-slate-600">
                <input
                  type="checkbox"
                  checked={staticFrame}
                  onChange={(event) => setStaticFrame(event.currentTarget.checked)}
                />
                添加 Sheet 画框与标题
              </label>
            </fieldset>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className="flex h-9 items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none hover:border-blue-300 hover:bg-blue-50 focus:ring-2 focus:ring-blue-100"
                disabled={exportDisabled}
                onClick={() => void exportDocument('markdown')}
              >
                <Download size={13} aria-hidden="true" />
                导出 Markdown
              </button>
              <button
                type="button"
                className="flex h-9 items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none hover:border-blue-300 hover:bg-blue-50 focus:ring-2 focus:ring-blue-100"
                disabled={exportDisabled}
                onClick={() => void exportDocument('opml')}
              >
                <Download size={13} aria-hidden="true" />
                导出 OPML
              </button>
              <button
                type="button"
                className="flex h-9 items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none hover:border-blue-300 hover:bg-blue-50 focus:ring-2 focus:ring-blue-100"
                disabled={exportDisabled}
                onClick={() => void exportDocument('task-csv')}
              >
                <Download size={13} aria-hidden="true" />
                导出 Task CSV
              </button>
              <button
                type="button"
                className="flex h-9 items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none hover:border-blue-300 hover:bg-blue-50 focus:ring-2 focus:ring-blue-100"
                disabled={exportDisabled}
                onClick={() => void exportDocument('task-ics')}
              >
                <Download size={13} aria-hidden="true" />
                导出 Task ICS
              </button>
              <button
                type="button"
                className="flex h-9 items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none hover:border-blue-300 hover:bg-blue-50 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                disabled={exportDisabled}
                onClick={() => void exportDocument('svg')}
              >
                <Download size={13} aria-hidden="true" />
                {busyStaticFormat === 'svg' ? '正在生成 SVG…' : '导出 SVG'}
              </button>
              <button
                type="button"
                className="flex h-9 items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none hover:border-blue-300 hover:bg-blue-50 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                disabled={exportDisabled}
                onClick={() => void exportDocument('png')}
              >
                <Download size={13} aria-hidden="true" />
                {busyStaticFormat === 'png' ? '正在生成 PNG…' : '导出 PNG'}
              </button>
              <button
                type="button"
                className="col-span-2 flex h-9 items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none hover:border-blue-300 hover:bg-blue-50 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                disabled={exportDisabled}
                onClick={() => void exportDocument('jpeg')}
              >
                <Download size={13} aria-hidden="true" />
                {busyStaticFormat === 'jpeg' ? '正在生成 JPEG…' : '导出 JPEG'}
              </button>
              <button
                type="button"
                className="col-span-2 flex h-9 items-center justify-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2 text-xs font-medium text-blue-700 outline-none hover:border-blue-300 hover:bg-blue-100 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                disabled={exportDisabled}
                onClick={() => void exportDocument('xmind')}
              >
                <Download size={13} aria-hidden="true" />
                {busyXMindOperation === 'export' ? '正在生成 XMind…' : '导出 XMind'}
              </button>
            </div>
            {busyStaticFormat !== undefined && (
              <div
                className="flex items-center justify-between rounded-md bg-blue-50 px-2 py-1.5 text-[10px] text-blue-700"
                role="status"
              >
                <span>正在生成自包含 {busyStaticFormat.toUpperCase()}…</span>
                <button
                  type="button"
                  className="rounded border border-blue-200 bg-white px-2 py-0.5 font-medium outline-none hover:bg-blue-100 focus:ring-2 focus:ring-blue-200"
                  onClick={cancelStaticOperation}
                >
                  取消 {busyStaticFormat.toUpperCase()} 导出
                </button>
              </div>
            )}
            {busyXMindOperation !== undefined && (
              <div
                className="flex items-center justify-between rounded-md bg-blue-50 px-2 py-1.5 text-[10px] text-blue-700"
                role="status"
              >
                <span>
                  {busyXMindOperation === 'export'
                    ? '正在后台生成 ZIP…'
                    : '正在后台校验并解析 ZIP…'}
                </span>
                <button
                  type="button"
                  className="rounded border border-blue-200 bg-white px-2 py-0.5 font-medium outline-none hover:bg-blue-100 focus:ring-2 focus:ring-blue-200"
                  onClick={cancelXMindOperation}
                >
                  取消 XMind {busyXMindOperation === 'export' ? '导出' : '导入'}
                </button>
              </div>
            )}
          </section>

          <section
            className="space-y-2 border-t border-slate-100 py-3"
            aria-labelledby={`${contentId}-import-title`}
            aria-describedby={readOnly ? readOnlyDescriptionId : undefined}
          >
            <div>
              <h3
                id={`${contentId}-import-title`}
                className="text-[11px] font-semibold uppercase tracking-wide text-slate-500"
              >
                导入
              </h3>
              <p className="mt-1 text-[10px] leading-4 text-slate-400">
                先解析并生成报告；是否应用新文档由编辑器确认。
              </p>
              {readOnly && (
                <p id={readOnlyDescriptionId} className="mt-1 text-[10px] text-amber-600">
                  只读模式下不能导入文件。
                </p>
              )}
            </div>

            <input
              ref={markdownInputRef}
              hidden
              type="file"
              accept=".md,.markdown,.txt,text/markdown,text/plain"
              disabled={importDisabled}
              aria-label="选择 Markdown 文件"
              onChange={(event) => void importFile('markdown-outline', event)}
            />
            <input
              ref={opmlInputRef}
              hidden
              type="file"
              accept=".opml,.xml,application/xml,text/xml,text/x-opml"
              disabled={importDisabled}
              aria-label="选择 OPML 文件"
              onChange={(event) => void importFile('opml-2.0', event)}
            />
            <input
              ref={xmindInputRef}
              hidden
              type="file"
              accept=".xmind,application/x-xmind,application/zip"
              disabled={importDisabled}
              aria-label="选择 XMind 文件"
              onChange={(event) => void importFile('xmind-content-json', event)}
            />

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className="flex h-9 items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none hover:border-blue-300 hover:bg-blue-50 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                disabled={importDisabled}
                aria-describedby={readOnly ? readOnlyDescriptionId : undefined}
                onClick={() => markdownInputRef.current?.click()}
              >
                <Upload size={13} aria-hidden="true" />
                {busyFormat === 'markdown-outline' ? '正在解析…' : '导入 Markdown'}
              </button>
              <button
                type="button"
                className="flex h-9 items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none hover:border-blue-300 hover:bg-blue-50 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                disabled={importDisabled}
                aria-describedby={readOnly ? readOnlyDescriptionId : undefined}
                onClick={() => opmlInputRef.current?.click()}
              >
                <Upload size={13} aria-hidden="true" />
                {busyFormat === 'opml-2.0' ? '正在解析…' : '导入 OPML'}
              </button>
              <button
                type="button"
                className="col-span-2 flex h-9 items-center justify-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2 text-xs font-medium text-blue-700 outline-none hover:border-blue-300 hover:bg-blue-100 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                disabled={importDisabled}
                aria-describedby={readOnly ? readOnlyDescriptionId : undefined}
                onClick={() => xmindInputRef.current?.click()}
              >
                <Upload size={13} aria-hidden="true" />
                {busyFormat === 'xmind-content-json' ? '正在校验 ZIP…' : '导入 XMind'}
              </button>
            </div>
          </section>

          {(feedback || xmindExportFeedback || error || notice) && (
            <section
              className="relative border-t border-slate-100 pt-3"
              aria-label="导入导出反馈"
              aria-live="polite"
            >
              <button
                type="button"
                className="absolute right-0 top-2 rounded p-1 text-slate-400 outline-none hover:bg-slate-100 hover:text-slate-700 focus:ring-2 focus:ring-blue-100"
                aria-label="清除导入导出反馈"
                onClick={clearFeedback}
              >
                <X size={13} aria-hidden="true" />
              </button>

              {error && (
                <p className="pr-7 text-xs leading-5 text-red-600" role="alert">
                  {error}
                </p>
              )}

              {notice && (
                <p className="pr-7 text-xs leading-5 text-slate-600" role="status">
                  {notice}
                </p>
              )}

              {xmindExportFeedback && (
                <div className="space-y-1.5 pr-7" data-testid="mindmap-xmind-export-report">
                  <p className="text-xs font-semibold text-emerald-700">
                    XMind 导出完成
                  </p>
                  <p className="truncate text-[10px] text-slate-400" title={xmindExportFeedback.fileName}>
                    {xmindExportFeedback.fileName}
                  </p>
                  <p className="text-[10px] leading-4 text-slate-500">
                    {xmindExportFeedback.report.exportedSheets} 个 Sheet ·{' '}
                    {xmindExportFeedback.report.exportedTopics} 个主题 ·{' '}
                    降级 {xmindExportFeedback.report.degradedItems} ·{' '}
                    保留属性 {xmindExportFeedback.report.preservedAttributes}
                  </p>
                  {xmindExportFeedback.report.diagnostics.length > 0 && (
                    <ul className="max-h-28 space-y-1 overflow-y-auto" aria-label="XMind 导出诊断">
                      {xmindExportFeedback.report.diagnostics.map((diagnostic, index) => (
                        <li
                          key={`${diagnostic.code}:${diagnostic.path ?? ''}:${index}`}
                          className="rounded bg-slate-50 px-2 py-1.5 text-[10px] leading-4 text-slate-600"
                        >
                          <span className="font-semibold">
                            {diagnosticSeverityLabel[diagnostic.severity]} · {diagnostic.code}
                          </span>
                          <span className="block">{diagnostic.message}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {feedback && (
                <div className="space-y-2 pr-1" data-testid="mindmap-import-report">
                  <div className="pr-7">
                    <p
                      className={`text-xs font-semibold ${feedback.result.report.success ? 'text-emerald-700' : 'text-red-600'}`}
                    >
                      {feedback.result.report.success ? '解析成功' : '无法导入'}
                      <span className="font-normal text-slate-500">
                        {' '}· {formatLabel(feedback.source.format)}
                      </span>
                    </p>
                    <p className="mt-0.5 truncate text-[10px] text-slate-400" title={feedback.source.fileName}>
                      {feedback.source.fileName}
                    </p>
                  </div>

                  <dl className="grid grid-cols-3 gap-1 text-center">
                    <div className="rounded bg-slate-50 px-1 py-1.5">
                      <dt className="text-[9px] text-slate-400">Sheet</dt>
                      <dd className="text-xs font-semibold text-slate-700">
                        {feedback.result.report.importedSheets}
                      </dd>
                    </div>
                    <div className="rounded bg-slate-50 px-1 py-1.5">
                      <dt className="text-[9px] text-slate-400">主题</dt>
                      <dd className="text-xs font-semibold text-slate-700">
                        {feedback.result.report.importedTopics}
                      </dd>
                    </div>
                    <div className="rounded bg-slate-50 px-1 py-1.5">
                      <dt className="text-[9px] text-slate-400">字节</dt>
                      <dd className="text-xs font-semibold text-slate-700">
                        {feedback.result.report.inputBytes}
                      </dd>
                    </div>
                  </dl>

                  <p className="text-[10px] leading-4 text-slate-500">
                    降级 {feedback.result.report.degradedItems} · 忽略{' '}
                    {feedback.result.report.ignoredItems} · 保留属性{' '}
                    {feedback.result.report.preservedAttributes}
                  </p>

                  {feedback.result.report.diagnostics.length > 0 && (
                    <ul className="max-h-36 space-y-1 overflow-y-auto" aria-label="导入诊断">
                      {feedback.result.report.diagnostics.map((diagnostic, index) => (
                        <li
                          key={`${diagnostic.code}:${diagnostic.path ?? ''}:${index}`}
                          className="rounded bg-slate-50 px-2 py-1.5 text-[10px] leading-4 text-slate-600"
                          data-severity={diagnostic.severity}
                        >
                          <span className="font-semibold">
                            {diagnosticSeverityLabel[diagnostic.severity]} · {diagnostic.code}
                          </span>
                          <span className="block">{diagnostic.message}</span>
                          {diagnostic.path && (
                            <span className="block truncate font-mono text-[9px] text-slate-400">
                              {diagnostic.path}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </aside>
  );
};
