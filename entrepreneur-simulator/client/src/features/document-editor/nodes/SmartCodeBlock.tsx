import { useEffect, useId, useMemo, useState } from 'react';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { AlertTriangle, Check, Code2, Copy, Eye, Loader2 } from 'lucide-react';
import DOMPurify from 'dompurify';
import { smartDocumentLowlight } from '../createEditorExtensions';

type MermaidApi = typeof import('mermaid')['default'];

let mermaidPromise: Promise<MermaidApi> | null = null;
let mermaidInitialized = false;

const loadMermaid = async () => {
  mermaidPromise ||= import('mermaid').then((module) => module.default);
  const mermaid = await mermaidPromise;
  if (!mermaidInitialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
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

const MermaidPreview = ({ source, renderId }: { source: string; renderId: string }) => {
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const [rendering, setRendering] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setRendering(true);
    setError('');

    const timer = window.setTimeout(() => {
      void loadMermaid()
        .then((mermaid) => mermaid.render(renderId, source))
        .then(({ svg: nextSvg }) => {
          if (cancelled) return;
          setSvg(DOMPurify.sanitize(nextSvg, {
            USE_PROFILES: { svg: true, svgFilters: true },
          }));
          setRendering(false);
        })
        .catch((reason) => {
          if (cancelled) return;
          setSvg('');
          setError(reason instanceof Error ? reason.message : '图表语法无法解析');
          setRendering(false);
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [renderId, source]);

  if (rendering) {
    return (
      <div className="smart-doc-mermaid-state" role="status">
        <Loader2 className="smart-doc-mermaid-spinner" aria-hidden="true" />
        正在生成图表…
      </div>
    );
  }

  if (error) {
    return (
      <div className="smart-doc-mermaid-error" role="alert">
        <AlertTriangle aria-hidden="true" />
        <div>
          <strong>Mermaid 语法有误</strong>
          <span>{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="smart-doc-mermaid-svg"
      data-testid="mermaid-preview"
      // Mermaid is configured with strict security and sanitized again here.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
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
