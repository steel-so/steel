import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import {
  DATABASE_URL,
  DATABASE_URL_POOLED,
  DB_POOL_MAX,
} from '@/lib/env/_server'
import { resolvePoolMax, resolveRuntimeDatabaseUrl } from '@/src/lib/db-pool'

export function createPrismaClient(
  connectionString: string,
  opts?: { max?: number },
): PrismaClient {
  const adapter = new PrismaPg({
    connectionString,
    max: opts?.max ?? 5,
  })

  return new PrismaClient({ adapter })
}

// Through PgBouncer when DATABASE_URL_POOLED is set (ADR 0038). Migrations
// (prisma.config.ts) and pg_dump/pg_restore keep the direct DATABASE_URL.
export const prisma = createPrismaClient(
  resolveRuntimeDatabaseUrl(DATABASE_URL, DATABASE_URL_POOLED),
  { max: resolvePoolMax(DB_POOL_MAX) },
)
