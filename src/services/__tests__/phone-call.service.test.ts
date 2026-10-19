import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakePhoneCallWithNames } from '@/src/__tests__/factories/whatsapp-phone-call.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  databaseError,
  forbidden,
  moduleDisabled,
  sdNotAgent,
  whatsappConversationNotFound,
} from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/whatsapp-phone-call.repository', async (orig) => ({
  ...(await orig<
    typeof import('@/src/repositories/whatsapp-phone-call.repository')
  >()),
  WhatsAppPhoneCallRepository: {
    listBySource: vi.fn(),
    findWithNames: vi.fn(),
  },
}))
vi.mock('../authz', () => ({ assertModuleMember: vi.fn() }))
vi.mock('../sd-access', () => ({ SdAccess: { requireAgent: vi.fn() } }))
vi.mock('../sd-ticket-engine', () => ({
  SdTicketEngine: { loadConfig: vi.fn(), resolveRef: vi.fn() },
}))
vi.mock('../whatsapp-conversation-scope.service', () => ({
  loadConversationForViewer: vi.fn(),
}))

import { WhatsAppPhoneCallRepository } from '@/src/repositories/whatsapp-phone-call.repository'
import { assertModuleMember } from '../authz'
import { PhoneCallService } from '../phone-call.service'
import { SdAccess } from '../sd-access'
import { SdTicketEngine } from '../sd-ticket-engine'
import { loadConversationForViewer } from '../whatsapp-conversation-scope.service'

const callRepo = vi.mocked(WhatsAppPhoneCallRepository)
const member = vi.mocked(assertModuleMember)
const requireAgent = vi.mocked(SdAccess.requireAgent)
const engine = vi.mocked(SdTicketEngine)
const viewer = vi.mocked(loadConversationForViewer)
const DB = databaseError('db down')

const MEMBERSHIP = { role: 'MEMBER', isPrivileged: false, permissions: null }

function call(overrides: Parameters<typeof createFakePhoneCallWithNames>[0] = {}) {
  return createFakePhoneCallWithNames({
    id: 'call1',
    workspaceId: 'ws1',
    conversationId: 'conv1',
    recordingKey: 'ws1/call1.wav',
    recordingMimeType: 'audio/wav',
    recordingSizeBytes: 10,
    ...overrides,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  member.mockResolvedValue(ok(MEMBERSHIP as never))
  viewer.mockResolvedValue(ok({} as never))
  requireAgent.mockResolvedValue(ok({} as never))
  engine.loadConfig.mockResolvedValue(ok({ prefixes: {} } as never))
  engine.resolveRef.mockResolvedValue(ok({ id: 'ticket1' } as never))
  callRepo.listBySource.mockResolvedValue(ok([call()]))
  callRepo.findWithNames.mockResolvedValue(ok(call()))
})

describe('PhoneCallService lists', () => {
  it('lists the calls of a conversation the viewer can see', async () => {
    const list = expectOk(
      await PhoneCallService.listForConversation('u1', 'ws1', 'conv1'),
    )

    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: 'call1', userName: 'Ana' })
    expect(member).toHaveBeenCalledWith('u1', 'ws1', 'COMMUNICATION', {
      resource: 'conversations',
      action: 'VIEW',
    })
    expect(viewer).toHaveBeenCalledWith(
      { userId: 'u1', role: 'MEMBER' },
      'ws1',
      'conv1',
    )
    expect(callRepo.listBySource).toHaveBeenCalledWith('ws1', {
      conversationId: 'conv1',
    })
  })

  it('hides a conversation outside the viewer scope (team)', async () => {
    viewer.mockResolvedValue(err(whatsappConversationNotFound()))
    expectErr(
      await PhoneCallService.listForConversation('u1', 'ws1', 'conv1'),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    )
    expect(callRepo.listBySource).not.toHaveBeenCalled()
  })

  it('refuses a non-member or a disabled module', async () => {
    member.mockResolvedValueOnce(err(forbidden()))
    expectErr(
      await PhoneCallService.listForConversation('u2', 'ws1', 'conv1'),
      'FORBIDDEN',
    )
    member.mockResolvedValueOnce(err(moduleDisabled()))
    expectErr(
      await PhoneCallService.listForCrmPerson('u1', 'ws1', 'p1'),
      'MODULE_DISABLED',
    )
  })

  it('lists the calls of a ticket for agents only', async () => {
    expectOk(await PhoneCallService.listForTicket('u1', 'ws1', 'INC-1'))
    expect(engine.resolveRef).toHaveBeenCalledWith('ws1', 'INC-1', {})
    expect(callRepo.listBySource).toHaveBeenCalledWith('ws1', {
      sdTicketId: 'ticket1',
    })

    requireAgent.mockResolvedValueOnce(err(sdNotAgent()))
    expectErr(
      await PhoneCallService.listForTicket('requester', 'ws1', 'INC-1'),
      'SD_NOT_AGENT',
    )
  })

  it('propagates ticket lookup failures', async () => {
    engine.loadConfig.mockResolvedValueOnce(err(DB))
    expectErr(
      await PhoneCallService.listForTicket('u1', 'ws1', 'INC-1'),
      'DATABASE_ERROR',
    )
    engine.resolveRef.mockResolvedValueOnce(err(DB))
    expectErr(
      await PhoneCallService.listForTicket('u1', 'ws1', 'INC-1'),
      'DATABASE_ERROR',
    )
  })

  it('lists the calls of a CRM person and opportunity with their RBAC', async () => {
    expectOk(await PhoneCallService.listForCrmPerson('u1', 'ws1', 'p1'))
    expect(member).toHaveBeenLastCalledWith('u1', 'ws1', 'CRM', {
      resource: 'people',
      action: 'VIEW',
    })
    expect(callRepo.listBySource).toHaveBeenLastCalledWith('ws1', {
      crmPersonId: 'p1',
    })

    expectOk(await PhoneCallService.listForCrmOpportunity('u1', 'ws1', 'o1'))
    expect(member).toHaveBeenLastCalledWith('u1', 'ws1', 'CRM', {
      resource: 'opportunities',
      action: 'VIEW',
    })
    expect(callRepo.listBySource).toHaveBeenLastCalledWith('ws1', {
      crmOpportunityId: 'o1',
    })

    member.mockResolvedValueOnce(err(forbidden()))
    expectErr(
      await PhoneCallService.listForCrmOpportunity('u1', 'ws1', 'o1'),
      'FORBIDDEN',
    )
  })

  it('propagates a listing failure', async () => {
    callRepo.listBySource.mockResolvedValue(err(DB))
    expectErr(
      await PhoneCallService.listForCrmPerson('u1', 'ws1', 'p1'),
      'DATABASE_ERROR',
    )
  })
})

