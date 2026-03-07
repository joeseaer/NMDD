import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

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

const turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
turndownService.use(gfm);

const encoded = encodeURIComponent(JSON.stringify({ nodes: [{ id: 'root', type: 'mindMap', data: { label: '中心主题' }, position: { x: 0, y: 0 } }], edges: [] }));
const html = `<p>Hello</p><div data-type="mind-map" data-mindmap="${encoded}"></div><p>World</p>`;

const normalized = normalizeMindMapHtmlForTurndown(html);
const md = turndownService.turndown(normalized);

console.log(md);
console.log('hasFence', md.includes('```mindmap'));

