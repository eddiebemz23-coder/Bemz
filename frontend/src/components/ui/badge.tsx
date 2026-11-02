import { cn } from '@/lib/cn';

type Tone = 'neutral' | 'brand' | 'warning' | 'danger' | 'info' | 'success';

const TONES: Record<Tone, string> = {
  neutral: 'bg-ink-100 text-ink-700 ring-ink-200',
  brand: 'bg-bemz-100 text-bemz-800 ring-bemz-200',
  warning: 'bg-amber-100 text-amber-800 ring-amber-200',
  danger: 'bg-clay-100 text-clay-800 ring-clay-200',
  info: 'bg-sky-100 text-sky-800 ring-sky-200',
  success: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
};

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export type BadgeTone = Tone;
