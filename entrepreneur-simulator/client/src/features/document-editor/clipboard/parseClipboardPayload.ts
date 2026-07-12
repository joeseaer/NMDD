import { normalizeClipboardHtml } from './normalizeClipboardHtml';
import { normalizeClipboardText, parseHtmlDocument, visibleTextWithLineBreaks } from './htmlUtils';
import { renderExternalMarkdown } from './parseMarkdownToHtml';
import { parsePlainText } from './parsePlainText';
import type {
  ClipboardPayload,
  ParsedClipboardContent,
  ParsePlainTextOptions,
} from './types';

export type ParseClipboardPayloadOptions = Pick<ParsePlainTextOptions, 'plain' | 'codeContext'>;

interface RichnessProfile {
  score: number;
  textLength: number;
}

/**
 * Score semantic structure rather than wrapper/style volume. Clipboard HTML
 * made only of div/span/p/br is intentionally treated as a plain-text fallback.
 */
const profileRichHtml = (html: string): RichnessProfile => {
  if (!html.trim()) return { score: 0, textLength: 0 };
  const doc = parseHtmlDocument(html);
  const body = doc.body;
  let score = 0;
  if (body.querySelector('h1, h2, h3, h4, h5, h6')) score += 4;
  if (body.querySelector('ul, ol, [data-type="taskList"]')) score += 4;
  if (body.querySelector('table')) score += 8;
  if (body.querySelector('pre, pre code')) score += 5;
  if (body.querySelector('blockquote')) score += 3;
  if (body.querySelector('[data-type="inline-equation"], [data-type="equation"]')) score += 6;
  if (body.querySelector('strong, b')) score += 2;
  if (body.querySelector('em, i')) score += 1;
  if (body.querySelector('s, del, strike')) score += 1;
  if (body.querySelector('a[href]')) score += 2;
  if (body.querySelector('img[src]')) score += 3;
  return {
    score,
    textLength: normalizeClipboardText(visibleTextWithLineBreaks(body)).trim().length,
  };
};

const markdownResult = (
  payload: ClipboardPayload,
  diagnostics: string[],
): ParsedClipboardContent => {
  const rendered = renderExternalMarkdown(payload.markdown);
  return {
    kind: 'markdown',
    html: rendered.html,
    text: payload.text || payload.markdown,
    source: payload.source,
    diagnostics: [
      ...diagnostics,
      'explicit text/markdown representation',
      ...(rendered.mathNodeCount ? [`${rendered.mathNodeCount} math node(s)`] : []),
    ],
  };
};

const shouldPreferMarkdown = (html: string, markdownHtml: string): boolean => {
  if (!html.trim()) return true;
  const htmlProfile = profileRichHtml(html);
  const markdownProfile = profileRichHtml(markdownHtml);

  // Wrapper-only HTML is the common Codex/system clipboard fallback. An
  // explicit Markdown MIME is a more faithful representation in that case.
  if (htmlProfile.score === 0) return true;
  if (markdownProfile.score > htmlProfile.score) return true;

  // Also catch truncated HTML that retained one semantic tag but lost most of
  // the copied answer. A small absolute margin avoids noise on short snippets.
  return markdownProfile.score >= htmlProfile.score
    && markdownProfile.textLength >= htmlProfile.textLength + 40
    && markdownProfile.textLength > htmlProfile.textLength * 1.25;
};

/** Core rich/plain decision. File insertion intentionally stays in handlePaste
 * so async uploads cannot race this synchronous semantic parser. */
export const parseClipboardPayload = (
  payload: ClipboardPayload,
  options: ParseClipboardPayloadOptions = {},
): ParsedClipboardContent => {
  // Ctrl/Cmd+Shift+V and code-block paste must never consult rich MIME types.
  if (options.plain || options.codeContext) {
    return parsePlainText(payload.text, {
      source: payload.source,
      plain: options.plain,
      codeContext: options.codeContext,
    });
  }

  const hasMarkdown = Boolean(payload.markdown.trim());
  const hasHtml = Boolean(payload.html.trim());

  if (hasHtml) {
    const normalized = normalizeClipboardHtml(payload.html, {
      source: payload.source,
      payload,
      allowInternalStructures: payload.source.source === 'internal',
    });
    if (normalized.html.trim()) {
      // Our private HTML can carry nodes that Markdown cannot represent.
      if (payload.source.source === 'internal') {
        return {
          kind: 'html',
          html: normalized.html,
          text: payload.text,
          source: normalized.source,
          diagnostics: [...normalized.diagnostics, 'trusted internal HTML preferred'],
        };
      }

      if (hasMarkdown) {
        const renderedMarkdown = renderExternalMarkdown(payload.markdown);
        if (shouldPreferMarkdown(normalized.html, renderedMarkdown.html)) {
          return {
            kind: 'markdown',
            html: renderedMarkdown.html,
            text: payload.text || payload.markdown,
            source: payload.source,
            diagnostics: [
              ...normalized.diagnostics,
              'explicit text/markdown preferred over impoverished HTML',
              ...(renderedMarkdown.mathNodeCount
                ? [`${renderedMarkdown.mathNodeCount} math node(s)`]
                : []),
            ],
          };
        }
      }

      return {
        kind: 'html',
        html: normalized.html,
        text: payload.text,
        source: normalized.source,
        diagnostics: normalized.diagnostics,
      };
    }
  }

  if (hasMarkdown) return markdownResult(payload, hasHtml ? ['HTML normalized to empty'] : []);

  return parsePlainText(payload.text, {
    source: payload.source,
    plain: options.plain,
    codeContext: options.codeContext,
  });
};
