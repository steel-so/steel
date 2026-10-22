import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/phone-call-link.repository')

import { PhoneCallLinkRepository } from '@/src/repositories/phone-call-link.repository'
import { PhoneCallLinkService } from '../phone-call-link.service'

const repo = vi.mocked(PhoneCallLinkRepository)
const DB = databaseError('boom')

const call = {
  id: 'call1',
  workspaceId: 'ws1',
  conversationId: 'conv1' as string | null,
  destination: '11999998888',
}

beforeEach(() => {
  vi.clearAllMocks()
  repo.findTicketForConversation.mockResolvedValue(ok('t1'))
  repo.findPersonByPhoneKey.mockResolvedValue(ok('p1'))
  repo.findOpenOpportunityForPerson.mockResolvedValue(ok('o1'))
  repo.findConversationByWaIds.mockResolvedValue(ok('conv9'))
})

describe('PhoneCallLinkService.resolve()', () => {
  it('chains the ticket, the person by phone key and their opportunity', async () => {
    expect(await PhoneCallLinkService.resolve(call)).toEqual({
      sdTicketId: 't1',
      crmPersonId: 'p1',
      crmOpportunityId: 'o1',
    })
    expect(repo.findPersonByPhoneKey).toHaveBeenCalledWith('ws1', '1199998888')
    expect(repo.findOpenOpportunityForPerson).toHaveBeenCalledWith('ws1', 'p1')
  })

  it('skips the ticket without a conversation', async () => {
    const links = await PhoneCallLinkService.resolve({
      ...call,
      conversationId: null,
    })
    expect(repo.findTicketForConversation).not.toHaveBeenCalled()
    expect(links.sdTicketId).toBeNull()
    expect(links.crmPersonId).toBe('p1')
  })

  it('skips the CRM lookups for a number that is not a national phone', async () => {
    const links = await PhoneCallLinkService.resolve({
      ...call,
      destination: '200',
    })
    expect(repo.findPersonByPhoneKey).not.toHaveBeenCalled()
    expect(links).toEqual({
      sdTicketId: 't1',
      crmPersonId: null,
      crmOpportunityId: null,
    })
  })

  it('loses only the link whose lookup failed', async () => {
    repo.findTicketForConversation.mockResolvedValue(err(DB))
    repo.findPersonByPhoneKey.mockResolvedValue(err(DB))
    expect(await PhoneCallLinkService.resolve(call)).toEqual({
      sdTicketId: null,
      crmPersonId: null,
      crmOpportunityId: null,
    })
    expect(repo.findOpenOpportunityForPerson).not.toHaveBeenCalled()

    repo.findPersonByPhoneKey.mockResolvedValue(ok('p1'))
    repo.findOpenOpportunityForPerson.mockResolvedValue(err(DB))
    const links = await PhoneCallLinkService.resolve(call)
    expect(links.crmPersonId).toBe('p1')
    expect(links.crmOpportunityId).toBeNull()
  })
})

describe('PhoneCallLinkService.findConversationId()', () => {
  it('looks the contact up by every way the number may be stored', async () => {
    expect(
      await PhoneCallLinkService.findConversationId('ws1', '(11) 99999-8888'),
    ).toBe('conv9')
    expect(repo.findConversationByWaIds).toHaveBeenCalledWith('ws1', [
      '551199998888',
      '5511999998888',
    ])
  })

  it('answers null when the lookup fails', async () => {
    repo.findConversationByWaIds.mockResolvedValue(err(DB))
    expect(
      await PhoneCallLinkService.findConversationId('ws1', '11999998888'),
    ).toBeNull()
  })
})
