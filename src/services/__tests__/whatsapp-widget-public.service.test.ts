import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeWhatsAppWidgetSettings,
  createFakeWhatsAppWidgetVisitor,
} from '@/src/__tests__/factories/nov-site-widget.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, rateLimited } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import { hashVisitorToken } from '@/src/lib/whatsapp/widget'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))
vi.mock('@/lib/base-email-url', () => ({
  baseEmailUrl: 'https://steel.example.com',
}))
vi.mock('@/src/lib/rate-limit', () => ({
  consume: vi.fn(),
  widgetSendLimiter: {},
  widgetSessionLimiter: {},
}))
vi.mock('@/src/repositories/satisfaction-survey.repository')
vi.mock('@/src/repositories/whatsapp-contact.repository')
vi.mock('@/src/repositories/whatsapp-message.repository')
vi.mock('@/src/repositories/whatsapp-widget.repository')
vi.mock('../satisfaction-survey.service', () => ({
  SatisfactionSurveyService: { handleInbound: vi.fn() },
}))
vi.mock('../whatsapp-business-hours.service', () => ({
  WhatsAppBusinessHoursService: { check: vi.fn() },
}))
vi.mock('../whatsapp-webhook.service', () => ({
  WhatsAppWebhookService: { ingestInboundMessage: vi.fn() },
}))

import { consume } from '@/src/lib/rate-limit'
import { SatisfactionSurveyRepository } from '@/src/repositories/satisfaction-survey.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import {
  WhatsAppWidgetSettingsRepository,
  WhatsAppWidgetVisitorRepository,
} from '@/src/repositories/whatsapp-widget.repository'
import { SatisfactionSurveyService } from '../satisfaction-survey.service'
import { WhatsAppBusinessHoursService } from '../whatsapp-business-hours.service'
import { WhatsAppWebhookService } from '../whatsapp-webhook.service'
import {
  WhatsAppWidgetPublicService,
  type WidgetContext,
} from '../whatsapp-widget-public.service'

const consumeMock = vi.mocked(consume)
const settingsRepo = vi.mocked(WhatsAppWidgetSettingsRepository)
const visitorRepo = vi.mocked(WhatsAppWidgetVisitorRepository)
const contactRepo = vi.mocked(WhatsAppContactRepository)
const messageRepo = vi.mocked(WhatsAppMessageRepository)
const surveyRepo = vi.mocked(SatisfactionSurveyRepository)
const surveyService = vi.mocked(SatisfactionSurveyService)
const hours = vi.mocked(WhatsAppBusinessHoursService.check)
const ingest = vi.mocked(WhatsAppWebhookService.ingestInboundMessage)

const WS = 'ws1'
const ORIGIN = 'https://cliente.example.com'
const META = { ip: '1.2.3.4', origin: ORIGIN }
const TOKEN = 'visitor-token'

const connection = createFakeWhatsAppConnection({
  id: 'conn1',
  workspaceId: WS,
  provider: 'WIDGET',
})

function context(overrides?: Parameters<typeof createFakeWhatsAppWidgetSettings>[0]) {
  const settings = createFakeWhatsAppWidgetSettings({
    workspaceId: WS,
    connectionId: 'conn1',
    ...overrides,
  })
  return { settings, connection, workspaceId: WS } satisfies WidgetContext
}

const visitor = createFakeWhatsAppWidgetVisitor({
  id: 'v1',
  workspaceId: WS,
  contactId: 'c1',
  tokenHash: hashVisitorToken(TOKEN),
})
const contact = { id: 'c1', waId: 'widget:abc', name: 'Ana' } as never
const conversation = { id: 'conv1', status: 'NEW' } as never
const open = { open: true, nextOpeningAt: null, hours: {} } as never
const closed = { open: false, nextOpeningAt: null, hours: {} } as never

