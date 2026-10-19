import { describe, expect, it } from 'vitest'
import {
  configurableNotificationKinds,
  isConfigurableNotificationKind,
  isUrgentNotificationKind,
  NOTIFICATION_ICONS,
  NOTIFICATION_MODULE_LABELS,
  NOTIFICATION_MODULES,
  NOTIFICATION_QUICK_FILTER_KEYS,
  NOTIFICATION_QUICK_FILTERS,
  notificationConversationRef,
  notificationKindCatalog,
  notificationKindInfo,
  notificationKindsOfModule,
  notificationModuleOf,
  notificationTicketRef,
} from '../notification-kind'

describe('notificationKindInfo', () => {
  it('should describe a known ServiceDesk kind in pt-BR', () => {
    const info = notificationKindInfo('SD_SLA_BREACHED')

    expect(info).toEqual({
      kind: 'SD_SLA_BREACHED',
      module: 'SERVICE_DESK',
      moduleLabel: 'ServiceDesk',
      label: 'SLA violado',
      icon: 'alarm',
      color: 'rose',
    })
  })

  it('should describe the WhatsApp sentiment kind as Comunicação', () => {
    const info = notificationKindInfo('WHATSAPP_NEGATIVE_SENTIMENT')

    expect(info.module).toBe('COMMUNICATION')
    expect(info.moduleLabel).toBe('Comunicação')
    expect(info.label).toBe('Sentimento negativo')
  })

  it('should infer the module by prefix for an unknown kind', () => {
    expect(notificationKindInfo('CRM_DEAL_WON')).toEqual({
      kind: 'CRM_DEAL_WON',
      module: 'CRM',
      moduleLabel: 'CRM',
      label: 'Crm deal won',
      icon: 'deal',
      color: 'violet',
    })
    expect(notificationKindInfo('SD_BRAND_NEW').module).toBe('SERVICE_DESK')
    expect(notificationKindInfo('WHATSAPP_SOMETHING').module).toBe(
      'COMMUNICATION',
    )
  })

  it('should fall back to the platform module for anything else', () => {
    const info = notificationKindInfo('BILLING_INVOICE_DUE')

    expect(info.module).toBe('OTHER')
    expect(info.moduleLabel).toBe('Plataforma')
    expect(info.icon).toBe('bell')
    expect(info.color).toBe('slate')
  })

  it('should never render an empty label', () => {
    expect(notificationKindInfo('').label).toBe('Notificação')
    expect(notificationKindInfo('_').label).toBe('Notificação')
  })

  it('should only use icons from the declared set', () => {
    for (const info of notificationKindCatalog()) {
      expect(NOTIFICATION_ICONS).toContain(info.icon)
      expect(NOTIFICATION_MODULES).toContain(info.module)
      expect(info.moduleLabel).toBe(NOTIFICATION_MODULE_LABELS[info.module])
    }
    expect(notificationKindCatalog().length).toBeGreaterThan(10)
  })
})

describe('notificationModuleOf / notificationKindsOfModule', () => {
  it('should group the known kinds by module', () => {
    const sd = notificationKindsOfModule('SERVICE_DESK')

    expect(sd).toContain('SD_TICKET_ASSIGNED')
    expect(sd).not.toContain('WHATSAPP_NEGATIVE_SENTIMENT')
    expect(
      sd.every((kind) => notificationModuleOf(kind) === 'SERVICE_DESK'),
    ).toBe(true)
    const zap = notificationKindsOfModule('COMMUNICATION')
    expect(zap).toEqual(
      expect.arrayContaining([
        'WHATSAPP_NEGATIVE_SENTIMENT',
        'WHATSAPP_CONVERSATION_ASSIGNED',
        'WHATSAPP_CONNECTION_LOST',
      ]),
    )
    expect(zap.every((kind) => kind.startsWith('WHATSAPP_'))).toBe(true)
  })

  it('should list the CRM and platform kinds under their modules', () => {
    expect(notificationKindsOfModule('CRM')).toContain('CRM_LEAD_ASSIGNED')
    expect(notificationKindsOfModule('CRM')).toContain('CRM_TASK_DUE')
    expect(notificationKindsOfModule('OTHER')).toContain('MEMBER_JOINED')
    expect(notificationKindsOfModule('OTHER')).toContain('AI_QUOTA_EXCEEDED')
    expect(
      notificationKindsOfModule('OTHER').some((kind) => kind.startsWith('SD_')),
    ).toBe(false)
  })
})

