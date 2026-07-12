import { useEffect, useState } from 'react';
import type { DocumentMode, DocumentTheme } from '../../components/document';

const THEME_STORAGE_KEY = 'nmdd.document-editor.theme';

const readStoredTheme = (): DocumentTheme => {
  if (typeof window === 'undefined') return 'system';
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
};

export function useDocumentViewPreferences() {
  const [mode, setMode] = useState<DocumentMode>('edit');
  const [theme, setTheme] = useState<DocumentTheme>(readStoredTheme);

  useEffect(() => {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  return { mode, setMode, theme, setTheme };
}
