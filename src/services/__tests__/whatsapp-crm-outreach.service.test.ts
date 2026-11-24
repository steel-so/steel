import { describe, expect, it, vi } from 'vitest'
import { createFakeWhatsAppContactWithoutCount } from '@/src/__tests__/factories/whatsapp-contact.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors/app-error'
import { err, ok } from '@/src/lib/result'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { markCrmOutreach } from '../whatsapp-crm-outreach.service'

vi.mock('@/src/repositories/whatsapp-contact.repository')

describe('markCrmOutreach()', () => {
  it('marks the contact of the number', async () => {
    vi.mocked(WhatsAppContactRepository.markCrmOutreach).mockResolvedValue(
      ok(createFakeWhatsAppContactWithoutCount({ crmOutreachAt: new Date() })),
    )

    expectOk(await markCrmOutreach('ws1', '5511988887777'))

    expect(WhatsAppContactRepository.markCrmOutreach).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      waId: '5511988887777',
    })
  })

  it('propagates a database failure so the send is not made unmarked', async () => {
    vi.mocked(WhatsAppContactRepository.markCrmOutreach).mockResolvedValue(
      err(databaseError()),
    )

    expectErr(await markCrmOutreach('ws1', '5511988887777'))
  })
})
