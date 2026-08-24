import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  CheckSquare,
  ChevronDown,
  Code,
  Columns3,
  ExternalLink,
  Highlighter,
  Image,
  Italic,
  Link,
  List,
  ListOrdered,
  Palette,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Subscript,
  Superscript,
  Table,
  Trash2,
  Unlink,
  Underline,
  Undo2,
} from 'lucide-react';
import { openSafeDocumentUrl } from '../DocumentLinkInteractionExtension';
import { calculateAnchoredMenuPosition, type AnchoredMenuPosition } from './anchoredMenuPosition';

type MenuButtonProps = {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
};

const MenuButton = ({ label, onClick, active = false, disabled = false, className = '', children }: MenuButtonProps) => (
  <button
    type="button"
    aria-label={label}
    aria-pressed={active || undefined}
    title={label}
    disabled={disabled}
    className={`smart-document-icon-button ${className}`.trim()}
    data-active={active ? 'true' : 'false'}
    onMouseDown={(event) => event.preventDefault()}
    onClick={onClick}
  >
    {children}
  </button>
);

const BLOCK_TYPES = [
  { value: 'paragraph', label: '正文', shortLabel: '正文' },
  { value: 'h1', label: '一级标题', shortLabel: 'H1' },
  { value: 'h2', label: '二级标题', shortLabel: 'H2' },
  { value: 'h3', label: '三级标题', shortLabel: 'H3' },
  { value: 'quote', label: '引用', shortLabel: '引用' },
  { value: 'code', label: '代码块', shortLabel: '代码' },
] as const;

type BlockTypeValue = typeof BLOCK_TYPES[number]['value'];

const PORTAL_STYLE_VARIABLES = [
  '--smart-doc-font-sans',
  '--smart-doc-surface-raised',
  '--smart-doc-surface-hover',
  '--smart-doc-text',
  '--smart-doc-text-secondary',
  '--smart-doc-text-muted',
  '--smart-doc-border',
  '--smart-doc-accent',
  '--smart-doc-radius-sm',
  '--smart-doc-radius-md',
  '--smart-doc-shadow-menu',
  '--smart-doc-motion-fast',
  '--smart-doc-ease',
] as const;

