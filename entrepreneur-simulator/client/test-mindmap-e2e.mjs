import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import MarkdownIt from 'markdown-it';

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeMindMapHtmlForTurndown(html) {
  if (!html || !html.includes('data-type="mind-map"')) return html;
  return html.replace(
    /<div[^>]*data-type=("|')mind-map\1[^>]*data-mindmap=("|')([^"']*)\2[^>]*>(?:\s*<\/div>)?/g,
    (_m, _q1, _q2, encoded) => {
      let jsonStr = '';
      try {
        jsonStr = decodeURIComponent(encoded);
      } catch {
        jsonStr = encoded;
      }
      return `<pre><code class="language-mindmap">${escapeHtml(jsonStr)}</code></pre>`;
    }
  );
}

const mdParser = new MarkdownIt({ html: true });
const defaultFence = mdParser.renderer.rules.fence;
mdParser.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const info = (token.info || '').trim();
  if (info === 'mindmap') {
    const jsonStr = (token.content || '').trim();
    const encoded = encodeURIComponent(jsonStr);
    return `<div data-type="mind-map" data-mindmap="${encoded}"></div>`;
  }
  if (defaultFence) return defaultFence(tokens, idx, options, env, self);
  return self.renderToken(tokens, idx, options);
};

const turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
turndownService.use(gfm);

async function main() {
  const mindmapJson = JSON.stringify({
    nodes: [{ id: 'root', type: 'mindMap', data: { label: '中心主题' }, position: { x: 0, y: 0 } }],
    edges: [],
  });
  const encoded = encodeURIComponent(mindmapJson);
  const html = `<p>Hello</p><div data-type="mind-map" data-mindmap="${encoded}"></div><p>World</p>`;

  const markdown = turndownService.turndown(normalizeMindMapHtmlForTurndown(html));
  if (!markdown.includes('```mindmap')) throw new Error('markdown missing mindmap fence');

  const createRes = await fetch('http://localhost:3000/api/sop/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'MindMap E2E Save Test',
      category: 'note',
      content: markdown,
      user_id: 'user-1',
      version: 'V1.0',
      tags: [],
    }),
  });
  const created = await createRes.json();
  if (!created?.id) throw new Error('create missing id');

  const listRes = await fetch('http://localhost:3000/api/sop/user-1');
  const list = await listRes.json();
  const item = list.find((x) => x.id === created.id);
  if (!item) throw new Error('created item not found in list');
  if (!item.content.includes('```mindmap')) throw new Error('stored content missing mindmap fence');

  const rendered = mdParser.render(item.content);
  if (!rendered.includes('data-type="mind-map"')) throw new Error('rendered html missing mind-map div');
  if (!rendered.includes('data-mindmap="')) throw new Error('rendered html missing data-mindmap');

  console.log('OK', {
    id: created.id,
    mdLen: item.content.length,
    renderedLen: rendered.length,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

