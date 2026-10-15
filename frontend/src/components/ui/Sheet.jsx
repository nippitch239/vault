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
        'fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm transition-opacity duration-300 animate-content-show',
        className
      )}
      {...props}
    />
  );
});
SheetOverlay.displayName = 'SheetOverlay';

export const SheetContent = React.forwardRef(
  ({ side = 'right', className, children, hideCloseButton = false, ...props }, ref) => {
    const { open, setOpen } = useSheet();
    const contentRef = useRef(null);

    useEffect(() => {
      if (!open) return;

      const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
          setOpen(false);
        }
      };

      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }, [open, setOpen]);

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
          className={cn(
            'fixed z-[60] flex flex-col gap-4 bg-background p-6 shadow-2xl max-h-screen overflow-y-auto duration-300',
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
              className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none text-muted-foreground hover:text-foreground"
              aria-label="Close"
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
    className={cn('flex flex-col space-y-2 text-center sm:text-left shrink-0', className)}
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
    className={cn('text-lg font-semibold text-foreground', className)}
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
