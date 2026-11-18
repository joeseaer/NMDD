import { useEffect, useRef, type ReactNode } from 'react';
import { ChevronDown, CircleHelp, GitBranch, Layers3, Pencil, Plus, X } from 'lucide-react';

interface PopoverProps {
  label: string;
  icon: typeof Plus;
  children: ReactNode;
  closeOnAction?: boolean;
}

const ToolbarPopover = ({ label, icon: Icon, children, closeOnAction }: PopoverProps) => {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) {
        ref.current?.removeAttribute('open');
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !ref.current?.open) return;
      event.preventDefault();
      event.stopPropagation();
      ref.current.removeAttribute('open');
      ref.current.querySelector('summary')?.focus();
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape, true);
    };
  }, []);
  return (
    <details ref={ref} className="mindmap-toolbar-popover" onToggle={(event) => {
      const current = event.currentTarget;
      if (!current.open) return;
      current.parentElement?.querySelectorAll('details[open]').forEach(other => {
        if (other !== current) other.removeAttribute('open');
      });
    }}>
      <summary className="mindmap-command" role="button" aria-label={label}>
        <Icon size={16} aria-hidden="true" /><span>{label}</span><ChevronDown size={12} aria-hidden="true" />
      </summary>
      <div className="mindmap-popover-content nowheel nodrag" onClick={(event) => {
        if (closeOnAction && event.target instanceof Element && event.target.closest('button:not(:disabled)')) {
          ref.current?.removeAttribute('open');
        }
      }}>
        {children}
      </div>
    </details>
  );
};

export interface MindMapToolbarProps {
  fullScreen: boolean;
  readOnly: boolean;
  canEdit: boolean;
  canAddSibling: boolean;
  sheetTabs: ReactNode;
  layoutControls: ReactNode;
  insertActions: ReactNode;
  historyActions: ReactNode;
  workspaceActions: ReactNode;
  viewportActions: ReactNode;
  onAddChild(): void;
  onAddSibling(): void;
  onEdit(): void;
}

export const MindMapToolbar = ({
  fullScreen, readOnly, canEdit, canAddSibling, sheetTabs, layoutControls,
  insertActions, historyActions, workspaceActions, viewportActions,
  onAddChild, onAddSibling, onEdit,
}: MindMapToolbarProps) => (
  <>
    <header
      className="mindmap-workspace-header"
      data-testid={fullScreen ? 'mindmap-v2-fullscreen-topbar' : 'mindmap-v2-embedded-topbar'}
      data-mindmap-chrome={fullScreen ? 'compact' : 'preview'}
    >
      <div className="mindmap-document-mark" aria-label="思维导图工作区">
        <GitBranch size={18} aria-hidden="true" />
        <span>思维导图</span>
      </div>
      {sheetTabs}
      <div className="mindmap-header-actions">
        <div className="mindmap-history-actions" role="group" aria-label="历史记录">{historyActions}</div>
        {workspaceActions}
        <div className="mindmap-viewport-actions" data-testid="mindmap-v2-viewport-actions">{viewportActions}</div>
      </div>
    </header>
    <div className="mindmap-command-bar" role="toolbar" aria-label="建图工具" data-testid="mindmap-v2-action-strip">
      <button type="button" className="mindmap-command mindmap-command-primary" disabled={readOnly} onClick={onAddChild} title="新增子主题 (Tab)">
        <Plus size={16} aria-hidden="true" /><span>子主题</span><kbd>Tab</kbd>
      </button>
      <button type="button" className="mindmap-command" disabled={readOnly || !canAddSibling} onClick={onAddSibling} title="新增同级主题 (Enter)">
        <GitBranch size={16} aria-hidden="true" /><span>同级主题</span><kbd>↵</kbd>
      </button>
      <button type="button" className="mindmap-command" disabled={readOnly || !canEdit} onClick={onEdit} title="编辑主题 (Space / F2)">
        <Pencil size={15} aria-hidden="true" /><span>编辑</span>
      </button>
      <span className="mindmap-toolbar-divider" aria-hidden="true" />
      <ToolbarPopover label="插入" icon={Plus} closeOnAction>{insertActions}</ToolbarPopover>
      <ToolbarPopover label="布局" icon={Layers3}>{layoutControls}</ToolbarPopover>
      <ToolbarPopover label="操作指南" icon={CircleHelp}>
        <div className="mindmap-shortcut-guide">
          <strong>让思路自然展开</strong>
          <p>单击选中，双击编辑；拖动主题卡片调整位置。</p>
          <dl>
            <div><dt>新增子主题</dt><dd><kbd>Tab</kbd></dd></div>
            <div><dt>新增同级主题</dt><dd><kbd>Enter</kbd></dd></div>
            <div><dt>编辑标题</dt><dd><kbd>Space / F2</kbd></dd></div>
            <div><dt>多选主题</dt><dd><kbd>Ctrl / ⌘ + 单击</kbd></dd></div>
            <div><dt>缩放画布</dt><dd><kbd>Ctrl / ⌘ + 滚轮</kbd></dd></div>
            <div><dt>撤销</dt><dd><kbd>Ctrl / ⌘ + Z</kbd></dd></div>
          </dl>
          <p><X size={12} aria-hidden="true" />按 Esc 关闭面板或退出全屏</p>
        </div>
      </ToolbarPopover>
    </div>
  </>
);
