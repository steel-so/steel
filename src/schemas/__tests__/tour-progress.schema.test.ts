import { describe, expect, it } from 'vitest'
import { MarkTourSeenSchema } from '../tour-progress.schema'

const valid = { key: 'platform.home', version: 1, status: 'COMPLETED' }

describe('MarkTourSeenSchema', () => {
  it('should accept a known tour, completed or skipped', () => {
    expect(MarkTourSeenSchema.safeParse(valid).success).toBe(true)
    expect(
      MarkTourSeenSchema.safeParse({ ...valid, status: 'SKIPPED' }).success,
    ).toBe(true)
  })

  it('should trim the key', () => {
    const parsed = MarkTourSeenSchema.parse({
      ...valid,
      key: ' platform.home ',
    })
    expect(parsed.key).toBe('platform.home')
  })

  it('should reject a tour that does not exist', () => {
    const parsed = MarkTourSeenSchema.safeParse({ ...valid, key: 'crm.nope' })
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]?.message).toBe('Tour desconhecido')
  })

  it('should reject an empty or oversized key', () => {
    expect(MarkTourSeenSchema.safeParse({ ...valid, key: '' }).success).toBe(
      false,
    )
    expect(
      MarkTourSeenSchema.safeParse({ ...valid, key: 'a'.repeat(81) }).success,
    ).toBe(false)
  })

  it('should reject a version that is not a positive integer', () => {
    for (const version of [0, -1, 1.5, 10_000, '1']) {
      expect(MarkTourSeenSchema.safeParse({ ...valid, version }).success).toBe(
        false,
      )
    }
  })

  it('should reject an unknown status', () => {
    expect(
      MarkTourSeenSchema.safeParse({ ...valid, status: 'OPEN' }).success,
    ).toBe(false)
  })
})
