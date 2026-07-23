import { Extension, type JSONContent } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import {
  Color,
  FontFamily,
  FontSize,
  TextStyle,
} from '@tiptap/extension-text-style';
import DOMPurify from 'dompurify';
import {
  Bold,
  Code2,
  Italic,
  IndentDecrease,
  IndentIncrease,
  List,
  ListOrdered,
  Palette,
  RemoveFormatting,
  Strikethrough,
  Underline,
  type LucideIcon,
} from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';

import type {
  Paragraph,
  RichInline,
  RichList,
  RichMark,
  RichText,
} from '../domain/types';

const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const HEX_COLOR = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FONT_FAMILY = /^[\p{L}\p{N}\s'",._-]{1,512}$/u;
const FONT_SIZE = /^(\d+(?:\.\d+)?)px$/i;
const TEXT_TRANSFORMS = new Set(['none', 'uppercase', 'lowercase', 'capitalize']);

const isSafeLinkHref = (href: string): boolean => {
  const candidate = href.trim();
  if (!candidate || /[\u0000-\u001f\u007f]/.test(candidate)) return false;
  const scheme = candidate.match(/^([a-z][a-z\d+.-]*):/i)?.[1];
  if (!scheme) return true;
  return SAFE_LINK_PROTOCOLS.has(`${scheme.toLowerCase()}:`);
};

const safeLinkHref = (href: string): string | undefined =>
  isSafeLinkHref(href) ? href.trim() : undefined;

const TextTransform = Extension.create({
  name: 'topicTextTransform',
  addGlobalAttributes() {
    return [{
      types: ['textStyle'],
      attributes: {
        textTransform: {
          default: null,
          parseHTML: (element: HTMLElement) => {
            const value = element.style.textTransform;
            return TEXT_TRANSFORMS.has(value) ? value : null;
          },
          renderHTML: (attributes: Record<string, unknown>) => {
            const value = attributes.textTransform;
            return typeof value === 'string' && TEXT_TRANSFORMS.has(value)
              ? { style: `text-transform: ${value}` }
              : {};
          },
        },
      },
    }];
  },
});

const editorExtensions = [
  StarterKit.configure({
    blockquote: false,
    codeBlock: false,
    heading: false,
    horizontalRule: false,
    link: {
      autolink: false,
      linkOnPaste: false,
      openOnClick: false,
      isAllowedUri: (url) => isSafeLinkHref(url),
      HTMLAttributes: {
        rel: 'noopener noreferrer nofollow',
        target: '_blank',
      },
    },
  }),
  TextStyle,
  Color,
  FontFamily,
  FontSize,
  TextTransform,
  TextAlign.configure({ types: ['paragraph'] }),
];

type EditorMark = NonNullable<JSONContent['marks']>[number];

const marksToTiptap = (marks: readonly RichMark[] | undefined): EditorMark[] | undefined => {
  if (!marks?.length) return undefined;
  const result: EditorMark[] = [];
  const basic = new Set<string>();
  const textStyle: Record<string, unknown> = {};
  let link: Extract<RichMark, { type: 'link' }> | undefined;

  marks.forEach((mark) => {
    switch (mark.type) {
      case 'bold':
      case 'italic':
      case 'underline':
      case 'strike':
      case 'code':
        basic.add(mark.type);
        break;
      case 'color':
        if (HEX_COLOR.test(mark.value)) textStyle.color = mark.value;
        break;
      case 'fontFamily':
        if (mark.value) textStyle.fontFamily = mark.value;
        break;
      case 'fontSize':
        if (Number.isFinite(mark.value) && mark.value > 0) {
          textStyle.fontSize = `${mark.value}px`;
        }
        break;
      case 'textTransform':
        textStyle.textTransform = mark.value;
        break;
      case 'link':
        if (mark.href.length > 0 && mark.href.length <= 16_384) link = mark;
        break;
    }
  });

  (['bold', 'italic', 'underline', 'strike', 'code'] as const).forEach((type) => {
    if (basic.has(type)) result.push({ type });
  });
  if (Object.keys(textStyle).length) result.push({ type: 'textStyle', attrs: textStyle });
  if (link) {
    result.push({
      type: 'link',
      attrs: {
        href: link.href,
        ...(link.title ? { title: link.title } : {}),
      },
    });
  }
  return result.length ? result : undefined;
};

const inlineToTiptap = (inline: RichInline): JSONContent | undefined => {
  if (inline.type === 'hardBreak') return { type: 'hardBreak' };
  if (!inline.text) return undefined;
  const marks = marksToTiptap(inline.marks);
  return {
    type: 'text',
    text: inline.text,
    ...(marks ? { marks } : {}),
  };
};

const paragraphToTiptap = (paragraph: Paragraph): JSONContent => {
  const content = paragraph.children
    .map(inlineToTiptap)
    .filter((inline): inline is JSONContent => inline !== undefined);
  return {
    type: 'paragraph',
    ...(paragraph.align ? { attrs: { textAlign: paragraph.align } } : {}),
    ...(content.length ? { content } : {}),
  };
};

const listToTiptap = (list: RichList): JSONContent => ({
  type: list.type,
  ...(list.type === 'orderedList' ? { attrs: { start: list.start ?? 1 } } : {}),
  content: list.items.map((item) => ({
    type: 'listItem',
    content: item.children.map((child) => (
      child.type === 'paragraph' ? paragraphToTiptap(child) : listToTiptap(child)
    )),
  })),
});

/** Convert canonical RichText into the deliberately smaller editor schema. */
export const richTextToEditorJson = (value: RichText): JSONContent => ({
  type: 'doc',
  content: value.blocks.length
    ? value.blocks.map((block) => (
      block.type === 'paragraph' ? paragraphToTiptap(block) : listToTiptap(block)
    ))
    : [{ type: 'paragraph' }],
});

const marksFromTiptap = (marks: readonly JSONContent[] | undefined): RichMark[] | undefined => {
  if (!marks?.length) return undefined;
  const basic = new Set<'bold' | 'italic' | 'underline' | 'strike' | 'code'>();
  const textStyles: RichMark[] = [];
  let link: Extract<RichMark, { type: 'link' }> | undefined;

  marks.forEach((mark) => {
    switch (mark.type) {
      case 'bold':
      case 'italic':
      case 'underline':
      case 'strike':
      case 'code':
        basic.add(mark.type);
        break;
      case 'textStyle': {
        const color = mark.attrs?.color;
        if (typeof color === 'string' && HEX_COLOR.test(color)) {
          textStyles.push({ type: 'color', value: color });
        }
        const fontFamily = mark.attrs?.fontFamily;
        if (typeof fontFamily === 'string' && fontFamily.length > 0 && fontFamily.length <= 512) {
          textStyles.push({ type: 'fontFamily', value: fontFamily });
        }
        const fontSize = mark.attrs?.fontSize;
        const match = typeof fontSize === 'string' ? fontSize.match(FONT_SIZE) : undefined;
        const numericSize = match ? Number(match[1]) : undefined;
        if (numericSize !== undefined && Number.isFinite(numericSize) && numericSize > 0 && numericSize <= 1000) {
          textStyles.push({ type: 'fontSize', value: numericSize });
        }
        const textTransform = mark.attrs?.textTransform;
        if (typeof textTransform === 'string' && TEXT_TRANSFORMS.has(textTransform)) {
          textStyles.push({
            type: 'textTransform',
            value: textTransform as Extract<RichMark, { type: 'textTransform' }>['value'],
          });
        }
        break;
      }
      case 'link': {
        const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : undefined;
        if (href && href.length <= 16_384) {
          const title = typeof mark.attrs?.title === 'string'
            ? mark.attrs.title.slice(0, 4096)
            : undefined;
          link = { type: 'link', href, ...(title ? { title } : {}) };
        }
        break;
      }
    }
  });
  const result: RichMark[] = [];
  (['bold', 'italic', 'underline', 'strike', 'code'] as const).forEach((type) => {
    if (basic.has(type)) result.push({ type });
  });
  result.push(...textStyles);
  if (link) result.push(link);
  return result.length ? result : undefined;
};

const paragraphFromTiptap = (node: JSONContent): Paragraph => {
  const children: RichInline[] = [];
  node.content?.forEach((inline) => {
    if (inline.type === 'hardBreak') {
      children.push({ type: 'hardBreak' });
      return;
    }
    if (inline.type !== 'text' || typeof inline.text !== 'string') return;
    const marks = marksFromTiptap(inline.marks);
    children.push({ type: 'text', text: inline.text, ...(marks ? { marks } : {}) });
  });
  const align = node.attrs?.textAlign;
  return {
    type: 'paragraph',
    ...(align === 'left' || align === 'center' || align === 'right' ? { align } : {}),
    children,
  };
};

const listFromTiptap = (node: JSONContent): RichList | undefined => {
  if (node.type !== 'bulletList' && node.type !== 'orderedList') return undefined;
  const items: RichList['items'] = [];
  (node.content ?? []).forEach((item) => {
    if (item.type !== 'listItem') return;
    const children: RichList['items'][number]['children'] = [];
    (item.content ?? []).forEach((child) => {
      if (child.type === 'paragraph') {
        children.push(paragraphFromTiptap(child));
        return;
      }
      const nested = listFromTiptap(child);
      if (nested) children.push(nested);
    });
    if (!children.length) children.push({ type: 'paragraph', children: [] });
    items.push({ type: 'listItem', children });
  });
  if (!items.length) return undefined;
  const start = node.type === 'orderedList' && Number.isInteger(node.attrs?.start)
    ? Number(node.attrs?.start)
    : undefined;
  return {
    type: node.type,
    ...(node.type === 'orderedList' && start !== undefined && start !== 1 ? { start } : {}),
    items,
  };
};

/** Convert editor JSON back into complete canonical RichText, dropping unknown nodes/marks. */
export const editorJsonToRichText = (json: JSONContent): RichText => {
  const blocks: RichText['blocks'] = [];
  (json.content ?? []).forEach((node) => {
    if (node.type === 'paragraph') {
      blocks.push(paragraphFromTiptap(node));
      return;
    }
    const list = listFromTiptap(node);
    if (list) blocks.push(list);
  });
  return {
    type: 'doc',
    version: 1,
    blocks: blocks.length ? blocks : [{ type: 'paragraph', children: [] }],
  };
};

const unwrap = (element: Element): void => {
  element.replaceWith(...Array.from(element.childNodes));
};

const supportedStyleDeclarations = (style: string): ReadonlyMap<string, string> => {
  const declarations = new Map<string, string>();
  style.split(';').forEach((declaration) => {
    const separator = declaration.indexOf(':');
    if (separator < 1) return;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim();
    if (property && value) declarations.set(property, value);
  });
  return declarations;
};

/** The paste boundary accepts only structures and inline styles represented by RichText. */
export const sanitizeTopicRichTextHtml = (html: string): string => {
  const purified = String(DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p', 'br', 'ul', 'ol', 'li', 'span', 'a',
      'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'code',
    ],
    ALLOWED_ATTR: ['href', 'title', 'start', 'style'],
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'svg', 'form'],
    FORBID_CONTENTS: ['script', 'style', 'iframe', 'object', 'embed', 'svg'],
    KEEP_CONTENT: true,
  }));
  const template = document.createElement('template');
  template.innerHTML = purified;

  Array.from(template.content.querySelectorAll('*')).forEach((element) => {
    const tag = element.tagName.toLowerCase();
    const originalStyle = element.getAttribute('style') ?? '';
    const originalHref = element.getAttribute('href') ?? '';
    const originalTitle = element.getAttribute('title');
    const originalStart = element.getAttribute('start');
    Array.from(element.attributes).forEach((attribute) => element.removeAttribute(attribute.name));

    if (tag === 'a') {
      const href = safeLinkHref(originalHref);
      if (!href) {
        unwrap(element);
        return;
      }
      element.setAttribute('href', href);
      if (originalTitle) element.setAttribute('title', originalTitle.slice(0, 4096));
      element.setAttribute('rel', 'noopener noreferrer nofollow');
      element.setAttribute('target', '_blank');
      return;
    }

    if (tag === 'ol') {
      const start = Number(originalStart);
      if (Number.isInteger(start) && start >= 0 && start <= 1_000_000) {
        element.setAttribute('start', String(start));
      }
      return;
    }

    if (tag === 'span') {
      const declarations = supportedStyleDeclarations(originalStyle);
      const styles: string[] = [];
      const color = declarations.get('color') ?? '';
      if (HEX_COLOR.test(color)) styles.push(`color: ${color}`);
      const fontFamily = declarations.get('font-family') ?? '';
      if (FONT_FAMILY.test(fontFamily)) styles.push(`font-family: ${fontFamily}`);
      const fontSize = declarations.get('font-size') ?? '';
      const fontSizeMatch = fontSize.match(FONT_SIZE);
      if (fontSizeMatch) {
        const size = Number(fontSizeMatch[1]);
        if (size > 0 && size <= 1000) styles.push(`font-size: ${size}px`);
      }
      const textTransform = declarations.get('text-transform') ?? '';
      if (TEXT_TRANSFORMS.has(textTransform)) {
        styles.push(`text-transform: ${textTransform}`);
      }
      if (styles.length) element.setAttribute('style', styles.join('; '));
      else unwrap(element);
      return;
    }

    if (tag === 'p') {
      const textAlign = supportedStyleDeclarations(originalStyle).get('text-align');
      if (textAlign === 'left' || textAlign === 'center' || textAlign === 'right') {
        element.setAttribute('style', `text-align: ${textAlign}`);
      }
    }
  });
  return template.innerHTML;
};

