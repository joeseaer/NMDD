import { classifyClipboardSource } from './classifyClipboardSource';
import type { ClipboardPayload } from './types';

const normalizeNewlines = (value: string) => value.replace(/\r\n?/g, '\n');

export const parseUriList = (value: string): string[] => (
  normalizeNewlines(value)
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'))
);

const collectFilesInClipboardOrder = (data: DataTransfer): File[] => {
  const itemFiles = Array.from(data.items || [])
    .filter(item => item.kind === 'file')
    .map(item => item.getAsFile())
    .filter((file): file is File => Boolean(file));

  // Chromium exposes item order reliably. The fallback covers browsers that only
  // populate DataTransfer.files and avoids duplicating the same File objects.
  if (itemFiles.length > 0) return itemFiles;
  return Array.from(data.files || []);
};

export const captureClipboardPayload = (data: DataTransfer | null | undefined): ClipboardPayload => {
  if (!data) {
    const source = classifyClipboardSource({ text: '', html: '', types: [] });
    return { text: '', html: '', markdown: '', uriList: [], files: [], types: [], source };
  }

  const types = Array.from(data.types || []);
  const text = normalizeNewlines(data.getData('text/plain') || '');
  const html = data.getData('text/html') || '';
  const markdown = normalizeNewlines(data.getData('text/markdown') || '');
  const uriList = parseUriList(data.getData('text/uri-list') || '');
  const files = collectFilesInClipboardOrder(data);
  const source = classifyClipboardSource({ text, html, types });

  return { text, html, markdown, uriList, files, types, source };
};
