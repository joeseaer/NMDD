import React, { useState, useEffect, useCallback } from 'react';
import { 
  Bold, Italic, Type, Strikethrough, Quote, ListOrdered, List, CheckSquare, 
  Code, PanelLeft, Columns, Table as TableIcon, Image as ImageIcon, X, Network
} from 'lucide-react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableRow } from '@tiptap/extension-table-row';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import Heading from '@tiptap/extension-heading';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { DOMParser as ProseMirrorDOMParser } from 'prosemirror-model';
import MarkdownIt from 'markdown-it';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { api } from '../services/api';
import { ColumnList, Column, SlashCommand, getSuggestionItems, renderItems, Indent, MindMap } from './TiptapExtensions';

// --- Parsers ---

const mdParser = new MarkdownIt({ html: true });

const defaultFence = mdParser.renderer.rules.fence;
mdParser.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const info = (token.info || '').trim();
    if (info === 'mindmap' || info.startsWith('mindmap ')) {
        const jsonStr = (token.content || '').trim();
        const encoded = encodeURIComponent(jsonStr);
        return `<div data-type="mind-map" data-mindmap="${encoded}"></div>`;
    }
    if (defaultFence) return defaultFence(tokens, idx, options, env, self);
    return self.renderToken(tokens, idx, options);
};
const turndownService = new TurndownService({ 
    headingStyle: 'atx',
    codeBlockStyle: 'fenced'
});
turndownService.use(gfm);

function normalizeMindMapHtmlForTurndown(html: string) {
    if (!html || !html.includes('data-type="mind-map"')) return html;

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const mindmaps = Array.from(doc.querySelectorAll('div[data-type="mind-map"][data-mindmap]'));
        if (mindmaps.length === 0) return html;

        for (const el of mindmaps) {
            const encoded = el.getAttribute('data-mindmap') || '';
            let jsonStr = '';
            try {
                jsonStr = decodeURIComponent(encoded);
            } catch {
                jsonStr = encoded;
            }

            const pre = doc.createElement('pre');
            const code = doc.createElement('code');
            code.className = 'language-mindmap';
            code.textContent = jsonStr;
            pre.appendChild(code);
            el.replaceWith(pre);
        }

        return doc.body.innerHTML;
    } catch {
        return html;
    }
}

// Custom rule to keep column structure as HTML
turndownService.addRule('keepColumns', {
  filter: (node) => {
    const el: any = node as any;
    const nodeName = String(el.nodeName || el.tagName || '').toLowerCase();
    const getAttr = (name: string) => (typeof el.getAttribute === 'function' ? el.getAttribute(name) : null);
    return nodeName === 'div' && (
      getAttr('data-type') === 'column-list' ||
      getAttr('data-type') === 'column'
    );
  },
  replacement: (_content, node) => {
    return (node as HTMLElement).outerHTML;
  }
});

// Custom rule to keep mind map structure as HTML
turndownService.addRule('keepMindMap', {
  filter: (node) => {
    const el: any = node as any;
    const nodeName = String(el.nodeName || el.tagName || '').toLowerCase();
    const getAttr = (name: string) => (typeof el.getAttribute === 'function' ? el.getAttribute(name) : null);
    const hasAttr = (name: string) => (typeof el.hasAttribute === 'function' ? el.hasAttribute(name) : !!getAttr(name));
    return nodeName === 'div' && (getAttr('data-type') === 'mind-map' || hasAttr('data-mindmap'));
  },
  replacement: (_content, node) => {
    const el = node as HTMLElement;
    const encoded = el.getAttribute('data-mindmap') || '';
    let jsonStr = '';
    try {
        jsonStr = decodeURIComponent(encoded);
    } catch {
        jsonStr = encoded;
    }
    return `\n\n\`\`\`mindmap\n${jsonStr}\n\`\`\`\n\n`;
  }
});

