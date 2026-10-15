import { describe, expect, it, vi } from 'vitest'
import { ok } from '@/src/lib/result'

vi.mock('@/src/services/crm-email-builder.service', () => ({
  renderCampaignEmail: vi.fn(),
  personToContact: (person: { name: string; companyName: string | null }) => ({
    name: person.name,
    email: 'old@example.com',
    company: person.companyName ?? undefined,
  }),
}))
vi.mock('@/src/repositories/crm-email-builder.repository')

import { databaseError } from '@/src/errors'
import { err } from '@/src/lib/result'
import { CrmEmailBuilderRepository } from '@/src/repositories/crm-email-builder.repository'
import { renderCampaignEmail as renderBuilderEmail } from '@/src/services/crm-email-builder.service'
import { renderCampaignEmail } from '../crm-campaign/email-renderer'

describe('renderCampaignEmail (campaign seam)', () => {
  it('should delegate to the e-mail builder render API', async () => {
    vi.mocked(renderBuilderEmail).mockResolvedValue(
      ok({ subject: 'Oi', html: '<p>Oi</p>', text: 'Oi' }),
    )
    const result = await renderCampaignEmail('tpl1', {
      workspaceId: 'ws1',
      name: 'Ana',
      email: 'ana@example.com',
      campaignLink: 'https://a.test/c/t',
      unsubscribeUrl: 'https://a.test/unsubscribe/u',
    })
    expect(result.ok && result.value.subject).toBe('Oi')
    expect(renderBuilderEmail).toHaveBeenCalledWith(
      'tpl1',
      { name: 'Ana', email: 'ana@example.com' },
      {
        workspaceId: 'ws1',
        campaignLink: 'https://a.test/c/t',
        unsubscribeUrl: 'https://a.test/unsubscribe/u',
      },
    )
  })

  it("should render with the CRM person's profile and list membership", async () => {
    vi.mocked(renderBuilderEmail).mockResolvedValue(
      ok({ subject: 'Oi', html: '<p>Oi</p>', text: 'Oi' }),
    )
    vi.mocked(CrmEmailBuilderRepository.findContacts).mockResolvedValue(
      ok([
        {
          id: 'p1',
          name: 'Ana Maria',
          emails: ['old@example.com'],
          phones: [],
          city: null,
          jobTitle: null,
          companyName: 'Acme',
        },
      ]),
    )
    const contact = {
      workspaceId: 'ws1',
      name: 'Ana',
      email: 'ana@example.com',
      campaignLink: 'https://a.test/c/t',
      personId: 'p1',
    }
    expect((await renderCampaignEmail('tpl1', contact)).ok).toBe(true)
    expect(renderBuilderEmail).toHaveBeenLastCalledWith(
      'tpl1',
      // The snapshot's name and address win over the person's.
      { name: 'Ana', email: 'ana@example.com', company: 'Acme' },
      {
        workspaceId: 'ws1',
        campaignLink: 'https://a.test/c/t',
        unsubscribeUrl: undefined,
        personId: 'p1',
      },
    )

    vi.mocked(CrmEmailBuilderRepository.findContacts).mockResolvedValueOnce(
      ok([]),
    )
    await renderCampaignEmail('tpl1', contact)
    expect(vi.mocked(renderBuilderEmail).mock.lastCall?.[1]).toEqual({
      name: 'Ana',
      email: 'ana@example.com',
    })

    vi.mocked(CrmEmailBuilderRepository.findContacts).mockResolvedValueOnce(
      err(databaseError('x')),
    )
    expect((await renderCampaignEmail('tpl1', contact)).ok).toBe(false)
  })
})