const markStyle = (marks: readonly RichMark[] | undefined): CSSProperties => {
  const style: CSSProperties = {};
  marks?.forEach((mark) => {
    switch (mark.type) {
      case 'color':
        if (HEX_COLOR.test(mark.value)) style.color = mark.value;
        break;
      case 'fontFamily':
        style.fontFamily = mark.value;
        break;
      case 'fontSize':
        if (Number.isFinite(mark.value) && mark.value > 0) style.fontSize = mark.value;
        break;
      case 'textTransform':
        style.textTransform = mark.value;
        break;
    }
  });
  return style;
};

const renderMarkedText = (
  text: string,
  marks: readonly RichMark[] | undefined,
  key: string,
): ReactNode => {
  let content: ReactNode = text;
  const types = new Set(marks?.map((mark) => mark.type));
  if (types.has('code')) content = <code>{content}</code>;
  if (types.has('strike')) content = <s>{content}</s>;
  if (types.has('underline')) content = <u>{content}</u>;
  if (types.has('italic')) content = <em>{content}</em>;
  if (types.has('bold')) content = <strong>{content}</strong>;

  const style = markStyle(marks);
  if (Object.keys(style).length) content = <span style={style}>{content}</span>;
  const link = marks?.find((mark): mark is Extract<RichMark, { type: 'link' }> => mark.type === 'link');
  const href = link ? safeLinkHref(link.href) : undefined;
  if (href) {
    content = (
      <a
        href={href}
        title={link?.title}
        target="_blank"
        rel="noopener noreferrer nofollow"
        onClick={(event) => event.stopPropagation()}
      >
        {content}
      </a>
    );
  } else if (link) {
    content = <span data-unsafe-link="true">{content}</span>;
  }
  return <span key={key}>{content}</span>;
};

