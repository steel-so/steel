import type { CrmCampaign, WhatsAppConnection } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeCrmCampaign,
  createFakeCrmCampaignConversion,
  createFakeCrmCampaignRecipient,
} from '@/src/__tests__/factories/crm-campaign.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit')
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/crm-campaign.repository')
vi.mock('@/src/repositories/crm-campaign-audience.repository')
vi.mock('@/src/repositories/crm-campaign-lookup.repository')
vi.mock('@/src/services/crm-campaign-send.service')
vi.mock('@/src/lib/crm-campaign/email-renderer', () => ({
  renderCampaignEmail: vi.fn(),
}))
vi.mock('@/src/lib/mail/send', () => ({ sendEmail: vi.fn() }))

import { auditMutation } from '@/lib/axiom/audit'
import { renderCampaignEmail } from '@/src/lib/crm-campaign/email-renderer'
import { sendEmail } from '@/src/lib/mail/send'
import {
  type CampaignFunnelCounts,
  CrmCampaignConversionRepository,
  CrmCampaignRecipientRepository,
  CrmCampaignRepository,
} from '@/src/repositories/crm-campaign.repository'
import { CrmCampaignAudienceRepository } from '@/src/repositories/crm-campaign-audience.repository'
import { CrmCampaignLookupRepository } from '@/src/repositories/crm-campaign-lookup.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import {
  CrmCampaignService,
  computeCampaignIssues,
} from '../crm-campaign.service'
import {
  buildCampaignEmail,
  CrmCampaignSendService,
  sendCampaignWhatsApp,
} from '../crm-campaign-send.service'

const membership = vi.mocked(MembershipRepository)
const campaigns = vi.mocked(CrmCampaignRepository)
const recipients = vi.mocked(CrmCampaignRecipientRepository)
const conversions = vi.mocked(CrmCampaignConversionRepository)
const audience = vi.mocked(CrmCampaignAudienceRepository)
const lookup = vi.mocked(CrmCampaignLookupRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const send = vi.mocked(CrmCampaignSendService)

const WS = 'ws1'
const ACTOR = 'u1'
const NOW = new Date('2026-10-09T13:00:00.000Z')

function member(role: 'OWNER' | 'MEMBER' | 'VIEWER' = 'MEMBER') {
  membership.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role, userId: ACTOR, workspaceId: WS })),
  )
}

function connection(
  overrides?: Partial<WhatsAppConnection>,
): WhatsAppConnection {
  return {
    id: 'conn1',
    workspaceId: WS,
    provider: 'ZAPI',
    module: 'COMMUNICATION',
    label: 'Comercial',
    phoneNumber: '5511999990000',
    status: 'CONNECTED',
    statusError: null,
    webhookSecret: 's',
    zapiInstanceId: 'i',
    encryptedZapiToken: 't',
    encryptedZapiClientToken: null,
    metaPhoneNumberId: null,
    metaWabaId: null,
    encryptedMetaAccessToken: null,
    createdById: ACTOR,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

/** A draft with every launch requirement filled. */
function readyCampaign(overrides?: Partial<CrmCampaign>): CrmCampaign {
  return createFakeCrmCampaign({
    id: 'c1',
    workspaceId: WS,
    slug: 'bf',
    destinationType: 'FORM',
    formId: 'f1',
    emailFrom: 'crm@example.com',
    emailSubject: 'Oferta',
    emailTemplateId: 't1',
    emailLegalBasis: 'CONSENT',
    audience: { mailingListIds: [], allPeople: true, leadStages: [] },
    ...overrides,
  })
}

function funnel(): CampaignFunnelCounts {
  const status = {
    NONE: 0,
    PENDING: 0,
    SENDING: 0,
    SENT: 0,
    FAILED: 0,
    SKIPPED: 0,
  }
  return {
    recipients: 2,
    email: {
      ...status,
      SENT: 2,
      delivered: 2,
      opened: 1,
      clicked: 1,
      bounced: 0,
      unsubscribed: 0,
    },
    whatsapp: {
      ...status,
      NONE: 2,
      delivered: 0,
      read: 0,
      clicked: 0,
      replied: 0,
    },
    conversions: 1,
  }
}

beforeEach(() => {
  member()
  lookup.findForm.mockResolvedValue(
    ok({ id: 'f1', token: 'ftok', published: true }),
  )
  lookup.findLandingPage.mockResolvedValue(
    ok({ id: 'l1', token: 'ltok', published: true }),
  )
  lookup.findEmailTemplate.mockResolvedValue(ok({ id: 't1', subject: 'Tpl' }))
  lookup.findConnection.mockResolvedValue(ok(connection()))
  lookup.findWhatsAppTemplate.mockResolvedValue(ok(null))
  lookup.mailingListsExist.mockResolvedValue(ok(true))
  audience.collectCandidates.mockResolvedValue(
    ok([
      {
        personId: 'p1',
        name: 'Ana',
        email: 'ana@example.com',
        phone: '11999990000',
      },
      { leadId: 'l1', name: 'Bia', email: 'bia@example.com' },
    ]),
  )
  audience.emailOptOuts.mockResolvedValue(
    ok({ emails: new Set<string>(), personIds: new Set<string>() }),
  )
  audience.whatsappOptOuts.mockResolvedValue(ok(new Set<string>()))
})

describe('CrmCampaignService — authorization', () => {
  it('should forbid non-members', async () => {
    membership.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await CrmCampaignService.list(ACTOR, WS), 'FORBIDDEN')
  })

  it('should forbid a VIEWER from creating', async () => {
    member('VIEWER')
    expectErr(
      await CrmCampaignService.create(ACTOR, WS, { name: 'BF' }),
      'FORBIDDEN',
    )
  })

  it('should block when the CRM module is disabled', async () => {
    moduleAccess.isEnabled.mockResolvedValueOnce(ok(false))
    expectErr(await CrmCampaignService.list(ACTOR, WS), 'MODULE_DISABLED')
  })

  it.each([
    ['get', () => CrmCampaignService.get(ACTOR, WS, 'c1')],
    ['update', () => CrmCampaignService.update(ACTOR, WS, 'c1', {})],
    ['remove', () => CrmCampaignService.remove(ACTOR, WS, 'c1')],
    ['options', () => CrmCampaignService.options(ACTOR, WS)],
    [
      'audiencePreview',
      () =>
        CrmCampaignService.audiencePreview(ACTOR, WS, {
          audience: { mailingListIds: [], allPeople: true, leadStages: [] },
          whatsappEnabled: false,
        }),
    ],
    ['previewEmail', () => CrmCampaignService.previewEmail(ACTOR, WS, 'c1')],
    [
      'testSend',
      () => CrmCampaignService.testSend(ACTOR, WS, 'c1', { email: 'a@b.co' }),
    ],
    ['launch', () => CrmCampaignService.launch(ACTOR, WS, 'c1', NOW)],
    [
      'control',
      () =>
        CrmCampaignService.control(ACTOR, WS, 'c1', { action: 'pause' }, NOW),
    ],
    ['stats', () => CrmCampaignService.stats(ACTOR, WS, 'c1')],
    [
      'listRecipients',
      () =>
        CrmCampaignService.listRecipients(ACTOR, WS, 'c1', {
          page: 1,
          pageSize: 10,
        }),
    ],
  ])('%s should require membership', async (_name, call) => {
    membership.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await call(), 'FORBIDDEN')
  })

  it.each([
    ['get', () => CrmCampaignService.get(ACTOR, WS, 'c1')],
    ['update', () => CrmCampaignService.update(ACTOR, WS, 'c1', {})],
    ['remove', () => CrmCampaignService.remove(ACTOR, WS, 'c1')],
    ['previewEmail', () => CrmCampaignService.previewEmail(ACTOR, WS, 'c1')],
    [
      'testSend',
      () => CrmCampaignService.testSend(ACTOR, WS, 'c1', { email: 'a@b.co' }),
    ],
    ['launch', () => CrmCampaignService.launch(ACTOR, WS, 'c1', NOW)],
    [
      'control',
      () =>
        CrmCampaignService.control(ACTOR, WS, 'c1', { action: 'pause' }, NOW),
    ],
    ['stats', () => CrmCampaignService.stats(ACTOR, WS, 'c1')],
    [
      'listRecipients',
      () =>
        CrmCampaignService.listRecipients(ACTOR, WS, 'c1', {
          page: 1,
          pageSize: 10,
        }),
    ],
  ])('%s should 404 a campaign of another workspace', async (_n, call) => {
    member('OWNER')
    campaigns.findById.mockResolvedValue(
      err({ code: 'CRM_CAMPAIGN_NOT_FOUND', message: 'x' }),
    )
    expectErr(await call(), 'CRM_CAMPAIGN_NOT_FOUND')
    expect(campaigns.findById).toHaveBeenCalledWith('c1', WS)
  })
})

