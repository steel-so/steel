import { describe, expect, it } from 'vitest'
import { UpdateWhatsAppSettingsSchema } from '../whatsapp-settings.schema'

describe('UpdateWhatsAppSettingsSchema', () => {
  it('should accept 0 (auto-close off) and a positive number of hours', () => {
    expect(
      UpdateWhatsAppSettingsSchema.safeParse({ autoCloseAfterHours: 0 })
        .success,
    ).toBe(true)
    expect(
      UpdateWhatsAppSettingsSchema.safeParse({ autoCloseAfterHours: 24 })
        .success,
    ).toBe(true)
  })

  it('should reject negative, fractional and too large values', () => {
    for (const autoCloseAfterHours of [-1, 1.5, 721]) {
      expect(
        UpdateWhatsAppSettingsSchema.safeParse({ autoCloseAfterHours }).success,
      ).toBe(false)
    }
  })

  it('should accept an empty patch', () => {
    expect(UpdateWhatsAppSettingsSchema.safeParse({}).success).toBe(true)
  })

  describe('sentiment alert', () => {
    it('should accept a full alert configuration', () => {
      expect(
        UpdateWhatsAppSettingsSchema.safeParse({
          sentimentAlertEnabled: true,
          sentimentAlertThreshold: -0.5,
          sentimentAlertNotifyInApp: true,
          sentimentAlertNotifyEmail: true,
          sentimentAlertRecipientIds: ['u1', 'u2'],
          sentimentAlertAssignToId: null,
          sentimentAlertCooldownHours: 12,
        }).success,
      ).toBe(true)
    })

    it('should keep the threshold between -1 and 0', () => {
      for (const sentimentAlertThreshold of [-1.1, 0.2]) {
        expect(
          UpdateWhatsAppSettingsSchema.safeParse({ sentimentAlertThreshold })
            .success,
        ).toBe(false)
      }
    })

    it('should require a cooldown of 1 to 168 whole hours', () => {
      for (const sentimentAlertCooldownHours of [0, 169, 2.5]) {
        expect(
          UpdateWhatsAppSettingsSchema.safeParse({
            sentimentAlertCooldownHours,
          }).success,
        ).toBe(false)
      }
    })

    it('should accept the call recording settings', () => {
      const parsed = UpdateWhatsAppSettingsSchema.safeParse({
        callRecordingEnabled: true,
        callRecordingNotice: '  Ligação gravada.  ',
        callRecordingRetentionDays: 30,
        callTranscriptionEnabled: false,
      })
      expect(parsed.success).toBe(true)
      expect(parsed.data?.callRecordingNotice).toBe('Ligação gravada.')
      expect(
        UpdateWhatsAppSettingsSchema.safeParse({ callRecordingNotice: null })
          .success,
      ).toBe(true)
    })

    it('should keep the recording retention between 1 day and 5 years', () => {
      for (const callRecordingRetentionDays of [0, 1826, 1.5]) {
        expect(
          UpdateWhatsAppSettingsSchema.safeParse({ callRecordingRetentionDays })
            .success,
        ).toBe(false)
      }
    })

    it('should cap the recording notice at 500 characters', () => {
      expect(
        UpdateWhatsAppSettingsSchema.safeParse({
          callRecordingNotice: 'a'.repeat(501),
        }).success,
      ).toBe(false)
    })
  })
  describe('queue and distribution (ADR 0047)', () => {
    it('should accept a full distribution configuration', () => {
      expect(
        UpdateWhatsAppSettingsSchema.safeParse({
          unassignedAlertNotifyInApp: true,
          unassignedAlertNotifyEmail: true,
          unassignedReminderMinutes: 15,
          distributionMode: 'LEAST_LOADED',
          distributionMaxOpenPerAgent: 12,
          distributionOnlyAvailable: false,
          distributionRespectBusinessHours: true,
        }).success,
      ).toBe(true)
    })

    it('should accept every mode and a null cap', () => {
      for (const distributionMode of ['OFF', 'ROUND_ROBIN', 'LEAST_LOADED']) {
        expect(
          UpdateWhatsAppSettingsSchema.safeParse({
            distributionMode,
            distributionMaxOpenPerAgent: null,
          }).success,
        ).toBe(true)
      }
    })

    it('should reject an unknown mode', () => {
      expect(
        UpdateWhatsAppSettingsSchema.safeParse({ distributionMode: 'RANDOM' })
          .success,
      ).toBe(false)
    })

    it('should accept 0 to turn the reminder off and cap it at 24 hours', () => {
      expect(
        UpdateWhatsAppSettingsSchema.safeParse({ unassignedReminderMinutes: 0 })
          .success,
      ).toBe(true)
      for (const unassignedReminderMinutes of [-1, 1.5, 1441]) {
        expect(
          UpdateWhatsAppSettingsSchema.safeParse({ unassignedReminderMinutes })
            .success,
        ).toBe(false)
      }
    })

    it('should keep the open-conversation cap between 1 and 500', () => {
      for (const distributionMaxOpenPerAgent of [0, -3, 2.5, 501]) {
        expect(
          UpdateWhatsAppSettingsSchema.safeParse({
            distributionMaxOpenPerAgent,
          }).success,
        ).toBe(false)
      }
      expect(
        UpdateWhatsAppSettingsSchema.safeParse({
          distributionMaxOpenPerAgent: 500,
        }).success,
      ).toBe(true)
    })
  })
})
