import { useState, type MutableRefObject } from 'react';
import DOMPurify from 'dompurify';
import { Download, FileCode2, FileText, Printer } from 'lucide-react';
import type { SmartDocumentValueGetter } from '../../../components/SmartDocumentEditor';

const safeFilename = (title: string) => (
  String(title || '未命名文档')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || '未命名文档'
);

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const downloadTextFile = (filename: string, content: string, type: string) => {
  const blob = new Blob(['\uFEFF', content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

const buildStandaloneHtml = (title: string, body: string) => `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; }
    body { max-width: 760px; margin: 0 auto; padding: 64px 28px 96px; color: #252525; font-size: 16px; line-height: 1.72; }
    h1 { margin: 0 0 40px; font-size: 42px; line-height: 1.18; letter-spacing: -0.035em; }
    h2 { margin: 2em 0 .55em; font-size: 28px; } h3 { margin: 1.7em 0 .45em; font-size: 22px; }
    p { margin: .55em 0; } blockquote { margin: 1.2em 0; padding-left: 1em; border-left: 3px solid #c7c6c2; color: #5f5e5b; }
    pre { overflow: auto; padding: 16px 18px; border: 1px solid #e8e7e4; border-radius: 10px; background: #f7f7f5; }
    code { font-family: "Cascadia Mono", Consolas, "Microsoft YaHei UI", monospace; }
    table { width: 100%; border-collapse: collapse; } th, td { padding: 8px 10px; border: 1px solid #deddd9; text-align: left; }
    img, video, iframe, svg { max-width: 100%; height: auto; } a { color: #315ea8; }
    @media print { body { max-width: none; padding: 0; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${body}
</body>
</html>`;

export const DocumentExportMenu = ({
  title,
  valueRef,
  beforeExport,
}: {
  title: string;
  valueRef: MutableRefObject<SmartDocumentValueGetter | null>;
  beforeExport?: () => Promise<void>;
}) => {
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);

  const getValue = async () => {
    setWorking(true);
    try {
      await beforeExport?.();
      const value = valueRef.current?.();
      if (!value) throw new Error('编辑器尚未准备好，请稍后重试。');
      return value;
    } finally {
      setWorking(false);
    }
  };

  const run = async (action: 'markdown' | 'html' | 'print') => {
    try {
      if (action === 'print') {
        await beforeExport?.();
        setOpen(false);
        window.print();
        return;
      }

      const value = await getValue();
      const basename = safeFilename(title);
      if (action === 'markdown') {
        downloadTextFile(`${basename}.md`, value.markdown, 'text/markdown');
      } else {
        const safeBody = DOMPurify.sanitize(value.html, {
          USE_PROFILES: { html: true },
          ADD_ATTR: ['data-type', 'data-equation', 'data-language'],
        });
        downloadTextFile(`${basename}.html`, buildStandaloneHtml(title, safeBody), 'text/html');
      }
      setOpen(false);
    } catch (error) {
      alert(error instanceof Error ? error.message : '导出失败，请重试。');
    }
  };

  return (
    <div className="smart-document-export-anchor">
      <button
        type="button"
        className="smart-document-icon-button"
        aria-label="导出文档"
        aria-expanded={open}
        disabled={working}
        onClick={() => setOpen((current) => !current)}
      >
        <Download aria-hidden="true" />
      </button>
      {open ? (
        <>
          <button type="button" className="smart-document-export-backdrop" aria-label="关闭导出菜单" onClick={() => setOpen(false)} />
          <div className="smart-document-export-menu" role="menu" aria-label="导出文档">
            <button type="button" role="menuitem" onClick={() => void run('markdown')}>
              <FileText aria-hidden="true" />
              <span><strong>Markdown</strong><small>适合备份、Git 和继续编辑</small></span>
            </button>
            <button type="button" role="menuitem" onClick={() => void run('html')}>
              <FileCode2 aria-hidden="true" />
              <span><strong>HTML 网页</strong><small>保留富文本并可离线打开</small></span>
            </button>
            <button type="button" role="menuitem" onClick={() => void run('print')}>
              <Printer aria-hidden="true" />
              <span><strong>打印 / PDF</strong><small>使用系统对话框另存为 PDF</small></span>
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
};
