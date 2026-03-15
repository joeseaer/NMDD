import React from 'react';

type State = {
  error: unknown;
  info: unknown;
};

export default class AppErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: unknown) {
    return { error, info: null };
  }

  componentDidCatch(error: unknown, info: unknown) {
    this.setState({ error, info });
  }

  render() {
    if (!this.state.error) return this.props.children;

    const err = this.state.error as any;
    const message = String(err?.message || err || 'Unknown error');
    const stack = typeof err?.stack === 'string' ? err.stack : '';

    return (
      <div className="min-h-screen bg-gray-50 text-gray-900 p-6">
        <div className="max-w-3xl mx-auto bg-white border border-gray-200 rounded-2xl p-6">
          <div className="text-lg font-bold">页面加载失败</div>
          <div className="text-sm text-gray-600 mt-2">这是前端运行时错误导致的白屏。下面是错误信息，修复后刷新即可。</div>

          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3">
            <div className="text-xs font-bold text-red-800">Error</div>
            <pre className="text-xs text-red-900 whitespace-pre-wrap break-words mt-1">{message}</pre>
          </div>

          {stack && (
            <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="text-xs font-bold text-gray-700">Stack</div>
              <pre className="text-[11px] text-gray-800 whitespace-pre-wrap break-words mt-1">{stack}</pre>
            </div>
          )}

          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90"
            >
              刷新页面
            </button>
            <button
              onClick={() => {
                try {
                  navigator.clipboard.writeText(`${message}\n\n${stack}`);
                } catch {}
              }}
              className="px-4 py-2 rounded-lg bg-white border border-gray-200 text-sm font-medium hover:bg-gray-50"
            >
              复制错误
            </button>
          </div>
        </div>
      </div>
    );
  }
}

