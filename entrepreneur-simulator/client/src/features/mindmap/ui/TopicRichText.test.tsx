import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { RichText } from '../domain/types';
import {
  editorJsonToRichText,
  richTableFromClipboardHtml,
  richTextToEditorJson,
  sanitizeTopicRichTextHtml,
  TopicRichText,
  TopicRichTextEditor,
} from './TopicRichText';

const paragraph = (text: string): RichText => ({
  type: 'doc',
  version: 1,
  blocks: [{
    type: 'paragraph',
    children: text ? [{ type: 'text', text }] : [],
  }],
});

const richFixture: RichText = {
  type: 'doc',
  version: 1,
  blocks: [
    {
      type: 'paragraph',
      align: 'center',
      children: [
        {
          type: 'text',
          text: '完整样式',
          marks: [
            { type: 'bold' },
            { type: 'italic' },
            { type: 'underline' },
            { type: 'strike' },
            { type: 'code' },
            { type: 'color', value: '#2563EB' },
            { type: 'fontFamily', value: 'Noto Sans CJK SC' },
            { type: 'fontSize', value: 18 },
            { type: 'textTransform', value: 'uppercase' },
            { type: 'link', href: 'https://example.com/path', title: '安全链接' },
          ],
        },
        { type: 'hardBreak' },
        {
          type: 'text',
          text: '危险链接',
          marks: [{ type: 'link', href: 'javascript:alert(1)' }],
        },
      ],
    },
    {
      type: 'orderedList',
      start: 3,
      items: [{
        type: 'listItem',
        children: [
          {
            type: 'paragraph',
            children: [{ type: 'text', text: '第三项' }],
          },
          {
            type: 'bulletList',
            items: [{
              type: 'listItem',
              children: [{
                type: 'paragraph',
                children: [{ type: 'text', text: '嵌套项' }],
              }],
            }],
          },
        ],
      }],
    },
  ],
};

beforeAll(() => {
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = () => new DOMRect();
  }
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () => ({
      length: 0,
      item: () => null,
      [Symbol.iterator]: function* iterator() { return; },
    }) as DOMRectList;
  }
  document.elementFromPoint = () => document.querySelector('[contenteditable="true"]');
});

afterEach(cleanup);

describe('TopicRichText canonical conversion and display', () => {
  it('ACC-SEM-015 round-trips every canonical block and supported mark without flattening', () => {
    expect(editorJsonToRichText(richTextToEditorJson(richFixture))).toEqual(richFixture);
  });

  it('ACC-SEM-015 renders paragraphs, hard breaks, nested lists, marks, and safe links', () => {
    const { container } = render(
      <TopicRichText value={richFixture} ariaLabel="主题富文本" />,
    );

    expect(screen.getByRole('document', { name: '主题富文本' })).toBeInTheDocument();
    expect(container.querySelector('p')).toHaveStyle({ textAlign: 'center' });
    expect(container.querySelector('strong em u s code')).toHaveTextContent('完整样式');
    const styled = screen.getByText('完整样式').closest('span[style]');
    expect(styled).toHaveStyle({
      color: '#2563EB',
      fontFamily: 'Noto Sans CJK SC',
      fontSize: '18px',
      textTransform: 'uppercase',
    });
    expect(screen.getByRole('link', { name: '完整样式' })).toHaveAttribute('href', 'https://example.com/path');
    expect(screen.getByRole('link', { name: '完整样式' })).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(screen.getByText('危险链接').closest('[data-unsafe-link]')).toHaveAttribute('data-unsafe-link', 'true');
    expect(container.querySelector('ol')).toHaveAttribute('start', '3');
    expect(container.querySelector('ol ul')).toHaveTextContent('嵌套项');
    expect(container.querySelectorAll('br')).toHaveLength(1);
  });

  it('round-trips and renders a portable table without flattening its cells', () => {
    const table: RichText = {
      type: 'doc',
      version: 1,
      blocks: [{
        type: 'table',
        rows: [
          { type: 'tableRow', cells: [
            { type: 'tableHeader', text: '负责人' },
            { type: 'tableHeader', text: '状态' },
          ] },
          { type: 'tableRow', cells: [
            { type: 'tableCell', text: '小王' },
            { type: 'tableCell', text: '进行中' },
          ] },
        ],
      }],
    };

    expect(editorJsonToRichText(richTextToEditorJson(table))).toEqual(table);
    const { container } = render(<TopicRichText value={table} ariaLabel="表格笔记" />);
    expect(screen.getByRole('document', { name: '表格笔记' })).toHaveTextContent('负责人');
    expect(container.querySelectorAll('table tr')).toHaveLength(2);
    expect(container.querySelector('th')).toHaveTextContent('负责人');
  });

  it('ACC-SEM-015/016 sanitizes unknown pasted HTML, unsafe URLs, attributes, and CSS', () => {
    const sanitized = sanitizeTopicRichTextHtml(`
      <h1 onclick="alert(1)">标题</h1>
      <p style="text-align: right; background-image: url(https://tracker.invalid/x)">
        <span style="color:#DC2626;font-size:17px;font-family:Inter;text-transform:capitalize;background:url(x)">安全样式</span>
        <a href="javascript:alert(1)" title="危险">危险</a>
        <a href="https://example.com" title="安全">安全</a>
        <img src=x onerror=alert(1)>
        <script>alert(1)</script>
      </p>
      <ol start="4"><li>项目</li></ol>
    `);

    expect(sanitized).toContain('标题');
    expect(sanitized).toContain('text-align: right');
    expect(sanitized).toContain('color: #DC2626');
    expect(sanitized).toContain('font-size: 17px');
    expect(sanitized).toContain('href="https://example.com"');
    expect(sanitized).toContain('<ol start="4">');
    expect(sanitized).not.toMatch(/javascript:|onclick|onerror|background|<script|<img|<h1/i);
    expect(sanitized).not.toContain('href=""');
  });

  it('converts a sanitized clipboard table into canonical note content', () => {
    expect(richTableFromClipboardHtml(`
      <table onclick="alert(1)"><thead><tr><th>负责人</th><th>状态</th></tr></thead>
      <tbody><tr><td><strong>小王</strong></td><td>进行中<script>alert(1)</script></td></tr></tbody></table>
    `)).toEqual({
      type: 'table',
      rows: [
        { type: 'tableRow', cells: [
          { type: 'tableHeader', text: '负责人' },
          { type: 'tableHeader', text: '状态' },
        ] },
        { type: 'tableRow', cells: [
          { type: 'tableCell', text: '小王' },
          { type: 'tableCell', text: '进行中' },
        ] },
      ],
    });
  });
});