const renderInline = (inline: RichInline, key: string): ReactNode =>
  inline.type === 'hardBreak'
    ? <br key={key} />
    : renderMarkedText(inline.text, inline.marks, key);

const renderParagraph = (paragraph: Paragraph, key: string): ReactNode => (
  <p key={key} style={paragraph.align ? { textAlign: paragraph.align } : undefined}>
    {paragraph.children.length
      ? paragraph.children.map((inline, index) => renderInline(inline, `${key}:i${index}`))
      : <br aria-hidden="true" />}
  </p>
);

const renderList = (list: RichList, key: string): ReactNode => {
  const children = list.items.map((item, itemIndex) => (
    <li key={`${key}:li${itemIndex}`}>
      {item.children.map((child, childIndex) => (
        child.type === 'paragraph'
          ? renderParagraph(child, `${key}:li${itemIndex}:p${childIndex}`)
          : renderList(child, `${key}:li${itemIndex}:l${childIndex}`)
      ))}
    </li>
  ));
  return list.type === 'orderedList'
    ? <ol key={key} start={list.start}>{children}</ol>
    : <ul key={key}>{children}</ul>;
};

export interface TopicRichTextDisplayProps {
  readonly value: RichText;
  readonly ariaLabel?: string;
  readonly className?: string;
}

