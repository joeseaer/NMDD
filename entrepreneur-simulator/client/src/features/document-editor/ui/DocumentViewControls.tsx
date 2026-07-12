import { Eye, Moon, Pencil, Sun, Monitor } from 'lucide-react';
import type { DocumentMode, DocumentTheme } from '../../../components/document';

export type DocumentViewControlsProps = {
  mode: DocumentMode;
  theme: DocumentTheme;
  onModeChange: (mode: DocumentMode) => void;
  onThemeChange: (theme: DocumentTheme) => void;
};

const THEME_LABELS: Record<DocumentTheme, string> = {
  system: '跟随系统',
  light: '浅色',
  dark: '深色',
};

export function DocumentViewControls({
  mode,
  theme,
  onModeChange,
  onThemeChange,
}: DocumentViewControlsProps) {
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;

  return (
    <div className="smart-document-view-controls" aria-label="文档显示设置">
      <div className="smart-document-mode-switch" role="group" aria-label="编辑模式">
        <button
          type="button"
          className="smart-document-icon-button"
          aria-label="编辑文档"
          aria-pressed={mode === 'edit'}
          data-active={mode === 'edit' ? 'true' : 'false'}
          data-testid="document-mode-edit"
          onClick={() => onModeChange('edit')}
        >
          <Pencil aria-hidden="true" />
        </button>
        <button
          type="button"
          className="smart-document-icon-button"
          aria-label="阅读文档"
          aria-pressed={mode === 'read'}
          data-active={mode === 'read' ? 'true' : 'false'}
          data-testid="document-mode-read"
          onClick={() => onModeChange('read')}
        >
          <Eye aria-hidden="true" />
        </button>
      </div>

      <label className="smart-document-theme-select" title={THEME_LABELS[theme]}>
        <ThemeIcon aria-hidden="true" />
        <span className="sr-only">文档主题</span>
        <select
          aria-label="文档主题"
          value={theme}
          data-testid="document-theme-select"
          onChange={event => onThemeChange(event.target.value as DocumentTheme)}
        >
          <option value="system">跟随系统</option>
          <option value="light">浅色</option>
          <option value="dark">深色</option>
        </select>
      </label>
    </div>
  );
}
