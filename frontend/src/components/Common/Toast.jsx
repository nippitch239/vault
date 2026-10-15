import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

const ToastContext = createContext(null);

function cn(...inputs) {
  return inputs.flat().filter(Boolean).join(' ');
}

function ToastSvg({ children, className = 'size-4' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const ICONS = {
  success: (
    <ToastSvg>
      <path d="M20 6 9 17l-5-5" />
    </ToastSvg>
  ),
  error: (
    <ToastSvg>
      <circle cx="12" cy="12" r="9" />
      <path d="M15 9l-6 6M9 9l6 6" />
    </ToastSvg>
  ),
  warning: (
    <ToastSvg>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </ToastSvg>
  ),
  info: (
    <ToastSvg>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-4M12 8h.01" />
    </ToastSvg>
  ),
  shield: (
    <ToastSvg>
      <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3z" />
      <path d="m9 12 2 2 4-4" />
    </ToastSvg>
  ),
  close: (
    <ToastSvg>
      <path d="M18 6 6 18M6 6l12 12" />
    </ToastSvg>
  ),
};

// Status token pairs per variant; the icon + screen-reader prefix make sure colour is never the only signal.
const VARIANTS = {
  success: { chip: 'bg-success text-success-foreground', srLabel: 'สำเร็จ:' },
  error: { chip: 'bg-error text-error-foreground', srLabel: 'ข้อผิดพลาด:' },
  warning: { chip: 'bg-warning text-warning-foreground', srLabel: 'คำเตือน:' },
  info: { chip: 'bg-info text-info-foreground', srLabel: 'แจ้งให้ทราบ:' },
};

const TOAST_SURFACE =
  'pointer-events-auto w-full rounded-lg border border-border bg-popover text-popover-foreground shadow-dialog animate-content-show';

function CloseToastButton({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="ปิดการแจ้งเตือน"
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-fast hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {ICONS.close}
    </button>
  );
}

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
    <div className={cn(TOAST_SURFACE, 'p-3')}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-info text-info-foreground">
          {ICONS.shield}
        </span>

        {/* Announced once; the per-second countdown below is hidden from screen readers. */}
        <div role="status" aria-atomic="true" className="min-w-0 flex-1">
          <p className="text-sm font-ui text-foreground">{toast.message || 'คัดลอกรหัสผ่านแล้ว'}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <span aria-hidden="true">ระบบจะล้างคลิปบอร์ดใน {remaining} วินาที</span>
            <span className="sr-only">ระบบจะล้างคลิปบอร์ดอัตโนมัติใน {total} วินาที</span>
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onClearClipboard(toast.id, toast.secret)}
            className="inline-flex h-8 items-center rounded-md border border-border bg-secondary px-2.5 text-xs font-ui text-secondary-foreground transition-colors duration-fast hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            ล้างทันที
          </button>
          <CloseToastButton onClick={() => onRemove(toast.id)} />
        </div>
      </div>

      {/* Countdown bar */}
      <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div
          className="h-full rounded-full bg-info-foreground transition-[width] duration-1000 ease-linear"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function ToastItem({ toast, onRemove }) {
  const variant = VARIANTS[toast.type] ? toast.type : 'info';
  const { chip, srLabel } = VARIANTS[variant];
  const isUrgent = variant === 'error';

  return (
    <div className={cn(TOAST_SURFACE, 'flex items-start gap-3 p-3')}>
      <span className={cn('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md', chip)}>
        {ICONS[variant]}
      </span>
      <div
        role={isUrgent ? 'alert' : 'status'}
        aria-atomic="true"
        className="min-w-0 flex-1 self-center text-sm text-foreground"
      >
        <span className="sr-only">{srLabel} </span>
        {toast.message}
      </div>
      <CloseToastButton onClick={() => onRemove(toast.id)} />
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
    addToast('ล้างคลิปบอร์ดแล้ว', 'info', 3000);
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
      const message = label ? `คัดลอกรหัสผ่านของ “${label}” แล้ว` : 'คัดลอกรหัสผ่านแล้ว';

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
      <section
        aria-label="การแจ้งเตือน"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[100] flex flex-col gap-2 sm:inset-x-auto sm:bottom-5 sm:right-5 sm:w-full sm:max-w-sm"
      >
        {toasts.map((toast) =>
          toast.type === 'clipboard' ? (
            <ClipboardToastItem
              key={toast.id}
              toast={toast}
              onRemove={removeToast}
              onClearClipboard={clearClipboardContent}
            />
          ) : (
            <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
          )
        )}
      </section>
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
