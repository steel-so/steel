import type { CrmCampaign } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeCampaignSite } from '@/src/__tests__/factories/campaign-site.factory'
import {
  createFakeCrmCampaign,
  createFakeCrmCampaignRecipient,
} from '@/src/__tests__/factories/crm-campaign.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { createCampaignLinkToken } from '@/src/lib/crm-campaign/tokens'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/crm-campaign.repository')
vi.mock('@/src/repositories/crm-campaign-lookup.repository')
vi.mock('@/src/repositories/crm-activity.repository')

import { CrmActivityRepository } from '@/src/repositories/crm-activity.repository'
import {
  CrmCampaignConversionRepository,
  CrmCampaignRecipientRepository,
  CrmCampaignRepository,
} from '@/src/repositories/crm-campaign.repository'
import { CrmCampaignLookupRepository } from '@/src/repositories/crm-campaign-lookup.repository'
import {
  CrmCampaignTrackingService,
  convertsRecipient,
  matchesDestination,
} from '../crm-campaign-tracking.service'

const campaigns = vi.mocked(CrmCampaignRepository)
const recipients = vi.mocked(CrmCampaignRecipientRepository)
const conversions = vi.mocked(CrmCampaignConversionRepository)
const lookup = vi.mocked(CrmCampaignLookupRepository)

const NOW = new Date('2026-10-09T13:00:00.000Z')
const T = CrmCampaignTrackingService

function campaign(overrides?: Partial<CrmCampaign>) {
  return createFakeCrmCampaign({
    id: 'c1',
    workspaceId: 'ws1',
    slug: 'bf',
    destinationType: 'FORM',
    formId: 'f1',
    ...overrides,
  })
}

function withRecipient(c: CrmCampaign = campaign()) {
  recipients.findWithCampaign.mockResolvedValue(
    ok({
      ...createFakeCrmCampaignRecipient({ id: 'r1', campaignId: c.id }),
      campaign: c,
    }),
  )
}

beforeEach(() => {
  recipients.markFirst.mockResolvedValue(ok(true))
  lookup.findForm.mockResolvedValue(
    ok({ id: 'f1', token: 'ftok', published: true }),
  )
  lookup.findLandingPage.mockResolvedValue(
    ok({ id: 'l1', token: 'ltok', published: true }),
  )
  conversions.record.mockResolvedValue(ok({ id: 'cv1' } as never))
})

describe('recordOpen()', () => {
  it('should mark the first open of an e-mail token', async () => {
    expect(
      expectOk(await T.recordOpen(createCampaignLinkToken('r1', 'EMAIL'), NOW)),
    ).toBe(true)
    expect(recipients.markFirst).toHaveBeenCalledWith(
      { id: 'r1' },
      'emailOpenedAt',
      NOW,
    )
  })

  it('should ignore invalid and WhatsApp tokens', async () => {
    expect(expectOk(await T.recordOpen('bad', NOW))).toBe(false)
    expect(
      expectOk(
        await T.recordOpen(createCampaignLinkToken('r1', 'WHATSAPP'), NOW),
      ),
    ).toBe(false)
  })
})

