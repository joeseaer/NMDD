import type { MindMapImportReportBuilder } from './report';

export interface SafeXmlAttribute {
  readonly name: string;
  readonly value: string;
}

export interface SafeXmlElement {
  readonly attributes: readonly SafeXmlAttribute[];
  readonly children: readonly SafeXmlElement[];
  readonly name: string;
  readonly text: string;
}

interface MutableXmlElement {
  attributes: SafeXmlAttribute[];
  children: MutableXmlElement[];
  name: string;
  text: string;
}

export interface SafeXmlParseLimits {
  readonly maxDepth: number;
  readonly maxElements: number;
}

const XML_NAME_START = /[A-Za-z_:]/;
const XML_NAME_CONTINUE = /[A-Za-z0-9_.:-]/;

function isXmlCodePoint(value: number): boolean {
  return value === 0x09
    || value === 0x0a
    || value === 0x0d
    || (value >= 0x20 && value <= 0xd7ff)
    || (value >= 0xe000 && value <= 0xfffd)
    || (value >= 0x10000 && value <= 0x10ffff);
}

function rejectXml(
  report: MindMapImportReportBuilder,
  code: string,
  message: string,
): null {
  report.add({
    code,
    disposition: 'rejected',
    message,
    severity: 'error',
  });
  return null;
}

function decodeXmlEntities(
  input: string,
  report: MindMapImportReportBuilder,
): string | null {
  let output = '';
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character !== '&') {
      const codePoint = input.codePointAt(index) ?? 0;
      if (!isXmlCodePoint(codePoint)) {
        rejectXml(report, 'xml.invalid-character', 'XML contains a forbidden character.');
        return null;
      }
      output += String.fromCodePoint(codePoint);
      if (codePoint > 0xffff) index += 1;
      continue;
    }

    const semicolon = input.indexOf(';', index + 1);
    if (semicolon < 0 || semicolon - index > 16) {
      rejectXml(report, 'xml.invalid-entity', 'XML contains an unterminated entity reference.');
      return null;
    }
    const entity = input.slice(index + 1, semicolon);
    const predefined: Readonly<Record<string, string>> = {
      amp: '&',
      apos: "'",
      gt: '>',
      lt: '<',
      quot: '"',
    };
    if (Object.prototype.hasOwnProperty.call(predefined, entity)) {
      output += predefined[entity];
      index = semicolon;
      continue;
    }

    let codePoint: number | undefined;
    if (/^#[0-9]+$/.test(entity)) codePoint = Number.parseInt(entity.slice(1), 10);
    else if (/^#x[0-9a-f]+$/i.test(entity)) codePoint = Number.parseInt(entity.slice(2), 16);
    if (codePoint === undefined || !isXmlCodePoint(codePoint)) {
      rejectXml(
        report,
        'xml.unknown-entity',
        `XML entity &${entity}; is not an allowed predefined or numeric entity.`,
      );
      return null;
    }
    output += String.fromCodePoint(codePoint);
    index = semicolon;
  }
  return output;
}

function readXmlName(value: string, start: number): { end: number; name: string } | null {
  if (!XML_NAME_START.test(value[start] ?? '')) return null;
  let end = start + 1;
  while (end < value.length && XML_NAME_CONTINUE.test(value[end])) end += 1;
  return { end, name: value.slice(start, end) };
}

function parseStartTag(
  raw: string,
  report: MindMapImportReportBuilder,
): { attributes: SafeXmlAttribute[]; name: string; selfClosing: boolean } | null {
  let value = raw.trim();
  let selfClosing = false;
  if (value.endsWith('/')) {
    selfClosing = true;
    value = value.slice(0, -1).trimEnd();
  }
  const elementName = readXmlName(value, 0);
  if (!elementName) return rejectXml(report, 'xml.invalid-name', 'XML element name is invalid.');

  let position = elementName.end;
  const attributes: SafeXmlAttribute[] = [];
  const names = new Set<string>();
  while (position < value.length) {
    while (/\s/.test(value[position] ?? '')) position += 1;
    if (position >= value.length) break;
    const attributeName = readXmlName(value, position);
    if (!attributeName) {
      return rejectXml(report, 'xml.invalid-attribute', 'XML attribute name is invalid.');
    }
    position = attributeName.end;
    while (/\s/.test(value[position] ?? '')) position += 1;
    if (value[position] !== '=') {
      return rejectXml(report, 'xml.invalid-attribute', 'XML attributes must use quoted values.');
    }
    position += 1;
    while (/\s/.test(value[position] ?? '')) position += 1;
    const quote = value[position];
    if (quote !== '"' && quote !== "'") {
      return rejectXml(report, 'xml.invalid-attribute', 'XML attributes must use quotes.');
    }
    position += 1;
    const valueStart = position;
    while (position < value.length && value[position] !== quote) {
      if (value[position] === '<') {
        return rejectXml(report, 'xml.invalid-attribute', 'XML attributes cannot contain raw <.');
      }
      position += 1;
    }
    if (position >= value.length) {
      return rejectXml(report, 'xml.invalid-attribute', 'XML attribute quote is not closed.');
    }
    if (names.has(attributeName.name)) {
      return rejectXml(report, 'xml.duplicate-attribute', 'XML contains a duplicate attribute.');
    }
    const decoded = decodeXmlEntities(value.slice(valueStart, position), report);
    if (decoded === null) return null;
    names.add(attributeName.name);
    attributes.push({ name: attributeName.name, value: decoded });
    position += 1;
  }
  return { attributes, name: elementName.name, selfClosing };
}