describe('CrmCampaignService.list()', () => {
  it('should map campaigns with KPIs and channel links', async () => {
    campaigns.listByWorkspace.mockResolvedValue(
      ok([
        readyCampaign(),
        readyCampaign({
          id: 'c2',
          destinationType: 'LANDING_PAGE',
          formId: null,
          landingPageId: 'l1',
        }),
        readyCampaign({ id: 'c3', destinationType: null, formId: null }),
      ]),
    )
    campaigns.funnel.mockResolvedValue(ok(new Map([['c1', funnel()]])))
    lookup.destinationTokens.mockResolvedValue(
      ok(
        new Map([
          ['f1', 'ftok'],
          ['l1', 'ltok'],
        ]),
      ),
    )

    const list = expectOk(await CrmCampaignService.list(ACTOR, WS))
    expect(list[0].kpis).toMatchObject({
      recipients: 2,
      emailSent: 2,
      conversions: 1,
    })
    expect(list[0].links.email).toContain('/f/ftok?utm_source=email')
    expect(list[1].links.whatsapp).toContain('/l/ltok?utm_source=whatsapp')
    expect(list[2].links).toEqual({
      destination: null,
      email: null,
      whatsapp: null,
    })
    expect(list[2].kpis.recipients).toBe(0)
    expect(lookup.destinationTokens).toHaveBeenCalledWith(WS, {
      landingPageIds: ['l1'],
      formIds: ['f1'],
    })
  })

  it('should propagate repository errors', async () => {
    campaigns.listByWorkspace.mockResolvedValue(err(databaseError('x')))
    expectErr(await CrmCampaignService.list(ACTOR, WS), 'DATABASE_ERROR')

    campaigns.listByWorkspace.mockResolvedValue(ok([]))
    campaigns.funnel.mockResolvedValue(err(databaseError('x')))
    expectErr(await CrmCampaignService.list(ACTOR, WS), 'DATABASE_ERROR')

    campaigns.funnel.mockResolvedValue(ok(new Map()))
    lookup.destinationTokens.mockResolvedValue(err(databaseError('x')))
    expectErr(await CrmCampaignService.list(ACTOR, WS), 'DATABASE_ERROR')
  })
})