const BlockTypeMenu = ({
  value,
  onChange,
}: {
  value: BlockTypeValue;
  onChange: (value: BlockTypeValue) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<AnchoredMenuPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const activeOption = BLOCK_TYPES.find((option) => option.value === value) || BLOCK_TYPES[0];

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const triggerStyle = window.getComputedStyle(trigger);
    PORTAL_STYLE_VARIABLES.forEach((property) => {
      menu.style.setProperty(property, triggerStyle.getPropertyValue(property));
    });
    const anchor = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    setPosition(calculateAnchoredMenuPosition({
      anchor,
      menuWidth: menuRect.width,
      menuHeight: menuRect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    }));
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    updatePosition();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePosition);
    if (menuRef.current) observer?.observe(menuRef.current);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const closeFromOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const closeFromEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeFromOutside);
    document.addEventListener('keydown', closeFromEscape);
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside);
      document.removeEventListener('keydown', closeFromEscape);
    };
  }, [open]);

  const menu = open && typeof document !== 'undefined' ? createPortal(
    <div
      ref={menuRef}
      className="smart-document-block-menu"
      data-side={position?.side || 'top'}
      role="listbox"
      aria-label="块类型"
      style={{
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        visibility: position ? 'visible' : 'hidden',
      }}
    >
      {BLOCK_TYPES.map((option) => (
        <button
          key={option.value}
          type="button"
          role="option"
          aria-selected={option.value === value}
          data-active={option.value === value ? 'true' : 'false'}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onChange(option.value);
            setOpen(false);
          }}
        >
          <span className="smart-document-block-menu__shortcut" aria-hidden="true">{option.shortLabel}</span>
          <span>{option.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  ) : null;

  return (
    <div className="smart-document-block-picker">
      <button
        ref={triggerRef}
        type="button"
        className="smart-document-block-picker__trigger"
        aria-label="当前块类型"
        aria-haspopup="listbox"
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{activeOption.label}</span>
        <ChevronDown aria-hidden="true" />
      </button>
      {menu}
    </div>
  );
};

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
}) => {
  const formatState = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      underline: current.isActive('underline'),
      strike: current.isActive('strike'),
      code: current.isActive('code'),
      link: current.isActive('link'),
      linkHref: String(current.getAttributes('link').href || ''),
      subscript: current.isActive('subscript'),
      superscript: current.isActive('superscript'),
    }),
  });

  return <BubbleMenu
    editor={editor}
    pluginKey="smartDocumentSelectionMenu"
    updateDelay={80}
    shouldShow={({ from, to, editor: currentEditor }) => from !== to && !currentEditor.isActive('codeBlock')}
    options={{ placement: 'top', offset: 8, flip: true, shift: { padding: 8 }, inline: true }}
    className="smart-document-bubble-menu"
    role="toolbar"
    aria-label="文字格式"
  >
    <MenuButton label="粗体 (Ctrl+B)" active={formatState.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
      <Bold />
    </MenuButton>
    <MenuButton label="斜体 (Ctrl+I)" active={formatState.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
      <Italic />
    </MenuButton>
    <MenuButton label="下划线 (Ctrl+U)" active={formatState.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}>
      <Underline />
    </MenuButton>
    <MenuButton label="删除线" active={formatState.strike} onClick={() => editor.chain().focus().toggleStrike().run()}>
      <Strikethrough />
    </MenuButton>
    <MenuButton label="行内代码" active={formatState.code} onClick={() => editor.chain().focus().toggleCode().run()}>
      <Code />
    </MenuButton>
    <span className="smart-document-toolbar-separator" aria-hidden="true" />
    {formatState.link ? (
      <MenuButton
        label="打开链接（Ctrl/Cmd+单击可直接打开）"
        className="smart-document-link-open-button"
        onClick={() => openSafeDocumentUrl(formatState.linkHref)}
      >
        <ExternalLink />
        <span>打开</span>
      </MenuButton>
    ) : null}
    <MenuButton label={formatState.link ? '编辑链接' : '添加链接'} active={formatState.link} onClick={onSetLink}>
      <Link />
    </MenuButton>
    {formatState.link ? (
      <MenuButton label="移除链接" onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}>
        <Unlink />
      </MenuButton>
    ) : null}
    <MenuButton label="下标" active={formatState.subscript} onClick={() => editor.chain().focus().toggleSubscript().run()}>
      <Subscript />
    </MenuButton>
    <MenuButton label="上标" active={formatState.superscript} onClick={() => editor.chain().focus().toggleSuperscript().run()}>
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
  </BubbleMenu>;
};

