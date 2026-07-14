import { useEffect, useState } from 'react';
import type { DocumentFont, DocumentMode, DocumentTheme, DocumentWidth } from '../../components/document';

const THEME_STORAGE_KEY = 'nmdd.document-editor.theme';
const WIDTH_STORAGE_KEY = 'nmdd.document-editor.width';
const FONT_STORAGE_KEY = 'nmdd.document-editor.font';
const SMALL_TEXT_STORAGE_KEY = 'nmdd.document-editor.small-text';

const readStoredTheme = (): DocumentTheme => {
  if (typeof window === 'undefined') return 'system';
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
};

const readStoredWidth = (): DocumentWidth => {
  if (typeof window === 'undefined') return 'default';
  const stored = window.localStorage.getItem(WIDTH_STORAGE_KEY);
  return stored === 'wide' || stored === 'full' ? stored : 'default';
};

const readStoredFont = (): DocumentFont => {
  if (typeof window === 'undefined') return 'sans';
  const stored = window.localStorage.getItem(FONT_STORAGE_KEY);
  return stored === 'serif' || stored === 'mono' ? stored : 'sans';
};

const readStoredSmallText = () => (
  typeof window !== 'undefined' && window.localStorage.getItem(SMALL_TEXT_STORAGE_KEY) === 'true'
);

export function useDocumentViewPreferences() {
  const [mode, setMode] = useState<DocumentMode>('edit');
  const [theme, setTheme] = useState<DocumentTheme>(readStoredTheme);
  const [width, setWidth] = useState<DocumentWidth>(readStoredWidth);
  const [font, setFont] = useState<DocumentFont>(readStoredFont);
  const [smallText, setSmallText] = useState(readStoredSmallText);

  useEffect(() => {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem(WIDTH_STORAGE_KEY, width);
  }, [width]);

  useEffect(() => {
    window.localStorage.setItem(FONT_STORAGE_KEY, font);
  }, [font]);

  useEffect(() => {
    window.localStorage.setItem(SMALL_TEXT_STORAGE_KEY, String(smallText));
  }, [smallText]);

  return {
    mode,
    setMode,
    theme,
    setTheme,
    width,
    setWidth,
    font,
    setFont,
    smallText,
    setSmallText,
  };
}