describe('resolveClick()', () => {
  it('should mark e-mail click + open and redirect with UTMs and ref', async () => {
    withRecipient()
    const token = createCampaignLinkToken('r1', 'EMAIL')
    const url = new URL(expectOk(await T.resolveClick(token, NOW)))
    expect(url.pathname).toBe('/f/ftok')
    expect(url.searchParams.get('utm_source')).toBe('email')
    expect(url.searchParams.get('utm_campaign')).toBe('bf')
    expect(url.searchParams.get('stc')).toBe(token)
    expect(recipients.markFirst).toHaveBeenCalledWith(
      { id: 'r1' },
      'emailClickedAt',
      NOW,
    )
    expect(recipients.markFirst).toHaveBeenCalledWith(
      { id: 'r1' },
      'emailOpenedAt',
      NOW,
    )
  })

  it('should mark WhatsApp clicks and reach landing pages', async () => {
    withRecipient(
      campaign({
        destinationType: 'LANDING_PAGE',
        formId: null,
        landingPageId: 'l1',
      }),
    )
    const url = expectOk(
      await T.resolveClick(createCampaignLinkToken('r1', 'WHATSAPP'), NOW),
    )
    expect(url).toContain('/l/ltok?utm_source=whatsapp')
    expect(recipients.markFirst).toHaveBeenCalledWith(
      { id: 'r1' },
      'whatsappClickedAt',
      NOW,
    )
  })

  it('should reject invalid tokens and gone campaigns/destinations', async () => {
    expectErr(await T.resolveClick('bad', NOW), 'CRM_CAMPAIGN_LINK_INVALID')
    const token = createCampaignLinkToken('r1', 'EMAIL')

    recipients.findWithCampaign.mockResolvedValueOnce(ok(null))
    expectErr(await T.resolveClick(token, NOW), 'CRM_CAMPAIGN_LINK_INVALID')

    withRecipient(campaign({ deletedAt: NOW }))
    expectErr(await T.resolveClick(token, NOW), 'CRM_CAMPAIGN_LINK_INVALID')

    withRecipient(campaign({ destinationType: null, formId: null }))
    expectErr(await T.resolveClick(token, NOW), 'CRM_CAMPAIGN_LINK_INVALID')

    withRecipient()
    lookup.findForm.mockResolvedValueOnce(ok(null))
    expectErr(await T.resolveClick(token, NOW), 'CRM_CAMPAIGN_LINK_INVALID')
    lookup.findForm.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await T.resolveClick(token, NOW), 'DATABASE_ERROR')
    recipients.findWithCampaign.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await T.resolveClick(token, NOW), 'DATABASE_ERROR')
  })
})

