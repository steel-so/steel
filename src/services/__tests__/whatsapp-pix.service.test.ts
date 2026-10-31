import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeCrmOpportunity } from '@/src/__tests__/factories/crm-opportunity.factory'
import {
  createFakeWhatsAppPixCharge,
  createFakeWhatsAppPixSettings,
} from '@/src/__tests__/factories/nov-z1-pix-in-chat.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppConversationWithPreview } from '@/src/__tests__/factories/whatsapp-conversation.factory'
import { createFakeWhatsAppMessage } from '@/src/__tests__/factories/whatsapp-message.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  databaseError,
  forbidden,
  notFound,
  whatsappConversationNotFound,
} from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('../authz', () => ({
  assertModuleMember: vi.fn(),
  assertModulePrivileged: vi.fn(),
}))
vi.mock('../whatsapp-conversation-scope.service', () => ({
  resolveConversationScope: vi.fn(),
  loadVisibleConversation: vi.fn(),
}))
vi.mock('../whatsapp-business-hours.service', () => ({
  WhatsAppBusinessHoursService: { assertOpen: vi.fn() },
}))
vi.mock('../whatsapp-sla.service', () => ({
  WhatsAppSlaService: { onOutbound: vi.fn(async () => undefined) },
}))
vi.mock('@/src/lib/pix/registry', () => ({
  getActivePixProvider: vi.fn(),
  getPixProviderById: vi.fn(),
}))
vi.mock('@/src/lib/whatsapp/send', () => ({
  WhatsAppSend: { text: vi.fn() },
}))
vi.mock('@/src/lib/whatsapp/realtime', () => ({
  publishWhatsAppEvent: vi.fn(async () => undefined),
}))
vi.mock('@/src/repositories/crm-note.repository')
vi.mock('@/src/repositories/crm-opportunity.repository')
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-conversation.repository')
vi.mock('@/src/repositories/whatsapp-conversation-event.repository')
vi.mock('@/src/repositories/whatsapp-message.repository')
vi.mock('@/src/repositories/whatsapp-pix.repository')

import type { PixProvider } from '@/src/lib/pix/provider'
import {
  getActivePixProvider,
  getPixProviderById,
} from '@/src/lib/pix/registry'
import { publishWhatsAppEvent } from '@/src/lib/whatsapp/realtime'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { CrmNoteRepository } from '@/src/repositories/crm-note.repository'
import { CrmOpportunityRepository } from '@/src/repositories/crm-opportunity.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppConversationEventRepository } from '@/src/repositories/whatsapp-conversation-event.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import {
  WhatsAppPixChargeRepository,
  WhatsAppPixSettingsRepository,
} from '@/src/repositories/whatsapp-pix.repository'
import { assertModuleMember, assertModulePrivileged } from '../authz'
import { WhatsAppBusinessHoursService } from '../whatsapp-business-hours.service'
import {
  loadVisibleConversation,
  resolveConversationScope,
} from '../whatsapp-conversation-scope.service'
import {
  formatPixAmount,
  pixIntroText,
  WhatsAppPixService,
} from '../whatsapp-pix.service'

const mockedMember = vi.mocked(assertModuleMember)
const mockedPrivileged = vi.mocked(assertModulePrivileged)
const mockedScope = vi.mocked(resolveConversationScope)
const mockedLoadConversation = vi.mocked(loadVisibleConversation)
const mockedHours = vi.mocked(WhatsAppBusinessHoursService.assertOpen)
const mockedActiveProvider = vi.mocked(getActivePixProvider)
const mockedProviderById = vi.mocked(getPixProviderById)
const mockedSend = vi.mocked(WhatsAppSend.text)
const mockedPublish = vi.mocked(publishWhatsAppEvent)
const settingsRepo = vi.mocked(WhatsAppPixSettingsRepository)
const chargeRepo = vi.mocked(WhatsAppPixChargeRepository)
const conversationRepo = vi.mocked(WhatsAppConversationRepository)
const connectionRepo = vi.mocked(WhatsAppConnectionRepository)
const messageRepo = vi.mocked(WhatsAppMessageRepository)
const eventRepo = vi.mocked(WhatsAppConversationEventRepository)
const opportunityRepo = vi.mocked(CrmOpportunityRepository)
const noteRepo = vi.mocked(CrmNoteRepository)