beforeEach(() => {
  vi.resetAllMocks()
  consumeMock.mockResolvedValue(ok(undefined))
  hours.mockResolvedValue(ok(open))
  visitorRepo.findByTokenHash.mockResolvedValue(ok(visitor))
  visitorRepo.findConversation.mockResolvedValue(ok(conversation))
  visitorRepo.listMessages.mockResolvedValue(ok([]))
  visitorRepo.update.mockResolvedValue(ok(visitor))
  visitorRepo.create.mockResolvedValue(ok(visitor))
  visitorRepo.setContactDescription.mockResolvedValue(ok(undefined))
  visitorRepo.hasOutboundText.mockResolvedValue(ok(false))
  contactRepo.findById.mockResolvedValue(ok(contact))
  contactRepo.upsertByWaId.mockResolvedValue(ok(contact))
  settingsRepo.teamExists.mockResolvedValue(ok(true))
  ingest.mockResolvedValue(ok(undefined))
  messageRepo.create.mockResolvedValue(ok({} as never))
})

describe('authorize', () => {
  const settings = createFakeWhatsAppWidgetSettings({
    workspaceId: WS,
    connectionId: 'conn1',
  })

  beforeEach(() => {
    settingsRepo.findByPublicKey.mockResolvedValue(ok(settings))
    settingsRepo.findConnection.mockResolvedValue(ok(connection))
  })

  it('should return the context for an allowed origin', async () => {
    const ctx = expectOk(
      await WhatsAppWidgetPublicService.authorize('k', ORIGIN),
    )
    expect(ctx.workspaceId).toBe(WS)
    expect(ctx.connection.id).toBe('conn1')
  })

  it('should propagate a settings lookup failure', async () => {
    settingsRepo.findByPublicKey.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppWidgetPublicService.authorize('k', ORIGIN),
      'DATABASE_ERROR',
    )
  })

  it('should hide an unknown key, a disabled widget and a missing connection', async () => {
    settingsRepo.findByPublicKey.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppWidgetPublicService.authorize('k', ORIGIN),
      'WIDGET_NOT_AVAILABLE',
    )
    settingsRepo.findByPublicKey.mockResolvedValue(
      ok({ ...settings, enabled: false }),
    )
    expectErr(
      await WhatsAppWidgetPublicService.authorize('k', ORIGIN),
      'WIDGET_NOT_AVAILABLE',
    )
    settingsRepo.findByPublicKey.mockResolvedValue(
      ok({ ...settings, connectionId: null }),
    )
    expectErr(
      await WhatsAppWidgetPublicService.authorize('k', ORIGIN),
      'WIDGET_NOT_AVAILABLE',
    )
  })

  it('should refuse an origin outside the list or a missing one', async () => {
    expectErr(
      await WhatsAppWidgetPublicService.authorize('k', 'https://evil.com'),
      'WIDGET_ORIGIN_NOT_ALLOWED',
    )
    expectErr(
      await WhatsAppWidgetPublicService.authorize('k', null),
      'WIDGET_ORIGIN_NOT_ALLOWED',
    )
  })

  it('should fail when the connection cannot be read or is gone', async () => {
    settingsRepo.findConnection.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppWidgetPublicService.authorize('k', ORIGIN),
      'DATABASE_ERROR',
    )
    settingsRepo.findConnection.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppWidgetPublicService.authorize('k', ORIGIN),
      'WIDGET_NOT_AVAILABLE',
    )
  })
})

describe('getConfig', () => {
  it('should report online inside the business hours', async () => {
    const dto = expectOk(await WhatsAppWidgetPublicService.getConfig(context()))
    expect(dto.online).toBe(true)
    expect(dto.offlineMessage).toBeNull()
  })

  it('should carry the offline notice outside the hours', async () => {
    hours.mockResolvedValue(ok(closed))
    const dto = expectOk(await WhatsAppWidgetPublicService.getConfig(context()))
    expect(dto.online).toBe(false)
    expect(dto.offlineMessage).toBe('Estamos fora do horário.')
  })

  it('should stay online when the hours cannot be read', async () => {
    hours.mockResolvedValue(err(databaseError('x')))
    const dto = expectOk(await WhatsAppWidgetPublicService.getConfig(context()))
    expect(dto.online).toBe(true)
  })
})