describe('attribute()', () => {
  const base = {
    workspaceId: 'ws1',
    kind: 'FORM_SUBMISSION' as const,
    sourceRef: 'sub1',
    formId: 'f1',
    leadId: 'lead1',
  }

  it('should attribute a submission to the recipient of the token', async () => {
    withRecipient()
    const ref = createCampaignLinkToken('r1', 'WHATSAPP')
    expect(
      expectOk(
        await T.attribute({ ...base, ref: { ref, utmSource: 'email' } }, NOW),
      ),
    ).toBe(true)
    expect(conversions.record).toHaveBeenCalledWith({
      campaignId: 'c1',
      recipientId: 'r1',
      channel: 'WHATSAPP',
      kind: 'FORM_SUBMISSION',
      sourceRef: 'sub1',
      leadId: 'lead1',
      personId: null,
      siteId: null,
      sitePageId: null,
      formId: 'f1',
    })
    expect(recipients.markFirst).toHaveBeenCalledWith(
      { id: 'r1' },
      'convertedAt',
      NOW,
    )
  })

  it('should fall back to the utm_campaign slug (forwarded link)', async () => {
    campaigns.findBySlug.mockResolvedValue(ok(campaign()))
    expect(
      expectOk(
        await T.attribute(
          { ...base, ref: { utmCampaign: 'bf', utmSource: 'whatsapp' } },
          NOW,
        ),
      ),
    ).toBe(true)
    expect(conversions.record).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: null, channel: 'WHATSAPP' }),
    )
    expect(recipients.markFirst).not.toHaveBeenCalled()

    // Unknown token recipient → slug.
    recipients.findWithCampaign.mockResolvedValueOnce(ok(null))
    expectOk(
      await T.attribute(
        {
          ...base,
          ref: {
            ref: createCampaignLinkToken('gone', 'EMAIL'),
            utmCampaign: 'bf',
            utmSource: 'x',
          },
        },
        NOW,
      ),
    )
    expect(conversions.record).toHaveBeenLastCalledWith(
      expect.objectContaining({ channel: null }),
    )
  })

  it('should count landing visits for landing destinations', async () => {
    campaigns.findBySlug.mockResolvedValue(
      ok(
        campaign({
          destinationType: 'LANDING_PAGE',
          formId: null,
          landingPageId: 'l1',
        }),
      ),
    )
    expect(
      expectOk(
        await T.attribute(
          {
            workspaceId: 'ws1',
            kind: 'LANDING_VIEW',
            sourceRef: 'view1',
            landingPageId: 'l1',
            ref: { utmCampaign: 'bf', utmSource: 'email' },
          },
          NOW,
        ),
      ),
    ).toBe(true)
  })

  it('should ignore other destinations, workspaces and duplicates', async () => {
    campaigns.findBySlug.mockResolvedValue(ok(campaign()))
    expect(
      expectOk(
        await T.attribute(
          { ...base, formId: 'f2', ref: { utmCampaign: 'bf' } },
          NOW,
        ),
      ),
    ).toBe(false)
    expect(
      expectOk(
        await T.attribute(
          {
            ...base,
            kind: 'LANDING_VIEW',
            landingPageId: 'l1',
            ref: { utmCampaign: 'bf' },
          },
          NOW,
        ),
      ),
    ).toBe(false)
    expect(
      expectOk(
        await T.attribute(
          { ...base, workspaceId: 'other', ref: { utmCampaign: 'bf' } },
          NOW,
        ),
      ),
    ).toBe(false)
    expect(expectOk(await T.attribute({ ...base, ref: {} }, NOW))).toBe(false)

    campaigns.findBySlug.mockResolvedValueOnce(ok(null))
    expect(
      expectOk(await T.attribute({ ...base, ref: { utmCampaign: 'zz' } }, NOW)),
    ).toBe(false)

    conversions.record.mockResolvedValueOnce(ok(null))
    withRecipient()
    expect(
      expectOk(
        await T.attribute(
          { ...base, ref: { ref: createCampaignLinkToken('r1', 'EMAIL') } },
          NOW,
        ),
      ),
    ).toBe(false)
    expect(recipients.markFirst).not.toHaveBeenCalled()

    // Landing view of a form campaign: recorded, but no conversion stamp.
    withRecipient(
      campaign({ destinationType: 'LANDING_PAGE', landingPageId: 'l1' }),
    )
    expectOk(
      await T.attribute(
        {
          workspaceId: 'ws1',
          kind: 'LANDING_VIEW',
          sourceRef: 'v',
          landingPageId: 'l1',
          ref: { ref: createCampaignLinkToken('r1', 'EMAIL') },
        },
        NOW,
      ),
    )
    expect(recipients.markFirst).toHaveBeenCalledWith(
      { id: 'r1' },
      'convertedAt',
      NOW,
    )
  })

  it('should propagate failures', async () => {
    const ref = { ref: createCampaignLinkToken('r1', 'EMAIL') }
    recipients.findWithCampaign.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await T.attribute({ ...base, ref }, NOW), 'DATABASE_ERROR')
    campaigns.findBySlug.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await T.attribute({ ...base, ref: { utmCampaign: 'bf' } }, NOW),
      'DATABASE_ERROR',
    )
    withRecipient()
    conversions.record.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await T.attribute({ ...base, ref }, NOW), 'DATABASE_ERROR')
  })
})

describe('onEmailEvent()', () => {
  const event = (type: string) => ({ type, data: { email_id: 'em1' } })

  it.each([
    ['email.delivered', ['emailDeliveredAt']],
    ['email.opened', ['emailOpenedAt']],
    ['email.clicked', ['emailOpenedAt', 'emailClickedAt']],
    ['email.bounced', ['emailBouncedAt']],
    ['email.complained', ['unsubscribedAt']],
  ])('%s should stamp %j', async (type, fields) => {
    recipients.findByProviderMessageId.mockResolvedValue(
      ok(createFakeCrmCampaignRecipient({ id: 'r1' })),
    )
    expect(expectOk(await T.onEmailEvent(event(type), NOW))).toBe(true)
    expect(recipients.markFirst.mock.calls.map((c) => c[1])).toEqual(fields)
  })

  it('should ignore unknown messages and events', async () => {
    recipients.findByProviderMessageId.mockResolvedValue(ok(null))
    expect(expectOk(await T.onEmailEvent(event('email.delivered'), NOW))).toBe(
      false,
    )
    recipients.findByProviderMessageId.mockResolvedValue(
      ok(createFakeCrmCampaignRecipient()),
    )
    expect(expectOk(await T.onEmailEvent(event('email.sent'), NOW))).toBe(false)
    recipients.findByProviderMessageId.mockResolvedValue(
      err(databaseError('x')),
    )
    expectErr(await T.onEmailEvent(event('email.sent'), NOW), 'DATABASE_ERROR')
  })
})

