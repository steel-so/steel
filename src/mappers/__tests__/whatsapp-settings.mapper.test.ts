import { describe, expect, it } from 'vitest'
import { createFakeWhatsAppSettings } from '@/src/__tests__/factories/whatsapp-settings.factory'
import {
  toWhatsAppSettingsDTO,
  WHATSAPP_SETTINGS_DEFAULTS,
} from '../whatsapp-settings.mapper'

describe('toWhatsAppSettingsDTO() queue and distribution fields', () => {
  it('defaults to a manual queue when nothing was saved', () => {
    const dto = toWhatsAppSettingsDTO('ws1', null)
    expect(dto).toMatchObject({
      unassignedAlertNotifyInApp: true,
      unassignedAlertNotifyEmail: false,
      unassignedReminderMinutes: 10,
      distributionMode: 'OFF',
      distributionMaxOpenPerAgent: null,
      distributionOnlyAvailable: true,
      distributionRespectBusinessHours: true,
    })
    expect(WHATSAPP_SETTINGS_DEFAULTS.distributionMode).toBe('OFF')
  })

  it('maps the saved row', () => {
    const dto = toWhatsAppSettingsDTO(
      'ws1',
      createFakeWhatsAppSettings({
        workspaceId: 'ws1',
        unassignedAlertNotifyInApp: false,
        unassignedAlertNotifyEmail: true,
        unassignedReminderMinutes: 0,
        distributionMode: 'ROUND_ROBIN',
        distributionMaxOpenPerAgent: 6,
        distributionOnlyAvailable: false,
        distributionRespectBusinessHours: false,
      }),
    )
    expect(dto).toMatchObject({
      unassignedAlertNotifyInApp: false,
      unassignedAlertNotifyEmail: true,
      unassignedReminderMinutes: 0,
      distributionMode: 'ROUND_ROBIN',
      distributionMaxOpenPerAgent: 6,
      distributionOnlyAvailable: false,
      distributionRespectBusinessHours: false,
    })
  })

  it('does not expose the round-robin pointer', () => {
    const dto = toWhatsAppSettingsDTO(
      'ws1',
      createFakeWhatsAppSettings({ distributionLastAssignedUserId: 'u9' }),
    )
    expect(dto).not.toHaveProperty('distributionLastAssignedUserId')
  })
})
