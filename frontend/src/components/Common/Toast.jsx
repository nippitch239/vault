import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { CheckIcon, CloseIcon, ShieldIcon } from './Icons.jsx';

const ToastContext = createContext(null);

function ClipboardToastItem({ toast, onRemove, onClearClipboard }) {
  const [remaining, setRemaining] = useState(toast.secondsRemaining || 30);
  const total = toast.totalSeconds || 30;

  useEffect(() => {
    const timer = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          onClearClipboard(toast.id, toast.secret);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [toast.id, toast.secret, onClearClipboard]);

  const percent = Math.max(0, Math.min(100, (remaining / total) * 100));

  return (
    <div className="pointer-events-auto flex flex-col p-4 rounded-xl shadow-2xl border border-indigo-500/40 bg-card text-card-foreground backdrop-blur-md transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shrink-0 mt-0.5">
            <ShieldIcon className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">
                {toast.message || 'คัดลอกรหัสผ่านแล้ว!'}
              </span>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">
                {remaining}s
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              คลิปบอร์ดจะถูกล้างอัตโนมัติเพื่อความปลอดภัย
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onClearClipboard(toast.id, toast.secret)}
            className="px-2.5 py-1 text-xs font-medium rounded-md bg-secondary hover:bg-secondary/80 text-secondary-foreground border border-border transition-colors"
            title="ล้างคลิปบอร์ดทันที"
          >
            ล้างทันที
          </button>
          <button
            type="button"
            onClick={() => onRemove(toast.id)}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors rounded-md"
            title="ปิดการแจ้งเตือน"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Progress countdown bar */}
      <div className="mt-3 w-full bg-muted rounded-full h-1 overflow-hidden">
        <div
          className="h-full bg-indigo-500 transition-all duration-1000 ease-linear rounded-full"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((message, type = 'info', duration = 3500) => {
    const id = Date.now() + Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);

    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }
  }, []);

  const clearClipboardContent = useCallback(async (id, secret) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        if (navigator.clipboard.readText) {
          try {
            const current = await navigator.clipboard.readText();
            if (current === secret) {
              await navigator.clipboard.writeText('');
            }
          } catch {
            // Permission denied or not supported, fallback to write empty
            await navigator.clipboard.writeText('');
          }
        } else if (navigator.clipboard.writeText) {
          await navigator.clipboard.writeText('');
        }
      }
    } catch (err) {
      console.warn('Failed to auto-clear clipboard:', err);
    }

    // Remove the countdown toast and display cleared confirmation
    setToasts((prev) => prev.filter((t) => t.id !== id));
    addToast('ล้างคลิปบอร์ดเรียบร้อยแล้ว (Clipboard cleared for security)', 'info', 3000);
  }, [addToast]);

  const copyPasswordWithAutoClear = useCallback(
    async (password, durationSeconds = 30, label = '') => {
      if (!password) return;

      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(password);
        }
      } catch (err) {
        console.warn('Clipboard write failed:', err);
      }

      const id = 'clip_' + Date.now() + Math.random().toString(36).substring(2, 6);
      const message = label ? `คัดลอกรหัสผ่านสำหรับ "${label}" แล้ว!` : 'คัดลอกรหัสผ่านแล้ว!';

      setToasts((prev) => [
        // Remove prior clipboard toasts if any
        ...prev.filter((t) => t.type !== 'clipboard'),
        {
          id,
          type: 'clipboard',
          message,
          secret: password,
          secondsRemaining: durationSeconds,
          totalSeconds: durationSeconds,
        },
      ]);
    },
    []
  );

  return (
    <ToastContext.Provider value={{ addToast, removeToast, copyPasswordWithAutoClear }}>
      {children}
      {/* Toast container must reside at z-[100] as specified in PROJECT.md interface contract */}
      <div className="fixed bottom-5 right-4 sm:right-5 z-[100] flex flex-col space-y-2 max-w-[calc(100vw-2rem)] sm:max-w-md w-full pointer-events-none">
        {toasts.map((toast) => {
          if (toast.type === 'clipboard') {
            return (
              <ClipboardToastItem
                key={toast.id}
                toast={toast}
                onRemove={removeToast}
                onClearClipboard={clearClipboardContent}
              />
            );
          }

          const isSuccess = toast.type === 'success';
          const isError = toast.type === 'error';
          const isWarning = toast.type === 'warning';

          return (
            <div
              key={toast.id}
              className={`pointer-events-auto flex items-center justify-between p-4 rounded-xl shadow-xl border text-sm font-medium transition-all backdrop-blur-md ${
                isSuccess
                  ? 'bg-card text-card-foreground border-emerald-500/50'
                  : isError
                  ? 'bg-card text-card-foreground border-destructive/50'
                  : isWarning
                  ? 'bg-card text-card-foreground border-amber-500/50'
                  : 'bg-card text-card-foreground border-border'
              }`}
            >
              <div className="flex items-center space-x-2.5">
                {isSuccess && <CheckIcon className="w-5 h-5 text-emerald-400 shrink-0" />}
                {isError && (
                  <div className="w-2 h-2 rounded-full bg-destructive shrink-0" />
                )}
                {isWarning && (
                  <div className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                )}
                <span className="text-foreground">{toast.message}</span>
              </div>
              <button
                type="button"
                onClick={() => removeToast(toast.id)}
                className="ml-3 text-muted-foreground hover:text-foreground transition-colors p-1 rounded"
              >
                <CloseIcon className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
}

export default ToastProvider;