// --- Custom Node Views ---
const ResizableImageComponent = (props: any) => {
    const { node, updateAttributes, selected } = props;
    const [width, setWidth] = useState(node.attrs.width || '100%');
    const [resizing, setResizing] = useState(false);
    
    // Simple drag resize handler
    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        setResizing(true);
        
        const startX = e.clientX;
        const startWidth = node.attrs.width ? parseInt(node.attrs.width) : (e.target as HTMLElement).parentElement?.offsetWidth || 300;
        
        const onMouseMove = (e: MouseEvent) => {
            const currentX = e.clientX;
            const diffX = currentX - startX;
            const newWidth = Math.max(100, startWidth + diffX);
            setWidth(`${newWidth}px`);
        };
        
        const onMouseUp = (e: MouseEvent) => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            setResizing(false);
            // Commit change
            const currentX = e.clientX;
            const diffX = currentX - startX;
            const newWidth = Math.max(100, startWidth + diffX);
            updateAttributes({ width: `${newWidth}px` });
        };
        
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };

    return (
        <NodeViewWrapper className="image-resizer-wrapper inline-block relative group" style={{ width: width, maxWidth: '100%' }}>
            <div className={`relative ${selected ? 'ring-2 ring-primary rounded-lg' : ''}`}>
                <img 
                    src={node.attrs.src} 
                    alt={node.attrs.alt}
                    className="rounded-lg w-full h-auto"
                />
                {/* Drag Handle */}
                <div 
                    className={`absolute bottom-2 right-2 w-4 h-4 bg-white border border-gray-300 rounded shadow-sm cursor-nwse-resize flex items-center justify-center transition-opacity ${selected || resizing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                    onMouseDown={handleMouseDown}
                >
                    <div className="w-2 h-2 border-r border-b border-gray-400"></div>
                </div>
                
                {/* Bubble Menu for Alignment (Simplified version) */}
                {selected && (
                    <div className="absolute top-2 right-2 bg-white rounded shadow-lg border border-gray-100 p-1 flex space-x-1">
                        <button 
                            className="p-1 hover:bg-gray-100 rounded"
                            onClick={() => updateAttributes({ width: '100%' })}
                            title="全宽"
                        >
                            <span className="text-xs font-bold px-1">100%</span>
                        </button>
                        <button 
                            className="p-1 hover:bg-gray-100 rounded"
                            onClick={() => updateAttributes({ width: '50%' })}
                            title="半宽"
                        >
                            <span className="text-xs font-bold px-1">50%</span>
                        </button>
                    </div>
                )}
            </div>
        </NodeViewWrapper>
    );
};

export const TiptapEditor = ({ content, onChange }: { content: string, onChange: (content: string) => void }) => {
    const [showTOC, setShowTOC] = useState(false);
    const mmSigRef = React.useRef<string>('');

    const uploadImage = useCallback(async (file: File) => {
        try {
            const { url } = await api.uploadImage(file);
            return url;
        } catch (error) {
            console.error('Failed to upload image', error);
            alert('图片上传失败，请重试');
            return null;
        }
    }, []);

    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                bulletList: {
                    keepMarks: true,
                    keepAttributes: false,
                },
                orderedList: {
                    keepMarks: true,
                    keepAttributes: false,
                },
            }),
            Link.configure({ openOnClick: false }),
            Image.extend({
                addAttributes() {
                    return {
                        ...this.parent?.(),
                        width: {
                            default: '100%',
                            renderHTML: attributes => ({
                                width: attributes.width,
                            }),
                        },
                    }
                },
                addNodeView() {
                    return ReactNodeViewRenderer(ResizableImageComponent);
                },
            }).configure({
                inline: true,
                allowBase64: true,
            }),
            Heading.configure({
                levels: [1, 2, 3, 4, 5, 6],
            }),
            TaskList,
            TaskItem.configure({ 
                nested: true,
                HTMLAttributes: {
                    class: 'flex items-start space-x-2',
                },
            }),
            Placeholder.configure({ placeholder: '开始输入内容... (输入 / 唤起命令菜单)' }),
            ColumnList,
            Column,
            SlashCommand.configure({
                suggestion: {
                    items: getSuggestionItems,
                    render: renderItems,
                },
            }),
            Indent,
            MindMap,
            Table.configure({
                resizable: true,
            }),
            TableRow,
            TableHeader,
            TableCell,
        ],
        content: mdParser.render(content), // Initial content: Markdown -> HTML
        editorProps: {
            attributes: {
                class: 'prose prose-sm max-w-none focus:outline-none min-h-[500px] p-8 outline-none [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:mb-4 [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:mb-3 [&_h2]:mt-6 [&_h3]:text-xl [&_h3]:font-bold [&_h3]:mb-2 [&_h3]:mt-4 [&_h4]:text-lg [&_h4]:font-bold [&_h4]:mb-2 [&_h5]:text-base [&_h5]:font-bold [&_h5]:mb-1 [&_h6]:text-sm [&_h6]:font-bold [&_h6]:text-gray-500 [&_li_p]:m-0 [&_ul[data-type="taskList"]]:list-none [&_ul[data-type="taskList"]]:pl-0 [&_img]:rounded-lg [&_img]:shadow-sm [&_img]:max-w-full [&_img]:my-4 [&_div[data-type="mind-map"]]:my-6',
            },
            handlePaste: (view, event, _slice) => {
                const text = event.clipboardData?.getData('text/plain');
                if (text) {
                     // Check for Markdown table syntax (Header row + Separator row)
                     if (/^\s*\|.*\|\s*\n\s*\|[-:| ]+\|\s*/m.test(text)) {
                         const html = mdParser.render(text);
                         const parser = new DOMParser();
                         const doc = parser.parseFromString(html, 'text/html');
                         const pmParser = ProseMirrorDOMParser.fromSchema(view.state.schema);
                         const slice = pmParser.parseSlice(doc.body);
                         const transaction = view.state.tr.replaceSelection(slice);
                         view.dispatch(transaction);
                         return true;
                     }
                }

                const items = Array.from(event.clipboardData?.items || []);
                const item = items.find(item => item.type.indexOf('image') === 0);

                if (item) {
                    event.preventDefault();
                    const file = item.getAsFile();
                    if (file) {
                        uploadImage(file).then(url => {
                            if (url) {
                                const { schema } = view.state;
                                const node = schema.nodes.image.create({ src: url });
                                const transaction = view.state.tr.replaceSelectionWith(node);
                                view.dispatch(transaction);
                            }
                        });
                    }
                    return true;
                }
                return false;
            },
            handleDrop: (view, event, _slice, moved) => {
                if (!moved && event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]) {
                    const file = event.dataTransfer.files[0];
                    if (file.type.indexOf('image') === 0) {
                        event.preventDefault();
                        uploadImage(file).then(url => {
                            if (url) {
                                const { schema } = view.state;
                                const coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY });
                                if (coordinates) {
                                    const node = schema.nodes.image.create({ src: url });
                                    const transaction = view.state.tr.insert(coordinates.pos, node);
                                    view.dispatch(transaction);
                                }
                            }
                        });
                        return true;
                    }
                }
                return false;
            }
        },
        onUpdate: ({ editor }) => {
             const html = editor.getHTML();
             const normalizedHtml = normalizeMindMapHtmlForTurndown(html);
             const markdown = turndownService.turndown(normalizedHtml);

             try {
                 const hasDiv = html.includes('data-type="mind-map"');
                 const hasFence = markdown.includes('```mindmap');
                 const sig = `${hasDiv}-${hasFence}-${markdown.length}`;
                 if (hasDiv && sig !== mmSigRef.current) {
                     mmSigRef.current = sig;
                     const idx = markdown.indexOf('```mindmap');
                     const snippet = idx >= 0 ? markdown.slice(Math.max(0, idx - 40), Math.min(markdown.length, idx + 220)) : '';
                     console.log('[mindmap][editor]', { hasDiv, hasFence, mdLen: markdown.length, snippet });
                 }
             } catch {}

             onChange(markdown);
        }
    });

    useEffect(() => {
        if (!editor) return;
        try {
            const rendered = mdParser.render(content || '');
            const hasDiv = rendered.includes('data-type="mind-map"');
            const hasFence = (content || '').includes('```mindmap');
            if (hasDiv || hasFence) {
                console.log('[mindmap][init]', { hasFence, renderedHasDiv: hasDiv, mdLen: (content || '').length });
            }
        } catch {}
    }, [editor]);

    const addImage = useCallback(() => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async () => {
            if (input.files?.length) {
                const file = input.files[0];
                const url = await uploadImage(file);
                if (url) {
                    editor?.chain().focus().setImage({ src: url }).run();
                }
            }
        };
        input.click();
    }, [editor, uploadImage]);

    if (!editor) {
        return null;
    }

    // Sync content if it changes externally (e.g. title update)
    useEffect(() => {
        if (editor && content) {
            const currentHTML = editor.getHTML();
            const newHTML = mdParser.render(content);
            const currentMarkdown = turndownService.turndown(normalizeMindMapHtmlForTurndown(currentHTML));
            if (currentMarkdown.trim() !== content.trim()) {
                 if (!editor.isFocused) {
                     editor.commands.setContent(newHTML);
                 }
            }
        }
    }, [content, editor]);

    return (
        <div className="flex h-full min-h-[500px] relative">
            {/* Outline / Table of Contents (Left Side) */}
            {showTOC && (
                <div className="hidden xl:flex flex-col w-64 sticky top-0 h-full border-r border-gray-100 bg-gray-50/30 flex-shrink-0 transition-all duration-300">
                    <div className="p-4 border-b border-gray-100 flex justify-between items-center">
                         <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center">
                            <ListOrdered className="w-3 h-3 mr-2" /> 
                            大纲
                         </h4>
                         <button 
                            onClick={() => setShowTOC(false)} 
                            className="text-gray-400 hover:text-gray-600 p-1 hover:bg-gray-100 rounded"
                            title="隐藏大纲"
                         >
                            <X className="w-3 h-3" />
                         </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                        <TableOfContents editor={editor} />
                    </div>
                </div>
            )}

            <div className="flex-1 flex flex-col min-w-0 transition-all duration-300">
                <EditorToolbar 
                    editor={editor} 
                    onAddImage={addImage} 
                    showTOC={showTOC} 
                    onToggleTOC={() => setShowTOC(!showTOC)} 
                />
                <div className="flex-1 bg-white cursor-text p-8 sm:p-12 max-w-5xl mx-auto w-full" onClick={() => editor.chain().focus().run()}>
                    <EditorContent editor={editor} />
                </div>
            </div>
        </div>
    )
}

