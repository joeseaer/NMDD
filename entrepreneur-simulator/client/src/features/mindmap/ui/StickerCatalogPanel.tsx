import {
  Search,
  Star,
  X,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from 'react';

import {
  readStickerCatalogPreferences,
  setFavoriteSticker,
  STICKER_CATALOG_PREFERENCES_EVENT,
  type StickerCatalogPreferences,
} from '../catalog/stickerRecentStore';
import type { StickerCatalogKind } from '../catalog/types';
import {
  BUILT_IN_STICKERS,
  builtInStickerById,
  filterBuiltInStickers,
  STICKER_CATEGORIES,
  type BuiltInStickerDescriptor,
  type BuiltInStickerId,
} from './stickerCatalog';

export const STICKER_CATALOG_DRAG_MIME = 'application/x-nmdd-mindmap-sticker-catalog';

type CatalogScope = 'all' | 'favorites' | 'recent';
type KindFilter = StickerCatalogKind | 'all';

export interface StickerCatalogPanelProps {
  readonly busy?: boolean;
  readonly readOnly?: boolean;
  readonly onClose: () => void;
  readonly onInsert: (stickerId: BuiltInStickerId) => void;
}

const insertLabel = (sticker: BuiltInStickerDescriptor): string => (
  `插入${sticker.kind === 'illustration' ? '插画' : '贴纸'}：${sticker.label}`
);

const scopeLabels: Readonly<Record<CatalogScope, string>> = {
  all: '全部',
  favorites: '收藏',
  recent: '最近',
};

const kindLabels: Readonly<Record<KindFilter, string>> = {
  all: '全部类型',
  illustration: '插画',
  sticker: '贴纸',
};

const preferenceItems = (
  preferences: StickerCatalogPreferences,
  scope: CatalogScope,
  candidates: readonly BuiltInStickerDescriptor[],
): readonly BuiltInStickerDescriptor[] => {
  if (scope === 'all') return candidates;
  const orderedIds = scope === 'recent' ? preferences.recent : preferences.favorites;
  const candidateIds = new Set(candidates.map(({ id }) => id));
  return orderedIds.flatMap((id) => {
    const sticker = candidateIds.has(id) ? builtInStickerById(id) : undefined;
    return sticker ? [sticker] : [];
  });
};

const focusGridItem = (container: HTMLElement, index: number): void => {
  container.querySelector<HTMLButtonElement>(`[data-catalog-grid-index="${index}"]`)?.focus();
};

export const StickerCatalogPanel = ({
  busy = false,
  readOnly = false,
  onClose,
  onInsert,
}: StickerCatalogPanelProps) => {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<CatalogScope>('all');
  const [kind, setKind] = useState<KindFilter>('all');
  const [categoryId, setCategoryId] = useState('all');
  const [activeIndex, setActiveIndex] = useState(0);
  const [preferences, setPreferences] = useState(readStickerCatalogPreferences);

  useEffect(() => {
    const refresh = (): void => setPreferences(readStickerCatalogPreferences());
    window.addEventListener(STICKER_CATALOG_PREFERENCES_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(STICKER_CATALOG_PREFERENCES_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const filtered = useMemo(() => preferenceItems(
    preferences,
    scope,
    filterBuiltInStickers({
      ...(categoryId === 'all' ? {} : { categoryId }),
      kind,
      query,
    }),
  ), [categoryId, kind, preferences, query, scope]);

  useEffect(() => setActiveIndex(0), [categoryId, kind, query, scope]);

  const favoriteIds = useMemo(() => new Set(preferences.favorites), [preferences.favorites]);
  const onGridKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (filtered.length === 0) return;
    const movement = event.key === 'ArrowRight'
      ? 1
      : event.key === 'ArrowLeft'
        ? -1
        : event.key === 'ArrowDown'
          ? 4
          : event.key === 'ArrowUp'
            ? -4
            : 0;
    let next = activeIndex;
    if (movement !== 0) next = Math.max(0, Math.min(filtered.length - 1, activeIndex + movement));
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = filtered.length - 1;
    else return;
    event.preventDefault();
    setActiveIndex(next);
    focusGridItem(event.currentTarget, next);
  };

  return (
    <aside
      aria-label="贴纸与插画"
      data-testid="mindmap-sticker-catalog"
      data-catalog-result-count={filtered.length}
      className="absolute bottom-3 right-3 top-14 z-40 flex w-[24rem] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-2xl"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key !== 'Escape') return;
        event.preventDefault();
        if (query) setQuery('');
        else onClose();
      }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <header className="border-b border-slate-200 px-3 pb-2.5 pt-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">贴纸与插画</h3>
            <p className="mt-0.5 text-[10px] text-slate-500">
              {BUILT_IN_STICKERS.length} 项许可素材 · {STICKER_CATEGORIES.length} 类 · 同源安全导出
            </p>
          </div>
          <button
            type="button"
            className="rounded p-1 text-slate-500 hover:bg-slate-100"
            aria-label="关闭贴纸与插画"
            onClick={onClose}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>

        <label className="relative mt-2.5 block">
          <span className="sr-only">搜索贴纸与插画</span>
          <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            value={query}
            maxLength={128}
            autoComplete="off"
            aria-label="搜索贴纸与插画"
            placeholder="搜索名称、分类或关键词"
            className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-8 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          {query ? (
            <button
              type="button"
              aria-label="清除贴纸搜索"
              className="absolute right-1.5 top-1.5 rounded p-1 text-slate-400 hover:bg-slate-100"
              onClick={() => setQuery('')}
            >
              <X size={13} aria-hidden="true" />
            </button>
          ) : null}
        </label>

        <div className="mt-2 flex items-center gap-1" role="group" aria-label="贴纸目录范围">
          {(Object.keys(scopeLabels) as CatalogScope[]).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={scope === value}
              className={`rounded-md px-2 py-1 text-[11px] ${scope === value
                ? 'bg-slate-800 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              onClick={() => setScope(value)}
            >
              {scopeLabels[value]}
              {value === 'recent' ? ` ${preferences.recent.length}` : ''}
              {value === 'favorites' ? ` ${preferences.favorites.length}` : ''}
            </button>
          ))}
          <span className="ml-auto text-[10px] tabular-nums text-slate-400" aria-live="polite">
            {filtered.length} 项
          </span>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <label className="text-[10px] text-slate-500">
            类型
            <select
              aria-label="筛选素材类型"
              value={kind}
              className="mt-0.5 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
              onChange={(event) => setKind(event.currentTarget.value as KindFilter)}
            >
              {(Object.keys(kindLabels) as KindFilter[]).map((value) => (
                <option key={value} value={value}>{kindLabels[value]}</option>
              ))}
            </select>
          </label>
          <label className="text-[10px] text-slate-500">
            分类
            <select
              aria-label="筛选素材分类"
              value={categoryId}
              className="mt-0.5 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
              onChange={(event) => setCategoryId(event.currentTarget.value)}
            >
              <option value="all">全部分类</option>
              {STICKER_CATEGORIES.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label}（{category.itemCount}）
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {filtered.length > 0 ? (
          <div
            role="grid"
            aria-label="贴纸与插画搜索结果"
            aria-colcount={4}
            aria-rowcount={Math.ceil(filtered.length / 4)}
            className="grid grid-cols-4 gap-2"
            onKeyDown={onGridKeyDown}
          >
            {filtered.map((sticker, index) => {
              const favorite = favoriteIds.has(sticker.id);
              return (
                <div
                  key={sticker.id}
                  role="gridcell"
                  aria-rowindex={Math.floor(index / 4) + 1}
                  aria-colindex={(index % 4) + 1}
                  className="group relative min-w-0 rounded-lg border border-slate-200 bg-slate-50 hover:border-blue-300 hover:bg-blue-50"
                >
                  <button
                    type="button"
                    draggable={!readOnly && !busy}
                    disabled={readOnly || busy}
                    tabIndex={index === activeIndex ? 0 : -1}
                    className="flex h-[6.65rem] w-full min-w-0 flex-col items-center justify-center rounded-lg px-1.5 pb-5 pt-1.5 text-center disabled:cursor-not-allowed disabled:opacity-45"
                    aria-label={insertLabel(sticker)}
                    title={`${sticker.label} · ${STICKER_CATEGORIES.find(({ id }) => id === sticker.categoryId)?.label ?? sticker.categoryId}`}
                    data-catalog-grid-index={index}
                    data-sticker-catalog-id={sticker.id}
                    data-sticker-catalog-kind={sticker.kind}
                    onFocus={() => setActiveIndex(index)}
                    onClick={() => onInsert(sticker.id)}
                    onDragStart={(event: DragEvent<HTMLButtonElement>) => {
                      if (readOnly || busy) {
                        event.preventDefault();
                        return;
                      }
                      event.dataTransfer.effectAllowed = 'copy';
                      event.dataTransfer.setData(STICKER_CATALOG_DRAG_MIME, sticker.id);
                    }}
                  >
                    <img
                      src={sticker.publicUrl}
                      alt=""
                      width={sticker.kind === 'illustration' ? 68 : 58}
                      height={sticker.kind === 'illustration' ? 51 : 58}
                      draggable={false}
                      loading="lazy"
                      decoding="async"
                      className={`${sticker.kind === 'illustration' ? 'h-[3.2rem] w-[4.25rem]' : 'h-[3.65rem] w-[3.65rem]'} pointer-events-none object-contain`}
                    />
                    <span className="mt-1 w-full truncate text-[9px] text-slate-700">{sticker.label}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`${favorite ? '取消收藏' : '收藏'}：${sticker.label}`}
                    aria-pressed={favorite}
                    className={`absolute bottom-1 right-1 rounded p-0.5 ${favorite
                      ? 'bg-amber-100 text-amber-600'
                      : 'text-slate-300 opacity-0 hover:bg-white hover:text-amber-500 focus:opacity-100 group-hover:opacity-100'}`}
                    onClick={() => setPreferences(setFavoriteSticker(sticker.id, !favorite))}
                  >
                    <Star size={11} fill={favorite ? 'currentColor' : 'none'} aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex min-h-36 flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 px-4 text-center">
            <Search size={22} className="text-slate-300" aria-hidden="true" />
            <p className="mt-2 text-xs font-medium text-slate-600">没有匹配的素材</p>
            <p className="mt-1 text-[10px] text-slate-400">换个名称、分类或关键词试试。</p>
            <button
              type="button"
              className="mt-2 rounded border border-slate-200 px-2 py-1 text-[10px] text-slate-600"
              onClick={() => {
                setQuery('');
                setScope('all');
                setKind('all');
                setCategoryId('all');
              }}
            >
              清除全部筛选
            </button>
          </div>
        )}
      </div>

      {busy ? (
        <p className="border-t border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700" role="status">
          正在添加贴纸…
        </p>
      ) : null}
      {readOnly ? (
        <p className="border-t border-slate-100 bg-slate-50 px-3 py-2 text-[10px] text-slate-500">
          只读模式可浏览目录，但不能插入或拖放素材。
        </p>
      ) : null}
    </aside>
  );
};