describe('listMessages', () => {
  it('should answer empty without a token or for an unknown one', async () => {
    const none = expectOk(
      await WhatsAppWidgetPublicService.listMessages(context(), null, null),
    )
    expect(none).toEqual({ messages: [], conversation: 'NONE', survey: null })
    visitorRepo.findByTokenHash.mockResolvedValue(ok(null))
    expectOk(
      await WhatsAppWidgetPublicService.listMessages(context(), TOKEN, null),
    )
  })

  it('should treat a token of another workspace as unknown', async () => {
    visitorRepo.findByTokenHash.mockResolvedValue(
      ok({ ...visitor, workspaceId: 'other' }),
    )
    const result = expectOk(
      await WhatsAppWidgetPublicService.listMessages(context(), TOKEN, null),
    )
    expect(result.conversation).toBe('NONE')
    expect(visitorRepo.findConversation).not.toHaveBeenCalled()
  })

  it('should propagate lookup failures', async () => {
    visitorRepo.findByTokenHash.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppWidgetPublicService.listMessages(context(), TOKEN, null),
      'DATABASE_ERROR',
    )
    visitorRepo.findByTokenHash.mockResolvedValue(ok(visitor))
    visitorRepo.findConversation.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppWidgetPublicService.listMessages(context(), TOKEN, null),
      'DATABASE_ERROR',
    )
    visitorRepo.findConversation.mockResolvedValue(ok(conversation))
    visitorRepo.listMessages.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppWidgetPublicService.listMessages(context(), TOKEN, null),
      'DATABASE_ERROR',
    )
  })

  it('should answer empty when the visitor has no conversation yet', async () => {
    visitorRepo.findConversation.mockResolvedValue(ok(null))
    const result = expectOk(
      await WhatsAppWidgetPublicService.listMessages(context(), TOKEN, null),
    )
    expect(result.conversation).toBe('NONE')
  })

  it('should return the mapped messages and the cursor query', async () => {
    const at = new Date('2026-10-30T12:00:00Z')
    visitorRepo.listMessages.mockResolvedValue(
      ok([
        {
          id: 'm1',
          direction: 'IN',
          type: 'TEXT',
          text: 'Oi',
          mediaUrl: null,
          sentByAi: false,
          senderUserId: null,
          createdAt: at,
        },
      ]),
    )
    const after = new Date('2026-10-30T11:00:00Z')
    const result = expectOk(
      await WhatsAppWidgetPublicService.listMessages(context(), TOKEN, after),
    )
    expect(result.conversation).toBe('OPEN')
    expect(result.messages).toEqual([
      { id: 'm1', from: 'visitor', text: 'Oi', createdAt: at.toISOString() },
    ])
    expect(visitorRepo.listMessages).toHaveBeenCalledWith('conv1', after, 100)
  })

  describe('survey', () => {
    const closedConversation = { id: 'conv1', status: 'CLOSED' } as never

    beforeEach(() => {
      visitorRepo.findConversation.mockResolvedValue(ok(closedConversation))
    })

    it('should show the open survey of a closed conversation', async () => {
      surveyRepo.findOpenByPhone.mockResolvedValue(
        ok({ kind: 'NPS' } as never),
      )
      const result = expectOk(
        await WhatsAppWidgetPublicService.listMessages(
          context({ showSurvey: true }),
          TOKEN,
          null,
        ),
      )
      expect(result.conversation).toBe('CLOSED')
      expect(result.survey).toMatchObject({ kind: 'NPS', scaleMax: 10 })
      expect(surveyRepo.findOpenByPhone).toHaveBeenCalledWith(
        WS,
        'widget:abc',
        expect.any(Date),
      )
    })

    it('should show nothing when no survey is open or the contact is gone', async () => {
      surveyRepo.findOpenByPhone.mockResolvedValue(ok(null))
      const none = expectOk(
        await WhatsAppWidgetPublicService.listMessages(
          context({ showSurvey: true }),
          TOKEN,
          null,
        ),
      )
      expect(none.survey).toBeNull()
      contactRepo.findById.mockResolvedValue(ok(null))
      const gone = expectOk(
        await WhatsAppWidgetPublicService.listMessages(
          context({ showSurvey: true }),
          TOKEN,
          null,
        ),
      )
      expect(gone.survey).toBeNull()
    })

    it('should not look for a survey when the option is off', async () => {
      const result = expectOk(
        await WhatsAppWidgetPublicService.listMessages(
          context({ showSurvey: false }),
          TOKEN,
          null,
        ),
      )
      expect(result.survey).toBeNull()
      expect(surveyRepo.findOpenByPhone).not.toHaveBeenCalled()
    })
  })
})