function findTagEnd(source: string, start: number): number {
  let quote: '"' | "'" | undefined;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = undefined;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index;
    }
  }
  return -1;
}

/**
 * Small non-validating XML scanner for OPML. It never resolves external
 * resources and rejects all declarations/entities outside XML's five built-ins.
 */
export function parseSafeXmlDocument(
  source: string,
  limits: SafeXmlParseLimits,
  report: MindMapImportReportBuilder,
): SafeXmlElement | null {
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(source)) {
    return rejectXml(
      report,
      'xml.dtd-entity-forbidden',
      'DOCTYPE and ENTITY declarations are forbidden.',
    );
  }

  let root: MutableXmlElement | undefined;
  const stack: MutableXmlElement[] = [];
  let elementCount = 0;
  let position = 0;

  const appendText = (raw: string): boolean => {
    if (raw.length === 0) return true;
    const decoded = decodeXmlEntities(raw, report);
    if (decoded === null) return false;
    const current = stack[stack.length - 1];
    if (!current) {
      if (/\S/.test(decoded)) {
        rejectXml(report, 'xml.text-outside-root', 'XML text appears outside the root element.');
        return false;
      }
      return true;
    }
    current.text += decoded;
    return true;
  };

  while (position < source.length) {
    const open = source.indexOf('<', position);
    if (open < 0) {
      if (!appendText(source.slice(position))) return null;
      position = source.length;
      break;
    }
    if (!appendText(source.slice(position, open))) return null;

    if (source.startsWith('<!--', open)) {
      const close = source.indexOf('-->', open + 4);
      if (close < 0) return rejectXml(report, 'xml.unclosed-comment', 'XML comment is not closed.');
      position = close + 3;
      continue;
    }
    if (source.startsWith('<?', open)) {
      const close = source.indexOf('?>', open + 2);
      if (close < 0) {
        return rejectXml(report, 'xml.unclosed-processing-instruction', 'XML processing instruction is not closed.');
      }
      const instruction = source.slice(open + 2, close).trim();
      if (!/^xml(?:\s|$)/i.test(instruction)) {
        report.add({
          code: 'xml.processing-instruction-ignored',
          disposition: 'ignored',
          message: 'A non-XML processing instruction was ignored.',
          severity: 'warning',
        });
      }
      position = close + 2;
      continue;
    }
    if (source.startsWith('<!', open)) {
      return rejectXml(
        report,
        'xml.declaration-forbidden',
        'XML declarations other than the XML prolog and comments are forbidden.',
      );
    }

    const close = findTagEnd(source, open + 1);
    if (close < 0) return rejectXml(report, 'xml.unclosed-tag', 'XML tag is not closed.');
    const rawTag = source.slice(open + 1, close);
    if (rawTag.startsWith('/')) {
      const closingName = rawTag.slice(1).trim();
      const parsedName = readXmlName(closingName, 0);
      if (!parsedName || parsedName.end !== closingName.length) {
        return rejectXml(report, 'xml.invalid-closing-tag', 'XML closing tag is invalid.');
      }
      const current = stack.pop();
      if (!current || current.name !== parsedName.name) {
        return rejectXml(report, 'xml.mismatched-tag', 'XML closing tag does not match.');
      }
      position = close + 1;
      continue;
    }

    const parsed = parseStartTag(rawTag, report);
    if (!parsed) return null;
    elementCount += 1;
    if (elementCount > limits.maxElements) {
      return rejectXml(report, 'xml.element-limit', 'XML contains too many elements.');
    }
    if (stack.length > limits.maxDepth) {
      return rejectXml(report, 'xml.depth-limit', 'XML nesting exceeds the configured limit.');
    }
    const element: MutableXmlElement = {
      attributes: parsed.attributes,
      children: [],
      name: parsed.name,
      text: '',
    };
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(element);
    else if (root) return rejectXml(report, 'xml.multiple-roots', 'XML must have one root element.');
    else root = element;
    if (!parsed.selfClosing) stack.push(element);
    position = close + 1;
  }

  if (stack.length > 0) return rejectXml(report, 'xml.unclosed-tag', 'XML contains an unclosed tag.');
  if (!root) return rejectXml(report, 'xml.no-root', 'XML has no root element.');
  return root;
}
