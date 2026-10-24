import React, { useId } from 'react';

function cn(...inputs) {
  return inputs.flat().filter(Boolean).join(' ');
}

export const Label = React.forwardRef(({ className, required, children, ...props }, ref) => (
  <label ref={ref} className={cn('text-sm font-ui text-foreground', className)} {...props}>
    {children}
    {required && (
      <span className="ml-0.5 text-destructive" aria-hidden="true">
        *
      </span>
    )}
  </label>
));
Label.displayName = 'Label';

const controlClass =
  'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ring-offset-background disabled:cursor-not-allowed disabled:opacity-50';

export const Textarea = React.forwardRef(({ className, error, ...props }, ref) => (
  <textarea
    ref={ref}
    aria-invalid={error ? true : undefined}
    className={cn(controlClass, 'min-h-[80px] resize-y', error && 'border-destructive', className)}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export const Select = React.forwardRef(({ className, error, children, ...props }, ref) => (
  <select
    ref={ref}
    aria-invalid={error ? true : undefined}
    className={cn(controlClass, 'h-10 py-0 pr-8', error && 'border-destructive', className)}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = 'Select';

/**
 * Label + control + hint/error, wired with htmlFor / aria-describedby.
 * Usage: <Field label="ชื่อ" error={err}>{(props) => <Input {...props} />}</Field>
 */
export function Field({ label, hint, error, required, className, children }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('grid gap-1.5', className)}>
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      {children({ id, 'aria-describedby': describedBy, error: Boolean(error), required })}
      {hint && !error && (
        <p id={hintId} className="text-caption text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-caption text-error-foreground">
          {error}
        </p>
      )}
    </div>
  );
}
