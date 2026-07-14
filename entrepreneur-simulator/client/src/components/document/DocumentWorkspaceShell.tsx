import React, { forwardRef } from 'react';
import { AlertCircle, Check, CloudOff, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';

export type DocumentTheme = 'light' | 'dark' | 'system';
export type DocumentMode = 'edit' | 'read';
export type DocumentWidth = 'default' | 'wide' | 'full';
export type DocumentFont = 'sans' | 'serif' | 'mono';
export type DocumentSaveState = 'idle' | 'saving' | 'saved' | 'error' | 'offline';

export interface DocumentWorkspaceShellProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  children: React.ReactNode;
  theme?: DocumentTheme;
  mode?: DocumentMode;
  width?: DocumentWidth;
  font?: DocumentFont;
  smallText?: boolean;
  topbar?: React.ReactNode;
  header?: React.ReactNode;
  properties?: React.ReactNode;
  outline?: React.ReactNode;
  outlineLabel?: string;
  floatingUi?: React.ReactNode;
  fullscreen?: boolean;
  scrollMode?: 'workspace' | 'editor';
  scrollRef?: React.Ref<HTMLDivElement>;
}

/**
 * Shared document-page skeleton. The shell owns the single page scrollbar by
 * default; use `scrollMode="editor"` only while integrating an editor that still
 * owns its legacy scroll container.
 */
export const DocumentWorkspaceShell = forwardRef<HTMLDivElement, DocumentWorkspaceShellProps>(
  function DocumentWorkspaceShell(
    {
      children,
      theme = 'system',
      mode = 'edit',
      width = 'default',
      font = 'sans',
      smallText = false,
      topbar,
      header,
      properties,
      outline,
      outlineLabel = '文档大纲',
      floatingUi,
      fullscreen = false,
      scrollMode = 'workspace',
      scrollRef,
      className,
      ...rest
    },
    ref,
  ) {
    return (
      <div
        ref={ref}
        className={clsx('smart-document-shell', className)}
        data-theme={theme}
        data-mode={mode}
        data-width={width}
        data-font={font}
        data-small-text={smallText ? 'true' : 'false'}
        data-fullscreen={fullscreen ? 'true' : 'false'}
        data-scroll-mode={scrollMode}
        {...rest}
      >
        {topbar ? <div className="smart-document-shell__topbar">{topbar}</div> : null}

        <div className="smart-document-shell__body">
          {outline ? (
            <aside className="smart-document-shell__outline" aria-label={outlineLabel}>
              {outline}
            </aside>
          ) : null}

          <div ref={scrollRef} className="smart-document-shell__scroll">
            <div className="smart-document-shell__page">
              {header}
              {properties}
              <div className="smart-document-shell__editor">{children}</div>
            </div>
          </div>
        </div>

        {floatingUi ? <div className="smart-document-shell__floating">{floatingUi}</div> : null}
      </div>
    );
  },
);

export interface DocumentTopbarProps extends React.HTMLAttributes<HTMLDivElement> {
  leading?: React.ReactNode;
  center?: React.ReactNode;
  actions?: React.ReactNode;
  saveState?: DocumentSaveState;
  saveLabels?: Partial<Record<DocumentSaveState, string>>;
  ariaLabel?: string;
}

const DEFAULT_SAVE_LABELS: Record<DocumentSaveState, string> = {
  idle: '',
  saving: '保存中…',
  saved: '已保存',
  error: '保存失败',
  offline: '离线，等待同步',
};

const SaveStateIcon = ({ state }: { state: Exclude<DocumentSaveState, 'idle'> }) => {
  if (state === 'saving') return <Loader2 aria-hidden="true" className="smart-document-save-state__spinner" />;
  if (state === 'saved') return <Check aria-hidden="true" />;
  if (state === 'offline') return <CloudOff aria-hidden="true" />;
  return <AlertCircle aria-hidden="true" />;
};

export function DocumentTopbar({
  leading,
  center,
  actions,
  saveState = 'idle',
  saveLabels,
  ariaLabel = '文档操作栏',
  className,
  ...rest
}: DocumentTopbarProps) {
  const labels = { ...DEFAULT_SAVE_LABELS, ...saveLabels };

  return (
    <div className={clsx('smart-document-topbar', className)} role="toolbar" aria-label={ariaLabel} {...rest}>
      <div className="smart-document-topbar__leading">{leading}</div>
      {center ? <div className="smart-document-topbar__center">{center}</div> : null}
      <div className="smart-document-topbar__actions">
        {saveState !== 'idle' ? (
          <span
            className="smart-document-save-state"
            data-state={saveState}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <SaveStateIcon state={saveState} />
            <span>{labels[saveState]}</span>
          </span>
        ) : null}
        {actions}
      </div>
    </div>
  );
}
