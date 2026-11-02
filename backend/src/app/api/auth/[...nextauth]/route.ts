import NextAuth from 'next-auth';
import { authOptions } from '@/lib/auth/options';

/**
 * NextAuth owns `/api/auth/*`: `/session`, `/csrf`, `/callback/credentials` and the
 * sign-in itself all come from here. The two credentials providers (phone OTP and
 * password) are defined in src/lib/auth/options.ts.
 */
const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
