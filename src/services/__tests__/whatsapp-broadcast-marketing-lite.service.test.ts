import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeWhatsAppBroadcastList,
  createFakeWhatsAppBroadcastRecipient,
} from '@/src/__tests__/factories/whatsapp-broadcast.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppContact } from '@/src/__tests__/factories/whatsapp-contact.factory'
import { createFakeWhatsAppSettings } from '@/src/__tests__/factories/whatsapp-settings.factory'
import { createFakeWhatsAppTemplate } from '@/src/__tests__/factories/whatsapp-template.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-broadcast.repository')
vi.mock('@/src/repositories/whatsapp-template.repository')
vi.mock('@/src/repositories/whatsapp-settings.repository')
vi.mock('@/src/lib/whatsapp/send', () => ({
  WhatsAppSend: { text: vi.fn(), media: vi.fn(), template: vi.fn() },
}))
vi.mock('@/src/lib/whatsapp/marketing-lite', () => ({
  metaCredentialsOf: vi.fn(),
  fetchMarketingLiteAnalytics: vi.fn(),
  describeMarketingLiteError: vi.fn(() => 'Motivo da Meta'),
}))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/services/whatsapp-notify', () => ({
  notifyWhatsAppUsers: vi.fn(async () => 1),
}))
vi.mock('@/src/lib/queue/queues', () => ({
  getWhatsappBroadcastQueue: vi.fn(() => ({ addBulk: vi.fn() })),
}))

import {
  describeMarketingLiteError,
  fetchMarketingLiteAnalytics,
  metaCredentialsOf,
} from '@/src/lib/whatsapp/marketing-lite'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppBroadcastRepository } from '@/src/repositories/whatsapp-broadcast.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppSettingsRepository } from '@/src/repositories/whatsapp-settings.repository'
import { WhatsAppTemplateRepository } from '@/src/repositories/whatsapp-template.repository'
import { WhatsAppBroadcastService } from '../whatsapp-broadcast.service'

const broadcastRepo = vi.mocked(WhatsAppBroadcastRepository)
const connectionRepo = vi.mocked(WhatsAppConnectionRepository)
const templateRepo = vi.mocked(WhatsAppTemplateRepository)
const settingsRepo = vi.mocked(WhatsAppSettingsRepository)
const send = vi.mocked(WhatsAppSend)

function arrange(options: {
  provider?: 'META' | 'ZAPI'
  category?: string
  lite?: boolean
  fallback?: boolean
}) {
  const list = createFakeWhatsAppBroadcastList({
    id: 'list1',
    workspaceId: 'ws1',
    connectionId: 'conn1',
    templateId: 'tpl1',
    status: 'RUNNING',
  })
  broadcastRepo.findRecipientById.mockResolvedValue(
    ok({
      ...createFakeWhatsAppBroadcastRecipient({
        id: 'r1',
        broadcastListId: 'list1',
      }),
      contact: createFakeWhatsAppContact({ waId: '5511988887777' }),
      broadcastList: list,
    }),
  )
  connectionRepo.findById.mockResolvedValue(
    ok(
      createFakeWhatsAppConnection({
        id: 'conn1',
        provider: options.provider ?? 'META',
      }),
    ),
  )
  templateRepo.findById.mockResolvedValue(
    ok(
      createFakeWhatsAppTemplate({
        id: 'tpl1',
        category: options.category ?? 'MARKETING',
      }),
    ),
  )
  settingsRepo.findByWorkspace.mockResolvedValue(
    ok(
      createFakeWhatsAppSettings({
        workspaceId: 'ws1',
        marketingLiteEnabled: options.lite ?? true,
        marketingLiteCloudFallback: options.fallback ?? true,
      }),
    ),
  )
  broadcastRepo.updateRecipientStatus.mockResolvedValue(ok(undefined))
  broadcastRepo.countPendingRecipients.mockResolvedValue(ok(1))
  send.template.mockResolvedValue(ok({ providerMessageId: 'wamid-1' }))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('sendToRecipient() with Marketing Messages Lite', () => {
  it('should send a marketing template through Lite and flag the recipient', async () => {
    arrange({ fallback: false })

    expectOk(await WhatsAppBroadcastService.sendToRecipient('list1', 'r1'))

    expect(send.template).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ marketingLite: { cloudApiFallback: false } }),
      {
        cost: expect.objectContaining({
          source: 'BROADCAST',
          viaMarketingLite: true,
        }),
      },
    )
    expect(broadcastRepo.updateRecipientStatus).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ status: 'SENT', viaMarketingLite: true }),
    )
  })

  it.each([
    ['the setting is off', { lite: false }],
    ['the template is not marketing', { category: 'UTILITY' }],
    ['the connection is Z-API', { provider: 'ZAPI' as const }],
  ])('should use the regular API when %s', async (_name, options) => {
    arrange(options)

    expectOk(await WhatsAppBroadcastService.sendToRecipient('list1', 'r1'))

    const input = send.template.mock.calls[0][1]
    expect(input).not.toHaveProperty('marketingLite')
    expect(send.template.mock.calls[0][2]?.cost).not.toHaveProperty(
      'viaMarketingLite',
    )
    expect(broadcastRepo.updateRecipientStatus).toHaveBeenCalledWith(
      'r1',
      expect.not.objectContaining({ viaMarketingLite: true }),
    )
  })

  it('should propagate a settings lookup failure without sending', async () => {
    arrange({})
    settingsRepo.findByWorkspace.mockResolvedValue(err(databaseError('boom')))

    expectErr(
      await WhatsAppBroadcastService.sendToRecipient('list1', 'r1'),
      'DATABASE_ERROR',
    )
    expect(send.template).not.toHaveBeenCalled()
  })
})

