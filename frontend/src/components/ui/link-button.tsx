import Link from 'next/link';
import { buttonClasses, type ButtonSize, type ButtonVariant } from '@/components/ui/button-styles';

/**
 * A server-rendered button. Navigation is a link, not a click handler, so it works before
 * hydration finishes on a low-end handset — which is most of the traffic here.
 */
export function LinkButton({
  href,
  variant = 'primary',
  size = 'md',
  block = false,
  className,
  children,
  prefetch = false,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  className?: string;
  children: React.ReactNode;
  prefetch?: boolean;
}) {
  return (
    <Link href={href} className={buttonClasses({ variant, size, block, className })} prefetch={prefetch}>
      {children}
    </Link>
  );
}