/** Renderer for canonical topic text; it never interprets the value as HTML. */
export const TopicRichTextDisplay = ({
  value,
  ariaLabel = '主题文本',
  className,
}: TopicRichTextDisplayProps) => (
  <div
    role="document"
    aria-label={ariaLabel}
    className={`topic-rich-text whitespace-pre-wrap break-words [&_a]:text-blue-600 [&_a]:underline [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:m-0 [&_ul]:list-disc [&_ul]:pl-5${className ? ` ${className}` : ''}`}
    data-topic-rich-text="display"
  >
    {value.blocks.map((block, index) => (
      block.type === 'paragraph'
        ? renderParagraph(block, `p${index}`)
        : renderList(block, `l${index}`)
    ))}
  </div>
);

interface FormatButtonProps {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly active: boolean;
  onActivate(): void;
}

const FormatButton = ({ label, icon: Icon, active, onActivate }: FormatButtonProps) => (
  <button
    type="button"
    className={`inline-flex h-7 w-7 items-center justify-center rounded border text-slate-600 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-400 ${active ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white'}`}
    aria-label={label}
    aria-pressed={active}
    title={label}
    onMouseDown={(event) => {
      event.preventDefault();
      event.stopPropagation();
    }}
    onClick={(event) => {
      event.stopPropagation();
      onActivate();
    }}
  >
    <Icon size={14} aria-hidden="true" />
  </button>
);

