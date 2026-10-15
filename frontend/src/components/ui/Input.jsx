import React from 'react';

function cn(...inputs) {
  return inputs.flat().filter(Boolean).join(' ');
}

export const Input = React.forwardRef(
  ({ className, type = 'text', error, ...props }, ref) => {
    return (
      <input
        type={type}
        ref={ref}
        className={cn(
          'flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground ring-offset-background transition-colors duration-fast file:border-0 file:bg-transparent file:text-sm file:font-ui placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
          error && 'border-destructive focus-visible:ring-destructive',
          className
        )}
        aria-invalid={error ? true : undefined}
        {...props}
      />
    );
  }
);

Input.displayName = 'Input';

export default Input;