describe('sendMessage', () => {
  const dto = { text: 'Preciso de ajuda' }

  describe('known visitor', () => {
    it('should ingest through the WhatsApp pipeline and issue no token', async () => {
      const result = expectOk(
        await WhatsAppWidgetPublicService.sendMessage(
          context(),
          TOKEN,
          dto,
          META,
        ),
      )
      expect(result.token).toBeNull()
      expect(visitorRepo.create).not.toHaveBeenCalled()
      expect(ingest).toHaveBeenCalledWith(
        expect.objectContaining({
          connection,
          waId: 'widget:abc',
          type: 'TEXT',
          text: 'Preciso de ajuda',
          routeTeamId: undefined,
        }),
      )
      expect(
        ingest.mock.calls[0][0].providerMessageId.startsWith('widget:in:'),
      ).toBe(true)
    })

    it('should route to the configured team', async () => {
      expectOk(
        await WhatsAppWidgetPublicService.sendMessage(
          context({ teamId: 't1' }),
          TOKEN,
          dto,
          META,
        ),
      )
      expect(ingest.mock.calls[0][0].routeTeamId).toBe('t1')
    })

    it('should fall back to the queue when the team is gone', async () => {
      settingsRepo.teamExists.mockResolvedValue(ok(false))
      expectOk(
        await WhatsAppWidgetPublicService.sendMessage(
          context({ teamId: 't1' }),
          TOKEN,
          dto,
          META,
        ),
      )
      expect(ingest.mock.calls[0][0].routeTeamId).toBeUndefined()
    })

    it('should pass the honeypot silently', async () => {
      const result = expectOk(
        await WhatsAppWidgetPublicService.sendMessage(
          context(),
          TOKEN,
          { ...dto, website: 'http://spam' },
          META,
        ),
      )
      expect(result.token).toBeNull()
      expect(ingest).not.toHaveBeenCalled()
    })

    it('should enforce the per-visitor send limit', async () => {
      consumeMock.mockResolvedValue(err(rateLimited(5)))
      expectErr(
        await WhatsAppWidgetPublicService.sendMessage(
          context(),
          TOKEN,
          dto,
          META,
        ),
        'RATE_LIMITED',
      )
      expect(ingest).not.toHaveBeenCalled()
    })

    it('should propagate lookup and ingest failures', async () => {
      visitorRepo.findByTokenHash.mockResolvedValue(err(databaseError('x')))
      expectErr(
        await WhatsAppWidgetPublicService.sendMessage(
          context(),
          TOKEN,
          dto,
          META,
        ),
        'DATABASE_ERROR',
      )
      visitorRepo.findByTokenHash.mockResolvedValue(ok(visitor))
      contactRepo.findById.mockResolvedValue(err(databaseError('x')))
      expectErr(
        await WhatsAppWidgetPublicService.sendMessage(
          context(),
          TOKEN,
          dto,
          META,
        ),
        'DATABASE_ERROR',
      )
      contactRepo.findById.mockResolvedValue(ok(contact))
      ingest.mockResolvedValue(err(databaseError('x')))
      expectErr(
        await WhatsAppWidgetPublicService.sendMessage(
          context(),
          TOKEN,
          dto,
          META,
        ),
        'DATABASE_ERROR',
      )
    })

    it('should reject a visitor whose contact was deleted', async () => {
      contactRepo.findById.mockResolvedValue(ok(null))
      expectErr(
        await WhatsAppWidgetPublicService.sendMessage(
          context(),
          TOKEN,
          dto,
          META,
        ),
        'WIDGET_VISITOR_INVALID',
      )
    })
  })

  describe('new visitor', () => {
    beforeEach(() => {
      visitorRepo.findByTokenHash.mockResolvedValue(ok(null))
    })

    it('should create the contact and the visitor and return the token once', async () => {
      const result = expectOk(
        await WhatsAppWidgetPublicService.sendMessage(
          context(),
          null,
          { ...dto, name: 'Ana', email: 'ana@x.com', pageUrl: 'https://s/p' },
          META,
        ),
      )
      expect(result.token).toBeTruthy()
      const created = visitorRepo.create.mock.calls[0][0]
      expect(created.tokenHash).toBe(hashVisitorToken(result.token as string))
      expect(created).toMatchObject({
        workspaceId: WS,
        name: 'Ana',
        email: 'ana@x.com',
        origin: ORIGIN,
      })
      expect(contactRepo.upsertByWaId.mock.calls[0][0]).toMatchObject({
        name: 'Ana',
      })
      expect(
        contactRepo.upsertByWaId.mock.calls[0][0].waId.startsWith('widget:'),
      ).toBe(true)
      expect(visitorRepo.setContactDescription).toHaveBeenCalledWith(
        'c1',
        expect.stringContaining('Página: https://s/p'),
      )
    })

    it('should call an anonymous visitor by a generic name', async () => {
      expectOk(
        await WhatsAppWidgetPublicService.sendMessage(
          context(),
          null,
          dto,
          { ip: 'unknown', origin: null },
        ),
      )
      expect(contactRepo.upsertByWaId.mock.calls[0][0].name).toBe(
        'Visitante do site',
      )
      expect(visitorRepo.setContactDescription).toHaveBeenCalledWith(
        'c1',
        'Chat do site',
      )
    })

    it('should describe the visitor by the site when there is no page url', async () => {
      expectOk(
        await WhatsAppWidgetPublicService.sendMessage(
          context(),
          null,
          { ...dto, phone: '11999999999' },
          META,
        ),
      )
      expect(visitorRepo.setContactDescription).toHaveBeenCalledWith(
        'c1',
        `Chat do site · Telefone: 11999999999 · Site: ${ORIGIN}`,
      )
    })

    it('should require the pre-chat answers when configured', async () => {
      const ctx = context({
        preChatEnabled: true,
        preChatAskEmail: true,
        preChatAskPhone: true,
      })
      const send = (body: Record<string, string>) =>
        WhatsAppWidgetPublicService.sendMessage(
          ctx,
          null,
          { ...dto, ...body },
          META,
        )
      expectErr(await send({}), 'VALIDATION_ERROR')
      expectErr(await send({ name: 'Ana' }), 'VALIDATION_ERROR')
      expectErr(
        await send({ name: 'Ana', email: 'a@x.com' }),
        'VALIDATION_ERROR',
      )
      expectOk(
        await send({ name: 'Ana', email: 'a@x.com', phone: '11999999999' }),
      )
    })

    it('should limit new visitors per IP', async () => {
      consumeMock.mockResolvedValueOnce(err(rateLimited(30)))
      expectErr(
        await WhatsAppWidgetPublicService.sendMessage(
          context(),
          null,
          dto,
          META,
        ),
        'RATE_LIMITED',
      )
      expect(contactRepo.upsertByWaId).not.toHaveBeenCalled()
    })

    it('should propagate contact and visitor creation failures', async () => {
      contactRepo.upsertByWaId.mockResolvedValue(err(databaseError('x')))
      expectErr(
        await WhatsAppWidgetPublicService.sendMessage(
          context(),
          null,
          dto,
          META,
        ),
        'DATABASE_ERROR',
      )
      contactRepo.upsertByWaId.mockResolvedValue(ok(contact))
      visitorRepo.create.mockResolvedValue(err(databaseError('x')))
      expectErr(
        await WhatsAppWidgetPublicService.sendMessage(
          context(),
          null,
          dto,
          META,
        ),
        'DATABASE_ERROR',
      )
    })

    it('should go on when only the contact description fails', async () => {
      visitorRepo.setContactDescription.mockResolvedValue(
        err(databaseError('x')),
      )
      const result = expectOk(
        await WhatsAppWidgetPublicService.sendMessage(
          context(),
          null,
          dto,
          META,
        ),
      )
      expect(result.token).toBeTruthy()
    })
  })

  describe('offline notice', () => {
    const send = (overrides?: Parameters<typeof context>[0]) =>
      WhatsAppWidgetPublicService.sendMessage(
        context(overrides),
        TOKEN,
        { text: 'oi' },
        META,
      )

    beforeEach(() => {
      hours.mockResolvedValue(ok(closed))
    })

    it('should write the notice on the conversation outside the hours', async () => {
      expectOk(await send())
      expect(messageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv1',
          direction: 'OUT',
          text: 'Estamos fora do horário.',
          status: 'SENT',
        }),
      )
    })

    it('should not repeat the notice inside the window', async () => {
      visitorRepo.hasOutboundText.mockResolvedValue(ok(true))
      expectOk(await send())
      expect(messageRepo.create).not.toHaveBeenCalled()
    })

    it('should stay quiet when off, inside the hours or when lookups fail', async () => {
      expectOk(await send({ offlineEnabled: false }))
      hours.mockResolvedValue(ok(open))
      expectOk(await send())
      hours.mockResolvedValue(err(databaseError('x')))
      expectOk(await send())
      hours.mockResolvedValue(ok(closed))
      visitorRepo.findConversation.mockResolvedValue(ok(null))
      expectOk(await send())
      visitorRepo.findConversation.mockResolvedValue(ok(conversation))
      visitorRepo.hasOutboundText.mockResolvedValue(err(databaseError('x')))
      expectOk(await send())
      expect(messageRepo.create).not.toHaveBeenCalled()
    })

    it('should not fail the send when the notice cannot be stored', async () => {
      messageRepo.create.mockResolvedValue(err(databaseError('x')))
      expectOk(await send())
    })
  })
})

