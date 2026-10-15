import React, { createContext, useContext, useEffect, useRef } from 'react';

function cn(...inputs) {
  return inputs.flat().filter(Boolean).join(' ');
}

const SheetContext = createContext({
  open: false,
  setOpen: () => {},
});

export const useSheet = () => useContext(SheetContext);

export const Sheet = ({ open, onOpenChange, children }) => {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const isControlled = open !== undefined;
  const currentOpen = isControlled ? open : internalOpen;

  const setOpen = (val) => {
    if (!isControlled) {
      setInternalOpen(val);
    }
    if (onOpenChange) {
      onOpenChange(val);
    }
  };

  return (
    <SheetContext.Provider value={{ open: currentOpen, setOpen }}>
      {children}
    </SheetContext.Provider>
  );
};

export const SheetTrigger = React.forwardRef(
  ({ children, asChild, onClick, ...props }, ref) => {
    const { setOpen } = useSheet();

    const handleClick = (e) => {
      onClick?.(e);
      if (!e.defaultPrevented) {
        setOpen(true);
      }
    };

    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children, {
        ref,
        onClick: handleClick,
        ...props,
      });
    }

    return (
      <button ref={ref} type="button" onClick={handleClick} {...props}>
        {children}
      </button>
    );
  }
);
SheetTrigger.displayName = 'SheetTrigger';

export const SheetOverlay = React.forwardRef(({ className, onClick, ...props }, ref) => {
  const { setOpen } = useSheet();

  return (
    <div
      ref={ref}
      aria-hidden="true"
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) {
          setOpen(false);
        }
      }}
      className={cn(
        'fixed inset-0 z-[60] bg-overlay/70 backdrop-blur-[2px] transition-opacity duration-base animate-content-show',
        className
      )}
      {...props}
    />
  );
});
SheetOverlay.displayName = 'SheetOverlay';

export const SheetContent = React.forwardRef(
  ({ side = 'right', className, children, hideCloseButton = false, closeLabel = 'ปิด', manageFocus = true, ...props }, ref) => {
    const { open, setOpen } = useSheet();
    const contentRef = useRef(null);
    const setOpenRef = useRef(setOpen);
    setOpenRef.current = setOpen;

    // Runs only on open/close (see Dialog.jsx): Esc closes the topmost modal; unless the
    // caller manages focus itself (manageFocus=false), focus moves in, Tab is trapped and
    // focus returns to the opener on close.
    useEffect(() => {
      if (!open) return undefined;
      const node = contentRef.current;
      const previouslyFocused = document.activeElement;
      const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
      if (manageFocus) (node?.querySelector('[data-autofocus]') || node?.querySelector(FOCUSABLE) || node)?.focus();

      const handleKeyDown = (e) => {
        const modals = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
        if (modals[modals.length - 1] !== node) return;
        if (e.key === 'Escape') {
          setOpenRef.current(false);
          return;
        }
        if (!manageFocus || e.key !== 'Tab' || !node) return;
        const items = [...node.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
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
        if (manageFocus && previouslyFocused?.focus) previouslyFocused.focus();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    if (!open) return null;

    const sideClasses = {
      right:
        'inset-y-0 right-0 h-full w-full sm:max-w-md border-l border-border animate-slide-in-from-right',
      left:
        'inset-y-0 left-0 h-full w-3/4 sm:max-w-sm border-r border-border animate-slide-in-from-left',
    };

    return (
      <div className="fixed inset-0 z-[60] flex">
        <SheetOverlay />
        <div
          ref={(node) => {
            contentRef.current = node;
            if (typeof ref === 'function') ref(node);
            else if (ref) ref.current = node;
          }}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          className={cn(
            'fixed z-[60] flex flex-col gap-4 bg-popover text-popover-foreground p-5 sm:p-6 shadow-dialog max-h-screen overflow-y-auto focus:outline-none',
            sideClasses[side] || sideClasses.right,
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
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-4"
              >
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
SheetContent.displayName = 'SheetContent';

export const SheetHeader = ({ className, ...props }) => (
  <div
    className={cn('flex flex-col gap-1.5 pr-8 text-left shrink-0', className)}
    {...props}
  />
);
SheetHeader.displayName = 'SheetHeader';

export const SheetFooter = ({ className, ...props }) => (
  <div
    className={cn(
      'flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 shrink-0 pt-4',
      className
    )}
    {...props}
  />
);
SheetFooter.displayName = 'SheetFooter';

export const SheetTitle = React.forwardRef(({ className, as: Component = 'h2', ...props }, ref) => (
  <Component
    ref={ref}
    className={cn('text-lg font-strong text-foreground', className)}
    {...props}
  />
));
SheetTitle.displayName = 'SheetTitle';

export const SheetDescription = React.forwardRef(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
SheetDescription.displayName = 'SheetDescription';

export const SheetClose = React.forwardRef(({ className, onClick, children, ...props }, ref) => {
  const { setOpen } = useSheet();
  return (
    <button
      ref={ref}
      type="button"
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) {
          setOpen(false);
        }
      }}
      className={className}
      {...props}
    >
      {children}
    </button>
  );
});
SheetClose.displayName = 'SheetClose';

export default Sheet;
