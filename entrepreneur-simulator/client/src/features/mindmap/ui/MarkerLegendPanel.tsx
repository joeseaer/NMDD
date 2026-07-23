import {
  ArrowDown,
  ArrowUp,
  Check,
  Flag,
  Library,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';

import type {
  MarkerDefinitionId,
  MarkerGroupId,
  MindMapDocumentV1,
  SheetId,
  TopicId,
} from '../domain/types';
import { mindMapRichTextToPlainText } from '../view/text';
import {
  BUILTIN_MARKER_LIBRARY,
  installedBuiltinMarkerKeys,
  markerDefinitionDeleteImpact,
  markerDefinitionsForGroup,
  markerGroupDeleteImpact,
  markerInstancesForTopic,
  markerLegendDefinitionIds,
  orderedMarkerGroups,
  planCreateCustomMarkerGroupCommand,
  planCreateMarkerDefinitionCommand,
  planDeleteMarkerDefinitionCommand,
  planDeleteMarkerGroupCommand,
  planInstallBuiltinMarkerLibraryCommand,
  planMoveMarkerLegendCommand,
  planPatchMarkerLegendCommand,
  planRenameMarkerGroupCommand,
  planReorderMarkerDefinitionCommand,
  planReorderMarkerGroupCommand,
  planReorderMarkerLegendItemsCommand,
  planToggleTopicMarkerCommand,
  planUpdateMarkerDefinitionCommand,
  type MarkerLegendCommand,
} from './markerPlanning';
import { markerVisual } from './markerVisuals';
import { MarkerIcon } from './MarkerIcon';

export interface MarkerLegendPanelProps {
  readonly document: MindMapDocumentV1;
  readonly sheetId: SheetId;
  readonly topicId?: TopicId;
  readonly readOnly: boolean;
  onCommand(command: MarkerLegendCommand): void;
  onClose(): void;
}

const controlClass = 'rounded border border-slate-200 bg-white p-1 text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35';

const moveItem = <T,>(items: readonly T[], index: number, direction: 'up' | 'down'): T[] => {
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= items.length) return [...items];
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
};

