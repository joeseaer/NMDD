import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { BrowserRouter } from 'react-router-dom'
import AppErrorBoundary from './components/AppErrorBoundary'

;(window as any).__APP_BOOT_OK__ = false

const showBootError = (err: unknown) => {
  const root = document.getElementById('root');
  if (!root) return;
  const e = err as any;
  const message = String(e?.message || e || 'Unknown error');
  const stack = typeof e?.stack === 'string' ? e.stack : '';
  root.innerHTML = `
    <div style="min-height:100vh;background:#f9fafb;color:#111827;padding:24px;font-family:ui-sans-serif,system-ui">
      <div style="max-width:760px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:20px">
        <div style="font-size:18px;font-weight:700">启动失败</div>
        <div style="font-size:13px;color:#4b5563;margin-top:8px">脚本在 React 启动前就崩溃了，下面是错误信息。</div>
        <div style="margin-top:14px;border:1px solid #fecaca;background:#fef2f2;border-radius:12px;padding:12px">
          <div style="font-size:12px;font-weight:700;color:#991b1b">Error</div>
          <pre style="margin-top:6px;white-space:pre-wrap;word-break:break-word;font-size:12px;color:#7f1d1d">${message}</pre>
        </div>
        ${stack ? `
        <div style="margin-top:12px;border:1px solid #e5e7eb;background:#f9fafb;border-radius:12px;padding:12px">
          <div style="font-size:12px;font-weight:700;color:#374151">Stack</div>
          <pre style="margin-top:6px;white-space:pre-wrap;word-break:break-word;font-size:11px;color:#1f2937">${stack}</pre>
        </div>
        ` : ''}
      </div>
    </div>
  `;
};

window.addEventListener('error', (e) => {
  if ((window as any).__APP_BOOT_OK__) return
  showBootError((e as any)?.error || e);
});

window.addEventListener('unhandledrejection', (e) => {
  if ((window as any).__APP_BOOT_OK__) return
  showBootError((e as any)?.reason || e);
});

try {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <AppErrorBoundary>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AppErrorBoundary>
    </React.StrictMode>,
  )
  setTimeout(() => {
    ;(window as any).__APP_BOOT_OK__ = true
  }, 0)
} catch (err) {
  showBootError(err)
}