describe('notificationTicketRef', () => {
  it('should extract the slug and the ticket reference from a ticket href', () => {
    expect(notificationTicketRef('/acme/servicedesk/tickets/123')).toEqual({
      slug: 'acme',
      ticketRef: '123',
    })
    expect(
      notificationTicketRef(
        '/acme/servicedesk/tickets/INC-000123?aba=historico',
      ),
    ).toEqual({ slug: 'acme', ticketRef: 'INC-000123' })
  })

  it('should return null for anything that is not a ticket link', () => {
    expect(notificationTicketRef(null)).toBeNull()
    expect(notificationTicketRef(undefined)).toBeNull()
    expect(notificationTicketRef('')).toBeNull()
    expect(notificationTicketRef('/acme/zap?conversa=c1')).toBeNull()
    expect(notificationTicketRef('/acme/servicedesk/tickets')).toBeNull()
    expect(
      notificationTicketRef('https://x.com/a/servicedesk/tickets/1'),
    ).toBeNull()
  })
})

describe('configurable notification kinds', () => {
  it('should treat everything outside the ServiceDesk as configurable', () => {
    expect(isConfigurableNotificationKind('CRM_DEAL_CLOSED')).toBe(true)
    expect(isConfigurableNotificationKind('WHATSAPP_NEGATIVE_SENTIMENT')).toBe(
      true,
    )
    expect(isConfigurableNotificationKind('TRIAL_ENDED')).toBe(true)
    expect(isConfigurableNotificationKind('SD_TICKET_ASSIGNED')).toBe(false)
  })

  it('should keep the daily AI digest out of the generic list (own card)', () => {
    expect(isConfigurableNotificationKind('AI_DAILY_DIGEST')).toBe(false)
    expect(
      configurableNotificationKinds().some(
        (info) => info.kind === 'AI_DAILY_DIGEST',
      ),
    ).toBe(false)
  })

  it('should list only configurable kinds, with pt-BR labels', () => {
    const catalog = configurableNotificationKinds()

    expect(catalog.some((info) => info.module === 'SERVICE_DESK')).toBe(false)
    expect(catalog.find((info) => info.kind === 'CRM_LEAD_ASSIGNED')).toEqual(
      expect.objectContaining({
        module: 'CRM',
        moduleLabel: 'CRM',
        label: 'Lead atribuído',
      }),
    )
    expect(
      catalog.find((info) => info.kind === 'MEMBER_JOINED')?.moduleLabel,
    ).toBe('Plataforma')
  })
})

describe('AI_ACTION_EXPIRING', () => {
  it('should be a configurable platform kind with its own label', () => {
    expect(notificationKindInfo('AI_ACTION_EXPIRING')).toEqual(
      expect.objectContaining({
        module: 'OTHER',
        label: 'Ação da IA expirando',
        icon: 'sparkles',
        color: 'amber',
      }),
    )
    expect(isConfigurableNotificationKind('AI_ACTION_EXPIRING')).toBe(true)
  })
})

describe('NOTIFICATION_QUICK_FILTERS', () => {
  it('should expose mentions and assigned, both made of known kinds', () => {
    expect(NOTIFICATION_QUICK_FILTER_KEYS).toEqual(['mentions', 'assigned'])
    expect(NOTIFICATION_QUICK_FILTERS.mentions).toEqual(['SD_TICKET_MENTIONED'])
    const known = new Set(notificationKindCatalog().map((info) => info.kind))
    for (const kind of [
      ...NOTIFICATION_QUICK_FILTERS.mentions,
      ...NOTIFICATION_QUICK_FILTERS.assigned,
    ]) {
      expect(known.has(kind)).toBe(true)
    }
    expect(NOTIFICATION_QUICK_FILTERS.assigned).toContain(
      'WHATSAPP_CONVERSATION_ASSIGNED',
    )
  })
})

describe('isUrgentNotificationKind', () => {
  it.each([
    'SD_SLA_BREACHED',
    'SD_SLA_AT_RISK',
    'SD_APPROVAL_REQUESTED',
    'AGENT_APPROVAL_REQUESTED',
    'SD_TICKET_ASSIGNED',
    'WHATSAPP_CONVERSATION_ASSIGNED',
    'AI_ACTION_EXPIRING',
  ])('should treat %s as urgent', (kind) => {
    expect(isUrgentNotificationKind(kind)).toBe(true)
  })

  it.each(['CRM_DEAL_CLOSED', 'SD_DIGEST', 'UNKNOWN'])(
    'should not treat %s as urgent',
    (kind) => {
      expect(isUrgentNotificationKind(kind)).toBe(false)
    },
  )
})

describe('notificationConversationRef', () => {
  it('should read the conversation of a WhatsApp link', () => {
    expect(notificationConversationRef('/acme/zap?conversa=c1')).toEqual({
      slug: 'acme',
      conversationId: 'c1',
    })
  })

  it('should find the id among other params and decode it', () => {
    expect(
      notificationConversationRef('/acme/zap?tab=x&conversa=c%201&y=2#top'),
    ).toEqual({ slug: 'acme', conversationId: 'c 1' })
  })

  it.each([
    null,
    undefined,
    '',
    '/acme/zap',
    '/acme/zap?outra=c1',
    '/acme/crm/leads?conversa=c1',
    'https://evil.test/acme/zap?conversa=c1',
  ])('should return null for %s', (href) => {
    expect(notificationConversationRef(href)).toBeNull()
  })
})
