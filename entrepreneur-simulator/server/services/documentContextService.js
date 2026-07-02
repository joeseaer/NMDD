const dbService = require('./dbService');

const MAX_SNIPPET_LENGTH = 900;
const MAX_PROMPT_BLOCK_LENGTH = 1200;

const containerTypes = new Set([
  'doc',
  'columnList',
  'column',
  'bulletList',
  'orderedList',
  'taskList',
  'listItem',
  'taskItem',
  'table',
  'tableRow',
  'tableCell',
  'tableHeader',
]);

const valueToText = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(valueToText).filter(Boolean).join(' ');
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([key, val]) => {
        const text = valueToText(val);
        return text ? `${key}: ${text}` : '';
      })
      .filter(Boolean)
      .join(' ');
  }
  return '';
};

const compactText = (value, maxLength = MAX_SNIPPET_LENGTH) => {
  const text = valueToText(value)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!maxLength || text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}...`;
};

const getNodeText = (node) => {
  if (!node || typeof node !== 'object') return '';
  if (node.type === 'text') return node.text || '';
  if (node.type === 'hardBreak') return '\n';
  const children = Array.isArray(node.content) ? node.content : [];
  return children.map(getNodeText).join(node.type === 'paragraph' ? '' : ' ');
};

const basenameFromUrl = (url) => {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    const parts = parsed.pathname.split('/').filter(Boolean);
    return decodeURIComponent(parts[parts.length - 1] || parsed.hostname || raw);
  } catch {
    const parts = raw.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || raw;
  }
};

const summarizeDatabase = (attrs) => {
  const name = attrs?.name || attrs?.title || 'Database';
  const properties = Array.isArray(attrs?.properties)
    ? attrs.properties.map((p) => `${p?.name || 'property'}:${p?.type || 'text'}`).slice(0, 12)
    : [];
  const views = Array.isArray(attrs?.views)
    ? attrs.views.map((v) => `${v?.name || 'view'}:${v?.mode || v?.type || 'table'}`).slice(0, 8)
    : [];
  const rows = Array.isArray(attrs?.rows) ? attrs.rows.length : 0;
  return compactText([
    `Database: ${name}`,
    properties.length ? `properties ${properties.join(', ')}` : '',
    views.length ? `views ${views.join(', ')}` : '',
    rows ? `${rows} rows` : '',
  ].filter(Boolean).join(' | '));
};

const summarizeNode = (node) => {
  const attrs = node?.attrs || {};
  const body = compactText(getNodeText(node), MAX_SNIPPET_LENGTH);

  switch (node?.type) {
    case 'heading':
      return compactText(`Heading ${attrs.level || 1}: ${body}`);
    case 'paragraph':
      return body;
    case 'blockquote':
      return compactText(`Quote: ${body}`);
    case 'codeBlock':
      return compactText(`Code: ${body}`);
    case 'horizontalRule':
      return 'Divider';
    case 'image':
      return compactText([
        `Image: ${attrs.caption || attrs.alt || basenameFromUrl(attrs.src) || attrs.src || ''}`,
        attrs.width ? `width ${attrs.width}` : '',
        attrs.align ? `align ${attrs.align}` : '',
        attrs.shape ? `shape ${attrs.shape}` : '',
        attrs.link ? `link ${attrs.link}` : '',
      ].filter(Boolean).join(' | '));
    case 'mediaBlock':
      return compactText([
        `${attrs.kind || 'file'} media: ${attrs.name || basenameFromUrl(attrs.url) || attrs.url || ''}`,
        attrs.mime || '',
        attrs.url || '',
      ].filter(Boolean).join(' | '));
    case 'toggleBlock':
      return compactText(`Toggle ${attrs.open === false ? '(closed)' : '(open)'}: ${attrs.title || ''} ${body}`);
    case 'calloutBlock':
      return compactText(`Callout ${attrs.icon || ''} ${attrs.tone || ''}: ${body}`);
    case 'bookmarkBlock':
      return compactText(`Bookmark: ${attrs.title || attrs.url || ''} ${attrs.description || ''} ${attrs.url || ''}`);
    case 'embedBlock':
      return compactText(`Embed: ${attrs.title || attrs.url || ''} ${attrs.url || ''}`);
    case 'templateButtonBlock':
      return compactText(`Template button: ${attrs.label || ''} ${attrs.templateTitle || ''} ${attrs.templateBody || ''} ${valueToText(attrs.templateContent)}`);
    case 'syncedBlock':
      return compactText(`Synced block ${attrs.syncId || ''}: ${body}`);
    case 'pageLinkBlock':
      return compactText(`Page link: ${attrs.title || attrs.pageTitle || attrs.pageId || ''}`);
    case 'equationBlock':
      return compactText(`Equation: ${attrs.formula || body}`);
    case 'mindMap':
      return compactText(`Mind map: ${body || attrs.markdown || attrs.data || ''}`);
    case 'databaseBlock':
      return summarizeDatabase(attrs);
    default:
      return body;
  }
};

const categoryToView = (category) => (String(category || '').toLowerCase() === 'note' ? 'notes' : 'sop');

const makeDocumentUrl = (doc, blockId) => {
  const view = categoryToView(doc.category);
  const base = `/notes?view=${encodeURIComponent(view)}&doc=${encodeURIComponent(doc.id)}`;
  return blockId ? `${base}#${encodeURIComponent(blockId)}` : base;
};

