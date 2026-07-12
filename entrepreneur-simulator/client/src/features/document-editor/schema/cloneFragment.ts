import type { DocumentFragmentJson, DocumentNodeJson } from './documentSchema';

export type FragmentIdKind =
  | 'block'
  | 'sync'
  | 'database'
  | 'property'
  | 'row'
  | 'view'
  | 'filter'
  | 'file';

export interface FragmentIdMaps {
  block: Record<string, string>;
  sync: Record<string, string>;
  database: Record<string, string>;
  property: Record<string, string>;
  row: Record<string, string>;
  view: Record<string, string>;
  filter: Record<string, string>;
  file: Record<string, string>;
}

export interface CloneFragmentOptions {
  createId?: (kind: FragmentIdKind, previousId: string) => string;
  preserveSyncIds?: boolean;
  remapDatabaseIds?: boolean;
}

export interface CloneFragmentResult<T extends DocumentFragmentJson> {
  fragment: T;
  idMaps: FragmentIdMaps;
}

export interface StripFragmentRuntimeOptions {
  preserveSyncIds?: boolean;
}

const RUNTIME_NODE_ATTRS = new Set([
  'blockComments',
  'comments',
  'commentIds',
  'commentThreadIds',
  'uploadId',
  'uploadStatus',
  'uploadError',
  'uploadProgress',
  'isUploading',
  'localUrl',
  'objectUrl',
  'selected',
]);

const ID_PREFIX: Record<FragmentIdKind, string> = {
  block: 'blk',
  sync: 'sync',
  database: 'db',
  property: 'prop',
  row: 'row',
  view: 'view',
  filter: 'filter',
  file: 'file',
};

let fallbackIdCounter = 0;

