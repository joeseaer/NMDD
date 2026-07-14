import { useState } from 'react';
import { Check, Eye, Maximize2, Monitor, Moon, Pencil, Settings2, Sun } from 'lucide-react';
import type { DocumentFont, DocumentMode, DocumentTheme, DocumentWidth } from '../../../components/document';

export type DocumentViewControlsProps = {
  mode: DocumentMode;
  theme: DocumentTheme;
  onModeChange: (mode: DocumentMode) => void;
  onThemeChange: (theme: DocumentTheme) => void;
  width?: DocumentWidth;
  font?: DocumentFont;
  smallText?: boolean;
  fullscreen?: boolean;
  onWidthChange?: (width: DocumentWidth) => void;
  onFontChange?: (font: DocumentFont) => void;
  onSmallTextChange?: (smallText: boolean) => void;
  onFullscreenChange?: (fullscreen: boolean) => void;
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
  width,
  font,
  smallText = false,
  fullscreen = false,
  onWidthChange,
  onFontChange,
  onSmallTextChange,
  onFullscreenChange,
}: DocumentViewControlsProps) {
  const [showDisplayMenu, setShowDisplayMenu] = useState(false);
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  const showDisplayOptions = Boolean(onWidthChange || onFontChange || onSmallTextChange || onFullscreenChange);

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

      {showDisplayOptions ? (
        <div className="smart-document-display-menu-anchor">
          <button
            type="button"
            className="smart-document-icon-button"
            aria-label="页面显示设置"
            aria-expanded={showDisplayMenu}
            onClick={() => setShowDisplayMenu((current) => !current)}
          >
            <Settings2 aria-hidden="true" />
          </button>
          {showDisplayMenu ? (
            <>
              <button
                type="button"
                className="smart-document-display-menu-backdrop"
                aria-label="关闭页面显示设置"
                onClick={() => setShowDisplayMenu(false)}
              />
              <div className="smart-document-display-menu" role="dialog" aria-label="页面显示设置">
                {width && onWidthChange ? (
                  <fieldset>
                    <legend>页面宽度</legend>
                    <div className="smart-document-display-menu__segments">
                      {([
                        ['default', '标准'],
                        ['wide', '宽版'],
                        ['full', '全宽'],
                      ] as Array<[DocumentWidth, string]>).map(([value, label]) => (
                        <button key={value} type="button" data-active={width === value ? 'true' : 'false'} onClick={() => onWidthChange(value)}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                ) : null}

                {font && onFontChange ? (
                  <fieldset>
                    <legend>字体</legend>
                    <div className="smart-document-display-menu__segments">
                      {([
                        ['sans', '默认'],
                        ['serif', '衬线'],
                        ['mono', '等宽'],
                      ] as Array<[DocumentFont, string]>).map(([value, label]) => (
                        <button key={value} type="button" data-active={font === value ? 'true' : 'false'} onClick={() => onFontChange(value)}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                ) : null}

                {onSmallTextChange ? (
                  <button type="button" className="smart-document-display-menu__check-row" onClick={() => onSmallTextChange(!smallText)}>
                    <span>小号正文</span>
                    <span className="smart-document-display-menu__check">{smallText ? <Check aria-hidden="true" /> : null}</span>
                  </button>
                ) : null}

                {onFullscreenChange ? (
                  <button
                    type="button"
                    className="smart-document-display-menu__check-row"
                    onClick={() => {
                      // The shell changes containing block in fullscreen. Close
                      // this popover first so it never jumps to a new anchor.
                      setShowDisplayMenu(false);
                      onFullscreenChange(!fullscreen);
                    }}
                  >
                    <span className="inline-flex items-center gap-2"><Maximize2 aria-hidden="true" /> 专注全屏</span>
                    <span className="smart-document-display-menu__check">{fullscreen ? <Check aria-hidden="true" /> : null}</span>
                  </button>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