const pushBlock = (blocks, doc, node, text, heading, order) => {
  const clean = compactText(text);
  if (!clean) return;
  const attrs = node?.attrs || {};
  const blockId = attrs.blockId || attrs.id || null;
  blocks.push({
    id: `${doc.id}:${blockId || order}`,
    doc_id: doc.id,
    block_id: blockId,
    title: doc.title || 'Untitled',
    category: doc.category || 'note',
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    updated_at: doc.updated_at || doc.created_at || '',
    heading: heading || '',
    type: node?.type || 'markdown',
    text: clean,
    url: makeDocumentUrl(doc, blockId),
    order,
  });
};

const collectNodeBlocks = (node, doc, blocks, state) => {
  if (!node || typeof node !== 'object') return state;
  const type = node.type || 'unknown';
  const children = Array.isArray(node.content) ? node.content : [];

  if (type === 'heading') {
    const text = summarizeNode(node);
    const headingText = compactText(getNodeText(node), 160);
    pushBlock(blocks, doc, node, text, state.heading, state.nextOrder++);
    return { ...state, heading: headingText || state.heading };
  }

  if (containerTypes.has(type)) {
    let nextState = state;
    children.forEach((child) => {
      nextState = collectNodeBlocks(child, doc, blocks, nextState);
    });
    return nextState;
  }

  const summary = summarizeNode(node);
  pushBlock(blocks, doc, node, summary, state.heading, state.nextOrder++);
  return state;
};

const collectJsonBlocks = (doc) => {
  const json = doc?.content_json;
  if (!json || typeof json !== 'object' || json.type !== 'doc') return [];
  const blocks = [];
  let state = { heading: '', nextOrder: 0 };
  (Array.isArray(json.content) ? json.content : []).forEach((node) => {
    state = collectNodeBlocks(node, doc, blocks, state);
  });
  return blocks;
};

const collectMarkdownBlocks = (doc) => {
  const text = typeof doc?.content === 'string' ? doc.content : '';
  if (!text.trim()) return [];
  const blocks = [];
  let heading = '';
  let buffer = [];
  let order = 0;

  const flush = () => {
    const chunk = compactText(buffer.join('\n'));
    buffer = [];
    if (chunk) {
      pushBlock(blocks, doc, { type: 'markdown', attrs: {} }, chunk, heading, order++);
    }
  };

  text.split(/\r?\n/).forEach((line) => {
    const headingMatch = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (headingMatch) {
      flush();
      heading = compactText(headingMatch[2], 160);
      pushBlock(blocks, doc, { type: 'heading', attrs: {} }, `Heading ${headingMatch[1].length}: ${heading}`, '', order++);
      return;
    }
    if (!line.trim()) {
      flush();
      return;
    }
    buffer.push(line);
    if (buffer.join('\n').length > MAX_SNIPPET_LENGTH) flush();
  });
  flush();
  return blocks;
};