const TableOfContents = ({ editor }: { editor: any }) => {
    const [headings, setHeadings] = useState<{ level: number; text: string; id: string; pos: number }[]>([]);

    useEffect(() => {
        if (!editor) return;

        const updateHeadings = () => {
            const items: any[] = [];
            editor.state.doc.descendants((node: any, pos: number) => {
                if (node.type.name === 'heading') {
                    items.push({
                        level: node.attrs.level,
                        text: node.textContent,
                        id: `heading-${pos}`, // Simple ID
                        pos: pos
                    });
                }
            });
            setHeadings(items);
        };

        updateHeadings();
        editor.on('update', updateHeadings);

        return () => {
            editor.off('update', updateHeadings);
        };
    }, [editor]);

    if (headings.length === 0) return <div className="text-xs text-gray-400 pl-2 italic">暂无标题，请使用 H1-H6 添加</div>;

    return (
        <ul className="space-y-1 font-sans">
            {headings.map((heading, index) => (
                <li 
                    key={index} 
                    className={`
                        text-sm py-1.5 pr-2 rounded-md cursor-pointer hover:bg-gray-100 hover:text-primary transition-colors truncate block
                        ${heading.level === 1 ? 'font-bold text-gray-900 pl-2' : ''}
                        ${heading.level === 2 ? 'font-medium text-gray-700 pl-4' : ''}
                        ${heading.level === 3 ? 'text-gray-600 pl-6' : ''}
                        ${heading.level === 4 ? 'text-gray-500 pl-8 text-xs' : ''}
                        ${heading.level >= 5 ? 'text-gray-400 pl-10 text-xs' : ''}
                    `}
                    onClick={() => {
                        editor.chain().focus().setTextSelection(heading.pos + 1).run();
                        const element = document.querySelector(`.ProseMirror h${heading.level}`);
                        if(element) element.scrollIntoView({ behavior: 'smooth' });
                    }}
                >
                    {heading.text || '(空标题)'}
                </li>
            ))}
        </ul>
    );
};

