import { cn } from '@/lib/cn';
import { humanise, orderTone } from '@/lib/client/format';

export function StatusPill({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset',
        orderTone(status),
        className,
      )}
    >
      {humanise(status)}
    </span>
  );
}
