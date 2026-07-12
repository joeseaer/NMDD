export const withoutRelationsForDocumentAutosave = <T extends { related?: unknown }>(
  document: T,
): Omit<T, 'related'> => {
  const { related: _related, ...payload } = document;
  return payload;
};
