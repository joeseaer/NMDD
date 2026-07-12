export type ClipboardSource =
  | 'internal'
  | 'office'
  | 'google-docs'
  | 'google-sheets'
  | 'notion'
  | 'chatgpt'
  | 'codex'
  | 'vscode'
  | 'github'
  | 'terminal'
  | 'generic';

export type ClipboardSourceConfidence = 'certain' | 'high' | 'medium' | 'low';

export interface ClipboardSourceMatch {
  source: ClipboardSource;
  confidence: ClipboardSourceConfidence;
  signals: string[];
}

export interface ClipboardPayload {
  text: string;
  html: string;
  /** Explicit Markdown representation exposed by Codex and other rich clients. */
  markdown: string;
  uriList: string[];
  files: File[];
  types: string[];
  source: ClipboardSourceMatch;
}

export type PlainTextKind =
  | 'empty'
  | 'text'
  | 'markdown'
  | 'tsv'
  | 'url'
  | 'code'
  | 'math';

export interface PlainTextDetection {
  kind: PlainTextKind;
  confidence: number;
  reasons: string[];
  language?: string;
}

export interface ParsedClipboardContent {
  kind: PlainTextKind | 'html';
  html: string;
  text: string;
  source: ClipboardSourceMatch;
  diagnostics: string[];
}

export interface NormalizeClipboardHtmlOptions {
  source?: ClipboardSourceMatch | ClipboardSource;
  payload?: Pick<ClipboardPayload, 'text' | 'html' | 'types'>;
  allowInternalStructures?: boolean;
}

export interface NormalizedClipboardHtml {
  html: string;
  source: ClipboardSourceMatch;
  mathNodeCount: number;
  droppedImageCount: number;
  diagnostics: string[];
}

export interface ParsePlainTextOptions {
  source?: ClipboardSourceMatch | ClipboardSource;
  /** Strict Ctrl/Cmd+Shift+V path. No Markdown, links, tables, code, or math nodes. */
  plain?: boolean;
  /** Used when the editor selection is already inside a code block. */
  codeContext?: boolean;
}

export interface SanitizedClipboardHtml {
  html: string;
  droppedImageCount: number;
  removedUnsafeUrlCount: number;
}