export const EditorTableMenu = ({ editor }: { editor: Editor }) => {
  const tableState = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      active: current.isActive('table'),
      addColumnBefore: current.can().addColumnBefore(),
      addColumnAfter: current.can().addColumnAfter(),
      addRowBefore: current.can().addRowBefore(),
      addRowAfter: current.can().addRowAfter(),
      mergeCells: current.can().mergeCells(),
      splitCell: current.can().splitCell(),
      deleteColumn: current.can().deleteColumn(),
      deleteRow: current.can().deleteRow(),
      deleteTable: current.can().deleteTable(),
    }),
  });
  if (!tableState.active) return null;

  return (
    <div className="smart-document-context-menu smart-document-table-menu" role="toolbar" aria-label="表格操作">
      <MenuButton label="左侧添加列" disabled={!tableState.addColumnBefore} onClick={() => editor.chain().focus().addColumnBefore().run()}><Columns3 /></MenuButton>
      <MenuButton label="右侧添加列" disabled={!tableState.addColumnAfter} onClick={() => editor.chain().focus().addColumnAfter().run()}><Columns3 /></MenuButton>
      <MenuButton label="上方添加行" disabled={!tableState.addRowBefore} onClick={() => editor.chain().focus().addRowBefore().run()}><Table /></MenuButton>
      <MenuButton label="下方添加行" disabled={!tableState.addRowAfter} onClick={() => editor.chain().focus().addRowAfter().run()}><Table /></MenuButton>
      <MenuButton label="合并单元格" disabled={!tableState.mergeCells} onClick={() => editor.chain().focus().mergeCells().run()}>合</MenuButton>
      <MenuButton label="拆分单元格" disabled={!tableState.splitCell} onClick={() => editor.chain().focus().splitCell().run()}>拆</MenuButton>
      <span className="smart-document-toolbar-separator" aria-hidden="true" />
      <MenuButton label="删除当前列" disabled={!tableState.deleteColumn} onClick={() => editor.chain().focus().deleteColumn().run()}><Trash2 /></MenuButton>
      <MenuButton label="删除当前行" disabled={!tableState.deleteRow} onClick={() => editor.chain().focus().deleteRow().run()}><Trash2 /></MenuButton>
      <MenuButton label="删除表格" disabled={!tableState.deleteTable} onClick={() => editor.chain().focus().deleteTable().run()}><Trash2 /></MenuButton>
    </div>
  );
};
export const EditorCompactToolbar = ({
  editor,
  onAddImage,
  onAddImageUrl,
  onAddWhiteboard,
}: {
  editor: Editor;
  onAddImage: () => void;
  onAddImageUrl: () => void;
  onAddWhiteboard: () => void;
}) => {
  const toolbarState = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      blockValue: current.isActive('heading', { level: 1 })
    ? 'h1'
    : current.isActive('heading', { level: 2 })
      ? 'h2'
      : current.isActive('heading', { level: 3 })
        ? 'h3'
        : current.isActive('codeBlock')
          ? 'code'
          : current.isActive('blockquote')
            ? 'quote'
            : 'paragraph',
      canUndo: current.can().undo(),
      canRedo: current.can().redo(),
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      underline: current.isActive('underline'),
      bulletList: current.isActive('bulletList'),
      orderedList: current.isActive('orderedList'),
      taskList: current.isActive('taskList'),
      alignLeft: current.isActive({ textAlign: 'left' }),
      alignCenter: current.isActive({ textAlign: 'center' }),
      alignRight: current.isActive({ textAlign: 'right' }),
    }),
  });
  const blockValue = toolbarState.blockValue as BlockTypeValue;

  const changeBlock = (value: BlockTypeValue) => {
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
        <MenuButton label="撤销 (Ctrl+Z)" disabled={!toolbarState.canUndo} onClick={() => editor.chain().focus().undo().run()}><Undo2 /></MenuButton>
        <MenuButton label="重做 (Ctrl+Shift+Z)" disabled={!toolbarState.canRedo} onClick={() => editor.chain().focus().redo().run()}><Redo2 /></MenuButton>
      </div>
      <span className="smart-document-toolbar-separator" aria-hidden="true" />
      <BlockTypeMenu value={blockValue} onChange={changeBlock} />
      <div className="smart-document-toolbar-group smart-document-toolbar-inline-actions">
        <MenuButton label="粗体" active={toolbarState.bold} onClick={() => editor.chain().focus().toggleBold().run()}><Bold /></MenuButton>
        <MenuButton label="斜体" active={toolbarState.italic} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic /></MenuButton>
        <MenuButton label="下划线" active={toolbarState.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}><Underline /></MenuButton>
      </div>
      <span className="smart-document-toolbar-separator" aria-hidden="true" />
      <div className="smart-document-toolbar-group">
        <MenuButton label="项目列表" active={toolbarState.bulletList} onClick={() => editor.chain().focus().toggleBulletList().run()}><List /></MenuButton>
        <MenuButton label="编号列表" active={toolbarState.orderedList} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered /></MenuButton>
        <MenuButton label="待办列表" active={toolbarState.taskList} onClick={() => editor.chain().focus().toggleTaskList().run()}><CheckSquare /></MenuButton>
      </div>
      <span className="smart-document-toolbar-spacer" />
      <div className="smart-document-toolbar-group">
        <MenuButton label="左对齐" active={toolbarState.alignLeft} onClick={() => editor.chain().focus().setTextAlign('left').run()}><AlignLeft /></MenuButton>
        <MenuButton label="居中" active={toolbarState.alignCenter} onClick={() => editor.chain().focus().setTextAlign('center').run()}><AlignCenter /></MenuButton>
        <MenuButton label="右对齐" active={toolbarState.alignRight} onClick={() => editor.chain().focus().setTextAlign('right').run()}><AlignRight /></MenuButton>
        <MenuButton label="插入表格" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table /></MenuButton>
        <MenuButton label="插入白板" onClick={onAddWhiteboard}><Palette /></MenuButton>
        <MenuButton label="上传图片" onClick={onAddImage}><Image /></MenuButton>
        <MenuButton label="通过网址插入图片" onClick={onAddImageUrl}><Link /></MenuButton>
      </div>
    </div>
  );
};
