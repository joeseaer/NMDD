import type {
  ClipboardSource,
  ClipboardSourceConfidence,
  ClipboardSourceMatch,
} from './types';

export interface ClipboardSourceInput {
  text?: string;
  html?: string;
  types?: readonly string[];
}

const match = (
  source: ClipboardSource,
  confidence: ClipboardSourceConfidence,
  signals: string[],
): ClipboardSourceMatch => ({ source, confidence, signals });

const includesAny = (value: string, patterns: readonly RegExp[]) => (
  patterns.some(pattern => pattern.test(value))
);

export const classifyClipboardSource = ({
  text = '',
  html = '',
  types = [],
}: ClipboardSourceInput): ClipboardSourceMatch => {
  const normalizedTypes = types.map(type => type.toLowerCase());
  const combined = `${html}\n${text.slice(0, 2_000)}`;

  if (
    normalizedTypes.some(type => type === 'application/x-nmdd-document-fragment')
    || includesAny(html, [
      /data-nmdd-clipboard(?:-version)?=/i,
      /data-nmdd-document-fragment/i,
    ])
  ) {
    return match('internal', 'certain', ['NMDD clipboard marker']);
  }

  if (includesAny(html, [
    /xmlns:(?:o|w|v)=["']urn:schemas-microsoft-com/i,
    /class=["'][^"']*Mso/i,
    /mso-(?:list|style|pagination|fareast-font-family)/i,
    /<meta[^>]+name=["'](?:generator|progid)["'][^>]+Microsoft\s+(?:Word|PowerPoint|Excel)/i,
    /urn:schemas-microsoft-com:office/i,
  ])) {
    return match('office', 'high', ['Microsoft Office HTML signature']);
  }

  if (includesAny(html, [
    /google-sheets-html-origin/i,
    /docs-internal-guid-[\w-]+/i,
    /data-sheets-/i,
  ])) {
    const sheets = /google-sheets-html-origin|data-sheets-/i.test(html);
    return match(
      sheets ? 'google-sheets' : 'google-docs',
      'high',
      [sheets ? 'Google Sheets HTML signature' : 'Google Docs HTML signature'],
    );
  }

  if (includesAny(html, [
    /data-notion-/i,
    /notion-(?:page-content|selectable|text-block|collection)/i,
    /id=["']notion-app/i,
  ])) {
    return match('notion', 'high', ['Notion HTML signature']);
  }

  if (includesAny(combined, [
    /data-message-author-role=["']assistant/i,
    /data-testid=["']conversation-turn-/i,
    /chatgpt\.com/i,
    /openai\.com\/chat/i,
  ])) {
    return match('chatgpt', 'high', ['ChatGPT conversation marker']);
  }

  if (
    normalizedTypes.includes('application/x-openai-codex')
    || includesAny(html, [/data-(?:openai-)?codex/i, /codex-copy-payload/i])
  ) {
    return match('codex', 'high', ['Codex clipboard marker']);
  }

  if (includesAny(html, [
    /data-vscode-/i,
    /class=["'][^"']*(?:monaco-editor|view-lines)/i,
    /font-family:\s*(?:Consolas|Menlo|Monaco|["']?SFMono-Regular)/i,
  ])) {
    return match('vscode', 'high', ['VS Code or Monaco HTML signature']);
  }

  if (includesAny(html, [
    /data-paste-markdown-skip/i,
    /class=["'][^"']*(?:blob-code|highlight-source-|markdown-body)/i,
    /github\.com/i,
  ])) {
    return match('github', 'medium', ['GitHub HTML signature']);
  }

  if (includesAny(html, [
    /class=["'][^"']*(?:xterm|terminal|ansi-)/i,
    /data-terminal/i,
  ])) {
    return match('terminal', 'high', ['terminal HTML signature']);
  }

  if (normalizedTypes.includes('text/markdown')) {
    // Codex exposes text/markdown in some clients, but this MIME type alone does
    // not prove provenance. Parsing does not depend on this low-confidence label.
    return match('codex', 'low', ['text/markdown MIME without source marker']);
  }

  return match('generic', 'low', []);
};

export const normalizeSourceMatch = (
  source: ClipboardSourceMatch | ClipboardSource | undefined,
  fallbackInput: ClipboardSourceInput = {},
): ClipboardSourceMatch => {
  if (!source) return classifyClipboardSource(fallbackInput);
  return typeof source === 'string' ? match(source, 'high', ['explicit source']) : source;
};
