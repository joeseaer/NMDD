import { Check, Clock, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';

export type PlannerItem = {
  id: string;
  type: 'event' | 'task';
  title: string;
  due_at?: string | null;
  status: 'open' | 'done' | 'archived';
};

const formatDue = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function TaskSection({
  title,
  items,
  tone,
  onToggleDone,
  onUpdate,
  onDelete,
  setIsDragging,
  onReorder,
}: {
  title: string;
  items: PlannerItem[];
  tone: 'red' | 'blue' | 'gray';
  onToggleDone: (it: PlannerItem) => void;
  onUpdate: (it: PlannerItem, patch: { title?: string; dueDate?: string | null }) => void;
  onDelete: (it: PlannerItem) => void;
  setIsDragging: (v: boolean) => void;
  onReorder?: (taskId: string, targetId: string) => void;
}) {
  const border = tone === 'red' ? 'border-red-200' : tone === 'blue' ? 'border-blue-200' : 'border-gray-200';
  const bg = tone === 'red' ? 'bg-red-50/40' : tone === 'blue' ? 'bg-blue-50/40' : 'bg-gray-50/40';
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingDue, setEditingDue] = useState<string>('');
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const ordered = [...items].sort((a, b) => {
    const sa = a.status === 'done' ? 1 : 0;
    const sb = b.status === 'done' ? 1 : 0;
    if (sa !== sb) return sa - sb;
    return 0;
  });
  return (
    <div className={`rounded-xl border ${border} ${bg} p-4`}>
      <div className="flex items-center justify-between">
        <div className="text-sm font-bold text-gray-900">{title}</div>
        <div className="text-xs text-gray-500">{items.length} 条</div>
      </div>
      {items.length === 0 ? (
        <div className="mt-3 text-xs text-gray-400 italic">暂无</div>
      ) : (
        <div className="mt-3 space-y-2">
          {ordered.map((it) => (
            <div 
              key={it.id} 
              className={`flex items-center gap-3 bg-white rounded-lg border px-3 py-2 cursor-move hover:shadow-sm transition-all duration-200 active:scale-95 active:bg-gray-50 ${dragOverId === it.id ? 'border-indigo-400 bg-indigo-50/30 border-t-2 border-t-indigo-500' : 'border-gray-100'}`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('taskId', it.id);
                setIsDragging(true);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverId(it.id);
              }}
              onDragLeave={() => {
                setDragOverId(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverId(null);
                const sourceId = e.dataTransfer.getData('taskId');
                if (sourceId && sourceId !== it.id && onReorder) {
                  onReorder(sourceId, it.id);
                }
              }}
              onDragEnd={() => setIsDragging(false)}
            >
              <button
                onClick={() => onToggleDone(it)}
                className={`w-5 h-5 rounded border flex items-center justify-center ${it.status === 'done' ? 'bg-green-600 border-green-600' : 'border-gray-300 hover:border-gray-400'}`}
                title={it.status === 'done' ? '标记未完成' : '标记完成'}
              >
                {it.status === 'done' && <Check className="w-4 h-4 text-white" />}
              </button>
              <div className="flex-1 min-w-0">
                {editingId === it.id ? (
                  <div className="space-y-2">
                    <input
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          setEditingId(null);
                          return;
                        }
                        if (e.key === 'Enter') {
                          onUpdate(it, { title: editingTitle, dueDate: editingDue || null });
                          setEditingId(null);
                        }
                      }}
                      className="w-full bg-white border border-gray-200 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                      placeholder="待办标题"
                    />
                    <input
                      type="date"
                      value={editingDue}
                      onChange={(e) => setEditingDue(e.target.value)}
                      className="bg-white border border-gray-200 rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          onUpdate(it, { title: editingTitle, dueDate: editingDue || null });
                          setEditingId(null);
                        }}
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <Save className="w-3 h-3" /> 保存
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="inline-flex items-center gap-1 text-xs text-gray-500 hover:underline"
                      >
                        <X className="w-3 h-3" /> 取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className={`text-sm font-medium whitespace-normal break-words ${it.status === 'done' ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{it.title}</div>
                    {it.due_at && (
                      <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                        <Clock className="w-3 h-3" />
                        <span>{formatDue(it.due_at)}</span>
                      </div>
                    )}
                  </>
                )}
              </div>
              {editingId !== it.id && (
                <button
                  onClick={() => {
                    setEditingId(it.id);
                    setEditingTitle(it.title || '');
                    setEditingDue(formatDue(it.due_at) || '');
                  }}
                  className="text-gray-400 hover:text-gray-700"
                  title="编辑"
                >
                  <Pencil className="w-4 h-4" />
                </button>
              )}
              <button onClick={() => onDelete(it)} className="text-gray-400 hover:text-red-600" title="删除">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PlannerTodoPanel({
  activeListId,
  focusDayLabel,
  focusDayTasks,
  overdue,
  upcoming,
  creating,
  onCreateTask,
  onToggleDone,
  onUpdate,
  onDelete,
  setIsDragging,
  onReorder,
}: {
  activeListId: string;
  focusDayLabel: string;
  focusDayTasks: PlannerItem[];
  overdue: PlannerItem[];
  upcoming: PlannerItem[];
  creating: boolean;
  onCreateTask: (payload: { title: string; dueDate: string; listId: string }) => Promise<void>;
  onToggleDone: (it: PlannerItem) => void;
  onUpdate: (it: PlannerItem, patch: { title?: string; dueDate?: string | null }) => void;
  onDelete: (it: PlannerItem) => void;
  setIsDragging: (v: boolean) => void;
  onReorder?: (taskId: string, targetId: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const disabled = useMemo(() => creating || !title.trim(), [creating, title]);

  return (
    <div className="flex-1 flex flex-col gap-4">
      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        <div className="text-sm font-bold text-gray-900">快速添加</div>
        <div className="mt-3 flex flex-col sm:flex-row gap-2">
          <div className="flex-1">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onCreateTask({ title, dueDate, listId: activeListId }).then(() => {
                    setTitle('');
                  });
                }
              }}
              className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              placeholder="输入待办标题，回车创建"
            />
          </div>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <button
            onClick={async () => {
              await onCreateTask({ title, dueDate, listId: activeListId });
              setTitle('');
            }}
            disabled={disabled}
            className="inline-flex items-center justify-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            添加
          </button>
        </div>
        <div className="mt-2 text-xs text-gray-400">默认落入当前清单；未选时会落入收集箱。</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <TaskSection title={`当天（${focusDayLabel}）`} items={focusDayTasks} tone="blue" onToggleDone={onToggleDone} onUpdate={onUpdate} onDelete={onDelete} setIsDragging={setIsDragging} onReorder={onReorder} />
        <TaskSection title="逾期" items={overdue} tone="red" onToggleDone={onToggleDone} onUpdate={onUpdate} onDelete={onDelete} setIsDragging={setIsDragging} onReorder={onReorder} />
        <TaskSection title="未来" items={upcoming} tone="gray" onToggleDone={onToggleDone} onUpdate={onUpdate} onDelete={onDelete} setIsDragging={setIsDragging} onReorder={onReorder} />
      </div>
    </div>
  );
}