const EditorToolbar = ({ editor, onAddImage, showTOC, onToggleTOC }: { editor: any, onAddImage: () => void, showTOC: boolean, onToggleTOC: () => void }) => {
    if (!editor) return null;

    return (
        <div className="border-b border-gray-200 p-2 flex items-center space-x-1 overflow-x-auto bg-white sticky top-0 z-10 shadow-sm">
             {/* TOC Toggle Button */}
            <ToolbarBtn 
                onClick={onToggleTOC} 
                isActive={showTOC}
                icon={<PanelLeft className={`w-4 h-4 ${showTOC ? 'text-primary' : 'text-gray-400'}`}/>} 
                label={showTOC ? "" : "大纲"}
            />
            <div className="w-px h-4 bg-gray-300 mx-2"></div>
            <ToolbarBtn 
                onClick={() => editor.chain().focus().toggleBold().run()} 
                isActive={editor.isActive('bold')} 
                icon={<Bold className="w-4 h-4"/>} 
            />
            <ToolbarBtn 
                onClick={() => editor.chain().focus().toggleItalic().run()} 
                isActive={editor.isActive('italic')} 
                icon={<Italic className="w-4 h-4"/>} 
            />
            <ToolbarBtn 
                onClick={() => editor.chain().focus().toggleStrike().run()} 
                isActive={editor.isActive('strike')} 
                icon={<Strikethrough className="w-4 h-4"/>} 
            />
            <ToolbarBtn 
                onClick={() => editor.chain().focus().toggleCode().run()} 
                isActive={editor.isActive('code')} 
                icon={<Code className="w-4 h-4"/>} 
            />
            <div className="w-px h-4 bg-gray-300 mx-2"></div>
            <ToolbarBtn 
                onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} 
                isActive={editor.isActive('heading', { level: 1 })} 
                icon={<Type className="w-4 h-4"/>} 
                label="H1" 
            />
            <ToolbarBtn 
                onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} 
                isActive={editor.isActive('heading', { level: 2 })} 
                icon={<Type className="w-4 h-4"/>} 
                label="H2" 
            />
            <ToolbarBtn 
                onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} 
                isActive={editor.isActive('heading', { level: 3 })} 
                icon={<Type className="w-3 h-3"/>} 
                label="H3" 
            />
            <div className="w-px h-4 bg-gray-300 mx-2"></div>
            <ToolbarBtn 
                onClick={() => editor.chain().focus().toggleBulletList().run()} 
                isActive={editor.isActive('bulletList')} 
                icon={<List className="w-4 h-4"/>} 
            />
            <ToolbarBtn 
                onClick={() => editor.chain().focus().toggleOrderedList().run()} 
                isActive={editor.isActive('orderedList')} 
                icon={<ListOrdered className="w-4 h-4"/>} 
            />
            <ToolbarBtn 
                onClick={() => editor.chain().focus().toggleTaskList().run()} 
                isActive={editor.isActive('taskList')} 
                icon={<CheckSquare className="w-4 h-4"/>} 
            />
            <div className="w-px h-4 bg-gray-300 mx-2"></div>
            <ToolbarBtn 
                onClick={() => editor.chain().focus().toggleBlockquote().run()} 
                isActive={editor.isActive('blockquote')} 
                icon={<Quote className="w-4 h-4"/>} 
            />
            <div className="w-px h-4 bg-gray-300 mx-2"></div>
            <ToolbarBtn 
                onClick={() => editor.chain().focus().setColumns(2).run()} 
                icon={<Columns className="w-4 h-4"/>} 
                label="2栏"
            />
            <ToolbarBtn 
                onClick={() => editor.chain().focus().setColumns(3).run()} 
                icon={<Columns className="w-4 h-4"/>} 
                label="3栏"
            />
            <div className="w-px h-4 bg-gray-300 mx-2"></div>
            <ToolbarBtn 
                onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} 
                icon={<TableIcon className="w-4 h-4"/>} 
                label="表格"
            />
            <ToolbarBtn 
                onClick={() => editor.chain().focus().insertContent({
                    type: 'mindMap',
                    attrs: {
                        data: { 
                            nodes: [{ id: 'root', type: 'mindMap', data: { label: '中心主题' }, position: { x: 0, y: 0 } }], 
                            edges: [] 
                        }
                    }
                }).run()} 
                icon={<Network className="w-4 h-4"/>} 
                label="导图"
            />
            <div className="w-px h-4 bg-gray-300 mx-2"></div>
            <ToolbarBtn 
                onClick={onAddImage}  
                icon={<ImageIcon className="w-4 h-4"/>} 
                label="图片"
            />
        </div>
    );
};

function ToolbarBtn({ icon, label, onClick, isActive }: { icon: React.ReactNode; label?: string; onClick?: () => void; isActive?: boolean }) {
    return (
        <button 
            onClick={onClick}
            className={`p-1.5 rounded flex items-center space-x-1 transition-colors ${isActive ? 'bg-gray-200 text-black' : 'text-gray-600 hover:bg-gray-200'}`}
        >
            {icon}
            {label && <span className="text-xs font-bold">{label}</span>}
        </button>
    );
}
