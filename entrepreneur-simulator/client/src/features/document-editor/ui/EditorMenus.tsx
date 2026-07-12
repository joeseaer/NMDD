import React from 'react';
import type { Editor } from '@tiptap/core';
import { BubbleMenu, FloatingMenu } from '@tiptap/react/menus';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  CheckSquare,
  Code,
  Columns3,
  Heading1,
  Heading2,
  Highlighter,
  Image,
  Italic,
  Link,
  List,
  ListOrdered,
  PanelLeft,
  Quote,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Subscript,
  Superscript,
  Table,
  Trash2,
  Underline,
  Undo2,
} from 'lucide-react';

type MenuButtonProps = {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
};

const MenuButton = ({ label, onClick, active = false, disabled = false, children }: MenuButtonProps) => (
  <button
    type="button"
    aria-label={label}
    aria-pressed={active || undefined}
    title={label}
    disabled={disabled}
    className="smart-document-icon-button"
    data-active={active ? 'true' : 'false'}
    onMouseDown={(event) => event.preventDefault()}
    onClick={onClick}
  >
    {children}
  </button>
);

const TEXT_COLORS = [
  { label: '默认文字', value: '' },
  { label: '灰色文字', value: '#6f6e69' },
  { label: '棕色文字', value: '#9f6b53' },
  { label: '红色文字', value: '#d44c47' },
  { label: '橙色文字', value: '#d9730d' },
  { label: '黄色文字', value: '#cb912f' },
  { label: '绿色文字', value: '#448361' },
  { label: '蓝色文字', value: '#337ea9' },
  { label: '紫色文字', value: '#9065b0' },
] as const;

const HIGHLIGHT_COLORS = [
  { label: '黄色高亮', value: '#fdecc8' },
  { label: '绿色高亮', value: '#dbeddb' },
  { label: '蓝色高亮', value: '#d3e5ef' },
  { label: '紫色高亮', value: '#e8deee' },
  { label: '红色高亮', value: '#ffe2dd' },
] as const;

export const EditorSelectionMenu = ({
  editor,
  onSetLink,
}: {
  editor: Editor;
  onSetLink: () => void;
}) => (
  <BubbleMenu
    editor={editor}
    pluginKey="smartDocumentSelectionMenu"
    updateDelay={80}
    shouldShow={({ from, to, editor: currentEditor }) => from !== to && !currentEditor.isActive('codeBlock')}
    options={{ placement: 'top', offset: 8, flip: true, shift: { padding: 8 }, inline: true }}
    className="smart-document-bubble-menu"
    role="toolbar"
    aria-label="文字格式"
  >
    <MenuButton label="粗体 (Ctrl+B)" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
      <Bold />
    </MenuButton>
    <MenuButton label="斜体 (Ctrl+I)" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
      <Italic />
    </MenuButton>
    <MenuButton label="下划线 (Ctrl+U)" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}>
      <Underline />
    </MenuButton>
    <MenuButton label="删除线" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}>
      <Strikethrough />
    </MenuButton>
    <MenuButton label="行内代码" active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}>
      <Code />
    </MenuButton>
    <span className="smart-document-toolbar-separator" aria-hidden="true" />
    <MenuButton label="添加或编辑链接" active={editor.isActive('link')} onClick={onSetLink}>
      <Link />
    </MenuButton>
    <MenuButton label="下标" active={editor.isActive('subscript')} onClick={() => editor.chain().focus().toggleSubscript().run()}>
      <Subscript />
    </MenuButton>
    <MenuButton label="上标" active={editor.isActive('superscript')} onClick={() => editor.chain().focus().toggleSuperscript().run()}>
      <Superscript />
    </MenuButton>
    <details className="smart-document-palette-menu">
      <summary aria-label="文字颜色" title="文字颜色"><span aria-hidden="true">A</span></summary>
      <div className="smart-document-palette-popover" role="group" aria-label="文字颜色">
        {TEXT_COLORS.map((color) => (
          <button
            type="button"
            key={color.label}
            title={color.label}
            aria-label={color.label}
            className="smart-document-color-swatch"
            style={{ color: color.value || 'var(--doc-text)' }}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => color.value
              ? editor.chain().focus().setColor(color.value).run()
              : editor.chain().focus().unsetColor().run()}
          >A</button>
        ))}
      </div>
    </details>
    <details className="smart-document-palette-menu">
      <summary aria-label="高亮颜色" title="高亮颜色"><Highlighter aria-hidden="true" /></summary>
      <div className="smart-document-palette-popover" role="group" aria-label="高亮颜色">
        {HIGHLIGHT_COLORS.map((color) => (
          <button
            type="button"
            key={color.value}
            title={color.label}
            aria-label={color.label}
            className="smart-document-color-swatch"
            style={{ backgroundColor: color.value }}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => editor.chain().focus().toggleHighlight({ color: color.value }).run()}
          />
        ))}
        <button
          type="button"
          className="smart-document-color-reset"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => editor.chain().focus().unsetHighlight().run()}
        >清除</button>
      </div>
    </details>
    <MenuButton label="清除文字格式" onClick={() => editor.chain().focus().unsetAllMarks().run()}>
      <RemoveFormatting />
    </MenuButton>
  </BubbleMenu>
);