describe('CrmCampaignService.get() and issues', () => {
  it('should list nothing missing for a ready campaign', async () => {
    campaigns.findById.mockResolvedValue(ok(readyCampaign()))
    const detail = expectOk(await CrmCampaignService.get(ACTOR, WS, 'c1'))
    expect(detail.issues).toEqual([])
    expect(detail.links.destination).toMatch(/\/f\/ftok$/)
  })

  it('should report every missing piece per step', async () => {
    const issues = expectOk(
      await computeCampaignIssues(
        createFakeCrmCampaign({ workspaceId: WS, whatsappEnabled: true }),
      ),
    )
    expect(issues.map((i) => i.step)).toEqual([
      'destination',
      'content',
      'content',
      'content',
      'content',
      'audience',
      'audience',
      'audience',
    ])
  })

  it('should flag a missing, unpublished or removed destination/template', async () => {
    lookup.findForm.mockResolvedValueOnce(ok(null))
    lookup.findEmailTemplate.mockResolvedValueOnce(ok(null))
    const missing = expectOk(await computeCampaignIssues(readyCampaign()))
    expect(missing.map((i) => i.message)).toEqual([
      'Escolha o formulário de destino',
      'O visual escolhido não existe mais',
    ])

    lookup.findLandingPage.mockResolvedValueOnce(ok(null))
    const noLanding = expectOk(
      await computeCampaignIssues(
        readyCampaign({ destinationType: 'LANDING_PAGE', landingPageId: 'l1' }),
      ),
    )
    expect(noLanding[0].message).toBe('Escolha a landing page de destino')

    const noId = expectOk(
      await computeCampaignIssues(readyCampaign({ formId: null })),
    )
    expect(noId[0].message).toBe('Escolha o formulário de destino')

    lookup.findForm.mockResolvedValueOnce(
      ok({ id: 'f1', token: 'ftok', published: false }),
    )
    const draft = expectOk(await computeCampaignIssues(readyCampaign()))
    expect(draft[0].message).toMatch(/Publique o destino/)
  })

  it('should validate the WhatsApp add-on', async () => {
    const wa = (o?: Partial<CrmCampaign>) =>
      readyCampaign({
        whatsappEnabled: true,
        whatsappLegalBasis: 'CONSENT',
        whatsappConnectionId: 'conn1',
        whatsappText: 'Oi {nome} {link}',
        ...o,
      })
    expect(expectOk(await computeCampaignIssues(wa()))).toEqual([])

    moduleAccess.isEnabled.mockImplementation(async (_ws, module) =>
      ok(module !== 'COMMUNICATION'),
    )
    expect(expectOk(await computeCampaignIssues(wa()))[0].message).toMatch(
      /Comunicação não está ativo/,
    )
    moduleAccess.isEnabled.mockImplementation(async () => ok(true))

    expect(
      expectOk(
        await computeCampaignIssues(wa({ whatsappConnectionId: null })),
      )[0].message,
    ).toBe('Escolha a conexão de WhatsApp')

    lookup.findConnection.mockResolvedValueOnce(
      ok(connection({ status: 'DISCONNECTED' })),
    )
    expect(expectOk(await computeCampaignIssues(wa()))[0].message).toMatch(
      /não está conectada/,
    )

    lookup.findConnection.mockResolvedValue(
      ok(connection({ provider: 'META' })),
    )
    lookup.findWhatsAppTemplate.mockResolvedValueOnce(
      ok({
        id: 'wt1',
        workspaceId: WS,
        connectionId: 'conn1',
        name: 'promo',
        language: 'pt_BR',
        category: 'MARKETING',
        status: 'APPROVED',
        components: [{ type: 'BODY', text: 'Oi {{1}}' }],
        quality: 'UNKNOWN' as const,
        qualityUpdatedAt: null,
        statusReason: null,
        headerFormat: null,
        headerMediaUrl: null,
        buttons: null,
        createdAt: NOW,
        updatedAt: NOW,
      }),
    )
    expect(
      expectOk(
        await computeCampaignIssues(
          wa({
            whatsappTemplateId: 'wt1',
            whatsappVariables: {
              header: {},
              body: { '1': { source: 'name' } },
              buttons: {},
            },
          }),
        ),
      ),
    ).toEqual([])
    expect(
      expectOk(await computeCampaignIssues(wa({ whatsappTemplateId: null })))[0]
        .message,
    ).toMatch(/template aprovado/)
  })

  it('should propagate lookup failures', async () => {
    lookup.findForm.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await computeCampaignIssues(readyCampaign()), 'DATABASE_ERROR')

    lookup.findEmailTemplate.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await computeCampaignIssues(readyCampaign()), 'DATABASE_ERROR')

    const wa = readyCampaign({
      whatsappEnabled: true,
      whatsappConnectionId: 'conn1',
    })
    moduleAccess.isEnabled.mockImplementation(async (_ws, module) =>
      module === 'COMMUNICATION' ? err(databaseError('x')) : ok(true),
    )
    expectErr(await computeCampaignIssues(wa), 'DATABASE_ERROR')
    moduleAccess.isEnabled.mockImplementation(async () => ok(true))

    lookup.findConnection.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await computeCampaignIssues(wa), 'DATABASE_ERROR')

    lookup.findConnection.mockResolvedValueOnce(
      ok(connection({ provider: 'META' })),
    )
    lookup.findWhatsAppTemplate.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await computeCampaignIssues({ ...wa, whatsappTemplateId: 'wt1' }),
      'DATABASE_ERROR',
    )

    // get(): destination lookup failure
    campaigns.findById.mockResolvedValue(ok(readyCampaign()))
    lookup.findForm.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await CrmCampaignService.get(ACTOR, WS, 'c1'), 'DATABASE_ERROR')
    // get(): issues failure after destination
    lookup.findForm
      .mockResolvedValueOnce(ok({ id: 'f1', token: 'ftok', published: true }))
      .mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await CrmCampaignService.get(ACTOR, WS, 'c1'), 'DATABASE_ERROR')
  })
})

