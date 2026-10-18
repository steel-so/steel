import { z } from 'zod'
import type { AppError } from '@/src/errors/app-error'
import { validationError } from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'

/**
 * Cursor pagination of the public API v1 (`docs/cli/README.md`): `?limit=`
 * (default 25, max 100) and `?cursor=`, answered with `data.items` and
 * `data.nextCursor` (`null` on the last page). The cursor is opaque to the
 * client: lists whose service already pages by cursor pass it through; the
 * others (services that return the whole list) page in memory with an
 * offset encoded in the cursor.
 */

export const V1_DEFAULT_LIMIT = 25
export const V1_MAX_LIMIT = 100

export interface V1Page<T> {
  items: T[]
  nextCursor: string | null
}

const blank = (value: unknown) =>
  value === '' || value === null ? undefined : value

export const V1PageQuerySchema = z.object({
  limit: z.preprocess(
    blank,
    z.coerce
      .number()
      .int()
      .min(1)
      .max(V1_MAX_LIMIT)
      .default(V1_DEFAULT_LIMIT)
      .meta({ description: `Itens por página (1–${V1_MAX_LIMIT}).` }),
  ),
  cursor: z.preprocess(
    blank,
    z.string().min(1).max(200).optional().meta({
      description:
        'Valor de `nextCursor` da página anterior. Omitido = primeira página.',
    }),
  ),
})

export type V1PageQuery = z.infer<typeof V1PageQuerySchema>

const OFFSET_PREFIX = 'o:'

/** Opaque cursor for an offset (`o:<n>` in base64url). */
export function encodeOffsetCursor(offset: number): string {
  return Buffer.from(`${OFFSET_PREFIX}${offset}`).toString('base64url')
}

export function decodeOffsetCursor(
  cursor: string | undefined,
): Result<number, AppError> {
  if (cursor === undefined) return ok(0)
  const raw = Buffer.from(cursor, 'base64url').toString('utf-8')
  const offset = raw.startsWith(OFFSET_PREFIX)
    ? Number(raw.slice(OFFSET_PREFIX.length))
    : Number.NaN
  if (!Number.isSafeInteger(offset) || offset < 0) {
    return err(
      validationError('Cursor inválido', [
        { code: 'custom', path: ['cursor'], message: 'Cursor inválido' },
      ]),
    )
  }
  return ok(offset)
}

/** One page of a list the service returned whole. */
export function paginateArray<T>(
  items: readonly T[],
  query: V1PageQuery,
): Result<V1Page<T>, AppError> {
  const offset = decodeOffsetCursor(query.cursor)
  if (!offset.ok) return offset
  const end = offset.value + query.limit
  return ok({
    items: items.slice(offset.value, end),
    nextCursor: end < items.length ? encodeOffsetCursor(end) : null,
  })
}
