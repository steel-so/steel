import { describe, expect, it } from 'vitest'
import {
  CRM_RETENTION_DEFAULTS,
  UpdateCrmRetentionSettingsSchema,
} from '../crm-retention.schema'

describe('UpdateCrmRetentionSettingsSchema', () => {
  it('should accept a partial update', () => {
    const parsed = UpdateCrmRetentionSettingsSchema.safeParse({
      createOpportunity: true,
    })
    expect(parsed.success).toBe(true)
  })

  it('should accept every field', () => {
    const parsed = UpdateCrmRetentionSettingsSchema.safeParse({
      onDetractor: false,
      onHealthDrop: false,
      createOpportunity: true,
      taskDueDays: 5,
    })
    expect(parsed.success).toBe(true)
  })

  it('should reject an empty update', () => {
    const parsed = UpdateCrmRetentionSettingsSchema.safeParse({})
    expect(parsed.success).toBe(false)
  })

  it.each([0, 31, 1.5])('should reject taskDueDays %s', (taskDueDays) => {
    const parsed = UpdateCrmRetentionSettingsSchema.safeParse({ taskDueDays })
    expect(parsed.success).toBe(false)
  })

  it('should expose the documented defaults', () => {
    expect(CRM_RETENTION_DEFAULTS).toEqual({
      onDetractor: true,
      onHealthDrop: true,
      createOpportunity: false,
      taskDueDays: 2,
    })
  })
})
