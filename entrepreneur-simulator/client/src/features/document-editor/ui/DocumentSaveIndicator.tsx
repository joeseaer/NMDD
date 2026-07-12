import type { DocumentSaveStatus } from '../useRevisionedSaveQueue';

export const DocumentSaveIndicator = ({
  status,
  onRetry,
  onReload,
}: {
  status: DocumentSaveStatus;
  onRetry?: () => void;
  onReload?: () => void;
}) => {
  const label = status.phase === 'dirty'
    ? '有未保存更改'
    : status.phase === 'saving'
      ? '保存中…'
      : status.phase === 'error'
        ? '保存失败'
        : status.phase === 'conflict'
          ? '存在版本冲突'
          : '已保存';

  return (
    <div
      className="smart-document-save-status"
      data-state={status.phase}
      role={status.phase === 'error' || status.phase === 'conflict' ? 'alert' : 'status'}
      title={status.message || label}
    >
      {status.phase === 'saving' && <span className="smart-document-save-spinner" aria-hidden="true" />}
      <span>{label}</span>
      {status.phase === 'error' && onRetry && (
        <button type="button" onClick={onRetry}>重试</button>
      )}
      {status.phase === 'conflict' && onReload && (
        <button type="button" onClick={onReload}>重新载入</button>
      )}
    </div>
  );
};
