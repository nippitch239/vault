import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './Dialog.jsx';
import { Button } from './Button.jsx';

function cn(...inputs) {
  return inputs.flat().filter(Boolean).join(' ');
}

const ALERT_STYLES = {
  error: 'bg-error text-error-foreground border-error-foreground/20',
  warning: 'bg-warning text-warning-foreground border-warning-foreground/20',
  success: 'bg-success text-success-foreground border-success-foreground/20',
  info: 'bg-info text-info-foreground border-info-foreground/20',
};

/** Inline message. Errors are announced (role="alert"), others politely (role="status"). */
export function Alert({ variant = 'info', title, children, action, className }) {
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={cn('flex flex-col gap-3 rounded-lg border px-4 py-3 text-sm sm:flex-row sm:items-start sm:justify-between', ALERT_STYLES[variant], className)}
    >
      <div className="grid gap-0.5">
        {title && <p className="font-ui">{title}</p>}
        {children && <div className="opacity-90">{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Spinner({ className, label = 'กำลังโหลด' }) {
  return (
    <span role="status" className={cn('inline-flex items-center gap-2 text-muted-foreground', className)}>
      <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function Skeleton({ className }) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-md bg-muted', className)} />;
}

export function EmptyState({ icon, title, description, action, className }) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-12 text-center', className)}>
      {icon && (
        <div className="mb-4 flex size-10 items-center justify-center rounded-lg border border-border bg-secondary text-muted-foreground" aria-hidden="true">
          {icon}
        </div>
      )}
      <h3 className="text-base font-strong">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/**
 * Confirmation step before destructive actions.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'ยืนยัน',
  cancelLabel = 'ยกเลิก',
  destructive = true,
  loading = false,
  onConfirm,
  children,
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !loading && onOpenChange(v)}>
      <DialogContent className="max-w-md" dismissible={!loading} hideCloseButton>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading} data-autofocus>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? 'destructive' : 'default'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
