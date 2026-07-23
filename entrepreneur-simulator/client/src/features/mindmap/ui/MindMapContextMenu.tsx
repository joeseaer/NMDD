import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  BoxSelect,
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  Copy,
  Link2,
  MessageSquareText,
  Pencil,
  Plus,
  Scissors,
  Settings2,
  Sigma,
  Trash2,
  type LucideIcon,
} from 'lucide-react';

import type { ElementRef } from '../domain/types';

export interface MindMapContextMenuAnchor {
  readonly clientX: number;
  readonly clientY: number;
}

/**
 * Capability flags describe what the command layer can legally do for the
 * current selection. Missing flags are deliberately treated as `false`.
 */
export interface MindMapContextMenuCapabilities {
  readonly editTitle?: boolean;
  readonly addChildTopic?: boolean;
  readonly addNextSiblingTopic?: boolean;
  readonly addPreviousSiblingTopic?: boolean;
  readonly insertParentTopic?: boolean;
  readonly copy?: boolean;
  readonly cut?: boolean;
  readonly paste?: boolean;
  readonly deleteElement?: boolean;
  readonly deleteCurrentTopic?: boolean;
  readonly deleteBranch?: boolean;
  readonly toggleCollapse?: boolean;
  readonly createRelationship?: boolean;
  readonly createBoundary?: boolean;
  readonly createSummary?: boolean;
  readonly createCallout?: boolean;
  readonly openFormat?: boolean;
}

export type MindMapContextMenuActionId =
  | 'edit-title'
  | 'add-child-topic'
  | 'add-next-sibling-topic'
  | 'add-previous-sibling-topic'
  | 'insert-parent-topic'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'delete-element'
  | 'delete-current-topic'
  | 'delete-branch'
  | 'toggle-collapse'
  | 'create-relationship'
  | 'create-boundary'
  | 'create-summary'
  | 'create-callout'
  | 'open-format';

export interface MindMapContextMenuActionContext {
  readonly target: ElementRef | null;
  readonly selectionCount: number;
}

export type MindMapContextMenuActionCallback = (
  context: MindMapContextMenuActionContext,
) => void;

export interface MindMapContextMenuProps {
  readonly open: boolean;
  /** Fixed-position anchor in viewport/client coordinates. */
  readonly anchor: MindMapContextMenuAnchor;
  /** `null` means that the user invoked the menu on blank canvas. */
  readonly target: ElementRef | null;
  readonly selectionCount: number;
  readonly readOnly: boolean;
  readonly capabilities: MindMapContextMenuCapabilities;
  /** Current branch state; only used to choose the fold/unfold label. */
  readonly collapsed?: boolean;
  onEditTitle?: MindMapContextMenuActionCallback;
  onAddChildTopic?: MindMapContextMenuActionCallback;
  onAddNextSiblingTopic?: MindMapContextMenuActionCallback;
  onAddPreviousSiblingTopic?: MindMapContextMenuActionCallback;
  onInsertParentTopic?: MindMapContextMenuActionCallback;
  onCopy?: MindMapContextMenuActionCallback;
  onCut?: MindMapContextMenuActionCallback;
  onPaste?: MindMapContextMenuActionCallback;
  onDeleteElement?: MindMapContextMenuActionCallback;
  onDeleteCurrentTopic?: MindMapContextMenuActionCallback;
  onDeleteBranch?: MindMapContextMenuActionCallback;
  onToggleCollapse?: MindMapContextMenuActionCallback;
  onCreateRelationship?: MindMapContextMenuActionCallback;
  onCreateBoundary?: MindMapContextMenuActionCallback;
  onCreateSummary?: MindMapContextMenuActionCallback;
  onCreateCallout?: MindMapContextMenuActionCallback;
  onOpenFormat?: MindMapContextMenuActionCallback;
  onClose(): void;
}

interface MenuItemDescriptor {
  readonly id: MindMapContextMenuActionId;
  readonly label: string;
  readonly shortcut?: string;
  readonly icon: LucideIcon;
  readonly enabled: boolean;
  readonly mutatesContent: boolean;
  readonly tone?: 'default' | 'danger';
  readonly run?: MindMapContextMenuActionCallback;
}

