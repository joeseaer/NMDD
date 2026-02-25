import { useState, useEffect } from 'react';
import { Save, Download, Clock, AlertCircle, Database } from 'lucide-react';

export default function Settings() {
  const [autoBackup, setAutoBackup] = useState(false);
  const [lastBackupDate, setLastBackupDate] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    const storedAuto = localStorage.getItem('auto_backup_enabled');
    if (storedAuto === 'true') setAutoBackup(true);

    const last = localStorage.getItem('last_backup_timestamp');
    if (last) {
      setLastBackupDate(new Date(parseInt(last)).toLocaleString());
    }
  }, []);

  const handleToggleAutoBackup = () => {
    const newState = !autoBackup;
    setAutoBackup(newState);
    localStorage.setItem('auto_backup_enabled', String(newState));
  };

  const handleManualBackup = async () => {
    setIsExporting(true);
    try {
      // Trigger download
      // We use fetch to get the blob so we can name it properly if needed, 
      // or just window.location.href if the server sets Content-Disposition (which it does).
      // Using window.location.href is simplest for file download.
      
      // But to update state after success, fetch is better.
      const response = await fetch('/api/backup/export?userId=user-1');
      if (!response.ok) throw new Error('Backup failed');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup-user-1-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      // Update timestamp
      const now = Date.now();
      localStorage.setItem('last_backup_timestamp', String(now));
      setLastBackupDate(new Date(now).toLocaleString());
      
    } catch (err) {
      console.error(err);
      alert('备份失败，请稍后重试');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">系统设置</h1>
        <p className="text-gray-500">管理您的数据与偏好</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-6 border-b border-gray-100 flex items-center gap-3">
          <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600">
            <Database size={24} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">数据备份与恢复</h2>
            <p className="text-sm text-gray-500">将您的所有训练数据导出到本地</p>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Manual Backup */}
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-100">
            <div className="flex items-center gap-4">
              <div className="p-2 bg-white rounded-full shadow-sm text-gray-600">
                <Download size={20} />
              </div>
              <div>
                <h3 className="font-medium text-gray-900">立即备份</h3>
                <p className="text-xs text-gray-500">
                  上次备份: {lastBackupDate || '从未备份'}
                </p>
              </div>
            </div>
            <button
              onClick={handleManualBackup}
              disabled={isExporting}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {isExporting ? (
                <>
                  <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                  导出中...
                </>
              ) : (
                <>
                  <Save size={16} />
                  导出数据 (.json)
                </>
              )}
            </button>
          </div>

          {/* Auto Backup Toggle */}
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-100">
            <div className="flex items-center gap-4">
              <div className={`p-2 rounded-full shadow-sm ${autoBackup ? 'bg-green-100 text-green-600' : 'bg-white text-gray-600'}`}>
                <Clock size={20} />
              </div>
              <div>
                <h3 className="font-medium text-gray-900">自动备份提醒</h3>
                <p className="text-xs text-gray-500">每 3 天提醒/自动下载备份数据</p>
              </div>
            </div>
            <button
              onClick={handleToggleAutoBackup}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
                autoBackup ? 'bg-indigo-600' : 'bg-gray-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  autoBackup ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {autoBackup && (
             <div className="flex items-start gap-2 text-xs text-blue-600 bg-blue-50 p-3 rounded-md">
                <AlertCircle size={14} className="mt-0.5" />
                <p>开启后，系统将在每次启动时检查距离上次备份是否超过 3 天。如果超过，将自动触发下载。</p>
             </div>
          )}
        </div>
      </div>
    </div>
  );
}
