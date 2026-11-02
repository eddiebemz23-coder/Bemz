import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('card flex flex-col items-center gap-3 px-6 py-12 text-center', className)}>
      {icon && <div className="text-3xl" aria-hidden>{icon}</div>}
      <h3 className="text-base font-semibold text-ink-900">{title}</h3>
      {description && <p className="max-w-md text-sm text-ink-500">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** The API answers an unexpected failure with a request id; quoting it is how support finds the log line. */
export function ErrorState({
  message,
  requestId,
  onRetry,
}: {
  message: string;
  requestId?: string | null;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="card border-clay-200 bg-clay-50 px-4 py-3 text-sm text-clay-800">
      <p className="font-medium">{message}</p>
      {requestId && <p className="mt-1 text-xs text-clay-600">Reference {requestId}</p>}
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-2 underline underline-offset-2">
          Try again
        </button>
      )}
    </div>
  );
}