type MenuSection = readonly MenuItemDescriptor[];

const VIEWPORT_MARGIN = 8;
const FALLBACK_MENU_WIDTH = 288;

const targetKindLabels: Record<ElementRef['kind'], string> = {
  topic: '主题',
  relationship: '关系线',
  boundary: '边界',
  summary: '概要',
  callout: '标注',
  zone: '区域',
};

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(Number.isFinite(value) ? value : minimum, minimum), maximum);

export const clampMindMapContextMenuPosition = (
  anchor: MindMapContextMenuAnchor,
  size: Readonly<{ width: number; height: number }>,
  viewport: Readonly<{ width: number; height: number }>,
): Readonly<{ left: number; top: number }> => {
  const availableWidth = Math.max(0, viewport.width - VIEWPORT_MARGIN * 2);
  const availableHeight = Math.max(0, viewport.height - VIEWPORT_MARGIN * 2);
  const renderedWidth = Math.min(Math.max(0, size.width), availableWidth);
  const renderedHeight = Math.min(Math.max(0, size.height), availableHeight);
  const maxLeft = Math.max(VIEWPORT_MARGIN, viewport.width - VIEWPORT_MARGIN - renderedWidth);
  const maxTop = Math.max(VIEWPORT_MARGIN, viewport.height - VIEWPORT_MARGIN - renderedHeight);

  return {
    left: clamp(anchor.clientX, VIEWPORT_MARGIN, maxLeft),
    top: clamp(anchor.clientY, VIEWPORT_MARGIN, maxTop),
  };
};

const contextSummary = (target: ElementRef | null, selectionCount: number): string => {
  if (!target) return '空白画布';
  if (selectionCount > 1) return `已选择 ${selectionCount} 个元素`;
  return targetKindLabels[target.kind];
};

const effectiveSelectionCount = (selectionCount: number): number =>
  Number.isFinite(selectionCount) ? Math.max(0, Math.floor(selectionCount)) : 0;

