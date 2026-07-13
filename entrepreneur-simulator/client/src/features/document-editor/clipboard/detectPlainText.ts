import { getImplicitMathLineIndexes, isLikelyStandaloneMath, protectMathInMarkdown } from './math';
import { normalizeClipboardText } from './htmlUtils';
import { parseTsv } from './tables';
import { normalizeSingleUrl } from './urlPolicy';
import type { ClipboardSource, PlainTextDetection } from './types';

interface Score {
  value: number;
  reasons: string[];
}

const MERMAID_HEADER = /^(?:(?:flowchart|graph)\s+(?:TB|TD|BT|RL|LR)\b|sequenceDiagram\b|classDiagram(?:-v2)?\b|stateDiagram(?:-v2)?\b|erDiagram\b|journey\b|gantt\b|pie(?:\s+showData)?\b|quadrantChart\b|requirementDiagram\b|gitGraph\b|C4(?:Context|Container|Component|Dynamic|Deployment)\b|mindmap\b|timeline\b|xychart-beta\b|block-beta\b|packet-beta\b|architecture-beta\b|sankey-beta\b|radar-beta\b|kanban\b)/;

export const isMermaidPlainText = (value: string): boolean => {
  const normalized = normalizeClipboardText(value).replace(/^\uFEFF/, '').trimStart();
  const withoutFrontmatter = normalized.replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, '').trimStart();
  const withoutDirectives = withoutFrontmatter
    .replace(/^(?:%%\{[^\n]*\}%%\s*\n)+/, '')
    .trimStart();
  return MERMAID_HEADER.test(withoutDirectives);
};

const scoreMarkdown = (value: string, source: ClipboardSource): Score => {
  const lines = value.split('\n');
  const reasons: string[] = [];
  let score = 0;
  const fenceCount = lines.filter(line => /^[ \t]{0,3}(?:```|~~~)/.test(line)).length;
  if (fenceCount >= 2) {
    score += 8;
    reasons.push('fenced code block');
  }
  if (/^\s*\|.+\|\s*$\n\s*\|?\s*:?-{3,}/m.test(value)) {
    score += 8;
    reasons.push('GFM table');
  }
  const taskCount = lines.filter(line => /^\s*[-*+]\s+\[[ xX]\]\s+/.test(line)).length;
  if (taskCount > 0) {
    score += taskCount > 1 ? 6 : 4;
    reasons.push('task list');
  }
  const listCount = lines.filter(line => /^\s*(?:[-*+] |\d+[.)] )/.test(line)).length;
  if (listCount >= 2) {
    score += 5;
    reasons.push('multi-item list');
  } else if (listCount === 1) {
    score += lines.length > 1 ? 2 : 3;
    reasons.push('list item');
  }
  const headingIndexes = lines
    .map((line, index) => (/^#{1,6}\s+\S/.test(line.trim()) ? index : -1))
    .filter(index => index >= 0);
  if (headingIndexes.length > 0) {
    const singleHeadingText = headingIndexes.length === 1
      ? lines[headingIndexes[0]].trim().replace(/^#{1,6}\s+/, '')
      : '';
    const singleLineHeadingLooksIntentional = lines.length > 1
      || source !== 'generic'
      || /^[A-Z0-9\u3400-\u9fff]/.test(singleHeadingText)
      || singleHeadingText.split(/\s+/).length >= 3;
    const hasHeadingBoundary = headingIndexes.some(index => (
      index === 0
      || lines[index - 1].trim() === ''
      || lines[index + 1]?.trim() === ''
    ));
    if ((hasHeadingBoundary || headingIndexes.length > 1) && singleLineHeadingLooksIntentional) {
      score += headingIndexes.length > 1 ? 6 : 4;
      reasons.push('ATX heading');
    }
  }
  if (lines.filter(line => /^\s*>\s?\S/.test(line)).length > 0) {
    score += 3;
    reasons.push('blockquote');
  }
  if (/(?:^|[^\\])(?:\*\*|__)[^\n]+(?:\*\*|__)/.test(value)) {
    score += 3;
    reasons.push('strong emphasis');
  }
  if (/(?:^|[^\\])~~[^\n]+~~/.test(value)) {
    score += 2;
    reasons.push('strikethrough');
  }
  if (/\[[^\]\n]+\]\((?:https?:\/\/|mailto:|\/)[^)\s]+\)/.test(value)) {
    score += 3;
    reasons.push('Markdown link');
  }
  if (/(?:^|[^`])`[^`\n]+`(?:$|[^`])/.test(value)) {
    score += 2;
    reasons.push('inline code');
  }
  return { value: score, reasons };
};

