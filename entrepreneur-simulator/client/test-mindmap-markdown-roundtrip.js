const TurndownService = require('turndown');
const { gfm } = require('turndown-plugin-gfm');
const MarkdownIt = require('markdown-it');

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

turndownService.addRule('keepMindMap', {
  filter: (node) => {
    return node.nodeName === 'DIV' && (node.getAttribute('data-type') === 'mind-map' || node.hasAttribute('data-mindmap'));
  },
  replacement: (_content, node) => {
    const el = node;
    const encoded = el.getAttribute('data-mindmap') || '';
    let jsonStr = '';
    try {
      jsonStr = decodeURIComponent(encoded);
    } catch {
      jsonStr = encoded;
    }
    return `\n\n\`\`\`mindmap\n${jsonStr}\n\`\`\`\n\n`;
  },
});

const encoded = encodeURIComponent(JSON.stringify({
  nodes: [{ id: 'root', type: 'mindMap', position: { x: 0, y: 0 }, data: { label: '中心主题' } }],
  edges: [],
}));

const html = `<p>Hello</p><div data-type="mind-map" data-mindmap="${encoded}"></div><p>World</p>`;

const markdown = turndownService.turndown(html);
const rendered = mdParser.render(markdown);

console.log('--- markdown ---');
console.log(markdown);
console.log('--- rendered ---');
console.log(rendered);
console.log('has data-mindmap in markdown', markdown.includes('data-mindmap'));
console.log('has mindmap fence in markdown', markdown.includes('```mindmap'));
console.log('has data-mindmap in rendered', rendered.includes('data-mindmap'));