describe('onWhatsAppStatus()', () => {
  it('should stamp delivered and read', async () => {
    recipients.findByProviderMessageId.mockResolvedValue(
      ok(createFakeCrmCampaignRecipient({ id: 'r1' })),
    )
    expectOk(await T.onWhatsAppStatus('wa1', 'DELIVERED', NOW))
    expect(recipients.markFirst.mock.calls.map((c) => c[1])).toEqual([
      'whatsappDeliveredAt',
    ])
    expectOk(await T.onWhatsAppStatus('wa1', 'READ', NOW))
    expect(recipients.markFirst.mock.calls.map((c) => c[1])).toEqual([
      'whatsappDeliveredAt',
      'whatsappDeliveredAt',
      'whatsappReadAt',
    ])
  })

  it('should ignore other statuses and unknown messages', async () => {
    expect(expectOk(await T.onWhatsAppStatus('wa1', 'SENT', NOW))).toBe(false)
    recipients.findByProviderMessageId.mockResolvedValue(ok(null))
    expect(expectOk(await T.onWhatsAppStatus('wa1', 'READ', NOW))).toBe(false)
    recipients.findByProviderMessageId.mockResolvedValue(
      err(databaseError('x')),
    )
    expectErr(await T.onWhatsAppStatus('wa1', 'READ', NOW), 'DATABASE_ERROR')
  })
})

describe('onWhatsAppInbound()', () => {
  const input = { workspaceId: 'ws1', waId: '5511', conversationId: 'conv1' }

  it('should mark the reply, link the conversation and log on the person', async () => {
    recipients.listAwaitingReply.mockResolvedValue(
      ok([
        {
          ...createFakeCrmCampaignRecipient({
            id: 'r1',
            campaignId: 'c1',
            personId: 'p1',
          }),
          campaign: campaign({ name: 'Black Friday' }),
        },
      ]),
    )
    recipients.markReplied.mockResolvedValue(ok(undefined))
    expect(expectOk(await T.onWhatsAppInbound(input, NOW))).toBe(true)
    expect(recipients.markReplied).toHaveBeenCalledWith('r1', {
      at: NOW,
      conversationId: 'conv1',
    })
    expect(CrmActivityRepository.record).toHaveBeenCalledWith(
      expect.objectContaining({
        personId: 'p1',
        summary: 'respondeu pelo WhatsApp à campanha Black Friday',
      }),
    )
    expect(recipients.listAwaitingReply.mock.calls[0][2]).toEqual(
      new Date(NOW.getTime() - 30 * 24 * 3_600_000),
    )
  })

  it('should skip the timeline without a person and ignore strangers', async () => {
    recipients.listAwaitingReply.mockResolvedValue(
      ok([
        {
          ...createFakeCrmCampaignRecipient({ id: 'r1' }),
          campaign: campaign(),
        },
      ]),
    )
    recipients.markReplied.mockResolvedValue(ok(undefined))
    expect(expectOk(await T.onWhatsAppInbound(input, NOW))).toBe(true)
    expect(CrmActivityRepository.record).not.toHaveBeenCalled()

    recipients.listAwaitingReply.mockResolvedValue(ok([]))
    expect(expectOk(await T.onWhatsAppInbound(input, NOW))).toBe(false)
  })

  it('should propagate failures', async () => {
    recipients.listAwaitingReply.mockResolvedValue(err(databaseError('x')))
    expectErr(await T.onWhatsAppInbound(input, NOW), 'DATABASE_ERROR')
    recipients.listAwaitingReply.mockResolvedValue(
      ok([
        {
          ...createFakeCrmCampaignRecipient({ id: 'r1' }),
          campaign: campaign(),
        },
      ]),
    )
    recipients.markReplied.mockResolvedValue(err(databaseError('x')))
    expectErr(await T.onWhatsAppInbound(input, NOW), 'DATABASE_ERROR')
  })
})