describe('CrmCampaignService.create()', () => {
  it('should create a draft with a unique slug and audit it', async () => {
    campaigns.listSlugsLike.mockResolvedValue(
      ok(['black-friday', 'black-friday-2']),
    )
    campaigns.create.mockImplementation(async (data) =>
      ok(createFakeCrmCampaign({ ...data, id: 'c9' })),
    )
    const created = expectOk(
      await CrmCampaignService.create(ACTOR, WS, { name: 'Black Friday' }),
    )
    expect(created.slug).toBe('black-friday-3')
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'crm_campaign', action: 'create' }),
    )
  })

  it('should keep the base slug when free and propagate errors', async () => {
    campaigns.listSlugsLike.mockResolvedValue(ok([]))
    campaigns.create.mockImplementation(async (data) =>
      ok(createFakeCrmCampaign({ ...data })),
    )
    expect(
      expectOk(await CrmCampaignService.create(ACTOR, WS, { name: 'Natal' }))
        .slug,
    ).toBe('natal')

    campaigns.create.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await CrmCampaignService.create(ACTOR, WS, { name: 'x' }),
      'DATABASE_ERROR',
    )

    campaigns.listSlugsLike.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await CrmCampaignService.create(ACTOR, WS, { name: 'x' }),
      'DATABASE_ERROR',
    )
  })
})

describe('CrmCampaignService.update()', () => {
  beforeEach(() => {
    campaigns.findById.mockResolvedValue(ok(readyCampaign()))
    campaigns.update.mockImplementation(async (_id, data) =>
      ok(readyCampaign(data as Partial<CrmCampaign>)),
    )
  })

  it('should save a draft and clear the other destination', async () => {
    expectOk(
      await CrmCampaignService.update(ACTOR, WS, 'c1', {
        destinationType: 'LANDING_PAGE',
        landingPageId: 'l1',
        whatsappVariables: null,
        audience: { mailingListIds: ['ml1'], allPeople: false, leadStages: [] },
      }),
    )
    expect(campaigns.update).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({
        formId: null,
        landingPageId: 'l1',
        whatsappVariables: null,
        audience: { mailingListIds: ['ml1'], allPeople: false, leadStages: [] },
        updatedById: ACTOR,
      }),
    )

    await CrmCampaignService.update(ACTOR, WS, 'c1', {
      destinationType: 'FORM',
      formId: 'f1',
      whatsappVariables: { header: {}, body: {}, buttons: {} },
    })
    expect(campaigns.update).toHaveBeenLastCalledWith(
      'c1',
      expect.objectContaining({ landingPageId: null }),
    )

    await CrmCampaignService.update(ACTOR, WS, 'c1', { destinationType: null })
    expect(campaigns.update).toHaveBeenLastCalledWith(
      'c1',
      expect.objectContaining({ landingPageId: null, formId: null }),
    )
  })

  it('should lock launched campaigns', async () => {
    campaigns.findById.mockResolvedValue(
      ok(readyCampaign({ status: 'SENDING' })),
    )
    expectErr(
      await CrmCampaignService.update(ACTOR, WS, 'c1', { name: 'x' }),
      'CRM_CAMPAIGN_LOCKED',
    )
  })

  it('should refuse WhatsApp without Comunicação', async () => {
    moduleAccess.isEnabled.mockImplementation(async (_ws, module) =>
      ok(module !== 'COMMUNICATION'),
    )
    expectErr(
      await CrmCampaignService.update(ACTOR, WS, 'c1', {
        whatsappEnabled: true,
      }),
      'CRM_CAMPAIGN_WHATSAPP_UNAVAILABLE',
    )
    moduleAccess.isEnabled.mockImplementation(async (_ws, module) =>
      module === 'COMMUNICATION' ? err(databaseError('x')) : ok(true),
    )
    expectErr(
      await CrmCampaignService.update(ACTOR, WS, 'c1', {
        whatsappEnabled: true,
      }),
      'DATABASE_ERROR',
    )
    moduleAccess.isEnabled.mockImplementation(async () => ok(true))
    expectOk(
      await CrmCampaignService.update(ACTOR, WS, 'c1', {
        whatsappEnabled: true,
      }),
    )
  })

  it.each([
    [
      'landingPageId',
      () => lookup.findLandingPage,
      'Landing page não encontrada',
    ],
    ['formId', () => lookup.findForm, 'Formulário não encontrado'],
    [
      'emailTemplateId',
      () => lookup.findEmailTemplate,
      'Visual de e-mail não encontrado',
    ],
    [
      'whatsappConnectionId',
      () => lookup.findConnection,
      'Conexão de WhatsApp não encontrada',
    ],
  ] as const)('should reject a foreign %s', async (field, repo, message) => {
    repo().mockResolvedValueOnce(ok(null) as never)
    const error = expectErr(
      await CrmCampaignService.update(ACTOR, WS, 'c1', { [field]: 'x' }),
      'VALIDATION_ERROR',
    )
    expect(error.message).toBe(message)
    repo().mockResolvedValueOnce(err(databaseError('x')) as never)
    expectErr(
      await CrmCampaignService.update(ACTOR, WS, 'c1', { [field]: 'x' }),
      'DATABASE_ERROR',
    )
  })

  it('should validate mailing lists and WhatsApp templates', async () => {
    lookup.mailingListsExist.mockResolvedValueOnce(ok(false))
    expectErr(
      await CrmCampaignService.update(ACTOR, WS, 'c1', {
        audience: { mailingListIds: ['x'], allPeople: false, leadStages: [] },
      }),
      'VALIDATION_ERROR',
    )
    lookup.mailingListsExist.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await CrmCampaignService.update(ACTOR, WS, 'c1', {
        audience: { mailingListIds: ['x'], allPeople: false, leadStages: [] },
      }),
      'DATABASE_ERROR',
    )

    expect(
      expectErr(
        await CrmCampaignService.update(ACTOR, WS, 'c1', {
          whatsappTemplateId: 'wt',
        }),
      ).message,
    ).toBe('Escolha a conexão antes do template')

    campaigns.findById.mockResolvedValue(
      ok(readyCampaign({ whatsappConnectionId: 'conn1' })),
    )
    expect(
      expectErr(
        await CrmCampaignService.update(ACTOR, WS, 'c1', {
          whatsappTemplateId: 'wt',
        }),
      ).message,
    ).toBe('Template de WhatsApp não encontrado')
    lookup.findWhatsAppTemplate.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await CrmCampaignService.update(ACTOR, WS, 'c1', {
        whatsappTemplateId: 'wt',
      }),
      'DATABASE_ERROR',
    )
    lookup.findWhatsAppTemplate.mockResolvedValueOnce(ok({ id: 'wt' } as never))
    expectOk(
      await CrmCampaignService.update(ACTOR, WS, 'c1', {
        whatsappTemplateId: 'wt',
      }),
    )
  })

  it('should propagate update failures', async () => {
    campaigns.update.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await CrmCampaignService.update(ACTOR, WS, 'c1', { name: 'x' }),
      'DATABASE_ERROR',
    )
  })
})

