import React, { createContext, useContext, useState, useEffect, useRef, useId } from 'react';

function cn(...inputs) {
  return inputs.flat().filter(Boolean).join(' ');
}

const DialogContext = createContext({ open: false, setOpen: () => {}, titleId: undefined, descriptionId: undefined });

export const useDialog = () => useContext(DialogContext);

/**
 * Accessible modal dialog (design/DESIGN.md "Dialog — Level 5").
 * - role="dialog", aria-modal, aria-labelledby/-describedby wired to DialogTitle/Description
 * - focus moves into the dialog on open, Tab is trapped, Esc closes, focus returns on close
 */
export const Dialog = ({ open, onOpenChange, children }) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const titleId = useId();
  const descriptionId = useId();

  const setOpen = (val) => {
    if (!isControlled) setInternalOpen(val);
    onOpenChange?.(val);
  };

  return (
    <DialogContext.Provider value={{ open: isOpen, setOpen, titleId, descriptionId }}>
      {children}
    </DialogContext.Provider>
  );
};

export const DialogTrigger = React.forwardRef(({ children, asChild, onClick, ...props }, ref) => {
  const { setOpen } = useDialog();
  const handleClick = (e) => {
    onClick?.(e);
    if (!e.defaultPrevented) setOpen(true);
  };
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children, { ref, onClick: handleClick, ...props });
  }
  return (
    <button ref={ref} type="button" onClick={handleClick} {...props}>
      {children}
    </button>
  );
});
DialogTrigger.displayName = 'DialogTrigger';

export const DialogOverlay = React.forwardRef(({ className, onClick, ...props }, ref) => {
  const { setOpen } = useDialog();
  return (
    <div
      ref={ref}
      aria-hidden="true"
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) setOpen(false);
      }}
      className={cn('fixed inset-0 z-[60] bg-overlay/70 backdrop-blur-[2px] animate-content-show', className)}
      {...props}
    />
  );
});
DialogOverlay.displayName = 'DialogOverlay';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const DialogContent = React.forwardRef(
  ({ className, children, hideCloseButton = false, closeLabel = 'ปิด', dismissible = true, ...props }, ref) => {
    const { open, setOpen, titleId, descriptionId } = useDialog();
    const contentRef = useRef(null);

    useEffect(() => {
      if (!open) return undefined;
      const previouslyFocused = document.activeElement;
      const node = contentRef.current;
      // Initial focus: [data-autofocus] element, else first focusable, else the dialog itself.
      const initial = node?.querySelector('[data-autofocus]') || node?.querySelector(FOCUSABLE) || node;
      initial?.focus();

      const handleKeyDown = (e) => {
        if (e.key === 'Escape' && dismissible) {
          e.stopPropagation();
          setOpen(false);
          return;
        }
        if (e.key !== 'Tab' || !node) return;
        const focusables = [...node.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      };
      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        if (previouslyFocused && typeof previouslyFocused.focus === 'function') previouslyFocused.focus();
      };
    }, [open, setOpen, dismissible]);

    if (!open) return null;

    return (
      <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4">
        <DialogOverlay onClick={(e) => !dismissible && e.preventDefault()} />
        <div
          ref={(node) => {
            contentRef.current = node;
            if (typeof ref === 'function') ref(node);
            else if (ref) ref.current = node;
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          tabIndex={-1}
          className={cn(
            'relative z-[60] grid w-full max-w-lg max-h-[90vh] sm:max-h-[85vh] gap-4 overflow-y-auto',
            'border border-border bg-popover text-popover-foreground p-5 sm:p-6 shadow-dialog',
            'rounded-t-xl sm:rounded-xl animate-content-show focus:outline-none',
            className
          )}
          {...props}
        >
          {children}
          {!hideCloseButton && (
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors duration-fast hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={closeLabel}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden="true">
                <path d="M18 6l-12 12" />
                <path d="M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>
    );
  }
);
DialogContent.displayName = 'DialogContent';

export const DialogHeader = ({ className, ...props }) => (
  <div className={cn('flex flex-col gap-1.5 pr-8 text-left', className)} {...props} />
);
DialogHeader.displayName = 'DialogHeader';

export const DialogFooter = ({ className, ...props }) => (
  <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />
);
DialogFooter.displayName = 'DialogFooter';

export const DialogTitle = React.forwardRef(({ className, as: Component = 'h2', ...props }, ref) => {
  const { titleId } = useDialog();
  return <Component ref={ref} id={titleId} className={cn('text-lg font-strong leading-tight tracking-tight', className)} {...props} />;
});
DialogTitle.displayName = 'DialogTitle';

export const DialogDescription = React.forwardRef(({ className, ...props }, ref) => {
  const { descriptionId } = useDialog();
  return <p ref={ref} id={descriptionId} className={cn('text-sm text-muted-foreground', className)} {...props} />;
});
DialogDescription.displayName = 'DialogDescription';

export const DialogClose = React.forwardRef(({ className, onClick, children, ...props }, ref) => {
  const { setOpen } = useDialog();
  return (
    <button
      ref={ref}
      type="button"
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) setOpen(false);
      }}
      className={className}
      {...props}
    >
      {children}
    </button>
  );
});
DialogClose.displayName = 'DialogClose';

export default Dialog;