export const EditorEmptyBlockMenu = ({ editor }: { editor: Editor }) => (
  <FloatingMenu
    editor={editor}
    pluginKey="smartDocumentEmptyBlockMenu"
    shouldShow={({ editor: currentEditor }) => (
      currentEditor.isEditable
      && currentEditor.isActive('paragraph')
      && currentEditor.state.selection.empty
      && currentEditor.state.selection.$from.parent.content.size === 0
    )}
    options={{ placement: 'left-start', offset: 10, flip: true, shift: { padding: 8 } }}
    className="smart-document-floating-menu"
    role="toolbar"
    aria-label="插入内容"
  >
    <MenuButton label="一级标题" onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 /></MenuButton>
    <MenuButton label="二级标题" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 /></MenuButton>
    <MenuButton label="项目列表" onClick={() => editor.chain().focus().toggleBulletList().run()}><List /></MenuButton>
    <MenuButton label="待办列表" onClick={() => editor.chain().focus().toggleTaskList().run()}><CheckSquare /></MenuButton>
    <MenuButton label="引用" onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote /></MenuButton>
    <MenuButton label="代码块" onClick={() => editor.chain().focus().toggleCodeBlock().run()}><Code /></MenuButton>
  </FloatingMenu>
);

export const EditorTableMenu = ({ editor }: { editor: Editor }) => {
  if (!editor.isActive('table')) return null;

  return (
    <div className="smart-document-context-menu smart-document-table-menu" role="toolbar" aria-label="表格操作">
      <MenuButton label="左侧添加列" disabled={!editor.can().addColumnBefore()} onClick={() => editor.chain().focus().addColumnBefore().run()}><Columns3 /></MenuButton>
      <MenuButton label="右侧添加列" disabled={!editor.can().addColumnAfter()} onClick={() => editor.chain().focus().addColumnAfter().run()}><Columns3 /></MenuButton>
      <MenuButton label="上方添加行" disabled={!editor.can().addRowBefore()} onClick={() => editor.chain().focus().addRowBefore().run()}><Table /></MenuButton>
      <MenuButton label="下方添加行" disabled={!editor.can().addRowAfter()} onClick={() => editor.chain().focus().addRowAfter().run()}><Table /></MenuButton>
      <MenuButton label="合并单元格" disabled={!editor.can().mergeCells()} onClick={() => editor.chain().focus().mergeCells().run()}>合</MenuButton>
      <MenuButton label="拆分单元格" disabled={!editor.can().splitCell()} onClick={() => editor.chain().focus().splitCell().run()}>拆</MenuButton>
      <span className="smart-document-toolbar-separator" aria-hidden="true" />
      <MenuButton label="删除当前列" disabled={!editor.can().deleteColumn()} onClick={() => editor.chain().focus().deleteColumn().run()}><Trash2 /></MenuButton>
      <MenuButton label="删除当前行" disabled={!editor.can().deleteRow()} onClick={() => editor.chain().focus().deleteRow().run()}><Trash2 /></MenuButton>
      <MenuButton label="删除表格" disabled={!editor.can().deleteTable()} onClick={() => editor.chain().focus().deleteTable().run()}><Trash2 /></MenuButton>
    </div>
  );
};
export const EditorCompactToolbar = ({
  editor,
  outlineOpen,
  onToggleOutline,
  onAddImage,
  onAddImageUrl,
}: {
  editor: Editor;
  outlineOpen: boolean;
  onToggleOutline: () => void;
  onAddImage: () => void;
  onAddImageUrl: () => void;
}) => {
  const blockValue = editor.isActive('heading', { level: 1 })
    ? 'h1'
    : editor.isActive('heading', { level: 2 })
      ? 'h2'
      : editor.isActive('heading', { level: 3 })
        ? 'h3'
        : editor.isActive('codeBlock')
          ? 'code'
          : editor.isActive('blockquote')
            ? 'quote'
            : 'paragraph';

  const changeBlock = (value: string) => {
    const chain = editor.chain().focus();
    if (value === 'h1') chain.setHeading({ level: 1 }).run();
    else if (value === 'h2') chain.setHeading({ level: 2 }).run();
    else if (value === 'h3') chain.setHeading({ level: 3 }).run();
    else if (value === 'code') chain.setCodeBlock().run();
    else if (value === 'quote') chain.setBlockquote().run();
    else chain.setParagraph().run();
  };

  return (
    <div className="smart-document-toolbar" role="toolbar" aria-label="文档工具栏">
      <div className="smart-document-toolbar-group">
        <MenuButton label={outlineOpen ? '隐藏大纲' : '显示大纲'} active={outlineOpen} onClick={onToggleOutline}><PanelLeft /></MenuButton>
        <MenuButton label="撤销 (Ctrl+Z)" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}><Undo2 /></MenuButton>
        <MenuButton label="重做 (Ctrl+Shift+Z)" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}><Redo2 /></MenuButton>
      </div>
      <span className="smart-document-toolbar-separator" aria-hidden="true" />
      <label className="smart-document-block-select-label">
        <span className="sr-only">当前块类型</span>
        <select className="smart-document-block-select" value={blockValue} onChange={(event) => changeBlock(event.target.value)}>
          <option value="paragraph">正文</option>
          <option value="h1">一级标题</option>
          <option value="h2">二级标题</option>
          <option value="h3">三级标题</option>
          <option value="quote">引用</option>
          <option value="code">代码块</option>
        </select>
      </label>
      <div className="smart-document-toolbar-group smart-document-toolbar-inline-actions">
        <MenuButton label="粗体" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold /></MenuButton>
        <MenuButton label="斜体" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic /></MenuButton>
        <MenuButton label="下划线" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}><Underline /></MenuButton>
      </div>
      <span className="smart-document-toolbar-separator" aria-hidden="true" />
      <div className="smart-document-toolbar-group">
        <MenuButton label="项目列表" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List /></MenuButton>
        <MenuButton label="编号列表" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered /></MenuButton>
        <MenuButton label="待办列表" active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()}><CheckSquare /></MenuButton>
      </div>
      <span className="smart-document-toolbar-spacer" />
      <div className="smart-document-toolbar-group">
        <MenuButton label="左对齐" active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()}><AlignLeft /></MenuButton>
        <MenuButton label="居中" active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()}><AlignCenter /></MenuButton>
        <MenuButton label="右对齐" active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()}><AlignRight /></MenuButton>
        <MenuButton label="插入表格" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table /></MenuButton>
        <MenuButton label="上传图片" onClick={onAddImage}><Image /></MenuButton>
        <MenuButton label="通过网址插入图片" onClick={onAddImageUrl}><Link /></MenuButton>
      </div>
    </div>
  );
};
