import { FileText, Search, Workflow, X } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';

import type { MindMapDocumentV1 } from '../domain/types';
import {
  internalLinkTargetKey,
  listInternalLinkTargets,
  type InternalLinkTarget,
  type InternalLinkTargetOption,
} from './internalLinkPlanning';

export interface InternalLinkPickerProps {
  readonly document: MindMapDocumentV1;
  readonly initialTarget?: InternalLinkTarget;
  readonly initialTitle?: string;
  readonly submitLabel?: string;
  onSubmit(target: InternalLinkTarget, title: string): void;
  onCancel(): void;
}

const optionTarget = (option: InternalLinkTargetOption): InternalLinkTarget => option.kind === 'sheet'
  ? { kind: 'sheet', targetSheetId: option.sheetId }
  : {
      kind: 'topic',
      targetSheetId: option.sheetId,
      targetTopicId: option.topicId!,
    };

const optionPrimaryLabel = (option: InternalLinkTargetOption): string => option.kind === 'sheet'
  ? option.sheetTitle
  : option.topicTitle ?? '未命名主题';

const optionSecondaryLabel = (option: InternalLinkTargetOption): string => option.kind === 'sheet'
  ? '整个 Sheet'
  : `${option.sheetTitle} / ${option.path.join(' / ')}`;

export const InternalLinkPicker = ({
  document,
  initialTarget,
  initialTitle = '',
  submitLabel = '保存内部链接',
  onSubmit,
  onCancel,
}: InternalLinkPickerProps) => {
  const [query, setQuery] = useState('');
  const [title, setTitle] = useState(initialTitle);
  const [selectedKey, setSelectedKey] = useState(
    initialTarget ? internalLinkTargetKey(initialTarget) : '',
  );
  const [error, setError] = useState<string | null>(null);
  const options = useMemo(
    () => listInternalLinkTargets(document, { query }),
    [document, query],
  );
  const allTargetsByKey = useMemo(() => new Map(
    listInternalLinkTargets(document).map((option) => [option.key, option]),
  ), [document]);
  const selected = allTargetsByKey.get(selectedKey);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!selected) {
      setError('请选择一个仍然存在的 Sheet 或主题。');
      return;
    }
    setError(null);
    onSubmit(optionTarget(selected), title);
  };

  return (
    <form className="space-y-3" aria-label="内部链接编辑器" onSubmit={submit}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold text-slate-800">链接到 Sheet 或主题</h3>
          <p className="mt-0.5 text-[10px] text-slate-500">可跨 Sheet 跳转；目标被删除后会明确显示为失效。</p>
        </div>
        <button
          type="button"
          className="rounded p-1 text-slate-500 hover:bg-slate-100"
          aria-label="取消内部链接"
          onClick={onCancel}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      <label className="relative block">
        <span className="sr-only">搜索 Sheet 或主题</span>
        <Search
          size={14}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
          aria-hidden="true"
        />
        <input
          value={query}
          className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-2.5 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          aria-label="搜索 Sheet 或主题"
          placeholder="输入 Sheet、主题或路径"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      <div
        className="max-h-52 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/60 p-1"
        role="listbox"
        aria-label="内部链接目标"
      >
        {options.length === 0 ? (
          <p className="px-2 py-5 text-center text-xs text-slate-400">没有匹配的 Sheet 或主题</p>
        ) : options.map((option) => {
          const isSelected = option.key === selectedKey;
          const Icon = option.kind === 'sheet' ? FileText : Workflow;
          return (
            <button
              key={option.key}
              type="button"
              role="option"
              aria-selected={isSelected}
              className={`mb-0.5 flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left last:mb-0 ${
                isSelected
                  ? 'bg-blue-100 text-blue-900 ring-1 ring-blue-300'
                  : 'text-slate-700 hover:bg-white'
              }`}
              style={option.kind === 'topic' ? { paddingLeft: `${8 + Math.min(option.depth, 8) * 10}px` } : undefined}
              onClick={() => {
                setSelectedKey(option.key);
                setError(null);
              }}
            >
              <Icon size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium">{optionPrimaryLabel(option)}</span>
                <span className="block truncate text-[10px] text-slate-500">{optionSecondaryLabel(option)}</span>
              </span>
            </button>
          );
        })}
      </div>

      <label className="block text-[11px] font-medium text-slate-600">
        显示标题（可选）
        <input
          value={title}
          className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          aria-label="内部链接显示标题"
          maxLength={4096}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>

      {error ? <p role="alert" className="text-[11px] text-red-600">{error}</p> : null}

      <div className="flex gap-2">
        <button
          type="submit"
          className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700"
        >
          {submitLabel}
        </button>
        <button
          type="button"
          className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"
          onClick={onCancel}
        >
          取消
        </button>
      </div>
    </form>
  );
};