const scoreCode = (value: string): Score & { language?: string } => {
  const lines = value.split('\n');
  const reasons: string[] = [];
  let score = 0;
  let language: string | undefined;

  if (/^\s*(?:import\s+.+\s+from\s+|export\s+(?:default\s+)?|const\s+\w+\s*=|let\s+\w+\s*=|function\s+\w+\s*\(|(?:public|private|protected)?\s*class\s+\w+)/m.test(value)) {
    score += 5;
    language = /\b(?:interface|type)\s+\w+|:\s*(?:string|number|boolean)\b/.test(value) ? 'typescript' : 'javascript';
    reasons.push('JavaScript/TypeScript declaration');
  }
  if (/^\s*(?:from\s+\w+(?:\.\w+)*\s+import\s+|import\s+\w+(?:\.\w+)*\s*$|def\s+\w+\s*\(|class\s+\w+\s*[:(])/m.test(value)) {
    score += 5;
    language = 'python';
    reasons.push('Python declaration');
  }
  if (/^\s*#\s+.+$\n\s*(?:print|def|class|import|from|if|for|while|with)\b/m.test(value)) {
    score += 5;
    language = 'python';
    reasons.push('Python comment followed by code');
  }
  if (/^\s*(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE)\b/im.test(value)) {
    score += 5;
    language = 'sql';
    reasons.push('SQL statement');
  }
  if (/^\s*(?:<!doctype\s+html|<html\b|<\/?(?:div|span|section|script|style)\b)/im.test(value)) {
    score += 5;
    language = 'html';
    reasons.push('HTML source');
  }
  if (/^\s*(?:[.#]?[\w-]+)\s*\{[^}]*:[^}]*\}/m.test(value)) {
    score += 5;
    language = 'css';
    reasons.push('CSS rule');
  }
  const indentedLines = lines.filter(line => /^(?: {2,}|\t)\S/.test(line)).length;
  if (indentedLines >= 2) {
    score += 2;
    reasons.push('consistent indentation');
  }
  const punctuationLines = lines.filter(line => /[{};]$|=>|===|!==|\)\s*\{/.test(line)).length;
  if (punctuationLines >= 2) {
    score += 3;
    reasons.push('programming punctuation');
  }
  if (/\b(?:console\.log|print|printf|System\.out|return|throw|await|async)\s*\(/.test(value)) {
    score += 3;
    reasons.push('code call expression');
  }
  if (lines.length === 1 && /^[A-Za-z_]\w*\s*=\s*[^=]+$/.test(value.trim())) score = Math.min(score, 2);
  return { value: score, reasons, language };
};

export const detectPlainText = (
  input: string,
  source: ClipboardSource = 'generic',
): PlainTextDetection => {
  const value = normalizeClipboardText(input);
  if (!value) return { kind: 'empty', confidence: 1, reasons: ['empty clipboard text'] };

  if (isMermaidPlainText(value)) {
    return {
      kind: 'code',
      confidence: 0.99,
      reasons: ['Mermaid diagram header'],
      language: 'mermaid',
    };
  }

  if (source === 'vscode' || source === 'terminal') {
    return {
      kind: 'code',
      confidence: 0.98,
      reasons: [`${source} source`],
      language: scoreCode(value).language,
    };
  }

  const tsv = parseTsv(value);
  if (tsv) return { kind: 'tsv', confidence: 0.98, reasons: ['consistent tabular rows'] };
  if (normalizeSingleUrl(value)) return { kind: 'url', confidence: 0.99, reasons: ['single safe URL'] };

  const math = protectMathInMarkdown(value);
  const markdown = scoreMarkdown(value, source);
  const code = scoreCode(value);

  if (
    markdown.value >= 3
    && (
      markdown.value >= code.value
      || markdown.value >= 6
      || (code.language === 'html' && markdown.reasons.includes('ATX heading'))
    )
  ) {
    return {
      kind: 'markdown',
      confidence: Math.min(0.99, 0.55 + markdown.value / 20),
      reasons: markdown.reasons,
    };
  }
  if (code.value >= 4) {
    return {
      kind: 'code',
      confidence: Math.min(0.97, 0.55 + code.value / 20),
      reasons: code.reasons,
      language: code.language,
    };
  }
  const implicitMathLines = getImplicitMathLineIndexes(value);
  if (math.tokens.length > 0 || isLikelyStandaloneMath(value) || implicitMathLines.length > 0) {
    return {
      kind: 'math',
      confidence: math.tokens.length > 0 ? 0.99 : 0.85,
      reasons: [math.tokens.length > 0 ? 'explicit LaTeX delimiter' : 'high-confidence math expression'],
    };
  }
  return { kind: 'text', confidence: 0.8, reasons: ['no reliable rich-text structure'] };
};
