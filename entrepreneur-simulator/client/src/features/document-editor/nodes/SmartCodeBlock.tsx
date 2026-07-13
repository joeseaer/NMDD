import { useEffect, useId, useMemo, useState } from 'react';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import {
  AlertTriangle,
  Check,
  Code2,
  Copy,
  Eye,
  Loader2,
  RefreshCw,
  Scan,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import DOMPurify from 'dompurify';
import { smartDocumentLowlight } from '../createEditorExtensions';

type MermaidApi = typeof import('mermaid')['default'];

let mermaidPromise: Promise<MermaidApi> | null = null;
let mermaidInitialized = false;

const resetMermaidLoader = () => {
  mermaidPromise = null;
  mermaidInitialized = false;
};

const loadMermaid = async () => {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid')
      .then((module) => module.default)
      .catch((error) => {
        // Vite can invalidate an optimized dependency while the app is open.
        // Never cache a rejected chunk promise: the next retry must import it again.
        resetMermaidLoader();
        throw error;
      });
  }
  const mermaid = await mermaidPromise;
  if (!mermaidInitialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      // DOMPurify intentionally keeps an SVG-only profile below. Native SVG
      // text survives that policy; Mermaid's default foreignObject labels do not.
      htmlLabels: false,
      flowchart: {
        // Large diagrams remain legible inside our own scroll/zoom viewport.
        useMaxWidth: false,
      },
      theme: 'base',
      themeVariables: {
        fontFamily: 'Inter, "Noto Sans SC", "Microsoft YaHei", sans-serif',
        primaryColor: '#f1f5f9',
        primaryTextColor: '#172033',
        primaryBorderColor: '#94a3b8',
        lineColor: '#64748b',
        secondaryColor: '#eef2ff',
        tertiaryColor: '#f8fafc',
      },
    });
    mermaidInitialized = true;
  }
  return mermaid;
};

type MermaidRenderError = {
  kind: 'load' | 'syntax';
  message: string;
};

type MermaidDiagram = {
  svg: string;
  intrinsicWidth: number;
};

const MERMAID_LOAD_ERROR = /(?:failed to fetch dynamically imported module|importing a module script failed|chunkloaderror|loading chunk|module script)/i;

const classifyMermaidError = (reason: unknown): MermaidRenderError => {
  const message = reason instanceof Error ? reason.message : String(reason || '图表语法无法解析');
  return {
    kind: MERMAID_LOAD_ERROR.test(message) ? 'load' : 'syntax',
    message,
  };
};

const readSvgIntrinsicWidth = (svg: string): number => {
  const template = document.createElement('template');
  template.innerHTML = svg;
  const element = template.content.querySelector('svg');
  const viewBox = element?.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  const viewBoxWidth = viewBox?.length === 4 ? viewBox[2] : Number.NaN;
  if (Number.isFinite(viewBoxWidth) && viewBoxWidth > 0) return viewBoxWidth;

  const attributeWidth = Number.parseFloat(element?.getAttribute('width') || '');
  return Number.isFinite(attributeWidth) && attributeWidth > 0 ? attributeWidth : 960;
};