function fakeProvider(overrides?: Partial<PixProvider>): PixProvider {
  return {
    id: 'mock',
    isTest: true,
    createCharge: vi.fn(async (input) =>
      ok({ providerChargeId: input.txid, brCode: `BR${input.txid}` }),
    ),
    cancelCharge: vi.fn(async () => ok(undefined)),
    parseWebhook: vi.fn(() => ok([])),
    ...overrides,
  }
}

const WS = 'ws1'
const CONV = 'conv1'
const ACTOR = 'u1'
const MEMBER = { role: 'MEMBER', isPrivileged: false } as never

let provider: PixProvider
const conversation = createFakeWhatsAppConversationWithPreview({
  id: CONV,
  workspaceId: WS,
})
const connection = createFakeWhatsAppConnection({ workspaceId: WS })

beforeEach(() => {
  vi.resetAllMocks()
  provider = fakeProvider()
  mockedMember.mockResolvedValue(ok(MEMBER))
  mockedPrivileged.mockResolvedValue(
    ok({ role: 'ADMIN', isPrivileged: true } as never),
  )
  mockedScope.mockResolvedValue(ok({ mode: 'ALL' } as never))
  mockedLoadConversation.mockResolvedValue(ok(conversation))
  mockedHours.mockResolvedValue(ok(undefined))
  mockedActiveProvider.mockReturnValue(ok(provider))
  mockedProviderById.mockReturnValue(ok(provider))
  settingsRepo.findByWorkspace.mockResolvedValue(
    ok(createFakeWhatsAppPixSettings({ workspaceId: WS })),
  )
  connectionRepo.findById.mockResolvedValue(ok(connection))
  conversationRepo.findById.mockResolvedValue(ok(conversation))
  conversationRepo.update.mockResolvedValue(ok(conversation as never))
  mockedSend.mockResolvedValue(ok({ providerMessageId: 'wamid.1' } as never))
  messageRepo.create.mockResolvedValue(ok(createFakeWhatsAppMessage()))
  chargeRepo.create.mockImplementation(async (data) =>
    ok(createFakeWhatsAppPixCharge(data as never)),
  )
  opportunityRepo.findById.mockResolvedValue(ok(createFakeCrmOpportunity()))
  noteRepo.create.mockResolvedValue(ok({} as never))
  eventRepo.create.mockResolvedValue(ok({} as never))
})

describe('formatting', () => {
  it('formats the amount in BRL', () => {
    expect(formatPixAmount(1234.5).replace(/\s/g, ' ')).toBe('R$ 1.234,50')
  })

  it('builds the intro with description and the São Paulo deadline', () => {
    const text = pixIntroText({
      amount: 150,
      description: 'Mensalidade',
      expiresAt: new Date('2026-11-12T17:30:00.000Z'),
    })
    expect(text).toContain('Mensalidade')
    expect(text).toContain('12/11 às 14:30')
    expect(text).toContain('Pix Copia e Cola')
  })
})

describe('WhatsAppPixService.getSettings()', () => {
  it('returns the defaults (off) for a workspace that never saved', async () => {
    settingsRepo.findByWorkspace.mockResolvedValue(ok(null))
    const dto = expectOk(await WhatsAppPixService.getSettings(ACTOR, WS))
    expect(dto).toMatchObject({
      enabled: false,
      defaultExpiresMinutes: 60,
      provider: 'mock',
      isTestProvider: true,
    })
  })

  it('propagates the access, repository and provider errors', async () => {
    mockedMember.mockResolvedValueOnce(err(forbidden()))
    expectErr(await WhatsAppPixService.getSettings(ACTOR, WS), 'FORBIDDEN')

    settingsRepo.findByWorkspace.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await WhatsAppPixService.getSettings(ACTOR, WS), 'DATABASE_ERROR')

    mockedActiveProvider.mockReturnValueOnce(err(forbidden()))
    expectErr(await WhatsAppPixService.getSettings(ACTOR, WS), 'FORBIDDEN')
  })
})

