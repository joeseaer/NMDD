import { Extension } from '@tiptap/core';
import {
  DOMParser as ProseMirrorDOMParser,
  DOMSerializer,
  Fragment,
  Slice,
  type Node as ProseMirrorNode,
  type ResolvedPos,
  type Schema,
} from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { dropPoint, insertPoint } from '@tiptap/pm/transform';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import {
  captureClipboardPayload,
  parseClipboardPayload,
  prepareFragmentForClipboard,
  serializeClipboardText,
  type ClipboardPayload,
} from './clipboard';
import type { DocumentFragmentJson } from './schema/documentSchema';
import { cloneFragmentForPaste } from './schema/cloneFragment';

export const NMDD_CLIPBOARD_MIME = 'application/x-nmdd-document-fragment';

type UploadStatus = 'uploading' | 'ready' | 'error';

type UploadJob = {
  id: string;
  file: File;
  status: UploadStatus;
  url: string | null;
};

type UploadBatch = {
  id: string;
  jobs: UploadJob[];
  anchor: number;
  insertedContent: boolean;
  cancelled: boolean;
};

type UploadPlaceholderSpec = {
  id: string;
  batchId: string;
  fileName: string;
  status: UploadStatus;
  order: number;
};

type UploadPlaceholderAction =
  | { type: 'add'; placeholders: Array<UploadPlaceholderSpec & { pos: number }> }
  | { type: 'update'; id: string; status: UploadStatus }
  | { type: 'remove'; ids: string[] }
  | { type: 'clear' };

export type SmartClipboardExtensionOptions = {
  uploadImage?: (file: File) => Promise<string | null>;
  uploadFile?: (file: File) => Promise<string | null>;
  onUploadError?: (file: File, error: unknown) => void;
  uploadControllerRef?: {
    current: SmartClipboardUploadController | null;
  };
};

export type SmartClipboardUploadController = {
  hasPendingUploads: () => boolean;
  waitForPendingUploads: () => Promise<void>;
};

const uploadPlaceholderKey = new PluginKey<DecorationSet>('smartClipboardUploadPlaceholders');