describe('CrmCampaignService.remove()', () => {
  it('should soft delete drafts and finished campaigns', async () => {
    campaigns.findById.mockResolvedValue(
      ok(readyCampaign({ status: 'COMPLETED' })),
    )
    campaigns.softDelete.mockResolvedValue(ok(undefined))
    member('OWNER')
    expectOk(await CrmCampaignService.remove(ACTOR, WS, 'c1'))
    campaigns.softDelete.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await CrmCampaignService.remove(ACTOR, WS, 'c1'),
      'DATABASE_ERROR',
    )
  })

  it('should refuse running campaigns', async () => {
    member('OWNER')
    campaigns.findById.mockResolvedValue(
      ok(readyCampaign({ status: 'PAUSED' })),
    )
    expectErr(
      await CrmCampaignService.remove(ACTOR, WS, 'c1'),
      'CRM_CAMPAIGN_LOCKED',
    )
  })
})

describe('CrmCampaignService.options()', () => {
  const options = {
    landingPages: [
      { id: 'l1', title: 'LP', status: 'PUBLISHED', shareToken: 'lt' },
    ],
    forms: [{ id: 'f1', name: 'Form', status: 'DRAFT', publicToken: 'ft' }],
    emailTemplates: [{ id: 't1', name: 'T', subject: 'S' }],
    mailingLists: [{ id: 'ml', name: 'Lista' }],
    connections: [
      {
        ...connection({ id: 'meta', provider: 'META' }),
        templates: [
          {
            id: 'wt',
            workspaceId: WS,
            connectionId: 'meta',
            name: 'promo',
            language: 'pt_BR',
            category: 'MARKETING',
            status: 'APPROVED' as const,
            components: [
              { type: 'BODY', text: 'Oi {{1}}' },
              {
                type: 'BUTTONS',
                buttons: [{ type: 'URL', text: 'Ver', url: 'https://x/{{1}}' }],
              },
            ],
            quality: 'UNKNOWN' as const,
            qualityUpdatedAt: null,
            statusReason: null,
            headerFormat: null,
            headerMediaUrl: null,
            buttons: null,
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
      },
      { ...connection(), templates: [] },
    ],
  }

  it('should list pickers and the WhatsApp connections', async () => {
    lookup.listOptions.mockResolvedValue(ok(options))
    const result = expectOk(await CrmCampaignService.options(ACTOR, WS))
    expect(result.landingPages[0].published).toBe(true)
    expect(result.forms[0].published).toBe(false)
    expect(result.whatsapp.available).toBe(true)
    expect(result.whatsapp.connections[0].templates[0].fields).toEqual({
      headerVariables: 0,
      bodyVariables: 1,
      bodyText: 'Oi {{1}}',
      urlButtons: [0],
    })
    expect(result.whatsapp.connections[1].templates).toEqual([])
  })

  it('should explain why WhatsApp is unavailable', async () => {
    lookup.listOptions.mockResolvedValue(ok({ ...options, connections: [] }))
    expect(
      expectOk(await CrmCampaignService.options(ACTOR, WS)).whatsapp.reason,
    ).toMatch(/Nenhuma conexão/)

    lookup.listOptions.mockResolvedValue(ok(options))
    moduleAccess.isEnabled.mockImplementation(async (_ws, module) =>
      ok(module !== 'COMMUNICATION'),
    )
    const off = expectOk(await CrmCampaignService.options(ACTOR, WS)).whatsapp
    expect(off.available).toBe(false)
    expect(off.connections).toEqual([])
    moduleAccess.isEnabled.mockImplementation(async (_ws, module) =>
      module === 'COMMUNICATION' ? err(databaseError('x')) : ok(true),
    )
    expectErr(await CrmCampaignService.options(ACTOR, WS), 'DATABASE_ERROR')
    moduleAccess.isEnabled.mockImplementation(async () => ok(true))

    lookup.listOptions.mockResolvedValue(err(databaseError('x')))
    expectErr(await CrmCampaignService.options(ACTOR, WS), 'DATABASE_ERROR')
  })
})

describe('CrmCampaignService.audiencePreview()', () => {
  const input = {
    audience: {
      mailingListIds: [],
      allPeople: true,
      leadStages: ['QUALIFIED' as const],
    },
    whatsappEnabled: true,
  }

  it('should count reachable contacts per channel, excluding opt-outs', async () => {
    audience.emailOptOuts.mockResolvedValue(
      ok({
        emails: new Set(['bia@example.com']),
        personIds: new Set<string>(),
      }),
    )
    const counts = expectOk(
      await CrmCampaignService.audiencePreview(ACTOR, WS, input),
    )
    expect(counts).toEqual({
      total: 2,
      email: { reachable: 1, optedOut: 1, missing: 0 },
      whatsapp: { reachable: 1, optedOut: 0, missing: 1 },
    })
    expect(audience.collectCandidates).toHaveBeenCalledWith(WS, {
      mailingListIds: [],
      allPeople: true,
      leadStages: ['QUALIFIED'],
    })
  })

  it('should skip WhatsApp opt-outs when the channel is off', async () => {
    expectOk(
      await CrmCampaignService.audiencePreview(ACTOR, WS, {
        ...input,
        whatsappEnabled: false,
      }),
    )
    expect(audience.whatsappOptOuts).not.toHaveBeenCalled()
  })

  it('should propagate audience failures', async () => {
    audience.whatsappOptOuts.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await CrmCampaignService.audiencePreview(ACTOR, WS, input),
      'DATABASE_ERROR',
    )
    audience.emailOptOuts.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await CrmCampaignService.audiencePreview(ACTOR, WS, input),
      'DATABASE_ERROR',
    )
    audience.collectCandidates.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await CrmCampaignService.audiencePreview(ACTOR, WS, input),
      'DATABASE_ERROR',
    )
  })
})

