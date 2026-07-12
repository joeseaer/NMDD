import { detectPlainText } from './detectPlainText';
import { escapeHtml, normalizeClipboardText } from './htmlUtils';
import {
  equationNodeHtml,
  getImplicitMathLineIndexes,
  isLikelyStandaloneMath,
  protectMathInMarkdown,
  restoreProtectedMathHtml,
} from './math';
import { renderExternalMarkdown } from './parseMarkdownToHtml';
import { normalizeSourceMatch } from './classifyClipboardSource';
import { parseTsv, tsvToHtml } from './tables';
import { normalizeSingleUrl } from './urlPolicy';
import type { ParsedClipboardContent, ParsePlainTextOptions } from './types';

export const renderLiteralText = (input: string): string => {
  const value = normalizeClipboardText(input);
  if (!value) return '';
  return value
    .split(/\n\n+/)
    .map(paragraph => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
};

const renderCode = (text: string, language?: string): string => {
  const languageClass = language ? ` class="language-${escapeHtml(language)}"` : '';
  return `<pre><code${languageClass}>${escapeHtml(text)}</code></pre>`;
};

const renderMathText = (text: string): { html: string; count: number } => {
  const protectedMath = protectMathInMarkdown(text);
  if (protectedMath.tokens.length > 0) {
    return restoreProtectedMathHtml(renderLiteralText(protectedMath.text), protectedMath.tokens);
  }
  if (isLikelyStandaloneMath(text)) {
    return { html: equationNodeHtml(text, 'block'), count: 1 };
  }
  const mathLineIndexes = new Set(getImplicitMathLineIndexes(text));
  if (mathLineIndexes.size > 0) {
    const parts: string[] = [];
    let prose: string[] = [];
    const flushProse = () => {
      while (prose[0]?.trim() === '') prose.shift();
      while (prose[prose.length - 1]?.trim() === '') prose.pop();
      if (prose.length) parts.push(renderLiteralText(prose.join('\n')));
      prose = [];
    };
    text.split('\n').forEach((line, index) => {
      if (mathLineIndexes.has(index)) {
        flushProse();
        parts.push(equationNodeHtml(line, 'block'));
      } else {
        prose.push(line);
      }
    });
    flushProse();
    return { html: parts.join(''), count: mathLineIndexes.size };
  }
  return { html: renderLiteralText(text), count: 0 };
};

export const parsePlainText = (
  input: string,
  options: ParsePlainTextOptions = {},
): ParsedClipboardContent => {
  const text = normalizeClipboardText(input);
  const source = normalizeSourceMatch(options.source, { text });
  if (options.plain) {
    return {
      kind: text ? 'text' : 'empty',
      html: renderLiteralText(text),
      text,
      source,
      diagnostics: ['strict plain-text paste'],
    };
  }
  if (options.codeContext) {
    return {
      kind: text ? 'text' : 'empty',
      html: renderLiteralText(text),
      text,
      source,
      diagnostics: ['existing code-block context'],
    };
  }

  const detection = detectPlainText(text, source.source);
  let html = '';
  const diagnostics = [...detection.reasons];
  if (detection.kind === 'markdown') {
    const rendered = renderExternalMarkdown(text);
    html = rendered.html;
    if (rendered.mathNodeCount > 0) diagnostics.push(`${rendered.mathNodeCount} math node(s)`);
  } else if (detection.kind === 'tsv') {
    const table = parseTsv(text);
    html = table ? tsvToHtml(table) : renderLiteralText(text);
  } else if (detection.kind === 'url') {
    const url = normalizeSingleUrl(text);
    html = url
      ? `<p><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a></p>`
      : renderLiteralText(text);
  } else if (detection.kind === 'code') {
    html = renderCode(text, detection.language);
  } else if (detection.kind === 'math') {
    const rendered = renderMathText(text);
    html = rendered.html;
    diagnostics.push(`${rendered.count} math node(s)`);
  } else {
    html = renderLiteralText(text);
  }

  return { kind: detection.kind, html, text, source, diagnostics };
};
