'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Tone = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

interface ToastApi {
  push: (message: string, tone?: Tone) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}

let sequence = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);

  const push = useCallback(
    (message: string, tone: Tone = 'info') => {
      const id = (sequence += 1);
      setToasts((current) => [...current.slice(-2), { id, message, tone }]);
      // Mobile-money prompts take longer than a page view, so a toast has to outlive the
      // request that produced it without the buyer having to dismiss it by hand.
      setTimeout(() => dismiss(id), tone === 'error' ? 8000 : 4200);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <button
            key={toast.id}
            type="button"
            onClick={() => dismiss(toast.id)}
            className={cn(
              'animate-fade-up pointer-events-auto max-w-md rounded-lg px-4 py-2.5 text-sm font-medium shadow-raised',
              toast.tone === 'success' && 'bg-bemz-700 text-white',
              toast.tone === 'error' && 'bg-clay-600 text-white',
              toast.tone === 'info' && 'bg-ink-900 text-white',
            )}
          >
            {toast.message}
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