export const MindMapContextMenu = ({
  open,
  anchor,
  target,
  selectionCount: rawSelectionCount,
  readOnly,
  capabilities,
  collapsed = false,
  onEditTitle,
  onAddChildTopic,
  onAddNextSiblingTopic,
  onAddPreviousSiblingTopic,
  onInsertParentTopic,
  onCopy,
  onCut,
  onPaste,
  onDeleteElement,
  onDeleteCurrentTopic,
  onDeleteBranch,
  onToggleCollapse,
  onCreateRelationship,
  onCreateBoundary,
  onCreateSummary,
  onCreateCallout,
  onOpenFormat,
  onClose,
}: MindMapContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<MindMapContextMenuActionId, HTMLButtonElement>());
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const closingRef = useRef(false);
  const [activeActionId, setActiveActionId] = useState<MindMapContextMenuActionId | null>(null);
  const [position, setPosition] = useState({
    left: anchor.clientX,
    top: anchor.clientY,
  });
  const selectionCount = effectiveSelectionCount(rawSelectionCount);
  const isTopic = target?.kind === 'topic';
  const isSingleTarget = target !== null && selectionCount <= 1;
  const hasTarget = target !== null;
  const context = useMemo<MindMapContextMenuActionContext>(
    () => ({ target, selectionCount }),
    [selectionCount, target],
  );

  const permitted = useCallback(
    (
      capability: keyof MindMapContextMenuCapabilities,
      callback: MindMapContextMenuActionCallback | undefined,
      mutatesContent: boolean,
      selectionRule = true,
    ): boolean => Boolean(
      capabilities[capability]
      && callback
      && selectionRule
      && (!readOnly || !mutatesContent)
    ),
    [capabilities, readOnly],
  );

  const sections = useMemo<readonly MenuSection[]>(() => {
    if (!target) {
      return [[{
        id: 'paste',
        label: '粘贴',
        shortcut: 'Ctrl+V',
        icon: ClipboardPaste,
        enabled: permitted('paste', onPaste, true),
        mutatesContent: true,
        run: onPaste,
      }]];
    }

    const result: MenuItemDescriptor[][] = [];

    result.push([{
      id: 'edit-title',
      label: '编辑标题',
      shortcut: 'F2',
      icon: Pencil,
      enabled: permitted('editTitle', onEditTitle, true, isSingleTarget),
      mutatesContent: true,
      run: onEditTitle,
    }]);

    if (isTopic) {
      result.push([
        {
          id: 'add-child-topic',
          label: '新增子主题',
          shortcut: 'Tab',
          icon: Plus,
          enabled: permitted('addChildTopic', onAddChildTopic, true, isSingleTarget),
          mutatesContent: true,
          run: onAddChildTopic,
        },
        {
          id: 'add-next-sibling-topic',
          label: '后置同级主题',
          shortcut: 'Enter',
          icon: Plus,
          enabled: permitted('addNextSiblingTopic', onAddNextSiblingTopic, true, isSingleTarget),
          mutatesContent: true,
          run: onAddNextSiblingTopic,
        },
        {
          id: 'add-previous-sibling-topic',
          label: '前置同级主题',
          shortcut: 'Shift+Enter',
          icon: Plus,
          enabled: permitted('addPreviousSiblingTopic', onAddPreviousSiblingTopic, true, isSingleTarget),
          mutatesContent: true,
          run: onAddPreviousSiblingTopic,
        },
        {
          id: 'insert-parent-topic',
          label: '插入父主题',
          icon: Plus,
          enabled: permitted('insertParentTopic', onInsertParentTopic, true, isSingleTarget),
          mutatesContent: true,
          run: onInsertParentTopic,
        },
      ]);
    } else if (capabilities.deleteElement) {
      result.push([{
        id: 'delete-element',
        label: '删除',
        shortcut: 'Delete',
        icon: Trash2,
        enabled: permitted('deleteElement', onDeleteElement, true, isSingleTarget),
        mutatesContent: true,
        tone: 'danger',
        run: onDeleteElement,
      }]);
    }

    result.push([
      {
        id: 'copy',
        label: selectionCount > 1 ? `复制 ${selectionCount} 个元素` : '复制',
        shortcut: 'Ctrl+C',
        icon: Copy,
        enabled: permitted('copy', onCopy, false),
        mutatesContent: false,
        run: onCopy,
      },
      {
        id: 'cut',
        label: selectionCount > 1 ? `剪切 ${selectionCount} 个元素` : '剪切',
        shortcut: 'Ctrl+X',
        icon: Scissors,
        enabled: permitted('cut', onCut, true),
        mutatesContent: true,
        run: onCut,
      },
      ...(isTopic ? [{
        id: 'paste' as const,
        label: '粘贴',
        shortcut: 'Ctrl+V',
        icon: ClipboardPaste,
        enabled: permitted('paste', onPaste, true),
        mutatesContent: true,
        run: onPaste,
      }] : []),
    ]);

    if (isTopic) {
      result.push([
        {
          id: 'delete-current-topic',
          label: '仅删除当前主题',
          icon: Trash2,
          enabled: permitted(
            'deleteCurrentTopic',
            onDeleteCurrentTopic,
            true,
            isSingleTarget,
          ),
          mutatesContent: true,
          tone: 'danger',
          run: onDeleteCurrentTopic,
        },
        {
          id: 'delete-branch',
          label: selectionCount > 1 ? `删除 ${selectionCount} 个分支` : '删除分支',
          shortcut: 'Delete',
          icon: Trash2,
          enabled: permitted('deleteBranch', onDeleteBranch, true),
          mutatesContent: true,
          tone: 'danger',
          run: onDeleteBranch,
        },
        {
          id: 'toggle-collapse',
          label: collapsed ? '展开分支' : '折叠分支',
          icon: collapsed ? ChevronRight : ChevronDown,
          enabled: permitted('toggleCollapse', onToggleCollapse, true, isSingleTarget),
          mutatesContent: true,
          run: onToggleCollapse,
        },
      ]);

      result.push([
        {
          id: 'create-relationship',
          label: '创建关系线',
          icon: Link2,
          enabled: permitted('createRelationship', onCreateRelationship, true),
          mutatesContent: true,
          run: onCreateRelationship,
        },
        {
          id: 'create-boundary',
          label: '创建边界',
          icon: BoxSelect,
          enabled: permitted('createBoundary', onCreateBoundary, true),
          mutatesContent: true,
          run: onCreateBoundary,
        },
        {
          id: 'create-summary',
          label: '创建概要',
          icon: Sigma,
          enabled: permitted('createSummary', onCreateSummary, true),
          mutatesContent: true,
          run: onCreateSummary,
        },
        {
          id: 'create-callout',
          label: '创建标注',
          icon: MessageSquareText,
          enabled: permitted('createCallout', onCreateCallout, true, isSingleTarget),
          mutatesContent: true,
          run: onCreateCallout,
        },
      ]);
    }

    if (hasTarget) {
      result.push([{
        id: 'open-format',
        label: readOnly ? '查看格式' : '打开格式',
        icon: Settings2,
        enabled: permitted('openFormat', onOpenFormat, false),
        mutatesContent: false,
        run: onOpenFormat,
      }]);
    }

    return result.filter((section) => section.length > 0);
  }, [
    collapsed,
    hasTarget,
    isSingleTarget,
    isTopic,
    onAddChildTopic,
    onAddNextSiblingTopic,
    onAddPreviousSiblingTopic,
    onCopy,
    onCreateBoundary,
    onCreateCallout,
    onCreateRelationship,
    onCreateSummary,
    onCut,
    onDeleteBranch,
    onDeleteCurrentTopic,
    onDeleteElement,
    onEditTitle,
    onInsertParentTopic,
    onOpenFormat,
    onPaste,
    onToggleCollapse,
    permitted,
    readOnly,
    selectionCount,
    target,
  ]);

  const items = useMemo(() => sections.flat(), [sections]);
  const enabledItems = useMemo(() => items.filter((item) => item.enabled), [items]);
  const enabledFingerprint = enabledItems.map((item) => item.id).join('|');

  const restoreFocus = useCallback(() => {
    const element = restoreFocusRef.current;
    if (element?.isConnected) element.focus({ preventScroll: true });
  }, []);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    onClose();
    restoreFocus();
  }, [onClose, restoreFocus]);

  const activate = useCallback((item: MenuItemDescriptor) => {
    if (!item.enabled || !item.run) return;
    item.run(context);
    requestClose();
  }, [context, requestClose]);

  const focusItem = useCallback((item: MenuItemDescriptor | undefined) => {
    if (!item) {
      setActiveActionId(null);
      menuRef.current?.focus({ preventScroll: true });
      return;
    }
    setActiveActionId(item.id);
    itemRefs.current.get(item.id)?.focus({ preventScroll: true });
  }, []);

  const moveFocus = useCallback((direction: 1 | -1) => {
    if (enabledItems.length === 0) return;
    const currentIndex = enabledItems.findIndex((item) => item.id === activeActionId);
    const baseIndex = currentIndex < 0 ? (direction > 0 ? -1 : 0) : currentIndex;
    const nextIndex = (baseIndex + direction + enabledItems.length) % enabledItems.length;
    focusItem(enabledItems[nextIndex]);
  }, [activeActionId, enabledItems, focusItem]);

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveFocus(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(-1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      focusItem(enabledItems[0]);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      focusItem(enabledItems[enabledItems.length - 1]);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      const activeItem = enabledItems.find((item) => item.id === activeActionId);
      if (activeItem) {
        event.preventDefault();
        activate(activeItem);
      }
    }
  }, [activate, activeActionId, enabledItems, focusItem, moveFocus]);

  const updatePosition = useCallback(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const bounds = menu.getBoundingClientRect();
    const next = clampMindMapContextMenuPosition(
      anchor,
      {
        width: bounds.width || menu.offsetWidth || FALLBACK_MENU_WIDTH,
        height: bounds.height || menu.offsetHeight,
      },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setPosition((current) => current.left === next.left && current.top === next.top
      ? current
      : next);
  }, [anchor]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [enabledFingerprint, open, updatePosition]);

  useLayoutEffect(() => {
    if (!open) return;
    closingRef.current = false;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    focusItem(enabledItems[0]);

    return () => {
      restoreFocus();
      restoreFocusRef.current = null;
    };
    // Re-capturing document.activeElement when capabilities change would save a
    // menu item instead of the original invoker, so this effect follows `open` only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) requestClose();
    };
    const handleOutsideContextMenu = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) requestClose();
    };
    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      requestClose();
    };
    const handleViewportChange = () => updatePosition();

    document.addEventListener('click', handleOutsideClick, true);
    document.addEventListener('contextmenu', handleOutsideContextMenu, true);
    document.addEventListener('keydown', handleDocumentKeyDown, true);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      document.removeEventListener('click', handleOutsideClick, true);
      document.removeEventListener('contextmenu', handleOutsideContextMenu, true);
      document.removeEventListener('keydown', handleDocumentKeyDown, true);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [open, requestClose, updatePosition]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      aria-label="思维导图上下文菜单"
      data-testid="mindmap-context-menu"
      data-target-kind={target?.kind ?? 'canvas'}
      className="fixed z-[1000] w-72 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border border-slate-200/90 bg-white/95 py-1.5 text-sm text-slate-700 shadow-[0_18px_48px_rgba(15,23,42,0.22)] outline-none backdrop-blur-md"
      style={{
        left: position.left,
        top: position.top,
        maxHeight: `calc(100vh - ${VIEWPORT_MARGIN * 2}px)`,
      }}
      onKeyDown={handleKeyDown}
      onMouseDown={(event: ReactMouseEvent<HTMLDivElement>) => event.stopPropagation()}
      onContextMenu={(event: ReactMouseEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div
        role="presentation"
        className="mb-1 flex items-center justify-between px-3 py-1 text-[11px] font-medium text-slate-400"
        aria-hidden="true"
      >
        <span>{contextSummary(target, selectionCount)}</span>
        {readOnly && <span className="rounded bg-slate-100 px-1.5 py-0.5">只读</span>}
      </div>

      {sections.map((section, sectionIndex) => (
        <div key={section.map((item) => item.id).join('|')} role="presentation">
          {sectionIndex > 0 && (
            <div role="separator" className="mx-2 my-1 border-t border-slate-100" />
          )}
          {section.map((item) => {
            const Icon = item.icon;
            const isActive = item.id === activeActionId;
            return (
              <button
                key={item.id}
                ref={(element) => {
                  if (element) itemRefs.current.set(item.id, element);
                  else itemRefs.current.delete(item.id);
                }}
                type="button"
                role="menuitem"
                tabIndex={item.enabled && isActive ? 0 : -1}
                aria-disabled={!item.enabled}
                data-action={item.id}
                data-mutates-content={item.mutatesContent ? 'true' : 'false'}
                className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left outline-none transition-colors ${
                  item.enabled
                    ? item.tone === 'danger'
                      ? 'text-red-600 hover:bg-red-50 focus:bg-red-50'
                      : 'hover:bg-blue-50 hover:text-blue-700 focus:bg-blue-50 focus:text-blue-700'
                    : 'cursor-not-allowed text-slate-300'
                }`}
                title={!item.enabled
                  ? readOnly && item.mutatesContent
                    ? '只读模式下不可修改内容'
                    : '当前选择不支持此操作'
                  : undefined}
                onFocus={() => {
                  if (item.enabled) setActiveActionId(item.id);
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  activate(item);
                }}
              >
                <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.shortcut && (
                  <span aria-hidden="true" className="ml-3 text-[11px] text-slate-400">
                    {item.shortcut}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>,
    document.body,
  );
};