export const MarkerLegendPanel = ({
  document,
  sheetId,
  topicId,
  readOnly,
  onCommand,
  onClose,
}: MarkerLegendPanelProps) => {
  const sheet = document.sheets[sheetId];
  const topic = topicId ? sheet?.topics[topicId] : undefined;
  const groups = useMemo(() => orderedMarkerGroups(document), [document]);
  const installedKeys = useMemo(() => installedBuiltinMarkerKeys(document), [document]);
  const topicMarkers = useMemo(() => topicId
    ? markerInstancesForTopic(document, sheetId, topicId)
    : [], [document, sheetId, topicId]);
  const activeByDefinition = useMemo(() => new Map(
    topicMarkers.map((marker) => [marker.markerDefinitionId, marker] as const),
  ), [topicMarkers]);
  const allDefinitions = useMemo(() => groups.flatMap((group) =>
    markerDefinitionsForGroup(document, group.id)), [document, groups]);
  const legendItemOrder = useMemo(() => markerLegendDefinitionIds(document, sheetId), [document, sheetId]);

  const [error, setError] = useState<string | null>(null);
  const [customGroupName, setCustomGroupName] = useState('');
  const [customGroupExclusive, setCustomGroupExclusive] = useState(true);
  const [editingGroupId, setEditingGroupId] = useState<MarkerGroupId | null>(null);
  const [editingGroupName, setEditingGroupName] = useState('');
  const [creatingDefinitionGroupId, setCreatingDefinitionGroupId] = useState<MarkerGroupId | null>(null);
  const [newDefinitionName, setNewDefinitionName] = useState('');
  const [newDefinitionShape, setNewDefinitionShape] = useState('custom-diamond');
  const [editingDefinitionId, setEditingDefinitionId] = useState<MarkerDefinitionId | null>(null);
  const [editingDefinitionName, setEditingDefinitionName] = useState('');
  const [confirmGroupId, setConfirmGroupId] = useState<MarkerGroupId | null>(null);
  const [confirmDefinitionId, setConfirmDefinitionId] = useState<MarkerDefinitionId | null>(null);
  const [markerQuery, setMarkerQuery] = useState('');
  const [legendTitle, setLegendTitle] = useState(sheet?.markerLegend.title ?? '标记图例');
  const [legendX, setLegendX] = useState(String(sheet?.markerLegend.position.x ?? 0));
  const [legendY, setLegendY] = useState(String(sheet?.markerLegend.position.y ?? 0));
  const topicMarkerGroups = useMemo(() => {
    const query = markerQuery.normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
    return groups.flatMap((group) => {
      const definitions = markerDefinitionsForGroup(document, group.id);
      if (!query) return [{ group, definitions }];
      if (group.name.normalize('NFKC').toLocaleLowerCase('zh-CN').includes(query)) {
        return [{ group, definitions }];
      }
      const matches = definitions.filter((definition) => [
        definition.name,
        definition.source.kind === 'builtin' ? definition.source.key : '',
        String(definition.semanticValue ?? ''),
      ].join(' ').normalize('NFKC').toLocaleLowerCase('zh-CN').includes(query));
      return matches.length > 0 ? [{ group, definitions: matches }] : [];
    });
  }, [document, groups, markerQuery]);
  const topicMarkerResultCount = topicMarkerGroups.reduce(
    (count, entry) => count + entry.definitions.length,
    0,
  );

  useEffect(() => {
    setLegendTitle(sheet?.markerLegend.title ?? '标记图例');
    setLegendX(String(sheet?.markerLegend.position.x ?? 0));
    setLegendY(String(sheet?.markerLegend.position.y ?? 0));
    setError(null);
  }, [sheet?.markerLegend.position.x, sheet?.markerLegend.position.y, sheet?.markerLegend.title, sheetId]);

  if (!sheet) return null;

  const dispatch = (command: MarkerLegendCommand): boolean => {
    try {
      onCommand(command);
      setError(null);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    }
  };

  const submitCustomGroup = (event: FormEvent): void => {
    event.preventDefault();
    if (readOnly) return;
    try {
      const command = planCreateCustomMarkerGroupCommand({
        document,
        sheetId,
        name: customGroupName,
        exclusive: customGroupExclusive,
      });
      if (dispatch(command)) setCustomGroupName('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const submitGroupRename = (event: FormEvent): void => {
    event.preventDefault();
    if (!editingGroupId || readOnly) return;
    try {
      if (dispatch(planRenameMarkerGroupCommand({
        document,
        sheetId,
        markerGroupId: editingGroupId,
        name: editingGroupName,
      }))) setEditingGroupId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const submitDefinition = (event: FormEvent): void => {
    event.preventDefault();
    if (!creatingDefinitionGroupId || readOnly) return;
    try {
      if (dispatch(planCreateMarkerDefinitionCommand({
        document,
        sheetId,
        markerGroupId: creatingDefinitionGroupId,
        name: newDefinitionName,
        sourceKey: newDefinitionShape,
      }))) {
        setNewDefinitionName('');
        setCreatingDefinitionGroupId(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const submitDefinitionRename = (event: FormEvent): void => {
    event.preventDefault();
    if (!editingDefinitionId || readOnly) return;
    try {
      if (dispatch(planUpdateMarkerDefinitionCommand({
        document,
        sheetId,
        markerDefinitionId: editingDefinitionId,
        name: editingDefinitionName,
      }))) setEditingDefinitionId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const saveLegendTitle = (): void => {
    if (readOnly) return;
    try {
      dispatch(planPatchMarkerLegendCommand({
        document,
        sheetId,
        title: legendTitle.trim() ? legendTitle : null,
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const saveLegendPosition = (): void => {
    if (readOnly) return;
    try {
      dispatch(planMoveMarkerLegendCommand({
        document,
        sheetId,
        position: { x: Number(legendX), y: Number(legendY) },
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <aside
      className="nowheel nodrag flex max-h-full w-[23rem] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white/98 shadow-2xl backdrop-blur"
      aria-label="标记与图例"
      data-testid="mindmap-marker-legend-panel"
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            <Flag size={15} aria-hidden="true" />标记与图例
          </h2>
          <p className="truncate text-[11px] text-slate-500">
            {topic ? `当前主题：${mindMapRichTextToPlainText(topic.title) || '未命名主题'}` : '管理文档标记库与当前画布图例'}
          </p>
        </div>
        <button type="button" className={controlClass} aria-label="关闭标记与图例" onClick={onClose}>
          <X size={15} aria-hidden="true" />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <section aria-labelledby="topic-marker-heading">
          <div className="mb-2 flex items-center justify-between">
            <h3 id="topic-marker-heading" className="text-xs font-semibold text-slate-800">主题标记</h3>
            <span className="text-[10px] text-slate-400">{topicMarkers.length} 个已应用</span>
          </div>
          {groups.length > 0 ? (
            <label className="relative mb-2 block">
              <span className="sr-only">搜索标记目录</span>
              <Search size={12} className="pointer-events-none absolute left-2 top-2 text-slate-400" aria-hidden="true" />
              <input
                type="search"
                value={markerQuery}
                maxLength={128}
                autoComplete="off"
                aria-label="搜索标记目录"
                placeholder="搜索名称、分组或标记键"
                className="w-full rounded-md border border-slate-200 py-1.5 pl-7 pr-12 text-[11px] outline-none focus:border-blue-400"
                onChange={(event) => setMarkerQuery(event.currentTarget.value)}
              />
              <span className="pointer-events-none absolute right-2 top-1.5 text-[9px] tabular-nums text-slate-400">
                {topicMarkerResultCount}
              </span>
            </label>
          ) : null}
          {!topic ? (
            <p className="rounded-lg border border-dashed border-slate-200 p-3 text-xs text-slate-500">
              选择一个主题后可添加、替换或移除标记。
            </p>
          ) : groups.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 p-3 text-xs text-slate-500">
              文档中还没有标记组，请先安装标准库或新建自定义组。
            </p>
          ) : (
            <div className="space-y-2.5">
              {topicMarkerGroups.map(({ group, definitions }) => {
                return (
                  <fieldset key={group.id} className="rounded-lg border border-slate-200 p-2">
                    <legend className="px-1 text-[11px] font-medium text-slate-700">
                      {group.name} · {group.exclusive ? '同组替换' : '同组可叠加'}
                    </legend>
                    <div className="flex flex-wrap gap-1.5">
                      {definitions.map((definition) => {
                        const active = activeByDefinition.get(definition.id);
                        const visual = markerVisual(definition);
                        const label = `${active ? '移除' : group.exclusive ? '应用或替换为' : '应用'}标记：${definition.name}（${group.name}）`;
                        return readOnly ? (
                          <span
                            key={definition.id}
                            className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] ${active
                              ? visual.toneClassName
                              : 'border-slate-200 bg-slate-50 text-slate-500'}`}
                            aria-label={`${definition.name}${active ? '，已应用' : '，未应用'}`}
                          >
                            <MarkerIcon visual={visual} size={14} className="shrink-0" />{definition.name}
                            {active ? <Check size={11} aria-hidden="true" /> : null}
                          </span>
                        ) : (
                          <button
                            key={definition.id}
                            type="button"
                            className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] ${active
                              ? visual.toneClassName
                              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                            aria-label={label}
                            aria-pressed={Boolean(active)}
                            onClick={() => {
                              try {
                                dispatch(planToggleTopicMarkerCommand({
                                  document,
                                  sheetId,
                                  topicId: topic.id,
                                  markerDefinitionId: definition.id,
                                }));
                              } catch (cause) {
                                setError(cause instanceof Error ? cause.message : String(cause));
                              }
                            }}
                          >
                            <MarkerIcon visual={visual} size={14} className="shrink-0" />{definition.name}
                            {active ? <Check size={11} aria-hidden="true" /> : null}
                          </button>
                        );
                      })}
                      {definitions.length === 0 ? <span className="text-[10px] text-slate-400">暂无标记</span> : null}
                    </div>
                  </fieldset>
                );
              })}
              {topicMarkerGroups.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-200 p-3 text-center text-xs text-slate-500">
                  没有匹配的标记。
                </p>
              ) : null}
            </div>
          )}
        </section>

        <section className="border-t border-slate-100 pt-3" aria-labelledby="marker-library-heading">
          <h3 id="marker-library-heading" className="text-xs font-semibold text-slate-800">标记库</h3>
          <div className="mt-2 rounded-lg border border-blue-100 bg-blue-50/70 p-2.5">
            <div className="flex items-start gap-2">
              <Library size={15} className="mt-0.5 shrink-0 text-blue-600" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium text-blue-900">标准标记组</p>
                <p className="mt-0.5 text-[10px] leading-4 text-blue-700">
                  {BUILTIN_MARKER_LIBRARY.map((spec) => `${spec.name}${installedKeys.has(spec.key) ? ' ✓' : ''}`).join(' · ')}
                </p>
              </div>
            </div>
            {!readOnly && installedKeys.size < BUILTIN_MARKER_LIBRARY.length ? (
              <button
                type="button"
                className="mt-2 w-full rounded-md bg-blue-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                onClick={() => {
                  try {
                    dispatch(planInstallBuiltinMarkerLibraryCommand({ document, sheetId }));
                  } catch (cause) {
                    setError(cause instanceof Error ? cause.message : String(cause));
                  }
                }}
              >
                安装缺少的标准标记组
              </button>
            ) : null}
          </div>

          {!readOnly ? (
            <form className="mt-3 rounded-lg border border-dashed border-slate-200 p-2.5" onSubmit={submitCustomGroup} aria-label="新建自定义标记组">
              <label className="block text-[10px] font-medium text-slate-600">
                新组名称
                <input
                  className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-blue-400"
                  aria-label="新自定义标记组名称"
                  value={customGroupName}
                  maxLength={512}
                  onChange={(event) => setCustomGroupName(event.currentTarget.value)}
                />
              </label>
              <label className="mt-2 flex items-center gap-2 text-[11px] text-slate-600">
                <input
                  type="checkbox"
                  aria-label="自定义标记组同组互斥"
                  checked={customGroupExclusive}
                  onChange={(event) => setCustomGroupExclusive(event.currentTarget.checked)}
                />
                同组互斥（新标记替换旧标记）
              </label>
              <button type="submit" className="mt-2 inline-flex items-center gap-1 rounded bg-slate-800 px-2.5 py-1.5 text-xs text-white">
                <Plus size={12} aria-hidden="true" />新建自定义组
              </button>
            </form>
          ) : null}

          <div className="mt-3 space-y-2">
            {groups.map((group, groupIndex) => {
              const definitions = markerDefinitionsForGroup(document, group.id);
              const groupImpact = group.kind === 'custom' ? markerGroupDeleteImpact(document, group.id) : null;
              return (
                <article key={group.id} className="rounded-lg border border-slate-200 bg-white p-2.5" aria-label={`标记组 ${group.name}`}>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-slate-800">{group.name}</p>
                      <p className="text-[9px] text-slate-400">{group.kind === 'builtin' ? '内置' : '自定义'} · {group.exclusive ? '互斥' : '可叠加'} · {definitions.length} 项</p>
                    </div>
                    {!readOnly && group.kind === 'custom' ? (
                      <div className="flex gap-1">
                        <button type="button" className={controlClass} aria-label={`重命名标记组 ${group.name}`} onClick={() => {
                          setEditingGroupId(group.id);
                          setEditingGroupName(group.name);
                        }}><Pencil size={11} aria-hidden="true" /></button>
                        <button type="button" className={controlClass} aria-label={`上移标记组 ${group.name}`} disabled={groupIndex === 0} onClick={() => {
                          try { dispatch(planReorderMarkerGroupCommand({ document, sheetId, markerGroupId: group.id, direction: 'up' })); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
                        }}><ArrowUp size={11} aria-hidden="true" /></button>
                        <button type="button" className={controlClass} aria-label={`下移标记组 ${group.name}`} disabled={groupIndex === groups.length - 1} onClick={() => {
                          try { dispatch(planReorderMarkerGroupCommand({ document, sheetId, markerGroupId: group.id, direction: 'down' })); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
                        }}><ArrowDown size={11} aria-hidden="true" /></button>
                        <button type="button" className={`${controlClass} text-red-500`} aria-label={`删除标记组 ${group.name}`} onClick={() => setConfirmGroupId(group.id)}><Trash2 size={11} aria-hidden="true" /></button>
                      </div>
                    ) : null}
                  </div>

                  {editingGroupId === group.id && !readOnly ? (
                    <form className="mt-2 flex gap-1" onSubmit={submitGroupRename} aria-label={`重命名标记组 ${group.name}`}>
                      <input className="min-w-0 flex-1 rounded border border-slate-200 px-2 py-1 text-xs" aria-label="标记组新名称" value={editingGroupName} onChange={(event) => setEditingGroupName(event.currentTarget.value)} />
                      <button type="submit" className={controlClass} aria-label="保存标记组名称"><Save size={11} aria-hidden="true" /></button>
                      <button type="button" className={controlClass} aria-label="取消重命名标记组" onClick={() => setEditingGroupId(null)}><X size={11} aria-hidden="true" /></button>
                    </form>
                  ) : null}

                  {confirmGroupId === group.id && groupImpact && !readOnly ? (
                    <div className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-[10px] leading-4 text-red-700" role="alertdialog" aria-label={`确认删除标记组 ${group.name}`}>
                      将删除 {groupImpact.definitions} 个定义、{groupImpact.instances} 个主题实例，并从 {groupImpact.legendItems} 个图例位置清理引用。此操作可撤销。
                      <div className="mt-1.5 flex gap-1">
                        <button type="button" className="rounded bg-red-600 px-2 py-1 text-white" onClick={() => {
                          try {
                            if (dispatch(planDeleteMarkerGroupCommand({ document, sheetId, markerGroupId: group.id }))) setConfirmGroupId(null);
                          } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
                        }}>确认删除</button>
                        <button type="button" className="rounded border border-red-200 bg-white px-2 py-1" onClick={() => setConfirmGroupId(null)}>取消</button>
                      </div>
                    </div>
                  ) : null}

                  <ul className="mt-2 space-y-1" aria-label={`${group.name} 标记定义`}>
                    {definitions.map((definition, definitionIndex) => {
                      const visual = markerVisual(definition);
                      const impact = markerDefinitionDeleteImpact(document, definition.id);
                      return (
                        <li key={definition.id} className="rounded border border-slate-100 bg-slate-50/70 px-2 py-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className={`inline-flex h-5 w-5 items-center justify-center rounded border ${visual.toneClassName}`} aria-hidden="true"><MarkerIcon visual={visual} size={14} /></span>
                            <span className="min-w-0 flex-1 truncate text-[11px] text-slate-700">{definition.name}</span>
                            {!readOnly && group.kind === 'custom' ? (
                              <div className="flex gap-1">
                                <button type="button" className={controlClass} aria-label={`重命名标记 ${definition.name}`} onClick={() => {
                                  setEditingDefinitionId(definition.id);
                                  setEditingDefinitionName(definition.name);
                                }}><Pencil size={10} aria-hidden="true" /></button>
                                <button type="button" className={controlClass} aria-label={`上移标记 ${definition.name}`} disabled={definitionIndex === 0} onClick={() => {
                                  try { dispatch(planReorderMarkerDefinitionCommand({ document, sheetId, markerDefinitionId: definition.id, direction: 'up' })); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
                                }}><ArrowUp size={10} aria-hidden="true" /></button>
                                <button type="button" className={controlClass} aria-label={`下移标记 ${definition.name}`} disabled={definitionIndex === definitions.length - 1} onClick={() => {
                                  try { dispatch(planReorderMarkerDefinitionCommand({ document, sheetId, markerDefinitionId: definition.id, direction: 'down' })); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
                                }}><ArrowDown size={10} aria-hidden="true" /></button>
                                <button type="button" className={`${controlClass} text-red-500`} aria-label={`删除标记 ${definition.name}`} onClick={() => setConfirmDefinitionId(definition.id)}><Trash2 size={10} aria-hidden="true" /></button>
                              </div>
                            ) : null}
                          </div>
                          {editingDefinitionId === definition.id && !readOnly ? (
                            <form className="mt-1.5 flex gap-1" onSubmit={submitDefinitionRename} aria-label={`重命名标记 ${definition.name}`}>
                              <input className="min-w-0 flex-1 rounded border border-slate-200 px-2 py-1 text-[11px]" aria-label="标记新名称" value={editingDefinitionName} onChange={(event) => setEditingDefinitionName(event.currentTarget.value)} />
                              <button type="submit" className={controlClass} aria-label="保存标记名称"><Save size={10} aria-hidden="true" /></button>
                              <button type="button" className={controlClass} aria-label="取消重命名标记" onClick={() => setEditingDefinitionId(null)}><X size={10} aria-hidden="true" /></button>
                            </form>
                          ) : null}
                          {confirmDefinitionId === definition.id && !readOnly ? (
                            <div className="mt-1.5 rounded border border-red-200 bg-red-50 p-1.5 text-[10px] text-red-700" role="alertdialog" aria-label={`确认删除标记 ${definition.name}`}>
                              将清理 {impact.instances} 个主题实例和 {impact.legendItems} 个图例引用；操作可撤销。
                              <div className="mt-1 flex gap-1">
                                <button type="button" className="rounded bg-red-600 px-2 py-0.5 text-white" onClick={() => {
                                  try {
                                    if (dispatch(planDeleteMarkerDefinitionCommand({ document, sheetId, markerDefinitionId: definition.id }))) setConfirmDefinitionId(null);
                                  } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
                                }}>确认删除</button>
                                <button type="button" className="rounded border border-red-200 bg-white px-2 py-0.5" onClick={() => setConfirmDefinitionId(null)}>取消</button>
                              </div>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>

                  {!readOnly && group.kind === 'custom' ? (
                    creatingDefinitionGroupId === group.id ? (
                      <form className="mt-2 grid grid-cols-[1fr_auto] gap-1" onSubmit={submitDefinition} aria-label={`向 ${group.name} 添加标记`}>
                        <input className="min-w-0 rounded border border-slate-200 px-2 py-1 text-[11px]" aria-label="新标记名称" value={newDefinitionName} onChange={(event) => setNewDefinitionName(event.currentTarget.value)} />
                        <select className="rounded border border-slate-200 bg-white px-1 text-[11px]" aria-label="新标记图形" value={newDefinitionShape} onChange={(event) => setNewDefinitionShape(event.currentTarget.value)}>
                          <option value="custom-diamond">◆ 菱形</option>
                          <option value="custom-circle">● 圆形</option>
                          <option value="custom-square">■ 方形</option>
                          <option value="custom-triangle">▲ 三角</option>
                        </select>
                        <div className="col-span-2 flex gap-1">
                          <button type="submit" className="rounded bg-violet-600 px-2 py-1 text-[10px] text-white">保存标记</button>
                          <button type="button" className="rounded border border-slate-200 px-2 py-1 text-[10px]" onClick={() => setCreatingDefinitionGroupId(null)}>取消</button>
                        </div>
                      </form>
                    ) : (
                      <button type="button" className="mt-2 inline-flex items-center gap-1 rounded border border-dashed border-violet-200 px-2 py-1 text-[10px] text-violet-700" onClick={() => {
                        setCreatingDefinitionGroupId(group.id);
                        setNewDefinitionName('');
                      }}><Plus size={10} aria-hidden="true" />添加自定义标记</button>
                    )
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>

        <section className="border-t border-slate-100 pt-3" aria-labelledby="marker-legend-heading">
          <div className="flex items-center justify-between">
            <h3 id="marker-legend-heading" className="text-xs font-semibold text-slate-800">画布图例</h3>
            {readOnly ? (
              <span className="text-[10px] text-slate-500">{sheet.markerLegend.visible ? '已显示' : '已隐藏'}</span>
            ) : (
              <label className="flex items-center gap-1.5 text-[10px] text-slate-600">
                <input
                  type="checkbox"
                  aria-label="显示标记图例"
                  checked={sheet.markerLegend.visible}
                  onChange={(event) => {
                    try { dispatch(planPatchMarkerLegendCommand({ document, sheetId, visible: event.currentTarget.checked })); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
                  }}
                />显示
              </label>
            )}
          </div>
          {readOnly ? (
            <dl className="mt-2 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-2 text-[10px] text-slate-600">
              <div><dt className="text-slate-400">标题</dt><dd>{sheet.markerLegend.title || '标记图例'}</dd></div>
              <div><dt className="text-slate-400">位置</dt><dd>x {sheet.markerLegend.position.x} · y {sheet.markerLegend.position.y}</dd></div>
            </dl>
          ) : (
            <div className="mt-2 space-y-2">
              <div className="flex gap-1">
                <input className="min-w-0 flex-1 rounded border border-slate-200 px-2 py-1.5 text-xs" aria-label="标记图例标题" value={legendTitle} onChange={(event) => setLegendTitle(event.currentTarget.value)} />
                <button type="button" className={controlClass} aria-label="保存标记图例标题" onClick={saveLegendTitle}><Save size={12} aria-hidden="true" /></button>
              </div>
              <div className="grid grid-cols-[1fr_1fr_auto] gap-1">
                <input type="number" step="1" className="min-w-0 rounded border border-slate-200 px-2 py-1 text-xs" aria-label="标记图例 X 坐标" value={legendX} onChange={(event) => setLegendX(event.currentTarget.value)} />
                <input type="number" step="1" className="min-w-0 rounded border border-slate-200 px-2 py-1 text-xs" aria-label="标记图例 Y 坐标" value={legendY} onChange={(event) => setLegendY(event.currentTarget.value)} />
                <button type="button" className="rounded bg-slate-800 px-2 text-[10px] text-white" onClick={saveLegendPosition}>移动</button>
              </div>
            </div>
          )}

          <ul className="mt-2 space-y-1" aria-label="图例项目顺序">
            {allDefinitions.map((definition) => {
              const includedIndex = legendItemOrder.indexOf(definition.id);
              const included = includedIndex >= 0;
              const visual = markerVisual(definition);
              return (
                <li key={definition.id} className="flex items-center gap-1.5 rounded border border-slate-100 px-2 py-1.5 text-[10px] text-slate-600">
                  {!readOnly ? (
                    <input
                      type="checkbox"
                      aria-label={`图例包含 ${definition.name}`}
                      checked={included}
                      onChange={(event) => {
                        const next = event.currentTarget.checked
                          ? [...legendItemOrder, definition.id]
                          : legendItemOrder.filter((id) => id !== definition.id);
                        try { dispatch(planReorderMarkerLegendItemsCommand({ document, sheetId, itemOrder: next })); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
                      }}
                    />
                  ) : <span aria-hidden="true">{included ? '✓' : '–'}</span>}
                  <span className={`inline-flex h-4 w-4 items-center justify-center rounded border ${visual.toneClassName}`} aria-hidden="true"><MarkerIcon visual={visual} size={12} /></span>
                  <span className="min-w-0 flex-1 truncate">{definition.name}</span>
                  {included && !readOnly ? (
                    <>
                      <button type="button" className={controlClass} aria-label={`在图例中上移 ${definition.name}`} disabled={includedIndex === 0} onClick={() => {
                        dispatch(planReorderMarkerLegendItemsCommand({ document, sheetId, itemOrder: moveItem(legendItemOrder, includedIndex, 'up') }));
                      }}><ArrowUp size={9} aria-hidden="true" /></button>
                      <button type="button" className={controlClass} aria-label={`在图例中下移 ${definition.name}`} disabled={includedIndex === legendItemOrder.length - 1} onClick={() => {
                        dispatch(planReorderMarkerLegendItemsCommand({ document, sheetId, itemOrder: moveItem(legendItemOrder, includedIndex, 'down') }));
                      }}><ArrowDown size={9} aria-hidden="true" /></button>
                    </>
                  ) : null}
                </li>
              );
            })}
            {allDefinitions.length === 0 ? <li className="text-[10px] text-slate-400">暂无可显示的标记定义。</li> : null}
          </ul>
        </section>

        {error ? <p className="rounded-lg bg-red-50 px-2.5 py-2 text-xs text-red-700" role="alert">{error}</p> : null}
      </div>
    </aside>
  );
};