describe('WhatsAppPixService.updateSettings()', () => {
  it('saves only the given fields', async () => {
    settingsRepo.upsert.mockResolvedValue(
      ok(createFakeWhatsAppPixSettings({ workspaceId: WS, enabled: true })),
    )
    const dto = expectOk(
      await WhatsAppPixService.updateSettings(ACTOR, WS, { enabled: true }),
    )
    expect(dto.enabled).toBe(true)
    expect(settingsRepo.upsert).toHaveBeenCalledWith(WS, { enabled: true })

    await WhatsAppPixService.updateSettings(ACTOR, WS, {
      defaultExpiresMinutes: 30,
    })
    expect(settingsRepo.upsert).toHaveBeenLastCalledWith(WS, {
      defaultExpiresMinutes: 30,
    })
  })

  it('refuses a non-admin', async () => {
    mockedPrivileged.mockResolvedValueOnce(err(forbidden()))
    expectErr(
      await WhatsAppPixService.updateSettings(ACTOR, WS, { enabled: true }),
      'FORBIDDEN',
    )
    expect(settingsRepo.upsert).not.toHaveBeenCalled()
  })

  it('propagates provider and database errors', async () => {
    mockedActiveProvider.mockReturnValueOnce(err(forbidden()))
    expectErr(
      await WhatsAppPixService.updateSettings(ACTOR, WS, {}),
      'FORBIDDEN',
    )
    settingsRepo.upsert.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await WhatsAppPixService.updateSettings(ACTOR, WS, {}),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppPixService.createCharge()', () => {
  const dto = { amount: 150, description: 'Mensalidade' }

  it('issues the charge, sends the intro and the bare code, and publishes', async () => {
    const result = expectOk(
      await WhatsAppPixService.createCharge(ACTOR, WS, CONV, dto),
    )

    expect(result).toMatchObject({
      status: 'PENDING',
      amount: 150,
      createdByAi: false,
      provider: 'mock',
    })
    expect(mockedSend).toHaveBeenCalledTimes(2)
    expect(mockedSend.mock.calls[0][1].text).toContain('Mensalidade')
    expect(mockedSend.mock.calls[1][1].text).toBe(result.brCode)
    expect(messageRepo.create).toHaveBeenCalledTimes(2)
    expect(chargeRepo.create.mock.calls[0][0]).toMatchObject({
      createdById: ACTOR,
      createdByAi: false,
    })
    expect(mockedPublish).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({ type: 'pix-charge.updated' }),
    )
  })

  it('uses the workspace default expiry unless one is given', async () => {
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(createFakeWhatsAppPixSettings({ defaultExpiresMinutes: 20 })),
    )
    const before = Date.now()
    await WhatsAppPixService.createCharge(ACTOR, WS, CONV, dto)
    const defaultExpiry = (
      chargeRepo.create.mock.calls[0][0].expiresAt as Date
    ).getTime()
    expect(defaultExpiry - before).toBeGreaterThanOrEqual(20 * 60_000 - 1000)
    expect(defaultExpiry - before).toBeLessThan(21 * 60_000)

    await WhatsAppPixService.createCharge(ACTOR, WS, CONV, {
      ...dto,
      expiresInMinutes: 5,
    })
    const custom = (
      chargeRepo.create.mock.calls[1][0].expiresAt as Date
    ).getTime()
    expect(custom - before).toBeLessThan(6 * 60_000)
  })

  it('links an existing opportunity and rejects an unknown one', async () => {
    expectOk(
      await WhatsAppPixService.createCharge(ACTOR, WS, CONV, {
        ...dto,
        opportunityId: 'opp1',
      }),
    )
    expect(chargeRepo.create.mock.calls[0][0].opportunityId).toBe('opp1')

    opportunityRepo.findById.mockResolvedValueOnce(
      err(notFound('CrmOpportunity')),
    )
    expectErr(
      await WhatsAppPixService.createCharge(ACTOR, WS, CONV, {
        ...dto,
        opportunityId: 'nope',
      }),
      'BAD_REQUEST',
    )

    opportunityRepo.findById.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await WhatsAppPixService.createCharge(ACTOR, WS, CONV, {
        ...dto,
        opportunityId: 'opp1',
      }),
      'DATABASE_ERROR',
    )
  })

  it('refuses while the Pix is off for the workspace', async () => {
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(createFakeWhatsAppPixSettings({ enabled: false })),
    )
    expectErr(
      await WhatsAppPixService.createCharge(ACTOR, WS, CONV, dto),
      'PIX_DISABLED',
    )
    settingsRepo.findByWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppPixService.createCharge(ACTOR, WS, CONV, dto),
      'PIX_DISABLED',
    )
    expect(provider.createCharge).not.toHaveBeenCalled()
  })

  it('stops on access, scope, conversation, hours and connection errors', async () => {
    mockedMember.mockResolvedValueOnce(err(forbidden()))
    expectErr(
      await WhatsAppPixService.createCharge('intruder', WS, CONV, dto),
      'FORBIDDEN',
    )
    mockedScope.mockResolvedValueOnce(err(forbidden()))
    expectErr(
      await WhatsAppPixService.createCharge(ACTOR, WS, CONV, dto),
      'FORBIDDEN',
    )
    settingsRepo.findByWorkspace.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await WhatsAppPixService.createCharge(ACTOR, WS, CONV, dto),
      'DATABASE_ERROR',
    )
    mockedActiveProvider.mockReturnValueOnce(err(forbidden()))
    expectErr(
      await WhatsAppPixService.createCharge(ACTOR, WS, CONV, dto),
      'FORBIDDEN',
    )
    mockedLoadConversation.mockResolvedValueOnce(
      err(whatsappConversationNotFound()),
    )
    expectErr(
      await WhatsAppPixService.createCharge(ACTOR, WS, 'other', dto),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    )
    mockedHours.mockResolvedValueOnce(err(forbidden()))
    expectErr(
      await WhatsAppPixService.createCharge(ACTOR, WS, CONV, dto),
      'FORBIDDEN',
    )
    connectionRepo.findById.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await WhatsAppPixService.createCharge(ACTOR, WS, CONV, dto),
      'DATABASE_ERROR',
    )
    connectionRepo.findById.mockResolvedValueOnce(ok(null))
    expectErr(
      await WhatsAppPixService.createCharge(ACTOR, WS, CONV, dto),
      'WHATSAPP_CONNECTION_NOT_FOUND',
    )
  })

  it('refuses while the AI is handling the conversation', async () => {
    mockedLoadConversation.mockResolvedValueOnce(
      ok({ ...conversation, aiActive: true }),
    )
    expectErr(
      await WhatsAppPixService.createCharge(ACTOR, WS, CONV, dto),
      'WHATSAPP_CONVERSATION_AI_HANDLING',
    )
  })

  it('returns the PSP error without storing anything', async () => {
    provider = fakeProvider({
      createCharge: vi.fn(async () => err(databaseError('psp down'))),
    })
    mockedActiveProvider.mockReturnValue(ok(provider))
    expectErr(
      await WhatsAppPixService.createCharge(ACTOR, WS, CONV, dto),
      'DATABASE_ERROR',
    )
    expect(chargeRepo.create).not.toHaveBeenCalled()
    expect(mockedSend).not.toHaveBeenCalled()
  })

  it('cancels at the PSP when the charge cannot be stored', async () => {
    chargeRepo.create.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await WhatsAppPixService.createCharge(ACTOR, WS, CONV, dto),
      'DATABASE_ERROR',
    )
    expect(provider.cancelCharge).toHaveBeenCalledTimes(1)
    expect(mockedSend).not.toHaveBeenCalled()
  })

  it('cancels the charge when the intro or the code never reaches the customer', async () => {
    mockedSend.mockResolvedValueOnce(err(databaseError('provider')))
    expectErr(
      await WhatsAppPixService.createCharge(ACTOR, WS, CONV, dto),
      'DATABASE_ERROR',
    )
    expect(provider.cancelCharge).toHaveBeenCalledTimes(1)
    expect(chargeRepo.markCanceled).toHaveBeenCalledTimes(1)

    mockedSend
      .mockResolvedValueOnce(ok({ providerMessageId: 'a' } as never))
      .mockResolvedValueOnce(err(databaseError('provider')))
    expectErr(
      await WhatsAppPixService.createCharge(ACTOR, WS, CONV, dto),
      'DATABASE_ERROR',
    )
    expect(chargeRepo.markCanceled).toHaveBeenCalledTimes(2)
  })

  it('fails when the message cannot be recorded', async () => {
    messageRepo.create.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await WhatsAppPixService.createCharge(ACTOR, WS, CONV, dto),
      'DATABASE_ERROR',
    )
  })

  it('still succeeds when the refreshed conversation cannot be read', async () => {
    conversationRepo.findById.mockResolvedValue(ok(null))
    expectOk(await WhatsAppPixService.createCharge(ACTOR, WS, CONV, dto))
    expect(mockedPublish).not.toHaveBeenCalledWith(
      WS,
      expect.objectContaining({ type: 'conversation.updated' }),
    )
  })
})

