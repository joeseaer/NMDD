import {
  exportToBlob,
  exportToClipboard,
  exportToSvg,
  serializeAsJSON,
} from '@excalidraw/excalidraw';
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types';

type ExportSnapshot = {
  title: string;
  elements: readonly any[];
  appState: AppState;
  files: BinaryFiles;
};

const safeFileName = (value: string) => (
  String(value || '未命名白板').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim() || '未命名白板'
);

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

const blankPngBlob = async (backgroundColor = '#ffffff'): Promise<Blob> => (
  new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const context = canvas.getContext('2d');
    if (!context) return reject(new Error('无法导出空白画布'));
    context.fillStyle = backgroundColor;
    context.fillRect(0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('无法导出空白画布')), 'image/png');
  })
);

const activeElements = (elements: readonly any[]) => elements.filter((element) => !element.isDeleted);

export const exportWhiteboardJson = ({ title, elements, appState, files }: ExportSnapshot) => {
  const serialized = serializeAsJSON(elements, appState, files, 'local');
  downloadBlob(new Blob([serialized], { type: 'application/vnd.excalidraw+json' }), `${safeFileName(title)}.excalidraw`);
};

export const exportWhiteboardPng = async ({ title, elements, appState, files }: ExportSnapshot) => {
  const visibleElements = activeElements(elements);
  const blob = visibleElements.length > 0
    ? await exportToBlob({
        elements: visibleElements,
        appState: { ...appState, exportBackground: true, exportWithDarkMode: false },
        files,
        mimeType: 'image/png',
        exportPadding: 24,
      })
    : await blankPngBlob(String(appState.viewBackgroundColor || '#ffffff'));
  downloadBlob(blob, `${safeFileName(title)}.png`);
};

export const exportWhiteboardSvg = async ({ title, elements, appState, files }: ExportSnapshot) => {
  const visibleElements = activeElements(elements);
  const svg = visibleElements.length > 0
    ? await exportToSvg({
        elements: visibleElements,
        appState: { ...appState, exportBackground: true, exportWithDarkMode: false },
        files,
        exportPadding: 24,
      })
    : (() => {
        const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        node.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        node.setAttribute('viewBox', '0 0 1280 720');
        const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        background.setAttribute('width', '1280');
        background.setAttribute('height', '720');
        background.setAttribute('fill', String(appState.viewBackgroundColor || '#ffffff'));
        node.appendChild(background);
        return node;
      })();
  downloadBlob(new Blob([svg.outerHTML], { type: 'image/svg+xml' }), `${safeFileName(title)}.svg`);
};

export const copyWhiteboardPng = async ({ elements, appState, files }: ExportSnapshot) => {
  const visibleElements = activeElements(elements);
  if (visibleElements.length === 0) {
    const blob = await blankPngBlob(String(appState.viewBackgroundColor || '#ffffff'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return;
  }
  await exportToClipboard({
    elements: visibleElements,
    appState: { ...appState, exportBackground: true, exportWithDarkMode: false },
    files,
    type: 'png',
  });
};
