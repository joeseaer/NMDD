import {
  DEFAULT_MIND_MAP_JSON_LIMITS,
  MindMapJsonError,
  parseConstrainedJson,
  type MindMapJsonLimits,
} from '../domain/safeJson';
import { collectMindMapClipboardEnvelope } from './collect';
import {
  projectMindMapClipboardHtmlOutline,
  projectMindMapClipboardOutline,
} from './outline';
import { validateMindMapClipboardEnvelopeSchema } from './schema';
import {
  MIND_MAP_CLIPBOARD_MARKDOWN_MIME,
  MIND_MAP_CLIPBOARD_HTML_MIME,
  MIND_MAP_CLIPBOARD_MIME,
  MIND_MAP_CLIPBOARD_SCHEMA,
  MIND_MAP_CLIPBOARD_SCHEMA_VERSION,
  MIND_MAP_CLIPBOARD_TEXT_MIME,
  MindMapClipboardError,
  type ClipboardDecodeOptions,
  type EncodeMindMapClipboardInput,
  type EncodedMindMapClipboard,
  type MindMapClipboardEnvelopeV1,
} from './types';
import {
  findUnsafeClipboardKeys,
  findUnsafeClipboardUrls,
  validateMindMapClipboardReferences,
} from './validation';

export const DEFAULT_MIND_MAP_CLIPBOARD_LIMITS: Readonly<MindMapJsonLimits> = Object.freeze({
  ...DEFAULT_MIND_MAP_JSON_LIMITS,
  maxArrayItems: 100_000,
  maxBytes: 4 * 1024 * 1024,
  maxDepth: 64,
  maxObjectKeys: 100_000,
  maxValues: 250_000,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function customMimeText(raw: string | Readonly<Record<string, string>>): string {
  if (typeof raw === 'string') return raw;
  const value = raw[MIND_MAP_CLIPBOARD_MIME];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new MindMapClipboardError(
      'clipboard.missing-custom-mime',
      `Clipboard data does not contain ${MIND_MAP_CLIPBOARD_MIME}.`,
    );
  }
  return value;
}

export function encodeMindMapClipboard(
  input: EncodeMindMapClipboardInput,
): EncodedMindMapClipboard {
  const collected = collectMindMapClipboardEnvelope(input);
  const custom = JSON.stringify(collected);
  // Encoding is also a trust boundary: never publish a custom MIME payload
  // that the decoder would reject later.
  const envelope = decodeMindMapClipboard(custom);
  const html = projectMindMapClipboardHtmlOutline(envelope);
  const markdown = projectMindMapClipboardOutline(envelope, { format: 'markdown' });
  const text = projectMindMapClipboardOutline(envelope, { format: 'plain' });
  return {
    envelope,
    mimeData: Object.freeze({
      [MIND_MAP_CLIPBOARD_MIME]: custom,
      [MIND_MAP_CLIPBOARD_HTML_MIME]: html,
      [MIND_MAP_CLIPBOARD_MARKDOWN_MIME]: markdown,
      [MIND_MAP_CLIPBOARD_TEXT_MIME]: text,
    }),
  };
}

export function decodeMindMapClipboard(
  raw: string | Readonly<Record<string, string>>,
  options: ClipboardDecodeOptions = {},
): MindMapClipboardEnvelopeV1 {
  let value: unknown;
  try {
    value = parseConstrainedJson(
      customMimeText(raw),
      options.limits ?? DEFAULT_MIND_MAP_CLIPBOARD_LIMITS,
    ).value;
  } catch (error) {
    if (error instanceof MindMapClipboardError) throw error;
    const detail = error instanceof MindMapJsonError ? error.code : 'unknown parse error';
    throw new MindMapClipboardError(
      'clipboard.invalid-envelope',
      'Clipboard payload could not be parsed safely.',
      [detail],
      error,
    );
  }

  if (
    isRecord(value) &&
    (value.schema !== MIND_MAP_CLIPBOARD_SCHEMA ||
      value.schemaVersion !== MIND_MAP_CLIPBOARD_SCHEMA_VERSION)
  ) {
    throw new MindMapClipboardError(
      'clipboard.unsupported-version',
      'Clipboard payload uses an unsupported schema or version.',
      [String(value.schema), String(value.schemaVersion)],
    );
  }

  const unsafeKeys = findUnsafeClipboardKeys(value);
  if (unsafeKeys.length > 0) {
    throw new MindMapClipboardError(
      'clipboard.unsafe-key',
      'Clipboard payload contains unsafe object keys.',
      unsafeKeys,
    );
  }

  const schemaErrors = validateMindMapClipboardEnvelopeSchema(value);
  if (schemaErrors.length > 0) {
    throw new MindMapClipboardError(
      'clipboard.invalid-envelope',
      'Clipboard payload does not match the canonical clipboard schema.',
      schemaErrors,
    );
  }
  const envelope = value as MindMapClipboardEnvelopeV1;

  const unsafeUrls = findUnsafeClipboardUrls(envelope);
  if (unsafeUrls.length > 0) {
    throw new MindMapClipboardError(
      'clipboard.unsafe-url',
      'Clipboard payload contains an unsafe URL.',
      unsafeUrls,
    );
  }

  const referenceErrors = validateMindMapClipboardReferences(envelope);
  if (referenceErrors.length > 0) {
    throw new MindMapClipboardError(
      'clipboard.invalid-reference',
      'Clipboard payload contains dangling or invalid canonical references.',
      referenceErrors,
    );
  }

  return envelope;
}
