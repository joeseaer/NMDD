import type { ExtensionBag, MindMapDocumentV1 } from '../domain/types';
import { buildCanonicalDocumentFromOutline } from './canonicalImport';
import { resolveMindMapImportLimits, utf8ByteLength } from './limits';
import { projectMindMapToNormalizedOutline } from './normalizedOutline';
import { MindMapImportReportBuilder } from './report';
import { parseSafeXmlDocument, type SafeXmlElement } from './safeXml';
import {
  OPML_ATTRIBUTES_EXTENSION_KEY,
  OPML_NAMESPACES_EXTENSION_KEY,
  OPML_ROOT_ATTRIBUTES_EXTENSION_KEY,
  type MindMapImportOptions,
  type MindMapImportResult,
  type NormalizedOutlineDocument,
  type NormalizedOutlineNode,
  type NormalizedOutlineSheet,
  type OpmlExtensionAttribute,
} from './types';

const NMDD_OPML_NAMESPACE = 'https://schemas.nmdd.app/opml/1';
const XML_NAME_PATTERN = /^[A-Za-z_:][A-Za-z0-9_.:-]*$/;
const EXTERNAL_ATTRIBUTE_NAMES = new Set([
  'htmlurl',
  'href',
  'url',
  'websiteurl',
  'xml:base',
  'xmlurl',
]);
const DROPPED_STANDARD_ATTRIBUTES = new Set([
  'category',
  'created',
  'isbreakpoint',
  'iscomment',
  'type',
]);

interface MutableOutlineNode {
  title: string;
  children: MutableOutlineNode[];
  extensions?: ExtensionBag;
}

function attributeValue(element: SafeXmlElement, name: string): string | undefined {
  return element.attributes.find((attribute) => attribute.name === name)?.value;
}

function extensionAttributes(
  extensions: Readonly<ExtensionBag> | undefined,
  key: string = OPML_ATTRIBUTES_EXTENSION_KEY,
): OpmlExtensionAttribute[] {
  const value = extensions?.[key];
  if (!Array.isArray(value)) return [];
  const attributes: OpmlExtensionAttribute[] = [];
  for (const item of value) {
    if (
      item !== null
      && typeof item === 'object'
      && typeof (item as { name?: unknown }).name === 'string'
      && typeof (item as { value?: unknown }).value === 'string'
    ) {
      attributes.push({
        name: (item as { name: string }).name,
        value: (item as { value: string }).value,
      });
    }
  }
  return attributes;
}

function collectUnknownOutlineAttributes(
  element: SafeXmlElement,
  path: string,
  report: MindMapImportReportBuilder,
  allowSheetKind = false,
): ExtensionBag | undefined {
  const preserved: OpmlExtensionAttribute[] = [];
  for (const attribute of element.attributes) {
    const lowerName = attribute.name.toLowerCase();
    if (lowerName === 'text' || lowerName === 'title') {
      continue;
    }
    if (lowerName === 'nmdd:kind') {
      if (!allowSheetKind || attribute.value !== 'sheet') {
        report.add({
          code: 'opml.kind-attribute-ignored',
          disposition: 'ignored',
          message: `Unsupported nmdd:kind value ${attribute.value} was ignored.`,
          path,
          severity: 'warning',
        });
      }
      continue;
    }
    if (EXTERNAL_ATTRIBUTE_NAMES.has(lowerName)) {
      report.add({
        code: 'opml.external-attribute-ignored',
        disposition: 'ignored',
        message: `External-link attribute ${attribute.name} was not imported.`,
        path,
        severity: 'warning',
      });
      continue;
    }
    if (DROPPED_STANDARD_ATTRIBUTES.has(lowerName)) {
      report.add({
        code: 'opml.standard-attribute-ignored',
        disposition: 'ignored',
        message: `OPML metadata attribute ${attribute.name} has no outline equivalent.`,
        path,
        severity: 'warning',
      });
      continue;
    }
    preserved.push({ name: attribute.name, value: attribute.value });
  }
  if (preserved.length === 0) return undefined;
  report.add({
    code: 'opml.unknown-attributes-preserved',
    count: preserved.length,
    disposition: 'preserved',
    message: `${preserved.length} unknown OPML attribute(s) were preserved in namespaced extensions.`,
    path,
    severity: 'info',
  });
  return { [OPML_ATTRIBUTES_EXTENSION_KEY]: preserved };
}

