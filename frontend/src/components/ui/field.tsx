'use client';

import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/cn';

/**
 * One label/error/hint contract for every form on the site, because the API answers a bad
 * request with `{ field, message }` pairs that have to land next to the input they came from.
 */
export function Field({
  label,
  hint,
  error,
  required,
  className,
  children,
  htmlFor,
}: {
  label?: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className={cn('w-full', className)}>
      {label && (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
          {required && <span className="ml-0.5 text-clay-600">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="mt-1 text-sm text-clay-700" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-ink-500">{hint}</p>
      ) : null}
    </div>
  );
}

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: ReactNode;
  error?: string;
  /** `prefix` is already an HTML attribute on inputs, so the adornments are named elsewhere. */
  leading?: ReactNode;
  trailing?: ReactNode;
}

export function TextField({ label, hint, error, leading, trailing, className, id, required, ...rest }: TextFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;

  return (
    <Field label={label} hint={hint} error={error} required={required} htmlFor={fieldId}>
      <div className="relative flex items-center">
        {leading && <span className="pointer-events-none absolute left-3 text-sm text-ink-500">{leading}</span>}
        <input
          id={fieldId}
          required={required}
          aria-invalid={error ? true : undefined}
          className={cn(
            'field-input',
            leading && 'pl-12',
            trailing && 'pr-14',
            error && 'border-clay-400 focus:border-clay-500',
            className,
          )}
          {...rest}
        />
        {trailing && <span className="pointer-events-none absolute right-3 text-sm text-ink-500">{trailing}</span>}
      </div>
    </Field>
  );
}

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: ReactNode;
  error?: string;
}

export function TextAreaField({ label, hint, error, className, id, required, rows = 4, ...rest }: TextAreaProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <Field label={label} hint={hint} error={error} required={required} htmlFor={fieldId}>
      <textarea
        id={fieldId}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        className={cn('field-input resize-y', error && 'border-clay-400 focus:border-clay-500', className)}
        {...rest}
      />
    </Field>
  );
}

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: ReactNode;
  error?: string;
  options: { value: string; label: string; disabled?: boolean }[];
  placeholder?: string;
}

export function SelectField({
  label,
  hint,
  error,
  options,
  placeholder,
  className,
  id,
  required,
  ...rest
}: SelectFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <Field label={label} hint={hint} error={error} required={required} htmlFor={fieldId}>
      <select
        id={fieldId}
        required={required}
        aria-invalid={error ? true : undefined}
        className={cn('field-input appearance-none pr-8', error && 'border-clay-400', className)}
        {...rest}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function CheckboxField({
  label,
  description,
  className,
  id,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; description?: ReactNode }) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <input
        id={fieldId}
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 rounded border-ink-300 text-bemz-600 focus:ring-bemz-500"
        {...rest}
      />
      <label htmlFor={fieldId} className="text-sm leading-snug text-ink-800">
        {label}
        {description && <span className="mt-0.5 block text-xs text-ink-500">{description}</span>}
      </label>
    </div>
  );
}

export function SwitchField({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-ink-900">{label}</p>
        {description && <p className="mt-0.5 text-xs text-ink-500">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-bemz-600' : 'bg-ink-300',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-5 rounded-full bg-white shadow transition-all',
            checked ? 'left-[22px]' : 'left-0.5',
          )}
        />
      </button>
    </div>
  );
}