describe('site destinations', () => {
  const site = (overrides?: Partial<CrmCampaign>) =>
    campaign({
      destinationType: 'SITE_PAGE',
      formId: null,
      siteId: 'site1',
      sitePageId: 'contato',
      ...overrides,
    })

  it('should redirect a click to the site page with UTMs and the token', async () => {
    lookup.findSite.mockResolvedValue(ok(createFakeCampaignSite()))
    withRecipient(site())
    const token = createCampaignLinkToken('r1', 'WHATSAPP')
    const url = new URL(expectOk(await T.resolveClick(token, NOW)))
    expect(url.pathname).toBe('/s/clinica/contato')
    expect(url.searchParams.get('utm_source')).toBe('whatsapp')
    expect(url.searchParams.get('utm_campaign')).toBe('bf')
    expect(url.searchParams.get('stc')).toBe(token)
  })

  it('should refuse a click when the page is not live or the site is gone', async () => {
    const token = createCampaignLinkToken('r1', 'EMAIL')
    lookup.findSite.mockResolvedValue(ok(createFakeCampaignSite()))
    withRecipient(site({ sitePageId: 'nova' }))
    expectErr(await T.resolveClick(token, NOW), 'CRM_CAMPAIGN_LINK_INVALID')

    lookup.findSite.mockResolvedValue(ok(null))
    withRecipient(site())
    expectErr(await T.resolveClick(token, NOW), 'CRM_CAMPAIGN_LINK_INVALID')

    lookup.findSite.mockResolvedValue(err(databaseError('x')))
    expectErr(await T.resolveClick(token, NOW), 'DATABASE_ERROR')
  })

  it('should attribute a site view and convert on the chosen page', async () => {
    withRecipient(site())
    const ref = createCampaignLinkToken('r1', 'EMAIL')
    expect(
      expectOk(
        await T.attribute(
          {
            workspaceId: 'ws1',
            kind: 'SITE_VIEW',
            sourceRef: 'hash:contato',
            siteId: 'site1',
            sitePageId: 'contato',
            ref: { ref },
          },
          NOW,
        ),
      ),
    ).toBe(true)
    expect(conversions.record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'SITE_VIEW',
        siteId: 'site1',
        sitePageId: 'contato',
        formId: null,
        channel: 'EMAIL',
      }),
    )
    expect(recipients.markFirst).toHaveBeenCalledWith(
      { id: 'r1' },
      'convertedAt',
      NOW,
    )

    // Another page of the same site counts, without converting.
    recipients.markFirst.mockClear()
    expectOk(
      await T.attribute(
        {
          workspaceId: 'ws1',
          kind: 'SITE_VIEW',
          sourceRef: 'hash:home',
          siteId: 'site1',
          sitePageId: 'home',
          ref: { ref },
        },
        NOW,
      ),
    )
    expect(recipients.markFirst).not.toHaveBeenCalled()
  })

  it('should attribute a form sent on a site page through the slug', async () => {
    lookup.findSiteIdBySlug.mockResolvedValue(ok('site1'))
    campaigns.findBySlug.mockResolvedValue(ok(site()))
    expect(
      expectOk(
        await T.attributeSiteForm(
          {
            workspaceId: 'ws1',
            submissionId: 'sub9',
            formId: 'f7',
            leadId: 'lead9',
            ref: {
              utmCampaign: 'bf',
              utmSource: 'email',
              siteSlug: 'clinica',
              sitePageId: 'home',
            },
          },
          NOW,
        ),
      ),
    ).toBe(true)
    expect(lookup.findSiteIdBySlug).toHaveBeenCalledWith('ws1', 'clinica')
    expect(conversions.record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'SITE_FORM_SUBMISSION',
        sourceRef: 'sub9',
        siteId: 'site1',
        sitePageId: 'home',
        formId: 'f7',
        leadId: 'lead9',
        channel: 'EMAIL',
      }),
    )
  })

  it('should skip site forms without a slug, of an unknown site or on failure', async () => {
    const input = {
      workspaceId: 'ws1',
      submissionId: 's',
      formId: 'f1',
      ref: { utmCampaign: 'bf', siteSlug: 'clinica' },
    }
    expect(
      expectOk(
        await T.attributeSiteForm(
          { ...input, ref: { utmCampaign: 'bf' } },
          NOW,
        ),
      ),
    ).toBe(false)
    lookup.findSiteIdBySlug.mockResolvedValueOnce(ok(null))
    expect(expectOk(await T.attributeSiteForm(input, NOW))).toBe(false)
    lookup.findSiteIdBySlug.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await T.attributeSiteForm(input, NOW), 'DATABASE_ERROR')
  })
})

