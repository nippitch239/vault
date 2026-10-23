import React from 'react';

export function cn(...inputs) {
  return inputs.flat().filter(Boolean).join(' ');
}

export const buttonVariants = ({
  variant = 'default',
  size = 'default',
  className = '',
} = {}) => {
  const base =
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0';

  const variants = {
    default: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm',
    destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm',
    outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground shadow-sm',
    secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
    ghost: 'hover:bg-accent hover:text-accent-foreground',
    link: 'text-primary underline-offset-4 hover:underline',
  };

  const sizes = {
    default: 'h-10 px-4 py-2',
    sm: 'h-9 px-3 text-xs rounded-md',
    lg: 'h-11 px-8 rounded-md',
    icon: 'size-10 rounded-md',
  };

  return cn(
    base,
    variants[variant] || variants.default,
    sizes[size] || sizes.default,
    className
  );
};

export const Button = React.forwardRef(
  ({ className, variant = 'default', size = 'default', type = 'button', disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled}
        className={buttonVariants({ variant, size, className })}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';

export default Button;
