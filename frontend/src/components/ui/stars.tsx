import { cn } from '@/lib/cn';

/**
 * Stars are drawn as text glyphs rather than SVG sprites: a grid of 60 product cards each
 * rendering five vectors is the kind of work that makes a budget phone stutter on scroll.
 */
export function Stars({ value, size = 'sm' }: { value: number | null; size?: 'sm' | 'md' | 'lg' }) {
  const rounded = Math.round(value ?? 0);
  const text = { sm: 'text-xs', md: 'text-sm', lg: 'text-lg' }[size];

  return (
    <span className={cn('inline-flex items-center gap-1', text)} aria-label={`${value ?? 0} out of 5 stars`}>
      <span aria-hidden className="leading-none tracking-tight">
        {[1, 2, 3, 4, 5].map((star) => (
          <span key={star} className={rounded >= star ? 'text-amber-400' : 'text-ink-200'}>
            ★
          </span>
        ))}
      </span>
      <span className="tabular text-ink-500">{value == null ? 'New' : value.toFixed(1)}</span>
    </span>
  );
}

export function StarInput({
  value,
  onChange,
  name = 'rating',
}: {
  value: number;
  onChange: (next: number) => void;
  name?: string;
}) {
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Star rating">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`${star} star${star === 1 ? '' : 's'}`}
          name={name}
          onClick={() => onChange(star)}
          className={cn(
            'text-2xl leading-none transition-transform hover:scale-110',
            value >= star ? 'text-amber-400' : 'text-ink-300',
          )}
        >
          ★
        </button>
      ))}
    </div>
  );
}
