'use client';

import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Typed input plus steppers: a basket quantity is changed one unit at a time on a phone. */
export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max = 999,
  disabled,
  label = 'Quantity',
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  label?: string;
}) {
  const clamp = (next: number) => Math.min(max, Math.max(min, Number.isFinite(next) ? Math.round(next) : min));

  return (
    <div className={cn('inline-flex items-center rounded-lg border border-ink-200 bg-white', disabled && 'opacity-60')}>
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        disabled={disabled || value <= min}
        onClick={() => onChange(clamp(value - 1))}
        className="grid size-9 place-items-center rounded-l-lg text-ink-600 hover:bg-ink-50 disabled:opacity-40"
      >
        <Minus className="size-4" />
      </button>
      <input
        aria-label={label}
        inputMode="numeric"
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const parsed = Number.parseInt(event.target.value.replace(/\D/g, ''), 10);
          onChange(clamp(Number.isNaN(parsed) ? min : parsed));
        }}
        className="tabular w-12 border-x border-ink-200 bg-transparent py-1.5 text-center text-sm font-semibold text-ink-900 outline-none"
      />
      <button
        type="button"
        aria-label={`Increase ${label}`}
        disabled={disabled || value >= max}
        onClick={() => onChange(clamp(value + 1))}
        className="grid size-9 place-items-center rounded-r-lg text-ink-600 hover:bg-ink-50 disabled:opacity-40"
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}