describe('marketingMetrics()', () => {
  const analytics = { sent: 10, delivered: 9, read: 5, clicked: 3 }

  function asMember() {
    vi.mocked(MembershipRepository).findByUserAndWorkspace.mockResolvedValue(
      ok(createFakeMembership({ role: 'MEMBER' })),
    )
  }

  function arrangeMetrics(count = 4) {
    asMember()
    broadcastRepo.findByIdRaw.mockResolvedValue(
      ok(
        createFakeWhatsAppBroadcastList({
          id: 'list1',
          workspaceId: 'ws1',
          connectionId: 'conn1',
          templateId: 'tpl1',
        }),
      ),
    )
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(createFakeWhatsAppSettings({ marketingLiteEnabled: true })),
    )
    broadcastRepo.marketingLiteSummary.mockResolvedValue(
      ok({ count, first: new Date('2026-10-01T10:00:00Z'), last: new Date() }),
    )
    templateRepo.findById.mockResolvedValue(
      ok(createFakeWhatsAppTemplate({ id: 'tpl1', name: 'promo' })),
    )
    connectionRepo.findById.mockResolvedValue(
      ok(createFakeWhatsAppConnection({ id: 'conn1', provider: 'META' })),
    )
    vi.mocked(metaCredentialsOf).mockResolvedValue({
      phoneNumberId: 'p',
      wabaId: 'w',
      accessToken: 't',
    })
    vi.mocked(fetchMarketingLiteAnalytics).mockResolvedValue(analytics)
  }

  it('should return the Meta totals for a broadcast sent through Lite', async () => {
    arrangeMetrics()

    expect(
      expectOk(
        await WhatsAppBroadcastService.marketingMetrics('u1', 'ws1', 'list1'),
      ),
    ).toEqual({
      enabled: true,
      viaMarketingLiteCount: 4,
      analytics,
      unavailableReason: null,
    })
    expect(fetchMarketingLiteAnalytics).toHaveBeenCalledWith(
      expect.anything(),
      { name: 'promo', language: 'pt_BR' },
      expect.objectContaining({ from: new Date('2026-10-01T10:00:00Z') }),
    )
  })

  it('should deny a non-member', async () => {
    vi.mocked(MembershipRepository).findByUserAndWorkspace.mockResolvedValue(
      ok(null),
    )
    expectErr(
      await WhatsAppBroadcastService.marketingMetrics('u1', 'ws1', 'list1'),
      'FORBIDDEN',
    )
  })

  it('should not find a broadcast of another workspace', async () => {
    arrangeMetrics()
    broadcastRepo.findByIdRaw.mockResolvedValue(
      ok(createFakeWhatsAppBroadcastList({ id: 'list1', workspaceId: 'ws2' })),
    )
    expectErr(
      await WhatsAppBroadcastService.marketingMetrics('u1', 'ws1', 'list1'),
      'WHATSAPP_BROADCAST_NOT_FOUND',
    )
    broadcastRepo.findByIdRaw.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppBroadcastService.marketingMetrics('u1', 'ws1', 'list1'),
      'WHATSAPP_BROADCAST_NOT_FOUND',
    )
  })

  it('should propagate database failures', async () => {
    arrangeMetrics()
    broadcastRepo.findByIdRaw.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await WhatsAppBroadcastService.marketingMetrics('u1', 'ws1', 'list1'),
      'DATABASE_ERROR',
    )
    settingsRepo.findByWorkspace.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await WhatsAppBroadcastService.marketingMetrics('u1', 'ws1', 'list1'),
      'DATABASE_ERROR',
    )
    broadcastRepo.marketingLiteSummary.mockResolvedValueOnce(
      err(databaseError('x')),
    )
    expectErr(
      await WhatsAppBroadcastService.marketingMetrics('u1', 'ws1', 'list1'),
      'DATABASE_ERROR',
    )
    templateRepo.findById.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await WhatsAppBroadcastService.marketingMetrics('u1', 'ws1', 'list1'),
      'DATABASE_ERROR',
    )
    connectionRepo.findById.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await WhatsAppBroadcastService.marketingMetrics('u1', 'ws1', 'list1'),
      'DATABASE_ERROR',
    )
  })

  it('should explain when nothing went through Lite', async () => {
    arrangeMetrics(0)
    const value = expectOk(
      await WhatsAppBroadcastService.marketingMetrics('u1', 'ws1', 'list1'),
    )
    expect(value.analytics).toBeNull()
    expect(value.unavailableReason).toContain('não usou')
    expect(fetchMarketingLiteAnalytics).not.toHaveBeenCalled()
  })

  it('should explain when the template or connection is gone', async () => {
    arrangeMetrics()
    templateRepo.findById.mockResolvedValue(ok(null))
    expect(
      expectOk(
        await WhatsAppBroadcastService.marketingMetrics('u1', 'ws1', 'list1'),
      ).unavailableReason,
    ).toContain('não existe mais')
  })

  it('should explain when the connection is not Meta', async () => {
    arrangeMetrics()
    vi.mocked(metaCredentialsOf).mockResolvedValue(null)
    expect(
      expectOk(
        await WhatsAppBroadcastService.marketingMetrics('u1', 'ws1', 'list1'),
      ).unavailableReason,
    ).toContain('Meta')
  })

  it('should keep the counters when Meta fails', async () => {
    arrangeMetrics()
    vi.mocked(fetchMarketingLiteAnalytics).mockRejectedValue(new Error('down'))
    const value = expectOk(
      await WhatsAppBroadcastService.marketingMetrics('u1', 'ws1', 'list1'),
    )
    expect(value.viaMarketingLiteCount).toBe(4)
    expect(value.analytics).toBeNull()
    expect(value.unavailableReason).toBe('Motivo da Meta')
    expect(describeMarketingLiteError).toHaveBeenCalledWith(new Error('down'))

    vi.mocked(fetchMarketingLiteAnalytics).mockRejectedValue('weird')
    expect(
      expectOk(
        await WhatsAppBroadcastService.marketingMetrics('u1', 'ws1', 'list1'),
      ).analytics,
    ).toBeNull()
  })

  it('should fall back to the list creation date when no send time is known', async () => {
    arrangeMetrics()
    broadcastRepo.marketingLiteSummary.mockResolvedValue(
      ok({ count: 1, first: null, last: null }),
    )
    expectOk(
      await WhatsAppBroadcastService.marketingMetrics('u1', 'ws1', 'list1'),
    )
    expect(fetchMarketingLiteAnalytics).toHaveBeenCalled()
  })

  it('should treat a list without template as not using Lite', async () => {
    arrangeMetrics()
    broadcastRepo.findByIdRaw.mockResolvedValue(
      ok(
        createFakeWhatsAppBroadcastList({
          id: 'list1',
          workspaceId: 'ws1',
          templateId: null,
        }),
      ),
    )
    expect(
      expectOk(
        await WhatsAppBroadcastService.marketingMetrics('u1', 'ws1', 'list1'),
      ).analytics,
    ).toBeNull()
  })
})
