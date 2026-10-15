import { describe, expect, it } from 'vitest'
import {
  createFakeCrmCampaign,
  createFakeCrmCampaignConversion,
  createFakeCrmCampaignRecipient,
} from '@/src/__tests__/factories/crm-campaign.factory'
import {
  toCrmCampaignAudienceDTO,
  toCrmCampaignConvertedContactDTO,
  toCrmCampaignDTO,
  toCrmCampaignKpisDTO,
  toCrmCampaignLinks,
  toCrmCampaignRecipientDTO,
} from '../crm-campaign.mapper'

describe('crm-campaign mapper', () => {
  it('should sanitize the stored audience JSON', () => {
    expect(toCrmCampaignAudienceDTO(null)).toEqual({
      mailingListIds: [],
      allPeople: false,
      leadStages: [],
    })
    expect(
      toCrmCampaignAudienceDTO({
        mailingListIds: ['a', 1],
        allPeople: 'yes',
        leadStages: 'QUALIFIED',
      }),
    ).toEqual({ mailingListIds: ['a'], allPeople: false, leadStages: [] })
    expect(
      toCrmCampaignAudienceDTO({
        mailingListIds: [],
        allPeople: true,
        leadStages: ['CLOSED'],
      }),
    ).toEqual({ mailingListIds: [], allPeople: true, leadStages: ['CLOSED'] })
  })

  it('should build channel links only with a destination token', () => {
    const campaign = createFakeCrmCampaign({ destinationType: 'LANDING_PAGE' })
    expect(toCrmCampaignLinks(campaign, 'https://a.test', null)).toEqual({
      destination: null,
      email: null,
      whatsapp: null,
    })
    const links = toCrmCampaignLinks(campaign, 'https://a.test', 'tok')
    expect(links.destination).toBe('https://a.test/l/tok')
    expect(links.email).toContain('utm_source=email')
    expect(links.whatsapp).toContain('utm_campaign=black-friday')
  })

  it('should build site page links from the resolved URL', () => {
    const campaign = createFakeCrmCampaign({ destinationType: 'SITE_PAGE' })
    const links = toCrmCampaignLinks(campaign, 'https://a.test', {
      url: 'https://a.test/s/clinica/contato',
    })
    expect(links.destination).toBe('https://a.test/s/clinica/contato')
    expect(links.email).toMatch(/\/s\/clinica\/contato\?utm_source=email/)
    // A token for a site page (or a URL for a form) is a mismatch.
    expect(
      toCrmCampaignLinks(campaign, 'https://a.test', 'tok').email,
    ).toBeNull()
    expect(
      toCrmCampaignLinks(
        createFakeCrmCampaign({ destinationType: 'FORM' }),
        'https://a.test',
        { url: 'https://a.test/x' },
      ).destination,
    ).toBeNull()
  })

  it('should map a campaign with ISO dates and null variables', () => {
    const at = new Date('2026-10-09T13:00:00.000Z')
    const dto = toCrmCampaignDTO(
      createFakeCrmCampaign({ startAt: at, scheduledAt: null }),
      { destination: null, email: null, whatsapp: null },
    )
    expect(dto.startAt).toBe(at.toISOString())
    expect(dto.scheduledAt).toBeNull()
    expect(dto.whatsappVariables).toBeNull()
    expect(dto.destination).toBeNull()
    expect(dto.siteId).toBeNull()
    expect(dto.whatsappQuickReplyId).toBeNull()
  })

  it('should default KPIs without a funnel', () => {
    expect(toCrmCampaignKpisDTO(undefined)).toEqual({
      recipients: 0,
      emailSent: 0,
      emailOpened: 0,
      emailClicked: 0,
      whatsappSent: 0,
      whatsappRead: 0,
      whatsappReplied: 0,
      conversions: 0,
    })
  })

  it('should map conversions without recipient and recipients', () => {
    expect(
      toCrmCampaignConvertedContactDTO({
        ...createFakeCrmCampaignConversion(),
        recipient: null,
      }).name,
    ).toBeNull()
    const row = toCrmCampaignRecipientDTO(
      createFakeCrmCampaignRecipient({ waId: '5511' }),
    )
    expect(row.waId).toBe('5511')
    expect(row.emailSentAt).toBeNull()
  })
})