const defaultCreateId = (kind: FragmentIdKind): string => {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now().toString(36)}${(fallbackIdCounter += 1).toString(36)}${Math.random().toString(36).slice(2, 9)}`;
  return `${ID_PREFIX[kind]}_${random}`;
};

const createEmptyMaps = (): FragmentIdMaps => ({
  block: {},
  sync: {},
  database: {},
  property: {},
  row: {},
  view: {},
  filter: {},
  file: {},
});

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const cloneUnknown = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(cloneUnknown);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneUnknown(child)]));
};

interface CloneContext {
  maps: FragmentIdMaps;
  options: Required<Pick<CloneFragmentOptions, 'preserveSyncIds' | 'remapDatabaseIds'>> & CloneFragmentOptions;
}

const mapId = (context: CloneContext, kind: FragmentIdKind, value: unknown): string => {
  const previousId = String(value || '');
  if (!previousId) return '';
  const existing = context.maps[kind][previousId];
  if (existing) return existing;
  const next = context.options.createId?.(kind, previousId) || defaultCreateId(kind);
  context.maps[kind][previousId] = next;
  return next;
};

const mappedReference = (
  context: CloneContext,
  kind: FragmentIdKind,
  value: unknown,
): unknown => {
  const key = String(value || '');
  return key ? context.maps[kind][key] || key : value;
};

const premapDatabaseIds = (database: Record<string, unknown>, context: CloneContext): void => {
  if (database.id) mapId(context, 'database', database.id);
  const properties = Array.isArray(database.properties) ? database.properties.filter(isRecord) : [];
  const rows = Array.isArray(database.rows) ? database.rows.filter(isRecord) : [];
  const views = Array.isArray(database.views) ? database.views.filter(isRecord) : [];
  const topFilters = Array.isArray(database.filters) ? database.filters.filter(isRecord) : [];
  properties.forEach(property => {
    if (property.id) mapId(context, 'property', property.id);
  });
  rows.forEach(row => {
    if (row.id) mapId(context, 'row', row.id);
  });
  views.forEach(view => {
    if (view.id) mapId(context, 'view', view.id);
    if (Array.isArray(view.filters)) view.filters.filter(isRecord).forEach(filter => {
      if (filter.id) mapId(context, 'filter', filter.id);
    });
  });
  topFilters.forEach(filter => {
    if (filter.id) mapId(context, 'filter', filter.id);
  });

  const filePropertyIds = new Set(
    properties.filter(property => property.type === 'files').map(property => String(property.id || '')),
  );
  rows.forEach(row => {
    if (!isRecord(row.cells)) return;
    const cells = row.cells;
    filePropertyIds.forEach(propertyId => {
      const files = cells[propertyId];
      if (!Array.isArray(files)) return;
      files.filter(isRecord).forEach(file => {
        if (file.id) mapId(context, 'file', file.id);
      });
    });
  });
};

const cloneFilter = (filter: Record<string, unknown>, context: CloneContext): Record<string, unknown> => ({
  ...Object.fromEntries(Object.entries(filter).map(([key, value]) => [key, cloneUnknown(value)])),
  ...(filter.id ? { id: mapId(context, 'filter', filter.id) } : {}),
  ...(filter.propertyId ? { propertyId: mappedReference(context, 'property', filter.propertyId) } : {}),
});

const cloneSort = (sort: unknown, context: CloneContext): unknown => {
  if (!isRecord(sort)) return cloneUnknown(sort);
  return {
    ...cloneUnknown(sort) as Record<string, unknown>,
    ...(sort.propertyId ? { propertyId: mappedReference(context, 'property', sort.propertyId) } : {}),
  };
};

const cloneDatabase = (value: unknown, context: CloneContext): unknown => {
  if (!isRecord(value)) return cloneUnknown(value);
  premapDatabaseIds(value, context);
  const sourceProperties = Array.isArray(value.properties) ? value.properties.filter(isRecord) : [];
  const propertyTypes = new Map(sourceProperties.map(property => [String(property.id || ''), String(property.type || '')]));

  const properties = sourceProperties.map(property => ({
    ...cloneUnknown(property) as Record<string, unknown>,
    ...(property.id ? { id: mapId(context, 'property', property.id) } : {}),
    ...(property.relationPropertyId
      ? { relationPropertyId: mappedReference(context, 'property', property.relationPropertyId) }
      : {}),
    ...(property.rollupTargetPropertyId
      ? { rollupTargetPropertyId: mappedReference(context, 'property', property.rollupTargetPropertyId) }
      : {}),
  }));

  const rows = (Array.isArray(value.rows) ? value.rows.filter(isRecord) : []).map(row => {
    const sourceCells = isRecord(row.cells) ? row.cells : {};
    const cells: Record<string, unknown> = {};
    Object.entries(sourceCells).forEach(([propertyId, cellValue]) => {
      const nextPropertyId = String(mappedReference(context, 'property', propertyId));
      const propertyType = propertyTypes.get(propertyId);
      if (propertyType === 'relation' && Array.isArray(cellValue)) {
        cells[nextPropertyId] = cellValue.map(rowId => mappedReference(context, 'row', rowId));
      } else if (propertyType === 'files' && Array.isArray(cellValue)) {
        cells[nextPropertyId] = cellValue.map(file => {
          if (!isRecord(file)) return cloneUnknown(file);
          return {
            ...cloneUnknown(file) as Record<string, unknown>,
            ...(file.id ? { id: mapId(context, 'file', file.id) } : {}),
          };
        });
      } else {
        cells[nextPropertyId] = cloneUnknown(cellValue);
      }
    });
    const page = isRecord(row.page) ? { ...cloneUnknown(row.page) as Record<string, unknown> } : row.page;
    if (isRecord(page) && page.contentJson) page.contentJson = cloneNodeOrValue(page.contentJson, context);
    return {
      ...cloneUnknown(row) as Record<string, unknown>,
      ...(row.id ? { id: mapId(context, 'row', row.id) } : {}),
      cells,
      ...(page ? { page } : {}),
    };
  });

  const views = (Array.isArray(value.views) ? value.views.filter(isRecord) : []).map(view => ({
    ...cloneUnknown(view) as Record<string, unknown>,
    ...(view.id ? { id: mapId(context, 'view', view.id) } : {}),
    ...(Array.isArray(view.filters) ? { filters: view.filters.filter(isRecord).map(filter => cloneFilter(filter, context)) } : {}),
    ...(view.groupBy ? { groupBy: mappedReference(context, 'property', view.groupBy) } : {}),
    ...(view.sort ? { sort: cloneSort(view.sort, context) } : {}),
  }));

  return {
    ...cloneUnknown(value) as Record<string, unknown>,
    ...(value.id ? { id: mapId(context, 'database', value.id) } : {}),
    properties,
    rows,
    views,
    ...(value.activeViewId ? { activeViewId: mappedReference(context, 'view', value.activeViewId) } : {}),
    ...(Array.isArray(value.filters) ? { filters: value.filters.filter(isRecord).map(filter => cloneFilter(filter, context)) } : {}),
    ...(value.groupBy ? { groupBy: mappedReference(context, 'property', value.groupBy) } : {}),
    ...(value.sort ? { sort: cloneSort(value.sort, context) } : {}),
  };
};

const cloneNodeAttrs = (attrs: Record<string, unknown>, context: CloneContext): Record<string, unknown> => {
  const next: Record<string, unknown> = {};
  Object.entries(attrs).forEach(([key, value]) => {
    if (RUNTIME_NODE_ATTRS.has(key)) return;
    if (key === 'blockId') {
      if (value) next.blockId = mapId(context, 'block', value);
      return;
    }
    if (key === 'syncId') {
      if (value) next.syncId = context.options.preserveSyncIds ? value : mapId(context, 'sync', value);
      return;
    }
    if (key === 'database' && context.options.remapDatabaseIds) {
      next.database = cloneDatabase(value, context);
      return;
    }
    if (key === 'templateContent' && Array.isArray(value)) {
      next.templateContent = value.map(child => cloneNodeOrValue(child, context));
      return;
    }
    next[key] = cloneUnknown(value);
  });
  return next;
};

const cloneNodeOrValue = (value: unknown, context: CloneContext): unknown => {
  if (Array.isArray(value)) return value.map(child => cloneNodeOrValue(child, context));
  if (!isRecord(value)) return value;
  const looksLikeNode = typeof value.type === 'string' || Array.isArray(value.content) || typeof value.text === 'string';
  if (!looksLikeNode) return cloneUnknown(value);

  const next: Record<string, unknown> = {};
  Object.entries(value).forEach(([key, child]) => {
    if (key === 'attrs' && isRecord(child)) next.attrs = cloneNodeAttrs(child, context);
    else if (key === 'content' && Array.isArray(child)) next.content = child.map(item => cloneNodeOrValue(item, context));
    else next[key] = cloneUnknown(child);
  });
  return next;
};

export const cloneFragmentForPaste = <T extends DocumentFragmentJson>(
  fragment: T,
  options: CloneFragmentOptions = {},
): CloneFragmentResult<T> => {
  const context: CloneContext = {
    maps: createEmptyMaps(),
    options: {
      ...options,
      preserveSyncIds: options.preserveSyncIds ?? false,
      remapDatabaseIds: options.remapDatabaseIds ?? true,
    },
  };
  return {
    fragment: cloneNodeOrValue(fragment, context) as T,
    idMaps: context.maps,
  };
};

const stripRuntimeValue = (value: unknown, options: StripFragmentRuntimeOptions): unknown => {
  if (Array.isArray(value)) return value.map(child => stripRuntimeValue(child, options));
  if (!isRecord(value)) return value;
  const next: Record<string, unknown> = {};
  Object.entries(value).forEach(([key, child]) => {
    if (key === 'attrs' && isRecord(child)) {
      const attrs: Record<string, unknown> = {};
      Object.entries(child).forEach(([attrName, attrValue]) => {
        if (
          attrName === 'blockId'
          || (attrName === 'syncId' && !options.preserveSyncIds)
          || RUNTIME_NODE_ATTRS.has(attrName)
        ) return;
        attrs[attrName] = stripRuntimeValue(attrValue, options);
      });
      next.attrs = attrs;
    } else {
      next[key] = stripRuntimeValue(child, options);
    }
  });
  return next;
};

export const stripFragmentRuntimeAttributes = <T extends DocumentFragmentJson>(
  fragment: T,
  options: StripFragmentRuntimeOptions = {},
): T => (
  stripRuntimeValue(fragment, options) as T
);

export const cloneNodeForPaste = (
  node: DocumentNodeJson,
  options: CloneFragmentOptions = {},
): CloneFragmentResult<DocumentNodeJson> => cloneFragmentForPaste(node, options);