const EDITOR_COLORS = ['#111827', '#DC2626', '#2563EB', '#059669', '#7C3AED'] as const;

export interface TopicRichTextEditorProps {
  readonly initialValue: RichText;
  readonly ariaLabel?: string;
  readonly className?: string;
  readonly autoFocus?: boolean;
  /** Topic titles commit on Enter; long-form Notes commit on Ctrl/Cmd+Enter. */
  readonly submitShortcut?: 'enter' | 'mod-enter';
  onCommit(value: RichText): void;
  onCancel(): void;
}

/** One editing session. Enter/blur commit and Escape cancels exactly once. */
export const TopicRichTextEditor = ({
  initialValue,
  ariaLabel = '编辑主题文本',
  className,
  autoFocus = true,
  submitShortcut = 'enter',
  onCommit,
  onCancel,
}: TopicRichTextEditorProps) => {
  const completedRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const savedSelectionRef = useRef<{ from: number; to: number } | undefined>();
  const onCommitRef = useRef(onCommit);
  const onCancelRef = useRef(onCancel);
  const [, setRevision] = useState(0);

  onCommitRef.current = onCommit;
  onCancelRef.current = onCancel;

  const finishCommit = (json: JSONContent): void => {
    if (completedRef.current) return;
    completedRef.current = true;
    onCommitRef.current(editorJsonToRichText(json));
  };
  const finishCancel = (): void => {
    if (completedRef.current) return;
    completedRef.current = true;
    onCancelRef.current();
  };

  const editor = useEditor({
    extensions: editorExtensions,
    content: richTextToEditorJson(initialValue),
    editorProps: {
      attributes: {
        class: 'min-h-8 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded border border-blue-400 bg-white px-2 py-1 text-sm text-slate-900 outline-none ring-2 ring-blue-100',
        role: 'textbox',
        'aria-label': ariaLabel,
        'aria-multiline': 'true',
        spellcheck: 'true',
      },
      transformPastedHTML: sanitizeTopicRichTextHtml,
      handleKeyDown: (view, event) => {
        const composing = event.isComposing || event.keyCode === 229;
        const submitOnEnter = submitShortcut === 'enter'
          && event.key === 'Enter'
          && !event.shiftKey;
        const submitOnModifier = submitShortcut === 'mod-enter'
          && event.key === 'Enter'
          && (event.ctrlKey || event.metaKey);
        if ((submitOnEnter || submitOnModifier) && !composing) {
          event.preventDefault();
          finishCommit(view.state.doc.toJSON());
          return true;
        }
        if (event.key === 'Escape' && !composing) {
          event.preventDefault();
          finishCancel();
          return true;
        }
        return false;
      },
    },
    onBlur: ({ editor: currentEditor, event }) => {
      if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return;
      finishCommit(currentEditor.getJSON());
    },
    onSelectionUpdate: () => setRevision((revision) => revision + 1),
    onTransaction: () => setRevision((revision) => revision + 1),
  }, [submitShortcut]);

  useEffect(() => {
    if (editor && autoFocus) editor.commands.focus('end');
  }, [autoFocus, editor]);

  if (!editor) return null;

  const toggle = (mark: 'bold' | 'italic' | 'underline' | 'strike' | 'code'): void => {
    const chain = editor.chain().focus();
    switch (mark) {
      case 'bold':
        chain.toggleBold().run();
        break;
      case 'italic':
        chain.toggleItalic().run();
        break;
      case 'underline':
        chain.toggleUnderline().run();
        break;
      case 'strike':
        chain.toggleStrike().run();
        break;
      case 'code':
        chain.toggleCode().run();
        break;
    }
  };

  const stopKeyboardPropagation = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    event.stopPropagation();
  };
  const stopMousePropagation = (event: ReactMouseEvent<HTMLDivElement>): void => {
    event.stopPropagation();
  };
  const commitWhenFocusLeaves = (event: ReactFocusEvent<HTMLDivElement>): void => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    finishCommit(editor.getJSON());
  };

  const activeColor = editor.getAttributes('textStyle').color;
  const colorInputValue = typeof activeColor === 'string' && HEX_COLOR.test(activeColor)
    ? activeColor.slice(0, 7)
    : '#111827';

  return (
    <div
      ref={rootRef}
      className={`nodrag nopan nowheel topic-rich-text-editor min-w-40${className ? ` ${className}` : ''}`}
      data-topic-rich-text="editor"
      onBlurCapture={commitWhenFocusLeaves}
      onKeyDown={stopKeyboardPropagation}
      onMouseDown={stopMousePropagation}
    >
      <div
        role="toolbar"
        aria-label="主题文本格式"
        className="mb-1 flex flex-wrap items-center gap-1 rounded border border-slate-200 bg-slate-50 p-1"
      >
        <FormatButton label="粗体" icon={Bold} active={editor.isActive('bold')} onActivate={() => toggle('bold')} />
        <FormatButton label="斜体" icon={Italic} active={editor.isActive('italic')} onActivate={() => toggle('italic')} />
        <FormatButton label="下划线" icon={Underline} active={editor.isActive('underline')} onActivate={() => toggle('underline')} />
        <FormatButton label="删除线" icon={Strikethrough} active={editor.isActive('strike')} onActivate={() => toggle('strike')} />
        <FormatButton label="行内代码" icon={Code2} active={editor.isActive('code')} onActivate={() => toggle('code')} />
        <span className="mx-0.5 h-5 w-px bg-slate-200" aria-hidden="true" />
        <FormatButton
          label="项目列表"
          icon={List}
          active={editor.isActive('bulletList')}
          onActivate={() => { editor.chain().focus().toggleBulletList().run(); }}
        />
        <FormatButton
          label="编号列表"
          icon={ListOrdered}
          active={editor.isActive('orderedList')}
          onActivate={() => { editor.chain().focus().toggleOrderedList().run(); }}
        />
        <FormatButton
          label="增加列表层级"
          icon={IndentIncrease}
          active={false}
          onActivate={() => { editor.chain().focus().sinkListItem('listItem').run(); }}
        />
        <FormatButton
          label="减少列表层级"
          icon={IndentDecrease}
          active={false}
          onActivate={() => { editor.chain().focus().liftListItem('listItem').run(); }}
        />
        <span className="mx-0.5 h-5 w-px bg-slate-200" aria-hidden="true" />
        <Palette size={14} className="text-slate-400" aria-hidden="true" />
        {EDITOR_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className="h-5 w-5 rounded-full border border-white outline outline-1 outline-slate-300 focus-visible:outline-2 focus-visible:outline-blue-500"
            style={{ backgroundColor: color }}
            aria-label={`文字颜色 ${color}`}
            aria-pressed={editor.isActive('textStyle', { color })}
            title={`文字颜色 ${color}`}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
              editor.chain().focus().setColor(color).run();
            }}
          />
        ))}
        <input
          type="color"
          className="h-6 w-7 cursor-pointer rounded border border-slate-200 bg-white p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          value={colorInputValue}
          aria-label="选择文字颜色"
          title="选择文字颜色"
          onMouseDown={(event) => {
            event.stopPropagation();
            savedSelectionRef.current = {
              from: editor.state.selection.from,
              to: editor.state.selection.to,
            };
          }}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => {
            const selection = savedSelectionRef.current ?? {
              from: editor.state.selection.from,
              to: editor.state.selection.to,
            };
            editor.chain()
              .focus()
              .setTextSelection(selection)
              .setColor(event.currentTarget.value.toUpperCase())
              .run();
          }}
        />
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-500 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-400"
          aria-label="清除文字颜色"
          title="清除文字颜色"
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            editor.chain().focus().unsetColor().run();
          }}
        >
          <RemoveFormatting size={14} aria-hidden="true" />
        </button>
      </div>
      <EditorContent editor={editor} />
      <p className="mt-1 text-[10px] leading-none text-slate-400" aria-hidden="true">
        {submitShortcut === 'enter'
          ? 'Enter 提交 · Shift+Enter 换行 · Esc 取消'
          : 'Ctrl/Cmd+Enter 提交 · Enter 换段 · Esc 取消'}
      </p>
    </div>
  );
};

export interface TopicRichTextProps extends TopicRichTextDisplayProps {
  readonly editing?: boolean;
  readonly autoFocus?: boolean;
  onCommit?(value: RichText): void;
  onCancel?(): void;
}

/** Convenience facade that keeps display and editing APIs on one component. */
export const TopicRichText = ({
  value,
  editing = false,
  ariaLabel,
  className,
  autoFocus,
  onCommit,
  onCancel,
}: TopicRichTextProps) => {
  if (!editing) {
    return <TopicRichTextDisplay value={value} ariaLabel={ariaLabel} className={className} />;
  }
  return (
    <TopicRichTextEditor
      initialValue={value}
      ariaLabel={ariaLabel}
      className={className}
      autoFocus={autoFocus}
      onCommit={onCommit ?? (() => undefined)}
      onCancel={onCancel ?? (() => undefined)}
    />
  );
};