const MermaidPreview = ({ source, renderId }: { source: string; renderId: string }) => {
  const [diagram, setDiagram] = useState<MermaidDiagram | null>(null);
  const [error, setError] = useState<MermaidRenderError | null>(null);
  const [rendering, setRendering] = useState(true);
  const [retryKey, setRetryKey] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [sizeMode, setSizeMode] = useState<'fit' | 'actual'>('actual');

  useEffect(() => {
    let cancelled = false;
    setRendering(true);
    setError(null);

    const timer = window.setTimeout(() => {
      void loadMermaid()
        .then((mermaid) => mermaid.render(renderId, source))
        .then(({ svg: nextSvg }) => {
          if (cancelled) return;
          const sanitizedSvg = DOMPurify.sanitize(nextSvg, {
            USE_PROFILES: { svg: true, svgFilters: true },
          });
          setDiagram({
            svg: sanitizedSvg,
            intrinsicWidth: readSvgIntrinsicWidth(sanitizedSvg),
          });
          setRendering(false);
        })
        .catch((reason) => {
          if (cancelled) return;
          setDiagram(null);
          setError(classifyMermaidError(reason));
          setRendering(false);
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [renderId, retryKey, source]);

  useEffect(() => {
    setZoom(1);
    setSizeMode('actual');
  }, [source]);

  if (rendering) {
    return (
      <div className="smart-doc-mermaid-state" role="status">
        <Loader2 className="smart-doc-mermaid-spinner" aria-hidden="true" />
        正在生成图表…
      </div>
    );
  }

  if (error) {
    const isLoadError = error.kind === 'load';
    return (
      <div className="smart-doc-mermaid-error" role="alert">
        <AlertTriangle aria-hidden="true" />
        <div>
          <strong>{isLoadError ? '流程图库加载失败' : 'Mermaid 语法有误'}</strong>
          <span>{error.message}</span>
          <button
            type="button"
            onClick={() => {
              if (isLoadError) resetMermaidLoader();
              setRetryKey((current) => current + 1);
            }}
          >
            <RefreshCw aria-hidden="true" />
            重试
          </button>
        </div>
      </div>
    );
  }

  if (!diagram) return null;

  const stageWidth = sizeMode === 'fit'
    ? `${Math.round(zoom * 100)}%`
    : `${Math.round(diagram.intrinsicWidth * zoom)}px`;

  return (
    <div className="smart-doc-mermaid-renderer" data-testid="mermaid-preview">
      <div className="smart-doc-mermaid-controls" role="toolbar" aria-label="流程图缩放">
        <button
          type="button"
          aria-label="缩小流程图"
          disabled={zoom <= 0.5}
          onClick={() => setZoom((current) => Math.max(0.5, Number((current - 0.25).toFixed(2))))}
        >
          <ZoomOut aria-hidden="true" />
        </button>
        <span aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          aria-label="放大流程图"
          disabled={zoom >= 2.5}
          onClick={() => setZoom((current) => Math.min(2.5, Number((current + 0.25).toFixed(2))))}
        >
          <ZoomIn aria-hidden="true" />
        </button>
        <button
          type="button"
          className="smart-doc-mermaid-controls__text"
          data-active={sizeMode === 'fit' && zoom === 1 ? 'true' : 'false'}
          onClick={() => {
            setSizeMode('fit');
            setZoom(1);
          }}
        >
          <Scan aria-hidden="true" />
          适应宽度
        </button>
        <button
          type="button"
          className="smart-doc-mermaid-controls__text"
          data-active={sizeMode === 'actual' && zoom === 1 ? 'true' : 'false'}
          onClick={() => {
            setSizeMode('actual');
            setZoom(1);
          }}
        >
          1:1
        </button>
      </div>
      <div
        className="smart-doc-mermaid-svg"
        data-size-mode={sizeMode}
        role="region"
        aria-label="可滚动流程图画布"
        tabIndex={0}
      >
        <div
          className="smart-doc-mermaid-stage"
          style={{ width: stageWidth }}
          // Mermaid is configured with strict security and sanitized again here.
          dangerouslySetInnerHTML={{ __html: diagram.svg }}
        />
      </div>
    </div>
  );
};

const SmartCodeBlockView = ({ node, editor, updateAttributes }: NodeViewProps) => {
  const language = String(node.attrs.language || '').toLowerCase();
  const isMermaid = language === 'mermaid';
  const source = node.textContent;
  const reactId = useId();
  const renderId = useMemo(
    () => `smart-doc-mermaid-${reactId.replace(/[^a-z0-9_-]/gi, '')}`,
    [reactId],
  );
  const [showPreview, setShowPreview] = useState(isMermaid);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setShowPreview(isMermaid);
  }, [isMermaid]);

  const copySource = async () => {
    await navigator.clipboard.writeText(source);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  if (!isMermaid) {
    return (
      <NodeViewWrapper className="smart-doc-code-block" data-language={language || undefined}>
        <div className="smart-doc-code-block__toolbar" contentEditable={false}>
          <select
            value={language}
            onChange={(event) => updateAttributes({ language: event.target.value || null })}
            disabled={!editor.isEditable}
            aria-label="代码语言"
          >
            <option value="">纯文本</option>
            <option value="javascript">JavaScript</option>
            <option value="typescript">TypeScript</option>
            <option value="python">Python</option>
            <option value="json">JSON</option>
            <option value="bash">Shell</option>
            <option value="sql">SQL</option>
            <option value="markdown">Markdown</option>
            <option value="mermaid">Mermaid 图表</option>
          </select>
          <button type="button" onClick={() => void copySource()} aria-label="复制代码">
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            <span>{copied ? '已复制' : '复制'}</span>
          </button>
        </div>
        <pre><NodeViewContent as={'code' as any} /></pre>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="smart-doc-code-block smart-doc-mermaid" data-language="mermaid">
      <div className="smart-doc-code-block__toolbar" contentEditable={false}>
        <span className="smart-doc-code-block__language">Mermaid</span>
        {editor.isEditable ? (
          <button type="button" onClick={() => setShowPreview((current) => !current)} aria-pressed={showPreview}>
            {showPreview ? <Code2 aria-hidden="true" /> : <Eye aria-hidden="true" />}
            <span>{showPreview ? '编辑源码' : '预览图表'}</span>
          </button>
        ) : null}
        <button type="button" onClick={() => void copySource()} aria-label="复制 Mermaid 源码">
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          <span>{copied ? '已复制' : '复制'}</span>
        </button>
      </div>
      <div className={showPreview ? 'smart-doc-code-block__source is-hidden' : 'smart-doc-code-block__source'}>
        <pre><NodeViewContent as={'code' as any} /></pre>
      </div>
      {showPreview ? (
        <div className="smart-doc-mermaid-preview" contentEditable={false}>
          <MermaidPreview source={source} renderId={renderId} />
        </div>
      ) : null}
    </NodeViewWrapper>
  );
};

export const SmartCodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(SmartCodeBlockView);
  },
}).configure({ lowlight: smartDocumentLowlight });
