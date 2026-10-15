import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeCampaignSite } from '@/src/__tests__/factories/campaign-site.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/crm-campaign-lookup.repository')

import { CrmCampaignLookupRepository } from '@/src/repositories/crm-campaign-lookup.repository'
import {
  type CampaignDestinationFields,
  resolveCampaignDestination,
  siteDestination,
} from '../crm-campaign-destination'

const lookup = vi.mocked(CrmCampaignLookupRepository)

function fields(
  overrides?: Partial<CampaignDestinationFields>,
): CampaignDestinationFields {
  return {
    workspaceId: 'ws1',
    destinationType: 'SITE_PAGE',
    landingPageId: null,
    formId: null,
    siteId: 'site1',
    sitePageId: 'home',
    ...overrides,
  }
}

beforeEach(() => {
  lookup.findSite.mockResolvedValue(ok(createFakeCampaignSite()))
})

describe('siteDestination()', () => {
  it('should resolve the home page of a published site to its root URL', () => {
    const resolved = siteDestination(createFakeCampaignSite(), 'home')
    expect(resolved.issue).toBeNull()
    expect(resolved.ref).toEqual({
      url: expect.stringMatching(/\/s\/clinica$/),
    })
    expect(resolved.summary).toMatchObject({
      type: 'SITE_PAGE',
      name: 'Clínica',
      pageTitle: 'Início',
      published: true,
    })
  })

  it('should treat an unreadable snapshot as unpublished', () => {
    const resolved = siteDestination(
      createFakeCampaignSite({ snapshot: { nope: true } }),
      'home',
    )
    expect(resolved.ref).toBeNull()
    expect(resolved.issue).toBe('Publique o site antes de enviar a campanha')
    // The draft page still names the summary.
    expect(resolved.summary.pageTitle).toBe('Início')
  })

  it('should leave the page title empty for an unknown page', () => {
    const resolved = siteDestination(createFakeCampaignSite(), 'gone')
    expect(resolved.summary.pageTitle).toBeNull()
    expect(resolved.summary.url).toBeNull()
  })
})

describe('resolveCampaignDestination()', () => {
  it('should resolve a site page through the lookup', async () => {
    const resolved = expectOk(await resolveCampaignDestination(fields()))
    expect(resolved?.summary.name).toBe('Clínica')
    expect(lookup.findSite).toHaveBeenCalledWith('ws1', 'site1')
  })

  it('should return null without a destination or a deleted record', async () => {
    expect(
      expectOk(await resolveCampaignDestination(fields({ siteId: null }))),
    ).toBeNull()
    expect(
      expectOk(
        await resolveCampaignDestination(fields({ destinationType: null })),
      ),
    ).toBeNull()
    expect(
      expectOk(
        await resolveCampaignDestination(
          fields({ destinationType: 'FORM', formId: null }),
        ),
      ),
    ).toBeNull()
    lookup.findSite.mockResolvedValueOnce(ok(null))
    expect(expectOk(await resolveCampaignDestination(fields()))).toBeNull()
    lookup.findForm.mockResolvedValueOnce(ok(null))
    expect(
      expectOk(
        await resolveCampaignDestination(
          fields({ destinationType: 'FORM', formId: 'f1' }),
        ),
      ),
    ).toBeNull()
  })

  it('should resolve forms and landing pages with their public URL', async () => {
    lookup.findForm.mockResolvedValueOnce(
      ok({ id: 'f1', token: 'ftok', published: false, name: 'Inscrição' }),
    )
    const form = expectOk(
      await resolveCampaignDestination(
        fields({ destinationType: 'FORM', formId: 'f1' }),
      ),
    )
    expect(form).toEqual({
      ref: 'ftok',
      summary: {
        type: 'FORM',
        name: 'Inscrição',
        pageTitle: null,
        url: expect.stringMatching(/\/f\/ftok$/),
        published: false,
      },
      issue: 'Publique o destino antes de enviar a campanha',
    })

    lookup.findLandingPage.mockResolvedValueOnce(
      ok({ id: 'l1', token: 'ltok', published: true }),
    )
    const landing = expectOk(
      await resolveCampaignDestination(
        fields({ destinationType: 'LANDING_PAGE', landingPageId: 'l1' }),
      ),
    )
    expect(landing?.summary).toMatchObject({ type: 'LANDING_PAGE', name: '' })
    expect(landing?.summary.url).toMatch(/\/l\/ltok$/)
    expect(landing?.issue).toBeNull()
  })

  it('should propagate lookup failures', async () => {
    lookup.findSite.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await resolveCampaignDestination(fields()), 'DATABASE_ERROR')
    lookup.findLandingPage.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await resolveCampaignDestination(
        fields({ destinationType: 'LANDING_PAGE', landingPageId: 'l1' }),
      ),
      'DATABASE_ERROR',
    )
  })
})