describe('answerSurvey', () => {
  const ctx = () => context({ showSurvey: true })

  it('should refuse when the option is off', async () => {
    expectErr(
      await WhatsAppWidgetPublicService.answerSurvey(
        context({ showSurvey: false }),
        TOKEN,
        { score: 9 },
      ),
      'WIDGET_NOT_AVAILABLE',
    )
  })

  it('should refuse an unknown visitor or a deleted contact', async () => {
    visitorRepo.findByTokenHash.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppWidgetPublicService.answerSurvey(ctx(), TOKEN, {
        score: 9,
      }),
      'WIDGET_VISITOR_INVALID',
    )
    visitorRepo.findByTokenHash.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppWidgetPublicService.answerSurvey(ctx(), TOKEN, {
        score: 9,
      }),
      'DATABASE_ERROR',
    )
    visitorRepo.findByTokenHash.mockResolvedValue(ok(visitor))
    contactRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppWidgetPublicService.answerSurvey(ctx(), TOKEN, {
        score: 9,
      }),
      'WIDGET_VISITOR_INVALID',
    )
    contactRepo.findById.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppWidgetPublicService.answerSurvey(ctx(), TOKEN, {
        score: 9,
      }),
      'DATABASE_ERROR',
    )
  })

  it('should record the score through the survey inbound path', async () => {
    surveyService.handleInbound.mockResolvedValue(ok({ handled: true }))
    expectOk(
      await WhatsAppWidgetPublicService.answerSurvey(ctx(), TOKEN, {
        score: 9,
      }),
    )
    expect(surveyService.handleInbound).toHaveBeenCalledTimes(1)
    expect(surveyService.handleInbound).toHaveBeenCalledWith({
      workspaceId: WS,
      waId: 'widget:abc',
      type: 'TEXT',
      text: '9',
    })
  })

  it('should send the comment as the follow-up message', async () => {
    surveyService.handleInbound.mockResolvedValue(ok({ handled: true }))
    expectOk(
      await WhatsAppWidgetPublicService.answerSurvey(ctx(), TOKEN, {
        score: 10,
        comment: 'Ótimo',
      }),
    )
    expect(surveyService.handleInbound).toHaveBeenCalledTimes(2)
    expect(surveyService.handleInbound.mock.calls[1][0].text).toBe('Ótimo')
  })

  it('should say the survey is closed when nothing was handled', async () => {
    surveyService.handleInbound.mockResolvedValue(ok({ handled: false }))
    expectErr(
      await WhatsAppWidgetPublicService.answerSurvey(ctx(), TOKEN, {
        score: 9,
      }),
      'VALIDATION_ERROR',
    )
  })

  it('should propagate a survey failure', async () => {
    surveyService.handleInbound.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppWidgetPublicService.answerSurvey(ctx(), TOKEN, {
        score: 9,
      }),
      'DATABASE_ERROR',
    )
  })
})
