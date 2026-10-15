import React, { createContext, useContext, useEffect, useRef, useState } from 'react';

function cn(...inputs) {
  return inputs.flat().filter(Boolean).join(' ');
}

const DropdownMenuContext = createContext({
  open: false,
  setOpen: () => {},
  triggerRef: null,
});

export const useDropdownMenu = () => useContext(DropdownMenuContext);

export const DropdownMenu = ({ open, onOpenChange, children }) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const triggerRef = useRef(null);
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
    <DropdownMenuContext.Provider value={{ open: currentOpen, setOpen, triggerRef }}>
      <div className="relative inline-block text-left">{children}</div>
    </DropdownMenuContext.Provider>
  );
};

export const DropdownMenuTrigger = React.forwardRef(
  ({ children, asChild, onClick, className, ...props }, ref) => {
    const { open, setOpen, triggerRef } = useDropdownMenu();

    const handleClick = (e) => {
      onClick?.(e);
      if (!e.defaultPrevented) {
        setOpen(!open);
      }
    };

    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children, {
        ref: (node) => {
          triggerRef.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        },
        onClick: handleClick,
        'aria-haspopup': 'true',
        'aria-expanded': open,
        ...props,
      });
    }

    return (
      <button
        ref={(node) => {
          triggerRef.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        }}
        type="button"
        onClick={handleClick}
        aria-haspopup="true"
        aria-expanded={open}
        className={className}
        {...props}
      >
        {children}
      </button>
    );
  }
);
DropdownMenuTrigger.displayName = 'DropdownMenuTrigger';

export const DropdownMenuContent = React.forwardRef(
  ({ align = 'end', sideOffset = 4, className, children, ...props }, ref) => {
    const { open, setOpen, triggerRef } = useDropdownMenu();
    const menuRef = useRef(null);

    useEffect(() => {
      if (!open) return;

      const handleClickOutside = (e) => {
        if (
          menuRef.current &&
          !menuRef.current.contains(e.target) &&
          triggerRef.current &&
          !triggerRef.current.contains(e.target)
        ) {
          setOpen(false);
        }
      };

      const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
          setOpen(false);
        }
      };

      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);

      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('keydown', handleKeyDown);
      };
    }, [open, setOpen, triggerRef]);

    if (!open) return null;

    const alignClasses = {
      start: 'left-0 origin-top-left',
      end: 'right-0 origin-top-right',
      center: 'left-1/2 -translate-x-1/2 origin-top',
    };

    return (
      <div
        ref={(node) => {
          menuRef.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        }}
        role="menu"
        style={{ marginTop: `${sideOffset}px` }}
        className={cn(
          'absolute z-50 min-w-[12rem] overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg animate-content-show focus:outline-none',
          alignClasses[align] || alignClasses.end,
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);
DropdownMenuContent.displayName = 'DropdownMenuContent';

export const DropdownMenuItem = React.forwardRef(
  ({ className, disabled = false, destructive = false, onClick, children, ...props }, ref) => {
    const { setOpen } = useDropdownMenu();

    const handleClick = (e) => {
      if (disabled) return;
      onClick?.(e);
      if (!e.defaultPrevented) {
        setOpen(false);
      }
    };

    return (
      <div
        ref={ref}
        role="menuitem"
        aria-disabled={disabled}
        onClick={handleClick}
        className={cn(
          'relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground',
          disabled && 'pointer-events-none opacity-50 cursor-not-allowed',
          destructive &&
            'text-destructive hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive',
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);
DropdownMenuItem.displayName = 'DropdownMenuItem';

export const DropdownMenuLabel = ({ className, inset = false, ...props }) => (
  <div
    className={cn(
      'px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground',
      inset && 'pl-8',
      className
    )}
    {...props}
  />
);
DropdownMenuLabel.displayName = 'DropdownMenuLabel';

export const DropdownMenuSeparator = ({ className, ...props }) => (
  <div className={cn('-mx-1 my-1 h-px bg-muted', className)} {...props} />
);
DropdownMenuSeparator.displayName = 'DropdownMenuSeparator';

export const DropdownMenuShortcut = ({ className, ...props }) => (
  <span
    className={cn('ml-auto text-xs tracking-widest text-muted-foreground', className)}
    {...props}
  />
);
DropdownMenuShortcut.displayName = 'DropdownMenuShortcut';

export default DropdownMenu;
