const test = require('node:test');
const assert = require('node:assert/strict');

const { collectJsonBlocks, compactText } = require('../services/documentContextService');

test('document context truncation never splits a grapheme cluster', () => {
  assert.equal(compactText('甲乙👩‍🔬丙丁', 4), '甲乙👩‍🔬...');
});

test('document context does not truncate text that only exceeds the UTF-16 code-unit limit', () => {
  const emojiText = '😀'.repeat(100);
  assert.equal(compactText(emojiText, 160), emojiText);
});

test('AI document context keeps inline equations and text carrying basic marks', () => {
  const blocks = collectJsonBlocks({
    id: 'doc-1',
    title: 'Marked document',
    category: 'note',
    tags: [],
    content_json: {
      type: 'doc',
      content: [{
        type: 'paragraph',
        attrs: { blockId: 'block-1' },
        content: [
          { type: 'text', text: 'Bold', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' highlighted', marks: [{ type: 'highlight', attrs: { color: '#fde68a' } }] },
          { type: 'text', text: ' and ' },
          { type: 'inlineEquation', attrs: { formula: 'E = mc^2' } },
          { type: 'text', text: ' linked', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
          { type: 'text', text: '.', marks: [{ type: 'underline' }, { type: 'textStyle', attrs: { color: '#334155' } }] },
        ],
      }],
    },
  });

  assert.equal(blocks.length, 1);
  assert.match(blocks[0].text, /Bold highlighted and E = mc\^2 linked\./);
  assert.equal(blocks[0].block_id, 'block-1');
});

test('a standalone inline equation remains searchable', () => {
  const blocks = collectJsonBlocks({
    id: 'doc-2',
    title: 'Equation',
    content_json: {
      type: 'doc',
      content: [{ type: 'inlineEquation', attrs: { latex: '\\alpha + \\beta' } }],
    },
  });

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'inlineEquation');
  assert.match(blocks[0].text, /alpha/);
  assert.match(blocks[0].text, /beta/);
});
