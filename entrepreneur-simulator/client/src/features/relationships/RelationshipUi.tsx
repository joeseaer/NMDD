import type { ReactNode } from 'react';
import { AlertCircle, ArrowRight, Inbox, Loader2, RefreshCw } from 'lucide-react';
import type { AttentionState, ConfidenceLevel, OpportunityStage } from './model';
import { ATTENTION_LABELS, CONFIDENCE_LABELS, OPPORTUNITY_STAGE_LABELS } from './model';

export const cn = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' ');

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">
        {eyebrow ? <div className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-600">{eyebrow}</div> : null}
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-gray-950">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-600">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function SurfaceCard({
  title,
  description,
  icon,
  action,
  children,
  className,
}: {
  title?: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-2xl border border-gray-200 bg-white shadow-sm', className)}>
      {title || action ? (
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-4 py-4 sm:px-5">
          <div className="flex min-w-0 items-start gap-3">
            {icon ? <div className="mt-0.5 text-indigo-600">{icon}</div> : null}
            <div className="min-w-0">
              {title ? <h2 className="font-semibold text-gray-950">{title}</h2> : null}
              {description ? <p className="mt-0.5 text-xs leading-5 text-gray-500">{description}</p> : null}
            </div>
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

export function PrimaryButton({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'min-h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:bg-gray-50',
        props.className,
      )}
    />
  );
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm leading-6 text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:bg-gray-50',
        props.className,
      )}
    />
  );
}

export function FieldLabel({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="flex items-center justify-between gap-3 text-sm font-medium text-gray-800">
        {label}
        {hint ? <span className="text-xs font-normal text-gray-400">{hint}</span> : null}
      </span>
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}

export function LoadingState({ label = '正在读取…' }: { label?: string }) {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center gap-3 text-sm text-gray-500" role="status">
      <Loader2 className="h-6 w-6 animate-spin text-indigo-600" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center gap-3 rounded-xl border border-red-200 bg-red-50 px-5 text-center" role="alert">
      <AlertCircle className="h-6 w-6 text-red-600" aria-hidden="true" />
      <div>
        <div className="font-medium text-red-900">暂时无法显示</div>
        <p className="mt-1 max-w-xl text-sm leading-6 text-red-700">{message}</p>
      </div>
      {onRetry ? (
        <SecondaryButton onClick={onRetry} className="border-red-200 text-red-700 hover:bg-red-100">
          <RefreshCw className="h-4 w-4" /> 重新加载
        </SecondaryButton>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center px-6 text-center">
      <div className="rounded-full bg-gray-100 p-3 text-gray-500"><Inbox className="h-6 w-6" /></div>
      <div className="mt-3 font-medium text-gray-900">{title}</div>
      <p className="mt-1 max-w-md text-sm leading-6 text-gray-500">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function AttentionBadge({ state }: { state: AttentionState }) {
  const tones: Record<AttentionState, string> = {
    focus: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
    maintain: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    observe: 'bg-sky-50 text-sky-700 ring-sky-200',
    repair: 'bg-amber-50 text-amber-800 ring-amber-200',
    boundary: 'bg-red-50 text-red-700 ring-red-200',
    dormant: 'bg-gray-100 text-gray-600 ring-gray-200',
    archived: 'bg-gray-100 text-gray-500 ring-gray-200',
  };
  return <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', tones[state])}>{ATTENTION_LABELS[state]}</span>;
}

export function ConfidenceBadge({ level }: { level: ConfidenceLevel }) {
  const tone = level === 'behavior_supported' || level === 'repeated'
    ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
    : level === 'mixed'
      ? 'bg-amber-50 text-amber-800 ring-amber-200'
      : 'bg-gray-100 text-gray-600 ring-gray-200';
  return <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', tone)}>{CONFIDENCE_LABELS[level]}</span>;
}

export function OpportunityStageBadge({ stage }: { stage: OpportunityStage }) {
  const positive = ['paid_validation', 'repeatable', 'scaling'].includes(stage);
  return (
    <span className={cn(
      'inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset',
      positive ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-indigo-50 text-indigo-700 ring-indigo-200',
    )}>
      {OPPORTUNITY_STAGE_LABELS[stage]}
    </span>
  );
}

export function ListArrow() {
  return <ArrowRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />;
}

export const formatDate = (value?: string | null, includeTime = false) => {
  if (!value) return '未设置';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', includeTime
    ? { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
};

export const splitLines = (value: string) => value
  .split(/[\n；;]/)
  .map((item) => item.trim())
  .filter(Boolean);