const tokenize = (value) => {
  const raw = compactText(value, 2000).toLowerCase();
  const tokens = new Set();
  const segments = raw.match(/[a-z0-9_]{2,}|[\u4e00-\u9fff]+/g) || [];
  segments.forEach((segment) => {
    if (!segment) return;
    tokens.add(segment);
    if (/^[\u4e00-\u9fff]+$/.test(segment)) {
      if (segment.length === 1) tokens.add(segment);
      for (let n = 2; n <= 3; n += 1) {
        for (let i = 0; i <= segment.length - n; i += 1) {
          tokens.add(segment.slice(i, i + n));
        }
      }
    }
  });
  return Array.from(tokens).filter((token) => token.length > 0);
};

const scoreBlock = (block, queryTokens, queryText) => {
  const haystack = compactText([
    block.title,
    block.category,
    block.tags.join(' '),
    block.heading,
    block.type,
    block.text,
  ].join('\n'), 5000).toLowerCase();
  const titleHaystack = compactText([block.title, block.tags.join(' '), block.heading].join(' '), 1000).toLowerCase();
  let score = 0;

  if (queryText && haystack.includes(queryText.toLowerCase())) score += 12;
  queryTokens.forEach((token) => {
    if (!token) return;
    if (haystack.includes(token)) score += token.length >= 2 ? 2 : 0.5;
    if (titleHaystack.includes(token)) score += 4;
  });

  if (String(block.category || '').toLowerCase() === 'sop') score += 0.4;
  score += Math.max(0, 1.5 - (block.order || 0) * 0.03);
  return score;
};

const buildDocumentCorpus = async (userId, options = {}) => {
  const docs = await dbService.getSOPs(userId, {
    domain: options.domain || 'life',
    researchType: options.researchType,
  });
  const documents = Array.isArray(docs) ? docs : [];
  const blocks = documents.flatMap((doc) => {
    const jsonBlocks = collectJsonBlocks(doc);
    if (jsonBlocks.length) return jsonBlocks;
    return collectMarkdownBlocks(doc);
  });
  return { documents, blocks };
};

const buildDecisionDocumentContext = async ({ userId, query, maxBlocks = 12, domain = 'life', researchType = null }) => {
  const { documents, blocks } = await buildDocumentCorpus(userId, { domain, researchType });
  const queryText = compactText(query, 500);
  const queryTokens = tokenize(queryText);

  const ranked = blocks
    .map((block) => ({ ...block, score: scoreBlock(block, queryTokens, queryText) }))
    .sort((a, b) => b.score - a.score || a.order - b.order);

  const positive = ranked.filter((block) => block.score > 1.6);
  const selected = (positive.length ? positive : ranked).slice(0, maxBlocks);

  const references = selected.map((block, index) => ({
    ref_id: `D${index + 1}`,
    doc_id: block.doc_id,
    block_id: block.block_id,
    title: block.title,
    category: block.category,
    heading: block.heading,
    type: block.type,
    updated_at: block.updated_at,
    snippet: compactText(block.text, 360),
    url: block.url,
    score: Number(block.score.toFixed(2)),
  }));

  const promptText = selected.length
    ? [
        `User document memory (${domain || 'life'}): ${documents.length} documents, ${blocks.length} searchable blocks, ${selected.length} selected blocks.`,
        'Use the following user-owned notes/SOP blocks as decision context. Prefer specific and recent user notes over generic advice. If a cited block is weakly related, say that it is only a light reference. When useful, cite references like [D1] in the answer.',
        ...references.map((ref, index) => {
          const block = selected[index];
          return [
            `[${ref.ref_id}] ${ref.title}${ref.heading ? ` > ${ref.heading}` : ''}`,
            `Category: ${ref.category}; Type: ${ref.type}; Updated: ${ref.updated_at || ''}; Link: ${ref.url}`,
            `Content: ${compactText(block.text, MAX_PROMPT_BLOCK_LENGTH)}`,
          ].join('\n');
        }),
      ].join('\n\n')
    : `User document memory (${domain || 'life'}): ${documents.length} documents, ${blocks.length} searchable blocks, no usable text blocks selected.`;

  return {
    corpus: {
      domain: domain || 'life',
      research_type: researchType || null,
      document_count: documents.length,
      block_count: blocks.length,
      selected_count: selected.length,
    },
    promptText,
    references,
    related_sops: Array.from(new Set(references.map((ref) => ref.title).filter(Boolean))),
  };
};

module.exports = {
  buildDecisionDocumentContext,
  buildDocumentCorpus,
  collectJsonBlocks,
  collectMarkdownBlocks,
};
