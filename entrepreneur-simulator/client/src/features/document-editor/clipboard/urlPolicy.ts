const CONTROL_OR_WHITESPACE = /[\u0000-\u001f\u007f\s]/;

export const isSafeLinkUrl = (value: string): boolean => {
  const url = value.trim();
  if (!url || CONTROL_OR_WHITESPACE.test(url.slice(0, url.indexOf(':') + 1))) return false;
  if (/^(?:https?:|mailto:|tel:)/i.test(url)) return true;
  return /^(?:[#/?]|\.\.?\/)/.test(url) && !/^\/\//.test(url);
};

export const isSafeImageUrl = (value: string): boolean => {
  const url = value.trim();
  if (!url || /^(?:data|blob|javascript|vbscript):/i.test(url)) return false;
  if (/^https?:/i.test(url)) return true;
  return /^(?:\/?[^/]|\.\.?\/)/.test(url) && !/^\/\//.test(url);
};

export const normalizeSingleUrl = (value: string): string | null => {
  const url = value.trim();
  if (!url || /\s/.test(url)) return null;
  return isSafeLinkUrl(url) ? url : null;
};