describe('matchesDestination() / convertsRecipient()', () => {
  const form = {
    destinationType: 'FORM' as const,
    landingPageId: null,
    formId: 'f1',
    siteId: null,
  }
  const onSite = {
    destinationType: 'SITE_PAGE' as const,
    landingPageId: null,
    formId: null,
    siteId: 's1',
  }

  it('should match each kind to its destination', () => {
    expect(
      matchesDestination(form, { kind: 'FORM_SUBMISSION', formId: 'f1' }),
    ).toBe(true)
    expect(
      matchesDestination(form, {
        kind: 'SITE_FORM_SUBMISSION',
        formId: 'f1',
        siteId: 'x',
      }),
    ).toBe(true)
    expect(matchesDestination(form, { kind: 'SITE_VIEW', siteId: 's1' })).toBe(
      false,
    )
    expect(
      matchesDestination(onSite, { kind: 'SITE_VIEW', siteId: 's1' }),
    ).toBe(true)
    expect(
      matchesDestination(onSite, { kind: 'SITE_VIEW', siteId: 's2' }),
    ).toBe(false)
    expect(
      matchesDestination(onSite, {
        kind: 'SITE_FORM_SUBMISSION',
        siteId: 's1',
        formId: 'any',
      }),
    ).toBe(true)
    expect(
      matchesDestination(onSite, { kind: 'FORM_SUBMISSION', formId: 'f1' }),
    ).toBe(false)
    expect(
      matchesDestination(onSite, { kind: 'LANDING_VIEW', landingPageId: 'l1' }),
    ).toBe(false)
  })

  it('should convert on forms, landing views and the chosen site page', () => {
    expect(
      convertsRecipient(
        { destinationType: 'LANDING_PAGE', sitePageId: null },
        { kind: 'LANDING_VIEW' },
      ),
    ).toBe(true)
    expect(
      convertsRecipient(
        { destinationType: 'FORM', sitePageId: null },
        { kind: 'LANDING_VIEW' },
      ),
    ).toBe(false)
    expect(
      convertsRecipient(
        { destinationType: 'SITE_PAGE', sitePageId: 'p1' },
        { kind: 'SITE_VIEW', sitePageId: 'p1' },
      ),
    ).toBe(true)
    expect(
      convertsRecipient(
        { destinationType: 'SITE_PAGE', sitePageId: 'p1' },
        { kind: 'SITE_VIEW', sitePageId: 'p2' },
      ),
    ).toBe(false)
    expect(
      convertsRecipient(
        { destinationType: 'FORM', sitePageId: null },
        { kind: 'SITE_FORM_SUBMISSION' },
      ),
    ).toBe(true)
  })
})
