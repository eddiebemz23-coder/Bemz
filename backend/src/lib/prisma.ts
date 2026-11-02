import { PrismaClient } from '@prisma/client';

/**
 * Single client per process. Next.js hot-reload creates a new module graph on every
 * edit, so without the global cache each reload leaks a connection pool until Postgres
 * refuses new connections (too_many_connections) during development.
 */
const createClient = () =>
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'warn', 'error']
        : ['warn', 'error'],
  });

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: ReturnType<typeof createClient> | undefined;
}

export const prisma = globalThis.prismaGlobal ?? createClient();

if (process.env.NODE_ENV !== 'production') globalThis.prismaGlobal = prisma;

export { PrismaClient };
export * from '@prisma/client';