describe('CrmCampaignService.previewEmail()', () => {
  it('should render the template with a sample contact and the email link', async () => {
    campaigns.findById.mockResolvedValue(ok(readyCampaign()))
    vi.mocked(renderCampaignEmail).mockResolvedValue(
      ok({ subject: 'Tpl', html: '<p>x</p>', text: 'x' }),
    )
    const preview = expectOk(
      await CrmCampaignService.previewEmail(ACTOR, WS, 'c1'),
    )
    expect(preview.subject).toBe('Oferta')
    expect(
      vi.mocked(renderCampaignEmail).mock.calls[0][1].campaignLink,
    ).toContain('utm_source=email')

    campaigns.findById.mockResolvedValue(
      ok(readyCampaign({ emailSubject: null, destinationType: null })),
    )
    expect(
      expectOk(await CrmCampaignService.previewEmail(ACTOR, WS, 'c1')).subject,
    ).toBe('Tpl')
  })

  it('should fail without template or when rendering fails', async () => {
    campaigns.findById.mockResolvedValue(
      ok(readyCampaign({ emailTemplateId: null })),
    )
    expectErr(
      await CrmCampaignService.previewEmail(ACTOR, WS, 'c1'),
      'VALIDATION_ERROR',
    )

    campaigns.findById.mockResolvedValue(ok(readyCampaign()))
    vi.mocked(renderCampaignEmail).mockResolvedValue(err(databaseError('x')))
    expectErr(
      await CrmCampaignService.previewEmail(ACTOR, WS, 'c1'),
      'DATABASE_ERROR',
    )

    lookup.findForm.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await CrmCampaignService.previewEmail(ACTOR, WS, 'c1'),
      'DATABASE_ERROR',
    )
  })
})

describe('CrmCampaignService.testSend()', () => {
  beforeEach(() => {
    campaigns.findById.mockResolvedValue(ok(readyCampaign()))
    vi.mocked(buildCampaignEmail).mockResolvedValue(
      ok({ subject: 'Oferta', html: '<p/>', text: '' }),
    )
    vi.mocked(sendEmail).mockResolvedValue({ id: 'm1' } as never)
  })

  it('should send a test e-mail with a [Teste] subject', async () => {
    const result = expectOk(
      await CrmCampaignService.testSend(ACTOR, WS, 'c1', {
        email: 'me@example.com',
      }),
    )
    expect(result).toEqual({ email: 'sent', whatsapp: null, errors: [] })
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'me@example.com',
        subject: '[Teste] Oferta',
      }),
    )
    expect(vi.mocked(buildCampaignEmail).mock.calls[0][1]).toMatchObject({
      openPixelUrl: null,
      unsubscribePageUrl: null,
    })
  })

  it('should report e-mail failures', async () => {
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error('boom'))
    expect(
      expectOk(
        await CrmCampaignService.testSend(ACTOR, WS, 'c1', { email: 'a@b.co' }),
      ),
    ).toEqual({ email: 'failed', whatsapp: null, errors: ['boom'] })

    vi.mocked(sendEmail).mockRejectedValueOnce('weird')
    expect(
      expectOk(
        await CrmCampaignService.testSend(ACTOR, WS, 'c1', { email: 'a@b.co' }),
      ).errors,
    ).toEqual(['Falha ao enviar'])

    vi.mocked(buildCampaignEmail).mockResolvedValueOnce(
      err(databaseError('render')),
    )
    expect(
      expectOk(
        await CrmCampaignService.testSend(ACTOR, WS, 'c1', { email: 'a@b.co' }),
      ).errors,
    ).toEqual(['render'])

    campaigns.findById.mockResolvedValue(ok(readyCampaign({ emailFrom: null })))
    expect(
      expectOk(
        await CrmCampaignService.testSend(ACTOR, WS, 'c1', { email: 'a@b.co' }),
      ).email,
    ).toBe('failed')
  })

  it('should test WhatsApp only when enabled and valid', async () => {
    expect(
      expectOk(
        await CrmCampaignService.testSend(ACTOR, WS, 'c1', {
          phone: '11999990000',
        }),
      ).errors,
    ).toEqual(['Ative o WhatsApp na campanha para testar'])

    campaigns.findById.mockResolvedValue(
      ok(
        readyCampaign({
          whatsappEnabled: true,
          whatsappConnectionId: 'conn1',
          whatsappText: 'Oi {link}',
        }),
      ),
    )
    expect(
      expectOk(
        await CrmCampaignService.testSend(ACTOR, WS, 'c1', { phone: '123' }),
      ).errors,
    ).toEqual(['Número de WhatsApp inválido'])

    vi.mocked(sendCampaignWhatsApp).mockResolvedValueOnce(
      ok({ providerMessageId: 'w1' }),
    )
    expect(
      expectOk(
        await CrmCampaignService.testSend(ACTOR, WS, 'c1', {
          phone: '11999990000',
        }),
      ).whatsapp,
    ).toBe('sent')
    expect(vi.mocked(sendCampaignWhatsApp).mock.calls[0][1]).toMatchObject({
      waId: '5511999990000',
      linkCode: 'teste',
    })

    vi.mocked(sendCampaignWhatsApp).mockResolvedValueOnce(
      err(databaseError('wa')),
    )
    expect(
      expectOk(
        await CrmCampaignService.testSend(ACTOR, WS, 'c1', {
          phone: '11999990000',
        }),
      ),
    ).toEqual({ email: null, whatsapp: 'failed', errors: ['wa'] })

    lookup.findConnection.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await CrmCampaignService.testSend(ACTOR, WS, 'c1', {
        phone: '11999990000',
      }),
      'DATABASE_ERROR',
    )
  })

  it('should propagate the detail failure', async () => {
    lookup.findForm.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await CrmCampaignService.testSend(ACTOR, WS, 'c1', { email: 'a@b.co' }),
      'DATABASE_ERROR',
    )
  })
})