function reportIgnoredContainerAttributes(
  element: SafeXmlElement,
  path: string,
  report: MindMapImportReportBuilder,
): void {
  if (element.attributes.length === 0) return;
  report.add({
    code: 'opml.container-attributes-ignored',
    count: element.attributes.length,
    disposition: 'ignored',
    message: `${element.attributes.length} unsupported attribute(s) on <${element.name}> were ignored.`,
    path,
    severity: 'warning',
  });
}

function convertOutlineElement(
  element: SafeXmlElement,
  path: string,
  depth: number,
  state: { count: number },
  options: MindMapImportOptions,
  report: MindMapImportReportBuilder,
): MutableOutlineNode | null {
  const limits = resolveMindMapImportLimits(options.limits);
  if (depth > limits.maxDepth) {
    report.add({
      code: 'opml.depth-limit',
      disposition: 'rejected',
      message: `OPML outline exceeds the ${limits.maxDepth} level limit.`,
      path,
      severity: 'error',
    });
    return null;
  }
  state.count += 1;
  if (state.count > limits.maxNodes) {
    report.add({
      code: 'opml.node-limit',
      disposition: 'rejected',
      message: `OPML outline exceeds the ${limits.maxNodes} node limit.`,
      path,
      severity: 'error',
    });
    return null;
  }

  const text = attributeValue(element, 'text');
  const titleAlias = attributeValue(element, 'title');
  if (text === undefined && titleAlias === undefined) {
    report.add({
      code: 'opml.missing-text',
      disposition: 'degraded',
      message: 'An outline without text received an empty topic title.',
      path,
      severity: 'warning',
    });
  } else if (text !== undefined && titleAlias !== undefined) {
    report.add({
      code: 'opml.title-alias-ignored',
      disposition: 'ignored',
      message: 'The title alias was ignored because the outline also has text.',
      path,
      severity: 'warning',
    });
  }

  const extensions = collectUnknownOutlineAttributes(element, path, report);
  const node: MutableOutlineNode = {
    children: [],
    ...(extensions === undefined ? {} : { extensions }),
    title: text ?? titleAlias ?? '',
  };
  let outlineIndex = 0;
  for (const child of element.children) {
    if (child.name !== 'outline') {
      report.add({
        code: 'opml.element-ignored',
        disposition: 'ignored',
        message: `Non-outline element <${child.name}> was ignored.`,
        path,
        severity: 'warning',
      });
      continue;
    }
    outlineIndex += 1;
    const converted = convertOutlineElement(
      child,
      `${path}/outline[${outlineIndex}]`,
      depth + 1,
      state,
      options,
      report,
    );
    if (!converted) return null;
    node.children.push(converted);
  }
  return node;
}

function xmlSafeText(value: string): string {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index) ?? 0xfffd;
    const allowed = codePoint === 0x09
      || codePoint === 0x0a
      || codePoint === 0x0d
      || (codePoint >= 0x20 && codePoint <= 0xd7ff)
      || (codePoint >= 0xe000 && codePoint <= 0xfffd)
      || (codePoint >= 0x10000 && codePoint <= 0x10ffff);
    result += String.fromCodePoint(allowed ? codePoint : 0xfffd);
    if (codePoint > 0xffff) index += 1;
  }
  return result;
}

