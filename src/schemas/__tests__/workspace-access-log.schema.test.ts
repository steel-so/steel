import { describe, expect, it } from 'vitest'
import {
  MAX_ACCESS_LOG_RANGE_DAYS,
  WorkspaceAccessLogExportQuerySchema,
  WorkspaceAccessLogListQuerySchema,
} from '../workspace-access-log.schema'

describe('WorkspaceAccessLogListQuerySchema', () => {
  it('defaults the page and accepts every filter', () => {
    const parsed = WorkspaceAccessLogListQuerySchema.parse({
      from: '2026-10-01',
      to: '2026-10-27',
      outcome: 'BLOCKED',
      surface: 'API',
      user: '  ana  ',
    })
    expect(parsed).toEqual({
      from: '2026-10-01',
      to: '2026-10-27',
      outcome: 'BLOCKED',
      surface: 'API',
      user: 'ana',
      page: 1,
      pageSize: 50,
    })
  })

  it('coerces the pagination from the query string', () => {
    const parsed = WorkspaceAccessLogListQuerySchema.parse({
      page: '3',
      pageSize: '20',
    })
    expect(parsed).toMatchObject({ page: 3, pageSize: 20 })
  })

  it('rejects a page size over 100 and unknown enums', () => {
    expect(
      WorkspaceAccessLogListQuerySchema.safeParse({ pageSize: '101' }).success,
    ).toBe(false)
    expect(
      WorkspaceAccessLogListQuerySchema.safeParse({ outcome: 'DENIED' })
        .success,
    ).toBe(false)
    expect(
      WorkspaceAccessLogListQuerySchema.safeParse({ surface: 'CLI' }).success,
    ).toBe(false)
  })

  it('rejects malformed days', () => {
    const parsed = WorkspaceAccessLogListQuerySchema.safeParse({
      from: '27/10/2026',
    })
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0].message).toBe(
      'Use uma data válida no formato AAAA-MM-DD',
    )
  })

  it('rejects an inverted range', () => {
    const parsed = WorkspaceAccessLogListQuerySchema.safeParse({
      from: '2026-10-27',
      to: '2026-10-01',
    })
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]).toMatchObject({
      path: ['to'],
      message: 'O fim do período precisa ser depois do início',
    })
  })

  it(`caps the range at ${MAX_ACCESS_LOG_RANGE_DAYS} days`, () => {
    expect(
      WorkspaceAccessLogListQuerySchema.safeParse({
        from: '2025-10-27',
        to: '2026-10-27',
      }).success,
    ).toBe(true)
    const parsed = WorkspaceAccessLogListQuerySchema.safeParse({
      from: '2025-10-26',
      to: '2026-10-27',
    })
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0].message).toBe(
      `O período pode ter no máximo ${MAX_ACCESS_LOG_RANGE_DAYS} dias`,
    )
  })

  it('accepts a single bound (the service fills the other)', () => {
    expect(
      WorkspaceAccessLogListQuerySchema.safeParse({ from: '2026-10-01' })
        .success,
    ).toBe(true)
    expect(
      WorkspaceAccessLogListQuerySchema.safeParse({ to: '2026-10-01' }).success,
    ).toBe(true)
  })
})

describe('WorkspaceAccessLogExportQuerySchema', () => {
  it('has no pagination', () => {
    expect(
      WorkspaceAccessLogExportQuerySchema.parse({ page: '2', user: 'ana' }),
    ).toEqual({ user: 'ana' })
  })

  it('validates the range like the list', () => {
    expect(
      WorkspaceAccessLogExportQuerySchema.safeParse({
        from: '2026-10-02',
        to: '2026-10-01',
      }).success,
    ).toBe(false)
  })
})