describe('CrmCampaignService.launch()', () => {
  beforeEach(() => {
    campaigns.findById.mockResolvedValue(ok(readyCampaign()))
    campaigns.transition.mockImplementation(async (_id, _from, data) =>
      ok(readyCampaign(data as Partial<CrmCampaign>)),
    )
    recipients.createMany.mockResolvedValue(ok(2))
  })

  it('should snapshot the audience, start sending and audit the legal basis', async () => {
    const detail = expectOk(
      await CrmCampaignService.launch(ACTOR, WS, 'c1', NOW),
    )
    expect(detail.status).toBe('SENDING')
    expect(campaigns.transition).toHaveBeenCalledWith(
      'c1',
      ['DRAFT'],
      expect.objectContaining({
        status: 'SENDING',
        startAt: NOW,
        consentConfirmedById: ACTOR,
      }),
    )
    expect(recipients.createMany).toHaveBeenCalledWith('c1', WS, [
      expect.objectContaining({
        personId: 'p1',
        emailStatus: 'PENDING',
        whatsappStatus: 'NONE',
      }),
      expect.objectContaining({ leadId: 'l1', emailStatus: 'PENDING' }),
    ])
    expect(send.enqueueDispatch).toHaveBeenCalled()
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'start',
        meta: expect.objectContaining({
          emailLegalBasis: 'CONSENT',
          recipients: 2,
        }),
      }),
    )
  })

  it('should schedule a future start', async () => {
    const later = new Date(NOW.getTime() + 3_600_000)
    campaigns.findById.mockResolvedValue(
      ok(readyCampaign({ scheduledAt: later })),
    )
    expect(
      expectOk(await CrmCampaignService.launch(ACTOR, WS, 'c1', NOW)).status,
    ).toBe('SCHEDULED')
  })

  it('should refuse an incomplete or launched campaign', async () => {
    campaigns.findById.mockResolvedValue(ok(readyCampaign({ emailFrom: null })))
    const error = expectErr(
      await CrmCampaignService.launch(ACTOR, WS, 'c1', NOW),
      'CRM_CAMPAIGN_INCOMPLETE',
    )
    expect((error.details as { issues: unknown[] }).issues).toHaveLength(1)

    campaigns.findById.mockResolvedValue(
      ok(readyCampaign({ status: 'COMPLETED' })),
    )
    expectErr(
      await CrmCampaignService.launch(ACTOR, WS, 'c1', NOW),
      'CRM_CAMPAIGN_LOCKED',
    )
  })

  it('should refuse when nobody is reachable', async () => {
    audience.emailOptOuts.mockResolvedValue(
      ok({
        emails: new Set(['ana@example.com', 'bia@example.com']),
        personIds: new Set<string>(),
      }),
    )
    expectErr(
      await CrmCampaignService.launch(ACTOR, WS, 'c1', NOW),
      'CRM_CAMPAIGN_NO_RECIPIENTS',
    )
    expect(campaigns.transition).not.toHaveBeenCalled()
  })

  it('should lose a concurrent launch race', async () => {
    campaigns.transition.mockResolvedValue(ok(null))
    expectErr(
      await CrmCampaignService.launch(ACTOR, WS, 'c1', NOW),
      'CRM_CAMPAIGN_LOCKED',
    )
    expect(recipients.createMany).not.toHaveBeenCalled()
  })

  it('should roll back to draft when the snapshot fails', async () => {
    recipients.createMany.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await CrmCampaignService.launch(ACTOR, WS, 'c1', NOW),
      'DATABASE_ERROR',
    )
    expect(campaigns.transition).toHaveBeenLastCalledWith(
      'c1',
      ['SCHEDULED', 'SENDING'],
      expect.objectContaining({ status: 'DRAFT' }),
    )
  })

  it('should propagate failures', async () => {
    lookup.findForm.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await CrmCampaignService.launch(ACTOR, WS, 'c1', NOW),
      'DATABASE_ERROR',
    )

    audience.collectCandidates.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await CrmCampaignService.launch(ACTOR, WS, 'c1', NOW),
      'DATABASE_ERROR',
    )

    campaigns.transition.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await CrmCampaignService.launch(ACTOR, WS, 'c1', NOW),
      'DATABASE_ERROR',
    )
  })

  it('should default the clock', async () => {
    expectOk(await CrmCampaignService.launch(ACTOR, WS, 'c1'))
  })
})