describe('PhoneCallService.recordingFor()', () => {
  it('serves the recording to whoever sees the conversation', async () => {
    expect(
      expectOk(await PhoneCallService.recordingFor('u1', 'ws1', 'call1')),
    ).toEqual({ key: 'ws1/call1.wav', mimeType: 'audio/wav', sizeBytes: 10 })
    expect(callRepo.findWithNames).toHaveBeenCalledWith('call1', 'ws1')
  })

  it('falls back to the ticket, then the opportunity, then the person', async () => {
    callRepo.findWithNames.mockResolvedValue(
      ok(
        call({
          sdTicketId: 't1',
          crmOpportunityId: 'o1',
          crmPersonId: 'p1',
        }),
      ),
    )
    viewer.mockResolvedValue(err(whatsappConversationNotFound()))

    // Agent of the ServiceDesk.
    expectOk(await PhoneCallService.recordingFor('u1', 'ws1', 'call1'))

    // Not an agent, but sees CRM opportunities.
    requireAgent.mockResolvedValue(err(sdNotAgent()))
    member.mockImplementation(async (_u, _w, module, require) =>
      module === 'CRM' && require?.resource === 'opportunities'
        ? ok(MEMBERSHIP as never)
        : err(forbidden()),
    )
    expectOk(await PhoneCallService.recordingFor('u1', 'ws1', 'call1'))

    // Only CRM people.
    member.mockImplementation(async (_u, _w, module, require) =>
      module === 'CRM' && require?.resource === 'people'
        ? ok(MEMBERSHIP as never)
        : err(forbidden()),
    )
    expectOk(await PhoneCallService.recordingFor('u1', 'ws1', 'call1'))
  })

  it('answers not found to someone who sees none of the records', async () => {
    callRepo.findWithNames.mockResolvedValue(
      ok(call({ sdTicketId: 't1', crmOpportunityId: 'o1', crmPersonId: 'p1' })),
    )
    member.mockResolvedValue(err(forbidden()))
    requireAgent.mockResolvedValue(err(forbidden()))

    expectErr(
      await PhoneCallService.recordingFor('u2', 'ws1', 'call1'),
      'PHONE_CALL_NOT_FOUND',
    )
  })

  it('answers not found when the conversation is hidden and nothing else is linked', async () => {
    viewer.mockResolvedValue(err(whatsappConversationNotFound()))
    expectErr(
      await PhoneCallService.recordingFor('u2', 'ws1', 'call1'),
      'PHONE_CALL_NOT_FOUND',
    )
  })

  it('answers not found for a call of another workspace', async () => {
    callRepo.findWithNames.mockResolvedValue(ok(null))
    expectErr(
      await PhoneCallService.recordingFor('u1', 'ws2', 'call1'),
      'PHONE_CALL_NOT_FOUND',
    )
  })

  it('answers recording not found for a visible call without audio', async () => {
    callRepo.findWithNames.mockResolvedValue(ok(call({ recordingKey: null })))
    expectErr(
      await PhoneCallService.recordingFor('u1', 'ws1', 'call1'),
      'PHONE_CALL_RECORDING_NOT_FOUND',
    )
  })

  it('defaults a missing size to zero', async () => {
    callRepo.findWithNames.mockResolvedValue(
      ok(call({ recordingSizeBytes: null })),
    )
    expect(
      expectOk(await PhoneCallService.recordingFor('u1', 'ws1', 'call1'))
        .sizeBytes,
    ).toBe(0)
  })

  it('propagates a lookup failure', async () => {
    callRepo.findWithNames.mockResolvedValue(err(DB))
    expectErr(
      await PhoneCallService.recordingFor('u1', 'ws1', 'call1'),
      'DATABASE_ERROR',
    )
  })
})
