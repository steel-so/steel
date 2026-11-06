import { describe, expect, it } from 'vitest'
import { createFakeWhatsAppAgentReportSettings } from '@/src/__tests__/factories/whatsapp-agent-report.factory'
import { toWhatsAppAgentReportSettingsDTO } from '@/src/mappers/whatsapp-agent-report.mapper'

describe('toWhatsAppAgentReportSettingsDTO', () => {
  it('maps saved settings', () => {
    expect(
      toWhatsAppAgentReportSettingsDTO(
        createFakeWhatsAppAgentReportSettings({
          enabled: true,
          updatedAt: new Date('2026-11-06T12:00:00.000Z'),
        }),
      ),
    ).toEqual({ enabled: true, updatedAt: '2026-11-06T12:00:00.000Z' })
  })

  it('a workspace that never saved the settings has the report off', () => {
    expect(toWhatsAppAgentReportSettingsDTO(null)).toEqual({
      enabled: false,
      updatedAt: null,
    })
  })
})
