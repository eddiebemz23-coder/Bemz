import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-bemz-600 text-white hover:bg-bemz-700 active:bg-bemz-800 disabled:bg-bemz-300',
  secondary: 'bg-clay-500 text-white hover:bg-clay-600 active:bg-clay-700 disabled:bg-clay-200',
  outline: 'border border-ink-200 bg-white text-ink-800 hover:border-bemz-400 hover:text-bemz-700',
  ghost: 'text-ink-700 hover:bg-ink-100',
  danger: 'bg-clay-600 text-white hover:bg-clay-700 disabled:bg-clay-300',
};

export const SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-11 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
};

/**
 * One class recipe shared by `<button>` and `<Link>`, because a "Add to cart" button and a
 * "Continue to checkout" link that look different for no reason reads as two different products.
 */
export function buttonClasses(params: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  className?: string;
}): string {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-70',
    VARIANTS[params.variant ?? 'primary'],
    SIZES[params.size ?? 'md'],
    params.block && 'w-full',
    params.className,
  );
}