describe('TopicRichTextEditor interaction contract', () => {
  it('supports CJK, Emoji, and Shift+Enter, then commits exactly once on Enter', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(
      <TopicRichTextEditor
        initialValue={paragraph('旧标题')}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );

    const editor = screen.getByRole('textbox', { name: '编辑主题文本' });
    await user.click(editor);
    await user.keyboard('{Control>}a{/Control}中文😀{Shift>}{Enter}{/Shift}第二行{Enter}');
    fireEvent.blur(editor);

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({
      type: 'doc',
      version: 1,
      blocks: [{
        type: 'paragraph',
        children: [
          { type: 'text', text: '中文😀' },
          { type: 'hardBreak' },
          { type: 'text', text: '第二行' },
        ],
      }],
    });
  });

  it('does not submit the Enter used by an active IME composition', () => {
    const onCommit = vi.fn();
    render(
      <TopicRichTextEditor
        initialValue={paragraph('拼音')}
        autoFocus={false}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    const editor = screen.getByRole('textbox');

    fireEvent.compositionStart(editor);
    fireEvent.keyDown(editor, { key: 'Enter', keyCode: 229, isComposing: true });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.compositionEnd(editor);
    fireEvent.blur(editor);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('ACC-SEM-015 keeps Enter for long-form Notes and commits on Ctrl+Enter', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(
      <TopicRichTextEditor
        initialValue={paragraph('')}
        submitShortcut="mod-enter"
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    const editor = screen.getByRole('textbox');
    await user.type(editor, '第一段{Enter}第二段');
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0].blocks).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: '第一段' }] },
      { type: 'paragraph', children: [{ type: 'text', text: '第二段' }] },
    ]);
  });

  it('exposes table insertion only when editing a long-form Note', () => {
    const { rerender } = render(
      <TopicRichTextEditor initialValue={paragraph('')} onCommit={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: '插入 3×3 表格' })).not.toBeInTheDocument();

    rerender(
      <TopicRichTextEditor
        initialValue={paragraph('')}
        allowTables
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: '插入 3×3 表格' })).toBeInTheDocument();
  });

  it('cancels exactly once on Escape and never commits on the following blur', () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(
      <TopicRichTextEditor
        initialValue={paragraph('取消')}
        autoFocus={false}
        onCommit={onCommit}
        onCancel={onCancel}
      />,
    );
    const editor = screen.getByRole('textbox');

    fireEvent.keyDown(editor, { key: 'Escape' });
    fireEvent.blur(editor);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('applies local formatting and returns canonical marks', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(
      <TopicRichTextEditor
        initialValue={paragraph('局部格式')}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    const editor = screen.getByRole('textbox');
    await user.click(editor);
    await user.keyboard('{Control>}a{/Control}');
    await user.click(screen.getByRole('button', { name: '粗体' }));
    await user.click(screen.getByRole('button', { name: '文字颜色 #DC2626' }));
    await user.keyboard('{Enter}');

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0].blocks[0]).toEqual({
      type: 'paragraph',
      children: [{
        type: 'text',
        text: '局部格式',
        marks: [
          { type: 'bold' },
          { type: 'color', value: '#DC2626' },
        ],
      }],
    });
  });
});
