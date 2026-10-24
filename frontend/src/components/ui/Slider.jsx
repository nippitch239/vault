import React, { useId } from 'react';

function cn(...inputs) {
  return inputs.flat().filter(Boolean).join(' ');
}

export const Slider = React.forwardRef(
  (
    {
      className,
      min = 0,
      max = 100,
      step = 1,
      value,
      defaultValue = min,
      onChange,
      disabled = false,
      id: customId,
      ...props
    },
    ref
  ) => {
    const autoId = useId();
    const id = customId || autoId;
    const currentValue = value !== undefined ? Number(value) : Number(defaultValue);
    const percentage = Math.min(
      100,
      Math.max(0, ((currentValue - min) / (max - min)) * 100)
    );

    return (
      <div className={cn('relative flex w-full touch-none select-none items-center py-2', className)}>
        {/* Track and Fill Layer */}
        <div className="relative h-2 w-full grow overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${percentage}%` }}
          />
        </div>

        {/* Real Range Input Overlay with opacity-0 */}
        <input
          ref={ref}
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          defaultValue={value === undefined ? defaultValue : undefined}
          onChange={onChange}
          disabled={disabled}
          className={cn(
            'absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0 disabled:cursor-not-allowed',
            disabled && 'pointer-events-none'
          )}
          {...props}
        />

        {/* Visual Thumb Follower */}
        <div
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute block size-5 -translate-x-1/2 rounded-full border-2 border-primary bg-background ring-offset-background transition-shadow',
            disabled && 'border-muted-foreground bg-muted'
          )}
          style={{ left: `${percentage}%` }}
        />
      </div>
    );
  }
);

Slider.displayName = 'Slider';

export default Slider;