function escapeXml(value: string): string {
  return xmlSafeText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function serializeExtensionAttributes(
  extensions: Readonly<ExtensionBag> | undefined,
  reservedNames: ReadonlySet<string>,
  key: string = OPML_ATTRIBUTES_EXTENSION_KEY,
): string {
  const seen = new Set<string>();
  return extensionAttributes(extensions, key)
    .filter((attribute) => {
      const lowerName = attribute.name.toLowerCase();
      if (
        !XML_NAME_PATTERN.test(attribute.name)
        || reservedNames.has(lowerName)
        || seen.has(attribute.name)
      ) {
        return false;
      }
      seen.add(attribute.name);
      return true;
    })
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((attribute) => ` ${attribute.name}="${escapeXml(attribute.value)}"`)
    .join('');
}

function serializeOutlineNode(
  node: NormalizedOutlineNode,
  depth: number,
  lines: string[],
): void {
  type SerializeEvent =
    | { readonly depth: number; readonly kind: 'close' }
    | { readonly depth: number; readonly kind: 'node'; readonly node: NormalizedOutlineNode };
  const stack: SerializeEvent[] = [{ depth, kind: 'node', node }];
  while (stack.length > 0) {
    const event = stack.pop();
    if (!event) break;
    const indent = '  '.repeat(event.depth);
    if (event.kind === 'close') {
      lines.push(`${indent}</outline>`);
      continue;
    }
    const attributes = serializeExtensionAttributes(
      event.node.extensions,
      new Set(['nmdd:kind', 'text', 'title']),
    );
    if (event.node.children.length === 0) {
      lines.push(`${indent}<outline text="${escapeXml(event.node.title)}"${attributes}/>`);
      continue;
    }
    lines.push(`${indent}<outline text="${escapeXml(event.node.title)}"${attributes}>`);
    stack.push({ depth: event.depth, kind: 'close' });
    for (let index = event.node.children.length - 1; index >= 0; index -= 1) {
      stack.push({ depth: event.depth + 1, kind: 'node', node: event.node.children[index] });
    }
  }
}

export function exportMindMapToOpml(document: MindMapDocumentV1): string {
  const outline = projectMindMapToNormalizedOutline(document);
  const namespaceAttributes = serializeExtensionAttributes(
    outline.extensions,
    new Set(['version', 'xmlns:nmdd']),
    OPML_NAMESPACES_EXTENSION_KEY,
  );
  const rootAttributes = serializeExtensionAttributes(
    outline.extensions,
    new Set(['version', 'xmlns:nmdd']),
    OPML_ROOT_ATTRIBUTES_EXTENSION_KEY,
  );
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<opml version="2.0" xmlns:nmdd="${NMDD_OPML_NAMESPACE}"${namespaceAttributes}${rootAttributes}>`,
    '  <head>',
    `    <title>${escapeXml(outline.title)}</title>`,
    '  </head>',
    '  <body>',
  ];
  for (const sheet of outline.sheets) {
    const attributes = serializeExtensionAttributes(
      sheet.extensions,
      new Set(['nmdd:kind', 'text', 'title']),
    );
    lines.push(
      `    <outline text="${escapeXml(sheet.title)}" nmdd:kind="sheet"${attributes}>`,
    );
    for (const root of sheet.roots) serializeOutlineNode(root, 3, lines);
    lines.push('    </outline>');
  }
  lines.push('  </body>', '</opml>');
  return `${lines.join('\n')}\n`;
}

export function importMindMapFromOpml(
  source: string,
  options: MindMapImportOptions = {},
): MindMapImportResult {
  const inputBytes = utf8ByteLength(source);
  const limits = resolveMindMapImportLimits(options.limits);
  const report = new MindMapImportReportBuilder('opml-2.0', inputBytes);
  if (inputBytes > limits.maxInputBytes) {
    report.add({
      code: 'opml.input-limit',
      disposition: 'rejected',
      message: `OPML input exceeds the ${limits.maxInputBytes} byte limit.`,
      severity: 'error',
    });
    return { document: null, report: report.build(false) };
  }

  const root = parseSafeXmlDocument(
    source,
    { maxDepth: limits.maxDepth + 8, maxElements: limits.maxNodes * 4 + 64 },
    report,
  );
  if (!root) return { document: null, report: report.build(false) };
  if (root.name !== 'opml') {
    report.add({
      code: 'opml.invalid-root',
      disposition: 'rejected',
      message: 'The XML root element must be <opml>.',
      severity: 'error',
    });
    return { document: null, report: report.build(false) };
  }
  if (attributeValue(root, 'version') !== '2.0') {
    report.add({
      code: 'opml.unsupported-version',
      disposition: 'rejected',
      message: 'Only OPML 2.0 is supported.',
      path: '/opml/@version',
      severity: 'error',
    });
    return { document: null, report: report.build(false) };
  }

  const documentExtensions: ExtensionBag = {};
  const namespaces: OpmlExtensionAttribute[] = [];
  const rootAttributes: OpmlExtensionAttribute[] = [];
  for (const attribute of root.attributes) {
    if (attribute.name === 'version' || attribute.name === 'xmlns:nmdd') continue;
    if (EXTERNAL_ATTRIBUTE_NAMES.has(attribute.name.toLowerCase())) {
      report.add({
        code: 'opml.external-attribute-ignored',
        disposition: 'ignored',
        message: `External-link attribute ${attribute.name} was not imported.`,
        path: '/opml',
        severity: 'warning',
      });
      continue;
    }
    if (attribute.name.startsWith('xmlns:')) namespaces.push(attribute);
    else rootAttributes.push(attribute);
  }
  if (namespaces.length > 0) {
    documentExtensions[OPML_NAMESPACES_EXTENSION_KEY] = namespaces;
    report.add({
      code: 'opml.namespaces-preserved',
      count: namespaces.length,
      disposition: 'preserved',
      message: 'Unknown OPML namespace declarations were preserved.',
      path: '/opml',
      severity: 'info',
    });
  }
  if (rootAttributes.length > 0) {
    documentExtensions[OPML_ROOT_ATTRIBUTES_EXTENSION_KEY] = rootAttributes;
    report.add({
      code: 'opml.root-attributes-preserved',
      count: rootAttributes.length,
      disposition: 'preserved',
      message: 'Unknown OPML root attributes were preserved.',
      path: '/opml',
      severity: 'info',
    });
  }

  const heads = root.children.filter((child) => child.name === 'head');
  const bodies = root.children.filter((child) => child.name === 'body');
  if (bodies.length !== 1) {
    report.add({
      code: 'opml.body-count',
      disposition: 'rejected',
      message: 'OPML must contain exactly one body element.',
      path: '/opml',
      severity: 'error',
    });
    return { document: null, report: report.build(false) };
  }
  if (heads.length > 1) {
    report.add({
      code: 'opml.extra-head-ignored',
      count: heads.length - 1,
      disposition: 'ignored',
      message: 'Only the first OPML head element was used.',
      path: '/opml',
      severity: 'warning',
    });
  }
  if (heads[0]) reportIgnoredContainerAttributes(heads[0], '/opml/head', report);
  for (const child of root.children) {
    if (child.name !== 'head' && child.name !== 'body') {
      report.add({
        code: 'opml.root-element-ignored',
        disposition: 'ignored',
        message: `Unexpected <${child.name}> element was ignored.`,
        path: '/opml',
        severity: 'warning',
      });
    }
  }

  const titleElements = heads[0]?.children.filter((child) => child.name === 'title') ?? [];
  for (const child of heads[0]?.children ?? []) {
    if (child.name !== 'title') {
      report.add({
        code: 'opml.head-element-ignored',
        disposition: 'ignored',
        message: `Unsupported head element <${child.name}> was ignored.`,
        path: '/opml/head',
        severity: 'warning',
      });
    }
  }
  if (titleElements[0]) {
    reportIgnoredContainerAttributes(titleElements[0], '/opml/head/title', report);
    if (titleElements[0].children.length > 0) {
      report.add({
        code: 'opml.title-elements-ignored',
        count: titleElements[0].children.length,
        disposition: 'ignored',
        message: 'Nested elements inside the OPML title were ignored.',
        path: '/opml/head/title',
        severity: 'warning',
      });
    }
  }
  let documentTitle = titleElements[0]?.text.trim() ?? 'Imported OPML';
  if (titleElements.length > 1) {
    report.add({
      code: 'opml.extra-title-ignored',
      count: titleElements.length - 1,
      disposition: 'ignored',
      message: 'Only the first OPML title element was used.',
      path: '/opml/head',
      severity: 'warning',
    });
  }
  if (documentTitle === '') documentTitle = 'Imported OPML';

  const body = bodies[0];
  reportIgnoredContainerAttributes(body, '/opml/body', report);
  const topLevel = body.children.filter((child) => child.name === 'outline');
  for (const child of body.children) {
    if (child.name !== 'outline') {
      report.add({
        code: 'opml.body-element-ignored',
        disposition: 'ignored',
        message: `Non-outline body element <${child.name}> was ignored.`,
        path: '/opml/body',
        severity: 'warning',
      });
    }
  }
  if (topLevel.length === 0) {
    report.add({
      code: 'opml.no-outline',
      disposition: 'rejected',
      message: 'OPML body contains no outline elements.',
      path: '/opml/body',
      severity: 'error',
    });
    return { document: null, report: report.build(false) };
  }

  const state = { count: 0 };
  const sheets: NormalizedOutlineSheet[] = [];
  const ordinaryRoots: NormalizedOutlineNode[] = [];
  let wrapperIndex = 0;
  let ordinaryIndex = 0;
  for (const element of topLevel) {
    if (attributeValue(element, 'nmdd:kind') === 'sheet') {
      wrapperIndex += 1;
      const roots: NormalizedOutlineNode[] = [];
      let childIndex = 0;
      for (const child of element.children) {
        if (child.name !== 'outline') {
          report.add({
            code: 'opml.sheet-element-ignored',
            disposition: 'ignored',
            message: `Non-outline sheet element <${child.name}> was ignored.`,
            path: `/opml/body/sheet[${wrapperIndex}]`,
            severity: 'warning',
          });
          continue;
        }
        childIndex += 1;
        const converted = convertOutlineElement(
          child,
          `/opml/body/sheet[${wrapperIndex}]/outline[${childIndex}]`,
          0,
          state,
          options,
          report,
        );
        if (!converted) return { document: null, report: report.build(false) };
        roots.push(converted);
      }
      const sheetExtensions = collectUnknownOutlineAttributes(
        element,
        `/opml/body/sheet[${wrapperIndex}]`,
        report,
        true,
      );
      sheets.push({
        ...(sheetExtensions === undefined ? {} : { extensions: sheetExtensions }),
        roots,
        title: attributeValue(element, 'text') ?? attributeValue(element, 'title') ?? '',
      });
    } else {
      ordinaryIndex += 1;
      const converted = convertOutlineElement(
        element,
        `/opml/body/outline[${ordinaryIndex}]`,
        0,
        state,
        options,
        report,
      );
      if (!converted) return { document: null, report: report.build(false) };
      ordinaryRoots.push(converted);
    }
  }
  if (ordinaryRoots.length > 0) {
    if (sheets.length > 0) {
      report.add({
        code: 'opml.mixed-body-roots',
        disposition: 'degraded',
        message: 'Top-level outlines outside NMDD sheet wrappers were placed in an extra sheet.',
        path: '/opml/body',
        severity: 'warning',
      });
    }
    sheets.push({ roots: ordinaryRoots, title: sheets.length === 0 ? 'Sheet 1' : 'Imported OPML' });
  }

  const outline: NormalizedOutlineDocument = {
    ...(Object.keys(documentExtensions).length === 0
      ? {}
      : { extensions: documentExtensions }),
    sheets,
    title: documentTitle,
  };
  const document = buildCanonicalDocumentFromOutline(outline, options, report);
  return { document, report: report.build(document !== null && !report.hasErrors()) };
}