describe('CrmCampaignService.control()', () => {
  beforeEach(() => {
    campaigns.findById.mockResolvedValue(
      ok(readyCampaign({ status: 'SENDING', startAt: NOW })),
    )
    campaigns.transition.mockImplementation(async (_id, _from, data) =>
      ok(readyCampaign(data as Partial<CrmCampaign>)),
    )
    recipients.skipAllOpen.mockResolvedValue(ok(3))
  })

  it('should pause, resume and cancel with audit', async () => {
    expect(
      expectOk(
        await CrmCampaignService.control(
          ACTOR,
          WS,
          'c1',
          { action: 'pause' },
          NOW,
        ),
      ).status,
    ).toBe('PAUSED')
    expect(auditMutation).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'suspend' }),
    )

    expect(
      expectOk(
        await CrmCampaignService.control(
          ACTOR,
          WS,
          'c1',
          { action: 'resume' },
          NOW,
        ),
      ).status,
    ).toBe('SENDING')
    expect(send.enqueueDispatch).toHaveBeenCalled()
    expect(auditMutation).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'reactivate' }),
    )

    expect(
      expectOk(
        await CrmCampaignService.control(
          ACTOR,
          WS,
          'c1',
          { action: 'cancel' },
          NOW,
        ),
      ).status,
    ).toBe('CANCELED')
    expect(recipients.skipAllOpen).toHaveBeenCalledWith('c1')
    expect(auditMutation).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'cancel' }),
    )
  })

  it('should resume a future campaign as scheduled', async () => {
    campaigns.findById.mockResolvedValue(
      ok(
        readyCampaign({
          status: 'PAUSED',
          startAt: new Date(NOW.getTime() + 1000),
        }),
      ),
    )
    expect(
      expectOk(
        await CrmCampaignService.control(
          ACTOR,
          WS,
          'c1',
          { action: 'resume' },
          NOW,
        ),
      ).status,
    ).toBe('SCHEDULED')
    campaigns.findById.mockResolvedValue(
      ok(readyCampaign({ status: 'PAUSED' })),
    )
    expect(
      expectOk(
        await CrmCampaignService.control(ACTOR, WS, 'c1', { action: 'resume' }),
      ).status,
    ).toBe('SENDING')
  })

  it('should refuse invalid transitions and propagate errors', async () => {
    campaigns.transition.mockResolvedValueOnce(ok(null))
    expectErr(
      await CrmCampaignService.control(
        ACTOR,
        WS,
        'c1',
        { action: 'pause' },
        NOW,
      ),
      'CRM_CAMPAIGN_LOCKED',
    )
    campaigns.transition.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await CrmCampaignService.control(
        ACTOR,
        WS,
        'c1',
        { action: 'pause' },
        NOW,
      ),
      'DATABASE_ERROR',
    )
    recipients.skipAllOpen.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await CrmCampaignService.control(
        ACTOR,
        WS,
        'c1',
        { action: 'cancel' },
        NOW,
      ),
      'DATABASE_ERROR',
    )
  })
})

describe('CrmCampaignService.stats() and listRecipients()', () => {
  beforeEach(() => {
    campaigns.findById.mockResolvedValue(ok(readyCampaign()))
  })

  it('should build the funnel and conversions', async () => {
    campaigns.funnel.mockResolvedValue(ok(new Map([['c1', funnel()]])))
    conversions.countBy.mockResolvedValue(
      ok([
        { kind: 'FORM_SUBMISSION', channel: 'EMAIL', count: 2 },
        { kind: 'LANDING_VIEW', channel: null, count: 1 },
        { kind: 'FORM_SUBMISSION', channel: 'WHATSAPP', count: 1 },
      ]),
    )
    conversions.listRecent.mockResolvedValue(
      ok([
        {
          ...createFakeCrmCampaignConversion({ leadId: 'lead1' }),
          recipient: { name: 'Ana' },
        },
      ]),
    )
    const stats = expectOk(await CrmCampaignService.stats(ACTOR, WS, 'c1'))
    expect(stats.email).toMatchObject({
      eligible: 2,
      sent: 2,
      opened: 1,
      pending: 0,
    })
    expect(stats.whatsapp.eligible).toBe(0)
    expect(stats.conversions).toEqual({
      total: 4,
      visits: 1,
      submissions: 3,
      byChannel: { email: 2, whatsapp: 1, unknown: 1 },
    })
    expect(stats.convertedContacts[0]).toMatchObject({
      name: 'Ana',
      leadId: 'lead1',
    })
  })

  it('should propagate stats failures', async () => {
    campaigns.funnel.mockResolvedValue(err(databaseError('x')))
    expectErr(await CrmCampaignService.stats(ACTOR, WS, 'c1'), 'DATABASE_ERROR')
    campaigns.funnel.mockResolvedValue(ok(new Map([['c1', funnel()]])))
    conversions.countBy.mockResolvedValue(err(databaseError('x')))
    expectErr(await CrmCampaignService.stats(ACTOR, WS, 'c1'), 'DATABASE_ERROR')
    conversions.countBy.mockResolvedValue(ok([]))
    conversions.listRecent.mockResolvedValue(err(databaseError('x')))
    expectErr(await CrmCampaignService.stats(ACTOR, WS, 'c1'), 'DATABASE_ERROR')
  })

  it('should page recipients', async () => {
    recipients.listPage.mockResolvedValue(
      ok({
        items: [createFakeCrmCampaignRecipient({ emailSentAt: NOW })],
        total: 1,
      }),
    )
    const page = expectOk(
      await CrmCampaignService.listRecipients(ACTOR, WS, 'c1', {
        page: 2,
        pageSize: 10,
      }),
    )
    expect(page).toMatchObject({ total: 1, page: 2, pageSize: 10 })
    expect(page.items[0].emailSentAt).toBe(NOW.toISOString())

    recipients.listPage.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await CrmCampaignService.listRecipients(ACTOR, WS, 'c1', {
        page: 1,
        pageSize: 10,
      }),
      'DATABASE_ERROR',
    )
  })
})
