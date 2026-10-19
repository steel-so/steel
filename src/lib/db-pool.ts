/**
 * Connection settings of the main Prisma client (ADR 0038). Pure, so the
 * env parsing is testable without opening a pool.
 */

/** Connections per process when `DB_POOL_MAX` is unset. Three app replicas,
 * the worker and the realtime then hold at most 50 — half of Postgres'
 * default `max_connections`, without a pooler in front. */
export const DEFAULT_DB_POOL_MAX = 10

/** `DB_POOL_MAX` arrives as a string (or raw, when env validation is
 * skipped); anything that is not a positive integer falls back to the
 * default. */
export function resolvePoolMax(raw: string | number | undefined): number {
  const value = typeof raw === 'number' ? raw : Number(raw)
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_DB_POOL_MAX
}

/** Runtime queries go through PgBouncer when `DATABASE_URL_POOLED` is set.
 * Prisma 7 talks to Postgres through `@prisma/adapter-pg`, which sends
 * unnamed statements, so transaction pooling needs no `pgbouncer=true` flag
 * (that one was for the old Rust engine's prepared statement cache). */
export function resolveRuntimeDatabaseUrl(
  direct: string,
  pooled: string | undefined,
): string {
  return pooled && pooled.length > 0 ? pooled : direct
}
