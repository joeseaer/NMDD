import {
  useEffect,
  useId,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import {
  Bold,
  ChevronDown,
  ChevronRight,
  Italic,
  RotateCcw,
} from 'lucide-react';

import type { StyleProperties } from '../domain/types';
import type { StyleOverridePath } from './formatPlanning';
import {
  buildFormatSelectionModel,
  colorValueForInput,
  constrainFormatOverrides,
  type FormatFieldState,
  type FormatSelectionEntry,
} from './formatSelection';

const controlClassName = 'h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400';

const stateText = <T,>(state: FormatFieldState<T>): string =>
  state.kind === 'mixed' ? '混合' : state.kind === 'default' ? '默认' : '已设置';

const literalColorText = (
  state: FormatFieldState<{ readonly kind: 'literal'; readonly value: string } | { readonly kind: 'token'; readonly token: string }>,
): string => {
  if (state.kind !== 'value') return stateText(state);
  return state.value.kind === 'literal' ? state.value.value : `主题色 · ${state.value.token}`;
};

interface ColorControlProps {
  readonly label: string;
  readonly state: FormatFieldState<
    { readonly kind: 'literal'; readonly value: string }
    | { readonly kind: 'token'; readonly token: string }
  >;
  readonly disabled: boolean;
  onChange(value: string): void;
}

const ColorControl = ({ label, state, disabled, onChange }: ColorControlProps) => {
  const id = useId();
  const inputValue = colorValueForInput(state);
  const htmlColor = /^#[0-9a-f]{6}$/i.test(inputValue) ? inputValue : '#64748b';
  return (
    <div className="flex items-center justify-between gap-3">
      <label className="text-xs text-slate-600" htmlFor={id}>{label}</label>
      <div className="flex items-center gap-2">
        <span className="max-w-28 truncate text-[10px] text-slate-400" data-format-state={state.kind}>
          {literalColorText(state)}
        </span>
        <input
          id={id}
          type="color"
          className="h-8 w-10 cursor-pointer rounded-md border border-slate-200 bg-white p-1 disabled:cursor-not-allowed disabled:bg-slate-100"
          value={htmlColor}
          disabled={disabled}
          aria-describedby={`${id}-state`}
          onChange={(event) => onChange(event.currentTarget.value.toUpperCase())}
        />
        <span id={`${id}-state`} className="sr-only">当前值：{literalColorText(state)}</span>
      </div>
    </div>
  );
};

interface NumberControlProps {
  readonly label: string;
  readonly state: FormatFieldState<number>;
  readonly disabled: boolean;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly suffix?: string;
  readonly toDisplay?: (value: number) => number;
  readonly fromDisplay?: (value: number) => number;
  onCommit(value: number): void;
}

const NumberControl = ({
  label,
  state,
  disabled,
  min,
  max,
  step = 1,
  suffix,
  toDisplay = (value) => value,
  fromDisplay = (value) => value,
  onCommit,
}: NumberControlProps) => {
  const id = useId();
  const canonicalText = state.kind === 'value' ? String(toDisplay(state.value)) : '';
  const [draft, setDraft] = useState(canonicalText);
  useEffect(() => setDraft(canonicalText), [canonicalText]);

  const commit = (): void => {
    if (draft.trim() === '') return;
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(canonicalText);
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    setDraft(String(clamped));
    onCommit(fromDisplay(clamped));
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    commit();
  };

  return (
    <div className="flex items-center justify-between gap-3">
      <label className="text-xs text-slate-600" htmlFor={id}>{label}</label>
      <div className="flex items-center gap-1">
        <input
          id={id}
          type="number"
          className={`${controlClassName} w-24 text-right`}
          value={draft}
          placeholder={state.kind === 'mixed' ? '混合' : '默认'}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          data-format-state={state.kind}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
        />
        {suffix && <span className="w-5 text-[10px] text-slate-400">{suffix}</span>}
      </div>
    </div>
  );
};

interface ToggleControlProps {
  readonly label: string;
  readonly state: FormatFieldState<boolean>;
  readonly disabled: boolean;
  readonly icon: typeof Bold;
  onToggle(value: boolean): void;
}

const ToggleControl = ({ label, state, disabled, icon: Icon, onToggle }: ToggleControlProps) => {
  const active = state.kind === 'value' && state.value;
  return (
    <button
      type="button"
      className={`flex h-8 flex-1 items-center justify-center gap-1 rounded-md border px-2 text-xs outline-none focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-40 ${active ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600'}`}
      disabled={disabled}
      aria-label={label}
      aria-pressed={state.kind === 'mixed' ? 'mixed' : active}
      data-format-state={state.kind}
      onClick={() => onToggle(state.kind === 'value' ? !state.value : true)}
    >
      <Icon size={14} aria-hidden="true" />
      <span>{label}</span>
      {state.kind !== 'value' && <span className="text-[9px] text-slate-400">{stateText(state)}</span>}
    </button>
  );
};

interface FormatSectionProps {
  readonly title: string;
  readonly resetLabel: string;
  readonly disabled: boolean;
  readonly resetPaths: readonly StyleOverridePath[];
  onReset(paths: readonly StyleOverridePath[]): void;
  readonly children: ReactNode;
}

const FormatSection = ({
  title,
  resetLabel,
  disabled,
  resetPaths,
  onReset,
  children,
}: FormatSectionProps) => (
  <section className="space-y-2 border-t border-slate-100 py-3" aria-label={title}>
    <div className="flex items-center justify-between">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      <button
        type="button"
        className="rounded px-1.5 py-1 text-[10px] text-slate-400 outline-none hover:bg-slate-100 hover:text-slate-600 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-35"
        disabled={disabled}
        aria-label={resetLabel}
        onClick={() => onReset(resetPaths)}
      >
        重置
      </button>
    </div>
    {children}
  </section>
);

const dashPreset = (
  state: FormatFieldState<readonly number[]>,
): 'default' | 'mixed' | 'solid' | 'dashed' | 'dotted' | 'custom' => {
  if (state.kind !== 'value') return state.kind;
  const dash = state.value;
  if (dash.length === 0) return 'solid';
  if (dash.length === 2 && dash[0] === 6 && dash[1] === 4) return 'dashed';
  if (dash.length === 2 && dash[0] === 2 && dash[1] === 3) return 'dotted';
  return 'custom';
};

export interface FormatPanelProps {
  readonly selection: readonly FormatSelectionEntry[];
  readonly readOnly: boolean;
  readonly defaultExpanded?: boolean;
  onApply(overrides: Readonly<StyleProperties>): void;
  onReset(paths?: readonly StyleOverridePath[]): void;
  onExpandedChange?(expanded: boolean): void;
}

export const FormatPanel = ({
  selection,
  readOnly,
  defaultExpanded = true,
  onApply,
  onReset,
  onExpandedChange,
}: FormatPanelProps) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const contentId = useId();
  const model = buildFormatSelectionModel(selection);
  const mutationDisabled = readOnly || model.count === 0;

  useEffect(() => onExpandedChange?.(expanded), [expanded, onExpandedChange]);

  const apply = (overrides: Readonly<StyleProperties>): void => {
    const constrained = constrainFormatOverrides(selection, overrides);
    if (Object.keys(constrained).length > 0) onApply(constrained);
  };

  const stopCanvasPointer = (event: ReactMouseEvent<HTMLElement>): void => {
    event.stopPropagation();
  };

  return (
    <aside
      className="nowheel nodrag absolute right-3 top-3 z-30 flex max-h-[calc(100%-1.5rem)] w-72 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white/95 shadow-xl backdrop-blur"
      aria-label="格式"
      data-testid="mindmap-format-panel"
      data-selection-kind={model.kind}
      onMouseDown={stopCanvasPointer}
    >
      <div className="flex h-11 items-center gap-2 px-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-slate-50 focus:ring-2 focus:ring-blue-100"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded
            ? <ChevronDown size={15} aria-hidden="true" />
            : <ChevronRight size={15} aria-hidden="true" />}
          <span className="font-semibold text-slate-700">格式</span>
          <span className="ml-auto text-[10px] text-slate-400">
            {model.count > 0 ? `已选 ${model.count} 项` : '未选择'}
          </span>
        </button>
        <button
          type="button"
          className="rounded-md p-2 text-slate-400 outline-none hover:bg-slate-50 hover:text-slate-700 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-35"
          aria-label="恢复全部默认"
          title="清除本地格式，恢复主题默认样式"
          disabled={mutationDisabled}
          onClick={() => onReset()}
        >
          <RotateCcw size={14} aria-hidden="true" />
        </button>
      </div>

      {expanded && (
        <div id={contentId} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3" data-testid="mindmap-format-panel-content">
          {model.kind === 'empty' && (
            <div className="border-t border-slate-100 py-8 text-center text-xs text-slate-400">
              选择主题、边界、标注或连接线后设置格式
            </div>
          )}

          {model.kind === 'incompatible' && (
            <div className="border-t border-slate-100 py-8 text-center text-xs leading-5 text-slate-400">
              当前同时选择了主题元素和连接线。请改选同一类型后编辑格式。
            </div>
          )}

          {model.kind === 'node' && (
            <>
              <FormatSection
                title="填充"
                resetLabel="重置填充色"
                disabled={mutationDisabled}
                resetPaths={['fill.color']}
                onReset={onReset}
              >
                <ColorControl
                  label="填充色"
                  state={model.fields.fillColor}
                  disabled={mutationDisabled}
                  onChange={(value) => apply({ fill: { color: { kind: 'literal', value } } })}
                />
              </FormatSection>

              <FormatSection
                title="文字"
                resetLabel="重置文字格式"
                disabled={mutationDisabled}
                resetPaths={[
                  'typography.color',
                  'typography.fontSize',
                  'typography.fontWeight',
                  'typography.italic',
                ]}
                onReset={onReset}
              >
                <ColorControl
                  label="文字色"
                  state={model.fields.textColor}
                  disabled={mutationDisabled}
                  onChange={(value) => apply({ typography: { color: { kind: 'literal', value } } })}
                />
                <NumberControl
                  label="字号"
                  state={model.fields.fontSize}
                  disabled={mutationDisabled}
                  min={1}
                  max={1000}
                  step={1}
                  suffix="px"
                  onCommit={(value) => apply({ typography: { fontSize: value } })}
                />
                <div className="flex gap-2" aria-label="字形">
                  <ToggleControl
                    label="粗体"
                    state={model.fields.bold}
                    disabled={mutationDisabled}
                    icon={Bold}
                    onToggle={(value) => apply({ typography: { fontWeight: value ? 700 : 400 } })}
                  />
                  <ToggleControl
                    label="斜体"
                    state={model.fields.italic}
                    disabled={mutationDisabled}
                    icon={Italic}
                    onToggle={(value) => apply({ typography: { italic: value } })}
                  />
                </div>
              </FormatSection>

              <FormatSection
                title="边框"
                resetLabel="重置边框格式"
                disabled={mutationDisabled}
                resetPaths={['border.color', 'border.width', 'border.radius']}
                onReset={onReset}
              >
                <ColorControl
                  label="边框色"
                  state={model.fields.borderColor}
                  disabled={mutationDisabled}
                  onChange={(value) => apply({ border: { color: { kind: 'literal', value } } })}
                />
                <NumberControl
                  label="边框宽度"
                  state={model.fields.borderWidth}
                  disabled={mutationDisabled}
                  min={0}
                  max={1000}
                  step={0.5}
                  suffix="px"
                  onCommit={(value) => apply({ border: { width: value } })}
                />
                <NumberControl
                  label="圆角"
                  state={model.fields.borderRadius}
                  disabled={mutationDisabled}
                  min={0}
                  max={10000}
                  step={1}
                  suffix="px"
                  onCommit={(value) => apply({ border: { radius: value } })}
                />
              </FormatSection>

              <FormatSection
                title="外观"
                resetLabel="重置透明度"
                disabled={mutationDisabled}
                resetPaths={['opacity']}
                onReset={onReset}
              >
                <NumberControl
                  label="透明度"
                  state={model.fields.opacity}
                  disabled={mutationDisabled}
                  min={0}
                  max={100}
                  step={1}
                  suffix="%"
                  toDisplay={(value) => Math.round(value * 100)}
                  fromDisplay={(value) => value / 100}
                  onCommit={(value) => apply({ opacity: value })}
                />
              </FormatSection>
            </>
          )}

          {model.kind === 'connector' && (
            <FormatSection
              title="连接线"
              resetLabel="重置连接线格式"
              disabled={mutationDisabled}
              resetPaths={['connector.color', 'connector.width', 'connector.dash']}
              onReset={onReset}
            >
              <ColorControl
                label="线条颜色"
                state={model.fields.connectorColor}
                disabled={mutationDisabled}
                onChange={(value) => apply({ connector: { color: { kind: 'literal', value } } })}
              />
              <NumberControl
                label="线条粗细"
                state={model.fields.connectorWidth}
                disabled={mutationDisabled}
                min={0}
                max={1000}
                step={0.5}
                suffix="px"
                onCommit={(value) => apply({ connector: { width: value } })}
              />
              <div className="flex items-center justify-between gap-3">
                <label className="text-xs text-slate-600" htmlFor={`${contentId}-dash`}>虚线</label>
                <select
                  id={`${contentId}-dash`}
                  className={`${controlClassName} w-28`}
                  value={dashPreset(model.fields.connectorDash)}
                  disabled={mutationDisabled}
                  data-format-state={model.fields.connectorDash.kind}
                  onChange={(event) => {
                    const preset = event.currentTarget.value;
                    if (preset === 'solid') apply({ connector: { dash: [] } });
                    if (preset === 'dashed') apply({ connector: { dash: [6, 4] } });
                    if (preset === 'dotted') apply({ connector: { dash: [2, 3] } });
                  }}
                >
                  {model.fields.connectorDash.kind === 'default' && <option value="default" disabled>默认</option>}
                  {model.fields.connectorDash.kind === 'mixed' && <option value="mixed" disabled>混合</option>}
                  {dashPreset(model.fields.connectorDash) === 'custom' && <option value="custom" disabled>自定义</option>}
                  <option value="solid">实线</option>
                  <option value="dashed">虚线</option>
                  <option value="dotted">点线</option>
                </select>
              </div>
            </FormatSection>
          )}
        </div>
      )}
    </aside>
  );
};