describe('WhatsAppPixService.createChargeForAi()', () => {
  const input = {
    workspaceId: WS,
    conversationId: CONV,
    amount: 99.9,
    description: 'Taxa de adesão',
  }

  it('charges as the AI: no sender, flagged and priced as an AI reply', async () => {
    const result = expectOk(await WhatsAppPixService.createChargeForAi(input))

    expect(result.createdByAi).toBe(true)
    expect(chargeRepo.create.mock.calls[0][0]).toMatchObject({
      createdById: null,
      createdByAi: true,
    })
    expect(mockedSend.mock.calls[0][2]).toMatchObject({
      cost: { source: 'AI_REPLY', conversationId: CONV },
    })
    expect(messageRepo.create.mock.calls[0][0]).toMatchObject({
      sentByAi: true,
    })
    // The AI does not move the conversation to "in progress".
    expect(conversationRepo.update.mock.calls[0][1]).not.toHaveProperty(
      'status',
    )
  })

  it('fails when Pix is off, or the conversation or connection is gone', async () => {
    settingsRepo.findByWorkspace.mockResolvedValueOnce(ok(null))
    expectErr(await WhatsAppPixService.createChargeForAi(input), 'PIX_DISABLED')

    conversationRepo.findById.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await WhatsAppPixService.createChargeForAi(input),
      'DATABASE_ERROR',
    )
    conversationRepo.findById.mockResolvedValueOnce(ok(null))
    expectErr(
      await WhatsAppPixService.createChargeForAi(input),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    )
    connectionRepo.findById.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await WhatsAppPixService.createChargeForAi(input),
      'DATABASE_ERROR',
    )
    connectionRepo.findById.mockResolvedValueOnce(ok(null))
    expectErr(
      await WhatsAppPixService.createChargeForAi(input),
      'WHATSAPP_CONNECTION_NOT_FOUND',
    )
  })
})

