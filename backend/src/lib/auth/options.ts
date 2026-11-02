import 'server-only';
import type { NextAuthOptions, User as NextAuthUser } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { prisma, type UserRole } from '../prisma';
import { verifyPassword } from './password';
import { verifyOtp } from '../otp';
import { env } from '../env';
import { normalisePhone } from '../phone';

/**
 * Two sign-in paths, matching how the market actually behaves:
 *   1. phone + SMS OTP  — the default for buyers and for most Kampala/Nairobi sellers
 *   2. identifier + password — used by admin staff and by shops that want a password
 *
 * Sessions are JWTs, not database sessions, because the Next.js deployment is stateless
 * and an attacker who dumps `sessions` should not gain a valid login cookie anyway.
 * The role is re-read from the database on every guarded request (see guards.ts) so a
 * suspended seller loses access immediately rather than at token expiry.
 */

export type BemzSessionUser = {
  id: string;
  role: UserRole;
  name: string | null;
  phone: string | null;
  email: string | null;
};

const MAX_FAILED_LOGINS = 8;
const LOCK_MINUTES = 15;

async function loadActiveUser(where: { id: string } | { email: string } | { phone: string }) {
  const user = await prisma.user.findUnique({ where });
  if (!user) return null;
  if (user.status === 'BANNED' || user.status === 'DELETED') return null;
  if (user.lockedUntil && user.lockedUntil > new Date()) return null;
  return user;
}

export const authOptions: NextAuthOptions = {
  secret: env().NEXTAUTH_SECRET,
  session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 30, updateAge: 60 * 60 },
  pages: {
    signIn: '/login',
    error: '/login',
    verifyRequest: '/login',
  },
  providers: [
    CredentialsProvider({
      id: 'phone-otp',
      name: 'Phone code',
      credentials: {
        phone: { label: 'Phone', type: 'text' },
        code: { label: 'Code', type: 'text' },
      },
      async authorize(credentials) {
        const phone = credentials?.phone ?? '';
        const code = credentials?.code ?? '';
        if (!phone || !code) return null;

        const verified = await verifyOtp({ phone, purpose: 'LOGIN', code });
        const user = await loadActiveUser({ id: verified.userId });
        if (!user) return null;

        return {
          id: user.id,
          role: user.role,
          name: user.name,
          phone: user.phone,
          email: user.email,
        } satisfies NextAuthUser;
      },
    }),
    CredentialsProvider({
      id: 'password',
      name: 'Password',
      credentials: {
        identifier: { label: 'Phone or email', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const identifier = (credentials?.identifier ?? '').trim();
        const password = credentials?.password ?? '';
        if (!identifier || !password) return null;

        // A buyer may have registered with `077...` or `+25677...`; normalise before lookup.
        const asPhone = (() => {
          try {
            return normalisePhone(identifier).e164;
          } catch {
            return undefined;
          }
        })();

        const found = asPhone
          ? await prisma.user.findUnique({ where: { phone: asPhone } })
          : await prisma.user.findUnique({ where: { email: identifier.toLowerCase() } });

        if (!found) return null;

        const ok = await verifyPassword(password, found.passwordHash);
        if (!ok) {
          const failedLoginCount = (found.failedLoginCount ?? 0) + 1;
          await prisma.user.update({
            where: { id: found.id },
            data: {
              failedLoginCount,
              lockedUntil:
                failedLoginCount >= MAX_FAILED_LOGINS
                  ? new Date(Date.now() + LOCK_MINUTES * 60_000)
                  : found.lockedUntil,
            },
          });
          return null;
        }

        if (found.status === 'BANNED' || found.status === 'DELETED') return null;
        if (found.lockedUntil && found.lockedUntil > new Date()) return null;

        await prisma.user.update({
          where: { id: found.id },
          data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
        });

        return {
          id: found.id,
          role: found.role,
          name: found.name,
          phone: found.phone,
          email: found.email,
        } satisfies NextAuthUser;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.role = (user as NextAuthUser & { role: UserRole }).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.uid) {
        session.user.id = String(token.uid);
        (session.user as NextAuthUser & { role?: UserRole }).role = token.role as UserRole;
      }
      return session;
    },
  },
};