let localIdCounter = 0;
const createLocalId = (prefix: string) => {
  const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${(localIdCounter += 1).toString(36)}`;
  return `${prefix}-${randomId}`;
};

const createLiteralTextSlice = (
  text: string,
  $context: ResolvedPos,
  schema: Schema,
): Slice => {
  const normalized = text.replace(/\r\n?/g, '\n');
  if ($context.parent.type.spec.code) {
    return normalized
      ? new Slice(Fragment.from(schema.text(normalized)), 0, 0)
      : Slice.empty;
  }

  const paragraph = schema.nodes.paragraph;
  if (!paragraph) {
    return normalized
      ? new Slice(Fragment.from(schema.text(normalized)), 0, 0)
      : Slice.empty;
  }

  const blocks = normalized.split('\n').map(line => (
    paragraph.create(null, line ? schema.text(line) : undefined)
  ));
  return Slice.maxOpen(Fragment.fromArray(blocks), true);
};

const parseRichTextSlice = (
  html: string,
  $context: ResolvedPos,
  view: EditorView,
  fallbackText: string,
): Slice => {
  try {
    const container = document.createElement('div');
    container.innerHTML = html;
    const parsed = ProseMirrorDOMParser.fromSchema(view.state.schema).parseSlice(container, {
      context: $context,
      preserveWhitespace: true,
    });
    if (parsed.size || !fallbackText) return parsed;
  } catch {
    // An unsupported foreign node should degrade to its textual representation.
  }
  return createLiteralTextSlice(fallbackText, $context, view.state.schema);
};

const rebuildSlice = (
  schema: Schema,
  fragment: DocumentFragmentJson,
  original: Slice,
): Slice => {
  try {
    return new Slice(
      Fragment.fromJSON(schema, fragment as readonly unknown[]),
      original.openStart,
      original.openEnd,
    );
  } catch {
    return original;
  }
};

const removeImageNodes = (fragment: Fragment): Fragment => {
  const nodes: ProseMirrorNode[] = [];
  fragment.forEach(node => {
    if (node.type.name === 'image') return;
    if (!node.content.size) {
      nodes.push(node);
      return;
    }
    nodes.push(node.copy(removeImageNodes(node.content)));
  });
  return Fragment.fromArray(nodes);
};

const serializeInternalClipboard = (view: EditorView, event: ClipboardEvent, cut: boolean): boolean => {
  const data = event.clipboardData;
  const selection = view.state.selection;
  if (!data || selection.empty) return false;

  const original = selection.content();
  const prepared = prepareFragmentForClipboard(original.content.toJSON() as DocumentFragmentJson);
  const cloned = rebuildSlice(view.state.schema, prepared.fragment, original);
  const serializer = DOMSerializer.fromSchema(view.state.schema);
  const marker = document.createElement('div');
  marker.setAttribute('data-nmdd-document-fragment', '2');
  marker.appendChild(serializer.serializeFragment(cloned.content));
  const markdown = serializeClipboardText(prepared.fragment);

  event.preventDefault();
  data.clearData();
  data.setData('text/html', marker.outerHTML);
  data.setData('text/plain', markdown);
  try {
    data.setData('text/markdown', markdown);
    data.setData(NMDD_CLIPBOARD_MIME, JSON.stringify({
      version: 2,
      openStart: cloned.openStart,
      openEnd: cloned.openEnd,
      fragment: prepared.fragment,
    }));
  } catch {
    // Some WebKit clipboard implementations reject custom MIME types.
  }

  if (cut) {
    view.dispatch(view.state.tr.deleteSelection().scrollIntoView().setMeta('uiEvent', 'cut'));
  }
  return true;
};

const getMediaKind = (file: File): 'video' | 'audio' | 'document' => {
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return 'document';
};

const createUploadedNode = (schema: Schema, file: File, url: string): ProseMirrorNode | null => {
  if (file.type.startsWith('image/') && schema.nodes.image) {
    return schema.nodes.image.create({
      src: url,
      alt: file.name,
      title: file.name,
      width: '100%',
      align: 'center',
    });
  }
  if (schema.nodes.mediaBlock) {
    return schema.nodes.mediaBlock.create({
      url,
      name: file.name,
      mime: file.type || '',
      size: file.size,
      kind: getMediaKind(file),
    });
  }
  return null;
};

const createPlaceholderWidget = (
  spec: UploadPlaceholderSpec,
  retry: (id: string) => void,
) => {
  const element = document.createElement('span');
  element.className = `smart-document-upload-placeholder is-${spec.status}`;
  element.setAttribute('role', 'status');
  element.setAttribute('contenteditable', 'false');
  element.dataset.uploadId = spec.id;

  const label = document.createElement('span');
  label.className = 'smart-document-upload-placeholder__label';
  label.textContent = spec.status === 'uploading'
    ? `正在上传 ${spec.fileName}`
    : spec.status === 'ready'
      ? `${spec.fileName} 已就绪`
      : `${spec.fileName} 上传失败`;
  element.appendChild(label);

  if (spec.status === 'error') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'smart-document-upload-placeholder__retry';
    button.textContent = '重试';
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', event => {
      event.preventDefault();
      retry(spec.id);
    });
    element.appendChild(button);
  }
  return element;
};

/**
 * The single ProseMirror clipboard boundary used by both the full document and
 * nested database-row editors. Parsing is synchronous; file uploads stay in
 * mapped decorations so transient state never leaks into persisted JSON.
 */
export const SmartClipboardExtension = Extension.create<SmartClipboardExtensionOptions>({
  name: 'smartClipboard',
  priority: 1100,

  addOptions() {
    return {};
  },

  addProseMirrorPlugins() {
    const extension = this;
    let pendingPayload: ClipboardPayload | null = null;
    let keyboardPlainPaste = false;
    let parserSawPlainPaste = false;
    let activeView: EditorView | null = null;
    const batches = new Map<string, UploadBatch>();
    const uploadStateWaiters = new Set<() => void>();

    const canDispatch = () => Boolean(activeView && !activeView.isDestroyed);
    const notifyUploadStateChanged = () => {
      uploadStateWaiters.forEach(resolve => resolve());
      uploadStateWaiters.clear();
    };
    const hasPendingUploads = () => Array.from(batches.values()).some(batch => !batch.cancelled);
    const waitForPendingUploads = async () => {
      while (true) {
        const activeBatches = Array.from(batches.values()).filter(batch => !batch.cancelled);
        if (!activeBatches.length) return;

        const failedFiles = activeBatches.flatMap(batch => (
          batch.jobs.filter(job => job.status === 'error').map(job => job.file.name || '未命名附件')
        ));
        if (failedFiles.length) {
          throw new Error(`附件上传失败：${failedFiles.join('、')}。请重试或撤销附件后再离开文档。`);
        }

        await new Promise<void>(resolve => uploadStateWaiters.add(resolve));
      }
    };
    const uploadController: SmartClipboardUploadController = {
      hasPendingUploads,
      waitForPendingUploads,
    };

    const updatePlaceholder = (id: string, status: UploadStatus) => {
      if (!canDispatch()) return;
      activeView!.dispatch(
        activeView!.state.tr
          .setMeta(uploadPlaceholderKey, { type: 'update', id, status } satisfies UploadPlaceholderAction)
          .setMeta('addToHistory', false),
      );
    };

    const finalizeBatch = (batch: UploadBatch) => {
      if (!canDispatch() || batch.cancelled || batch.jobs.some(job => !job.url)) return;
      const decorationSet = uploadPlaceholderKey.getState(activeView!.state);
      const positions = decorationSet
        ? decorationSet
          .find(undefined, undefined, spec => batch.jobs.some(job => job.id === spec.id))
          .map(decoration => decoration.from)
        : [];
      const nodes = batch.jobs
        .map(job => createUploadedNode(activeView!.state.schema, job.file, job.url!))
        .filter((node): node is ProseMirrorNode => Boolean(node));
      const transaction = activeView!.state.tr.setMeta(uploadPlaceholderKey, {
        type: 'remove',
        ids: batch.jobs.map(job => job.id),
      } satisfies UploadPlaceholderAction);
      if (nodes.length) {
        const anchor = positions.length ? Math.min(...positions) : batch.anchor;
        const fragment = Fragment.fromArray(nodes);
        const uploadSlice = new Slice(fragment, 0, 0);
        const validPos = dropPoint(transaction.doc, anchor, uploadSlice)
          ?? insertPoint(transaction.doc, anchor, nodes[0].type);
        if (validPos !== null) transaction.replace(validPos, validPos, uploadSlice);
      }
      activeView!.dispatch(transaction.scrollIntoView());
      batch.cancelled = true;
      batches.delete(batch.id);
      notifyUploadStateChanged();
    };

    const resolveUpload = async (job: UploadJob) => {
      const handler = job.file.type.startsWith('image/')
        ? extension.options.uploadImage || extension.options.uploadFile
        : extension.options.uploadFile || extension.options.uploadImage;
      if (!handler) return null;
      return handler(job.file);
    };

    const runUpload = async (batch: UploadBatch, job: UploadJob) => {
      if (batch.cancelled) return;
      job.status = 'uploading';
      job.url = null;
      updatePlaceholder(job.id, 'uploading');
      notifyUploadStateChanged();
      try {
        const url = await resolveUpload(job);
        if (batch.cancelled) return;
        job.url = url || null;
        job.status = url ? 'ready' : 'error';
        updatePlaceholder(job.id, job.status);
      } catch (error) {
        if (batch.cancelled) return;
        job.status = 'error';
        job.url = null;
        extension.options.onUploadError?.(job.file, error);
        updatePlaceholder(job.id, 'error');
      }

      notifyUploadStateChanged();

      if (batch.jobs.every(candidate => candidate.status === 'ready')) finalizeBatch(batch);
    };

    const retryUpload = (id: string) => {
      const batch = Array.from(batches.values()).find(candidate => (
        candidate.jobs.some(job => job.id === id)
      ));
      const job = batch?.jobs.find(candidate => candidate.id === id);
      if (!batch || !job || job.status !== 'error') return;
      void runUpload(batch, job);
    };

    const beginUploadBatch = (
      view: EditorView,
      files: File[],
      pos: number,
      insertedContent: boolean,
      transaction = view.state.tr,
    ) => {
      const batch: UploadBatch = {
        id: createLocalId('upload-batch'),
        anchor: pos,
        insertedContent,
        cancelled: false,
        jobs: files.map(file => ({
          id: createLocalId('upload'),
          file,
          status: 'uploading',
          url: null,
        })),
      };
      transaction.setMeta(uploadPlaceholderKey, {
        type: 'add',
        placeholders: batch.jobs.map((job, order) => ({
          id: job.id,
          batchId: batch.id,
          fileName: job.file.name || `文件 ${order + 1}`,
          status: 'uploading',
          order,
          pos,
        })),
      } satisfies UploadPlaceholderAction);
      view.dispatch(transaction.scrollIntoView());
      // The anchor is already expressed in transaction.doc coordinates. Add
      // the batch after dispatch so the plugin does not map it a second time.
      batches.set(batch.id, batch);
      notifyUploadStateChanged();
      batch.jobs.forEach(job => void runUpload(batch, job));
    };

    const cancelPendingUploads = () => {
      batches.forEach(batch => { batch.cancelled = true; });
      batches.clear();
      notifyUploadStateChanged();
      if (canDispatch()) {
        activeView!.dispatch(
          activeView!.state.tr
            .setMeta(uploadPlaceholderKey, { type: 'clear' } satisfies UploadPlaceholderAction)
            .setMeta('addToHistory', false),
        );
      }
    };

    return [new Plugin<DecorationSet>({
      key: uploadPlaceholderKey,
      state: {
        init: () => DecorationSet.empty,
        apply: (transaction, previous) => {
          batches.forEach(batch => {
            batch.anchor = transaction.mapping.map(batch.anchor, 1);
          });
          let next = previous.map(transaction.mapping, transaction.doc);
          const historyMeta = transaction.getMeta('history$');
          if (historyMeta && batches.size) {
            batches.forEach(batch => { batch.cancelled = true; });
            batches.clear();
            notifyUploadStateChanged();
            next = DecorationSet.empty;
          }

          const action = transaction.getMeta(uploadPlaceholderKey) as UploadPlaceholderAction | undefined;
          if (!action) return next;
          if (action.type === 'clear') return DecorationSet.empty;
          if (action.type === 'remove') {
            const remove = next.find(undefined, undefined, spec => action.ids.includes(spec.id));
            return next.remove(remove);
          }
          if (action.type === 'update') {
            const remove = next.find(undefined, undefined, spec => spec.id === action.id);
            const replacements = remove.map(decoration => {
              const spec = { ...decoration.spec, status: action.status } as UploadPlaceholderSpec;
              return Decoration.widget(
                decoration.from,
                () => createPlaceholderWidget(spec, retryUpload),
                { ...spec, side: spec.order + 1 },
              );
            });
            return next.remove(remove).add(transaction.doc, replacements);
          }

          const additions = action.placeholders.map(placeholder => Decoration.widget(
            placeholder.pos,
            () => createPlaceholderWidget(placeholder, retryUpload),
            { ...placeholder, side: placeholder.order + 1 },
          ));
          return next.add(transaction.doc, additions);
        },
      },
      props: {
        decorations: state => uploadPlaceholderKey.getState(state),
        handleKeyDown: (_view, event) => {
          const isPaste = event.key.toLowerCase() === 'v' && (event.ctrlKey || event.metaKey);
          if (isPaste) keyboardPlainPaste = event.shiftKey;

          const isUndo = event.key.toLowerCase() === 'z' && (event.ctrlKey || event.metaKey) && !event.shiftKey;
          if (!isUndo || batches.size === 0) return false;
          const shouldUndoDocument = Array.from(batches.values()).some(batch => batch.insertedContent);
          cancelPendingUploads();
          return !shouldUndoDocument;
        },
        handleDOMEvents: {
          paste: (_view, event) => {
            pendingPayload = captureClipboardPayload((event as ClipboardEvent).clipboardData);
            parserSawPlainPaste = false;
            return false;
          },
          copy: (view, event) => serializeInternalClipboard(view, event as ClipboardEvent, false),
          cut: (view, event) => serializeInternalClipboard(view, event as ClipboardEvent, true),
        },
        clipboardTextParser: (text, $context, plain, view) => {
          const payload = pendingPayload || captureClipboardPayload(undefined);
          const hydratedPayload = payload.text === text ? payload : { ...payload, text };
          const codeContext = Boolean($context.parent.type.spec.code);
          const strictPlain = Boolean(plain || keyboardPlainPaste);
          parserSawPlainPaste = strictPlain;
          const result = parseClipboardPayload(hydratedPayload, { plain: strictPlain, codeContext });
          if (strictPlain || codeContext) {
            return createLiteralTextSlice(result.text, $context, view.state.schema);
          }
          return parseRichTextSlice(result.html, $context, view, result.text);
        },
        transformPastedHTML: html => {
          const payload = pendingPayload || captureClipboardPayload(undefined);
          const hydratedPayload = payload.html === html ? payload : { ...payload, html };
          return parseClipboardPayload(hydratedPayload, {
            plain: false,
            codeContext: false,
          }).html;
        },
        transformPasted: slice => {
          if (pendingPayload?.source.source !== 'internal' || keyboardPlainPaste || parserSawPlainPaste) {
            return slice;
          }
          const cloned = cloneFragmentForPaste(slice.content.toJSON() as DocumentFragmentJson);
          return rebuildSlice(extension.editor.schema, cloned.fragment, slice);
        },
        transformCopied: slice => {
          const prepared = prepareFragmentForClipboard(slice.content.toJSON() as DocumentFragmentJson);
          return rebuildSlice(extension.editor.schema, prepared.fragment, slice);
        },
        clipboardTextSerializer: slice => (
          serializeClipboardText(slice.content.toJSON() as DocumentFragmentJson)
        ),
        handlePaste: (view, event, parsedSlice) => {
          const payload = pendingPayload || captureClipboardPayload(event.clipboardData);
          const strictPlain = Boolean(keyboardPlainPaste || parserSawPlainPaste);
          const codeContext = Boolean(view.state.selection.$from.parent.type.spec.code);
          pendingPayload = null;
          keyboardPlainPaste = false;
          parserSawPlainPaste = false;

          if (strictPlain || codeContext || payload.files.length === 0) return false;
          event.preventDefault();

          const textSlice = payload.text
            ? new Slice(removeImageNodes(parsedSlice.content), parsedSlice.openStart, parsedSlice.openEnd)
            : Slice.empty;
          const transaction = view.state.tr;
          if (textSlice.size) transaction.replaceSelection(textSlice);
          const anchor = transaction.selection.from;
          beginUploadBatch(view, payload.files, anchor, textSlice.size > 0, transaction);
          return true;
        },
        handleDrop: (view, event, _slice, moved) => {
          if (moved) return false;
          const files = Array.from(event.dataTransfer?.files || []);
          if (!files.length) return false;
          event.preventDefault();
          const coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY });
          beginUploadBatch(view, files, coordinates?.pos ?? view.state.selection.from, false);
          return true;
        },
      },
      view: view => {
        activeView = view;
        if (extension.options.uploadControllerRef) {
          extension.options.uploadControllerRef.current = uploadController;
        }
        return {
          destroy: () => {
            batches.forEach(batch => { batch.cancelled = true; });
            batches.clear();
            notifyUploadStateChanged();
            if (extension.options.uploadControllerRef?.current === uploadController) {
              extension.options.uploadControllerRef.current = null;
            }
            activeView = null;
          },
        };
      },
    })];
  },
});
