import type { CrmRetentionSettings } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { toCrmRetentionSettingsDTO } from '../crm-retention.mapper'

describe('toCrmRetentionSettingsDTO', () => {
  it('should return the defaults when the workspace never saved', () => {
    expect(toCrmRetentionSettingsDTO('ws-1', null)).toEqual({
      workspaceId: 'ws-1',
      onDetractor: true,
      onHealthDrop: true,
      onSlaBreach: false,
      createOpportunity: false,
      taskDueDays: 2,
      isDefault: true,
      updatedById: null,
      updatedAt: null,
    })
  })

  it('should map a saved row', () => {
    const updatedAt = new Date('2026-11-13T10:00:00.000Z')
    const row: CrmRetentionSettings = {
      id: 'r1',
      workspaceId: 'ws-1',
      onDetractor: false,
      onHealthDrop: true,
      onSlaBreach: true,
      createOpportunity: true,
      taskDueDays: 7,
      updatedById: 'u1',
      createdAt: updatedAt,
      updatedAt,
    }
    expect(toCrmRetentionSettingsDTO('ws-1', row)).toEqual({
      workspaceId: 'ws-1',
      onDetractor: false,
      onHealthDrop: true,
      onSlaBreach: true,
      createOpportunity: true,
      taskDueDays: 7,
      isDefault: false,
      updatedById: 'u1',
      updatedAt: '2026-11-13T10:00:00.000Z',
    })
  })
})