describe('listing', () => {
  it('lists the charges of a visible conversation', async () => {
    chargeRepo.listByConversation.mockResolvedValue(
      ok([
        createFakeWhatsAppPixCharge({
          expiresAt: new Date(Date.now() - 1000),
        }),
      ]),
    )
    const list = expectOk(
      await WhatsAppPixService.listByConversation(ACTOR, WS, CONV),
    )
    expect(list).toHaveLength(1)
    // A pending charge past its deadline reads as expired.
    expect(list[0].status).toBe('EXPIRED')
  })

  it('hides the charges of a conversation the actor cannot see', async () => {
    mockedLoadConversation.mockResolvedValueOnce(
      err(whatsappConversationNotFound()),
    )
    expectErr(
      await WhatsAppPixService.listByConversation(ACTOR, WS, CONV),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    )
    expect(chargeRepo.listByConversation).not.toHaveBeenCalled()

    mockedMember.mockResolvedValueOnce(err(forbidden()))
    expectErr(
      await WhatsAppPixService.listByConversation(ACTOR, WS, CONV),
      'FORBIDDEN',
    )

    chargeRepo.listByConversation.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await WhatsAppPixService.listByConversation(ACTOR, WS, CONV),
      'DATABASE_ERROR',
    )
  })

  it('lists the charges of an opportunity for CRM members only', async () => {
    chargeRepo.listByOpportunity.mockResolvedValue(
      ok([createFakeWhatsAppPixCharge()]),
    )
    expect(
      expectOk(await WhatsAppPixService.listByOpportunity(ACTOR, WS, 'opp1')),
    ).toHaveLength(1)
    expect(mockedMember).toHaveBeenCalledWith(ACTOR, WS, 'CRM', {
      resource: 'opportunities',
      action: 'VIEW',
    })

    mockedMember.mockResolvedValueOnce(err(forbidden()))
    expectErr(
      await WhatsAppPixService.listByOpportunity(ACTOR, WS, 'opp1'),
      'FORBIDDEN',
    )
    opportunityRepo.findById.mockResolvedValueOnce(
      err(notFound('CrmOpportunity')),
    )
    expectErr(
      await WhatsAppPixService.listByOpportunity(ACTOR, WS, 'opp1'),
      'RESOURCE_NOT_FOUND',
    )
    chargeRepo.listByOpportunity.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await WhatsAppPixService.listByOpportunity(ACTOR, WS, 'opp1'),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppPixService.cancel()', () => {
  const charge = createFakeWhatsAppPixCharge({
    id: 'ch1',
    workspaceId: WS,
    conversationId: CONV,
  })

  beforeEach(() => {
    chargeRepo.findById.mockResolvedValue(ok(charge))
    chargeRepo.markCanceled.mockResolvedValue(
      ok({ ...charge, status: 'CANCELED', canceledAt: new Date() }),
    )
  })

  it('cancels a pending charge at the PSP and in the database', async () => {
    const dto = expectOk(
      await WhatsAppPixService.cancel(ACTOR, WS, CONV, 'ch1'),
    )
    expect(dto.status).toBe('CANCELED')
    expect(provider.cancelCharge).toHaveBeenCalledWith(charge.providerChargeId)
    expect(mockedPublish).toHaveBeenCalled()
  })

  it('answers not found for another conversation or a missing charge', async () => {
    expectErr(
      await WhatsAppPixService.cancel(ACTOR, WS, 'other-conv', 'ch1'),
      'PIX_CHARGE_NOT_FOUND',
    )
    chargeRepo.findById.mockResolvedValueOnce(ok(null))
    expectErr(
      await WhatsAppPixService.cancel(ACTOR, WS, CONV, 'ch1'),
      'PIX_CHARGE_NOT_FOUND',
    )
    chargeRepo.findById.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await WhatsAppPixService.cancel(ACTOR, WS, CONV, 'ch1'),
      'DATABASE_ERROR',
    )
  })

  it('refuses a paid, canceled or expired charge', async () => {
    for (const patch of [
      { status: 'PAID' as const },
      { status: 'CANCELED' as const },
      { expiresAt: new Date(Date.now() - 1000) },
    ]) {
      chargeRepo.findById.mockResolvedValueOnce(ok({ ...charge, ...patch }))
      expectErr(
        await WhatsAppPixService.cancel(ACTOR, WS, CONV, 'ch1'),
        'PIX_CHARGE_NOT_PENDING',
      )
    }
    expect(provider.cancelCharge).not.toHaveBeenCalled()
  })

  it('loses the race when it was paid meanwhile', async () => {
    chargeRepo.markCanceled.mockResolvedValueOnce(ok(null))
    expectErr(
      await WhatsAppPixService.cancel(ACTOR, WS, CONV, 'ch1'),
      'PIX_CHARGE_NOT_PENDING',
    )
  })

  it('propagates access, provider and database failures', async () => {
    mockedMember.mockResolvedValueOnce(err(forbidden()))
    expectErr(
      await WhatsAppPixService.cancel('intruder', WS, CONV, 'ch1'),
      'FORBIDDEN',
    )
    mockedLoadConversation.mockResolvedValueOnce(
      err(whatsappConversationNotFound()),
    )
    expectErr(
      await WhatsAppPixService.cancel(ACTOR, WS, CONV, 'ch1'),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    )
    mockedProviderById.mockReturnValueOnce(err(forbidden()))
    expectErr(
      await WhatsAppPixService.cancel(ACTOR, WS, CONV, 'ch1'),
      'FORBIDDEN',
    )
    provider = fakeProvider({
      cancelCharge: vi.fn(async () => err(databaseError('psp'))),
    })
    mockedProviderById.mockReturnValue(ok(provider))
    expectErr(
      await WhatsAppPixService.cancel(ACTOR, WS, CONV, 'ch1'),
      'DATABASE_ERROR',
    )
    provider = fakeProvider()
    mockedProviderById.mockReturnValue(ok(provider))
    chargeRepo.markCanceled.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await WhatsAppPixService.cancel(ACTOR, WS, CONV, 'ch1'),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppPixService.handlePayment()', () => {
  const charge = createFakeWhatsAppPixCharge({
    id: 'ch1',
    workspaceId: WS,
    conversationId: CONV,
    opportunityId: 'opp1',
  })
  const notice = {
    providerChargeId: charge.providerChargeId,
    paidAmount: 150,
    paidAt: new Date('2026-11-12T12:00:00.000Z'),
    endToEndId: 'E1',
    payerName: 'Maria',
  }

  beforeEach(() => {
    chargeRepo.findByProviderCharge.mockResolvedValue(ok(charge))
    chargeRepo.markPaid.mockResolvedValue(
      ok({ ...charge, status: 'PAID', paidAt: notice.paidAt }),
    )
  })

  it('marks it paid, drops the timeline event, notes the deal and publishes', async () => {
    const dto = expectOk(await WhatsAppPixService.handlePayment('mock', notice))

    expect(dto.status).toBe('PAID')
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'PIX_PAID',
        source: 'PIX',
        conversationId: CONV,
      }),
    )
    expect(eventRepo.create.mock.calls[0][0].reason).not.toContain('cobrado')
    expect(noteRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        opportunityId: 'opp1',
        createdById: charge.createdById,
        title: 'Pix recebido',
      }),
    )
    expect(mockedPublish).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({ type: 'pix-charge.updated' }),
    )
  })

  it('notes a different received amount in the event', async () => {
    await WhatsAppPixService.handlePayment('mock', {
      ...notice,
      paidAmount: 100,
    })
    expect(eventRepo.create.mock.calls[0][0].reason).toContain('cobrado')
  })

  it('is idempotent: a repeated notice changes nothing', async () => {
    chargeRepo.markPaid.mockResolvedValueOnce(ok(null))
    expectOk(await WhatsAppPixService.handlePayment('mock', notice))
    expect(eventRepo.create).not.toHaveBeenCalled()
    expect(noteRepo.create).not.toHaveBeenCalled()
    expect(mockedPublish).not.toHaveBeenCalled()
  })

  it('does not note anything for a charge without a deal', async () => {
    chargeRepo.markPaid.mockResolvedValueOnce(
      ok({ ...charge, opportunityId: null, status: 'PAID' }),
    )
    expectOk(await WhatsAppPixService.handlePayment('mock', notice))
    expect(noteRepo.create).not.toHaveBeenCalled()
  })

  it('credits the note to the deal owner when the AI made the charge', async () => {
    chargeRepo.markPaid.mockResolvedValueOnce(
      ok({ ...charge, createdById: null, status: 'PAID' }),
    )
    opportunityRepo.findById.mockResolvedValueOnce(
      ok(createFakeCrmOpportunity({ createdById: 'deal-owner' })),
    )
    await WhatsAppPixService.handlePayment('mock', notice)
    expect(noteRepo.create.mock.calls[0][0].createdById).toBe('deal-owner')
  })

  it('survives a deleted deal and a failing note', async () => {
    opportunityRepo.findById.mockResolvedValueOnce(
      err(notFound('CrmOpportunity')),
    )
    expectOk(await WhatsAppPixService.handlePayment('mock', notice))
    expect(noteRepo.create).not.toHaveBeenCalled()

    chargeRepo.markPaid.mockResolvedValueOnce(ok({ ...charge, status: 'PAID' }))
    noteRepo.create.mockResolvedValueOnce(err(databaseError('x')))
    expectOk(await WhatsAppPixService.handlePayment('mock', notice))
  })

  it('fails for an unknown charge and on database errors', async () => {
    chargeRepo.findByProviderCharge.mockResolvedValueOnce(ok(null))
    expectErr(
      await WhatsAppPixService.handlePayment('mock', notice),
      'PIX_CHARGE_NOT_FOUND',
    )
    chargeRepo.findByProviderCharge.mockResolvedValueOnce(
      err(databaseError('x')),
    )
    expectErr(
      await WhatsAppPixService.handlePayment('mock', notice),
      'DATABASE_ERROR',
    )
    chargeRepo.markPaid.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await WhatsAppPixService.handlePayment('mock', notice),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppPixService.simulatePayment()', () => {
  const charge = createFakeWhatsAppPixCharge({
    id: 'ch1',
    workspaceId: WS,
    conversationId: CONV,
  })

  beforeEach(() => {
    chargeRepo.findById.mockResolvedValue(ok(charge))
    chargeRepo.findByProviderCharge.mockResolvedValue(ok(charge))
    chargeRepo.markPaid.mockResolvedValue(ok({ ...charge, status: 'PAID' }))
  })

  it('settles a charge of a test provider for an admin', async () => {
    const dto = expectOk(
      await WhatsAppPixService.simulatePayment(ACTOR, WS, CONV, 'ch1'),
    )
    expect(dto.status).toBe('PAID')
    expect(chargeRepo.markPaid.mock.calls[0][1]).toMatchObject({
      paidAmount: 150,
    })
  })

  it('refuses non-admins, real providers and foreign charges', async () => {
    mockedPrivileged.mockResolvedValueOnce(err(forbidden()))
    expectErr(
      await WhatsAppPixService.simulatePayment(ACTOR, WS, CONV, 'ch1'),
      'FORBIDDEN',
    )

    provider = fakeProvider({ isTest: false })
    mockedProviderById.mockReturnValue(ok(provider))
    expectErr(
      await WhatsAppPixService.simulatePayment(ACTOR, WS, CONV, 'ch1'),
      'FORBIDDEN',
    )
    provider = fakeProvider()
    mockedProviderById.mockReturnValue(ok(provider))

    expectErr(
      await WhatsAppPixService.simulatePayment(ACTOR, WS, 'other', 'ch1'),
      'PIX_CHARGE_NOT_FOUND',
    )
    chargeRepo.findById.mockResolvedValueOnce(ok(null))
    expectErr(
      await WhatsAppPixService.simulatePayment(ACTOR, WS, CONV, 'ch1'),
      'PIX_CHARGE_NOT_FOUND',
    )
    chargeRepo.findById.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await WhatsAppPixService.simulatePayment(ACTOR, WS, CONV, 'ch1'),
      'DATABASE_ERROR',
    )
    mockedProviderById.mockReturnValueOnce(err(forbidden()))
    expectErr(
      await WhatsAppPixService.simulatePayment(ACTOR, WS, CONV, 'ch1'),
      'FORBIDDEN',
    )
    chargeRepo.markPaid.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await WhatsAppPixService.simulatePayment(ACTOR, WS, CONV, 'ch1'),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppPixService.handleWebhook()', () => {
  const charge = createFakeWhatsAppPixCharge({ workspaceId: WS })
  const notice = {
    providerChargeId: charge.providerChargeId,
    paidAmount: 150,
    paidAt: new Date(),
    endToEndId: null,
    payerName: null,
  }
  const headers = new Headers()

  beforeEach(() => {
    chargeRepo.findByProviderCharge.mockResolvedValue(ok(charge))
    chargeRepo.markPaid.mockResolvedValue(ok({ ...charge, status: 'PAID' }))
  })

  it('authenticates through the provider and settles each payment', async () => {
    provider = fakeProvider({ parseWebhook: vi.fn(() => ok([notice, notice])) })
    mockedProviderById.mockReturnValue(ok(provider))
    const result = expectOk(
      await WhatsAppPixService.handleWebhook('mock', headers, '{}'),
    )
    expect(result.processed).toBe(2)
    expect(provider.parseWebhook).toHaveBeenCalledWith(
      headers,
      '{}',
      expect.any(URLSearchParams),
    )
  })

  it('answers 404 for an unknown provider and passes the auth error on', async () => {
    mockedProviderById.mockReturnValueOnce(err(forbidden()))
    expectErr(
      await WhatsAppPixService.handleWebhook('nope', headers, '{}'),
      'RESOURCE_NOT_FOUND',
    )
    provider = fakeProvider({ parseWebhook: vi.fn(() => err(forbidden())) })
    mockedProviderById.mockReturnValue(ok(provider))
    expectErr(
      await WhatsAppPixService.handleWebhook('mock', headers, '{}'),
      'FORBIDDEN',
    )
  })

  it('skips payments of unknown charges but fails on real errors', async () => {
    provider = fakeProvider({ parseWebhook: vi.fn(() => ok([notice])) })
    mockedProviderById.mockReturnValue(ok(provider))
    chargeRepo.findByProviderCharge.mockResolvedValueOnce(ok(null))
    expect(
      expectOk(await WhatsAppPixService.handleWebhook('mock', headers, '{}'))
        .processed,
    ).toBe(0)

    chargeRepo.findByProviderCharge.mockResolvedValueOnce(
      err(databaseError('x')),
    )
    expectErr(
      await WhatsAppPixService.handleWebhook('mock', headers, '{}'),
      'DATABASE_ERROR',
    )
  })
})
