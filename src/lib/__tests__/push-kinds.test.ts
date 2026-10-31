import { describe, expect, it } from 'vitest'
import {
  buildPushMessage,
  isPushNotificationKind,
  PUSH_NOTIFICATION_KINDS,
  safePushUrl,
} from '../push/push-kinds'

describe('push kinds', () => {
  it('should cover conversation, SLA, approval and lead', () => {
    expect(isPushNotificationKind('WHATSAPP_CONVERSATION_ASSIGNED')).toBe(true)
    expect(isPushNotificationKind('SD_SLA_AT_RISK')).toBe(true)
    expect(isPushNotificationKind('SD_APPROVAL_REQUESTED')).toBe(true)
    expect(isPushNotificationKind('CRM_LEAD_ASSIGNED')).toBe(true)
    expect(isPushNotificationKind('SD_TICKET_MESSAGE')).toBe(false)
    expect(PUSH_NOTIFICATION_KINDS.length).toBeGreaterThan(0)
  })

  it('should build a generic message from the kind only', () => {
    const message = buildPushMessage('CRM_LEAD_ASSIGNED', '/acme/crm/leads?record=l1')

    expect(message.title).toContain('CRM')
    expect(message.body).toBe('Toque para abrir no Steel.')
    expect(message.url).toBe('/acme/crm/leads?record=l1')
    expect(message.tag).toBe('CRM_LEAD_ASSIGNED')
  })

  it('should truncate very long titles from unknown kinds', () => {
    const message = buildPushMessage(`CRM_${'X'.repeat(200)}`, null)
    expect(message.title.length).toBeLessThanOrEqual(80)
  })

  it('should only accept same-app paths as click targets', () => {
    expect(safePushUrl('/acme/crm')).toBe('/acme/crm')
    expect(safePushUrl('//evil.example')).toBe('/')
    expect(safePushUrl('https://evil.example')).toBe('/')
    expect(safePushUrl(null)).toBe('/')
    expect(safePushUrl(undefined)).toBe('/')
  })
})
