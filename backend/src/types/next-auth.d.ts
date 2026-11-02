import 'next-auth';
import 'next-auth/jwt';
import type { UserRole } from '@prisma/client';

/**
 * NextAuth's default types only carry name/email/image. Bemz needs the user id and role
 * on every request, so both the session and the JWT are widened here.
 */

declare module 'next-auth' {
  interface User {
    id: string;
    role?: UserRole;
    phone?: string | null;
  }

  interface Session {
    user: User & {
      id: string;
      role: UserRole;
      phone?: string | null;
    };
    error?: 'SessionExpired' | 'AccountSuspended';
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    uid?: string;
    role?: UserRole;
  }
}
