import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeNewsletter,
  createFakeNewsletterIssue,
} from '@/src/__tests__/factories/newsletter-nl-issues.factory'
import {
  createFakeIssueWhatsApp,
  createFakeWhatsAppRecipient,
} from '@/src/__tests__/factories/newsletter2-engage.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppTemplate } from '@/src/__tests__/factories/whatsapp-template.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  crmNewsletterIssueNotFound,
  databaseError,
  forbidden,
  moduleDisabled,
  rateLimited,
  whatsappMessageLimitReached,
  whatsappProviderError,
} from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit')
vi.mock('@/src/services/authz', () => ({ assertModuleEnabled: vi.fn() }))
vi.mock('@/src/services/crm-newsletter-issue.service', () => ({
  loadNewsletterScope: vi.fn(),
  loadIssue: vi.fn(),
}))
vi.mock('@/src/repositories/crm-newsletter-whatsapp.repository')
vi.mock('@/src/repositories/crm-campaign-lookup.repository', () => ({
  CrmCampaignLookupRepository: {
    findConnection: vi.fn(),
    findWhatsAppTemplate: vi.fn(),
  },
}))
vi.mock('@/src/repositories/crm-campaign.repository', () => ({
  CrmCampaignRecipientRepository: { countWhatsAppSentSince: vi.fn() },
}))
vi.mock(
  '@/src/repositories/crm-newsletter-issue.repository',
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    CrmNewsletterIssueRepository: { findByIdUnscoped: vi.fn() },
  }),
)
vi.mock('@/src/lib/whatsapp/send', () => ({
  WhatsAppSend: { text: vi.fn(), template: vi.fn() },
}))
const add = vi.hoisted(() => vi.fn())
vi.mock('@/src/lib/queue/queues', () => ({
  getCrmNewsletterQueue: () => ({ add }),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { CrmCampaignRecipientRepository } from '@/src/repositories/crm-campaign.repository'
import { CrmCampaignLookupRepository } from '@/src/repositories/crm-campaign-lookup.repository'
import { CrmNewsletterIssueRepository } from '@/src/repositories/crm-newsletter-issue.repository'
import { CrmNewsletterWhatsAppRepository } from '@/src/repositories/crm-newsletter-whatsapp.repository'
import { assertModuleEnabled } from '../authz'
import { loadIssue, loadNewsletterScope } from '../crm-newsletter-issue.service'
import {
  CrmNewsletterWhatsAppService as Service,
  sendIssueWhatsApp,
  WEB_VERSION_GRACE_MS,
} from '../crm-newsletter-whatsapp.service'

const repo = vi.mocked(CrmNewsletterWhatsAppRepository)
const lookup = vi.mocked(CrmCampaignLookupRepository)
const send = vi.mocked(WhatsAppSend)
const NOW = new Date('2026-10-28T13:00:00.000Z')
const SENT_AT = new Date(NOW.getTime() - WEB_VERSION_GRACE_MS - 1000)
const A = ['u1', 'ws1', 'nl1', 'is1'] as const
const newsletter = createFakeNewsletter()
const zapi = createFakeWhatsAppConnection({
  id: 'c1',
  workspaceId: 'ws1',
  provider: 'ZAPI',
  status: 'CONNECTED',
  module: 'COMMUNICATION',
})
const meta = createFakeWhatsAppConnection({
  id: 'c2',
  workspaceId: 'ws1',
  provider: 'META',
  status: 'CONNECTED',
  module: 'COMMUNICATION',
})
const template = createFakeWhatsAppTemplate({
  id: 't1',
  name: 'nova_edicao',
  language: 'pt_BR',
  status: 'APPROVED',
  category: 'MARKETING',
  components: [{ type: 'BODY', text: 'Oi {{1}}: {{2}} {{3}}' }] as never,
  buttons: [] as never,
  headerFormat: null,
  headerMediaUrl: null,
})
const metaConfig = createFakeIssueWhatsApp({
  connectionId: 'c2',
  templateId: 't1',
  text: null,
  variables: {
    header: {},
    body: {
      '1': { source: 'first_name' },
      '2': { source: 'summary' },
      '3': { source: 'link' },
    },
    buttons: {},
  } as never,
})

const sentIssue = (over = {}) => ({
  ...createFakeNewsletterIssue({
    status: 'SENT',
    sentAt: SENT_AT,
    excerpt: 'Resumo da edição',
    ...over,
  }),
  newsletter,
})

describe('CrmNewsletterWhatsAppService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(assertModuleEnabled).mockResolvedValue(ok(true))
    vi.mocked(loadNewsletterScope).mockResolvedValue(
      ok({ membership: {}, newsletter } as never),
    )
    vi.mocked(loadIssue).mockResolvedValue(ok(createFakeNewsletterIssue()))
    repo.findConfig.mockResolvedValue(ok(createFakeIssueWhatsApp()))
    repo.upsertConfig.mockImplementation(async (_id, _ws, data) =>
      ok(createFakeIssueWhatsApp(data as never)),
    )
    repo.subscriberCandidates.mockResolvedValue(
      ok({
        candidates: [
          {
            subscriberId: 's1',
            personId: 'p1',
            name: 'Ana',
            phones: ['11999990000'],
          },
          { subscriberId: 's2', personId: 'p2', name: 'Bia', phones: [] },
        ],
        linked: 2,
      }),
    )
    repo.issueCandidates.mockResolvedValue(
      ok([
        {
          subscriberId: 's1',
          personId: 'p1',
          name: 'Ana',
          phones: ['11999990000'],
        },
        {
          subscriberId: 's3',
          personId: 'p3',
          name: 'Caio',
          phones: ['21988887777'],
        },
      ]),
    )
    repo.optedOut.mockResolvedValue(ok(new Set()))
    repo.markStarted.mockResolvedValue(ok(true))
    repo.createRecipients.mockResolvedValue(ok(2))
    repo.releaseStuck.mockResolvedValue(ok(0))
    repo.release.mockResolvedValue(ok(undefined))
    repo.skipPending.mockResolvedValue(ok(3))
    repo.markSkipped.mockResolvedValue(ok(undefined))
    repo.markSent.mockResolvedValue(ok(undefined))
    repo.markFailed.mockResolvedValue(ok(undefined))
    repo.countSentSince.mockResolvedValue(ok(0))
    repo.claimBatch.mockResolvedValue(ok([createFakeWhatsAppRecipient()]))
    repo.stats.mockResolvedValue(
      ok({
        total: 2,
        pending: 0,
        sent: 1,
        failed: 0,
        skipped: 1,
        delivered: 1,
        read: 0,
      }),
    )
    repo.listRecipients.mockResolvedValue(
      ok({
        items: [createFakeWhatsAppRecipient({ status: 'SENT' })],
        total: 1,
      }),
    )
    lookup.findConnection.mockImplementation(async (_ws, id) =>
      ok(id === 'c2' ? meta : id === 'c1' ? zapi : null),
    )
    lookup.findWhatsAppTemplate.mockResolvedValue(ok(template))
    vi.mocked(
      CrmCampaignRecipientRepository.countWhatsAppSentSince,
    ).mockResolvedValue(ok(0))
    vi.mocked(CrmNewsletterIssueRepository.findByIdUnscoped).mockResolvedValue(
      ok(sentIssue() as never),
    )
    send.text.mockResolvedValue(ok({ providerMessageId: 'wamid.1' } as never))
    send.template.mockResolvedValue(
      ok({ providerMessageId: 'wamid.2' } as never),
    )
  })

  describe('get', () => {
    it('returns the settings, no problems and the reach of a draft', async () => {
      const dto = expectOk(await Service.get(...A))
      expect(dto).toMatchObject({
        issueId: 'is1',
        enabled: true,
        connectionId: 'c1',
        available: true,
        problems: [],
        reach: { linked: 2, reachable: 1, missingPhone: 1, optedOut: 0 },
      })
      expect(repo.optedOut).toHaveBeenCalledWith('ws1', ['5511999990000'])
    })

    it('defaults without settings and skips the reach once sent', async () => {
      repo.findConfig.mockResolvedValueOnce(ok(null))
      vi.mocked(loadIssue).mockResolvedValueOnce(
        ok(createFakeNewsletterIssue({ status: 'SENT' })),
      )
      const dto = expectOk(await Service.get(...A))
      expect(dto).toMatchObject({ enabled: false, reach: null, problems: [] })
    })

    it('is unavailable without the Comunicação module', async () => {
      vi.mocked(assertModuleEnabled).mockResolvedValueOnce(
        err(moduleDisabled()),
      )
      const dto = expectOk(await Service.get(...A))
      expect(dto.available).toBe(false)
      expect(dto.unavailableReason).toContain('Comunicação')
      expect(dto.reach).toBeNull()
    })

    it('lists every problem of an enabled version', async () => {
      vi.mocked(loadNewsletterScope).mockResolvedValueOnce(
        ok({
          membership: {},
          newsletter: createFakeNewsletter({ archiveEnabled: false }),
        } as never),
      )
      repo.findConfig.mockResolvedValueOnce(
        ok(
          createFakeIssueWhatsApp({
            text: 'sem link',
            legalBasis: null,
            consentConfirmedAt: null,
          }),
        ),
      )
      lookup.findConnection.mockResolvedValueOnce(
        ok({ ...zapi, status: 'DISCONNECTED' } as never),
      )
      const dto = expectOk(await Service.get(...A))
      expect(dto.problems).toEqual([
        'Ative o arquivo público da newsletter: a mensagem leva o link da versão web',
        'A conexão de WhatsApp não está ativa',
        'Inclua {link} na mensagem para levar o contato ao destino',
        'Declare a base legal do envio no WhatsApp',
      ])
    })

    it('flags a missing or deleted connection and checks Meta templates', async () => {
      repo.findConfig.mockResolvedValueOnce(
        ok(createFakeIssueWhatsApp({ connectionId: null })),
      )
      expect(expectOk(await Service.get(...A)).problems).toEqual([
        'Escolha a conexão de WhatsApp',
      ])
      repo.findConfig.mockResolvedValueOnce(
        ok(createFakeIssueWhatsApp({ connectionId: 'gone' })),
      )
      expect(expectOk(await Service.get(...A)).problems).toEqual([
        'A conexão de WhatsApp escolhida não existe mais',
      ])
      repo.findConfig.mockResolvedValueOnce(ok(metaConfig))
      expect(expectOk(await Service.get(...A)).problems).toEqual([])
      repo.findConfig.mockResolvedValueOnce(
        ok({ ...metaConfig, templateId: null }),
      )
      expect(expectOk(await Service.get(...A)).problems).toEqual([
        'Escolha um template aprovado pela Meta',
      ])
    })

    it('propagates errors', async () => {
      vi.mocked(loadNewsletterScope).mockResolvedValueOnce(err(forbidden()))
      expectErr(await Service.get(...A), 'FORBIDDEN')
      vi.mocked(loadIssue).mockResolvedValueOnce(
        err(crmNewsletterIssueNotFound()),
      )
      expectErr(await Service.get(...A), 'CRM_NEWSLETTER_ISSUE_NOT_FOUND')
      repo.findConfig.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.get(...A), 'DATABASE_ERROR')
      vi.mocked(assertModuleEnabled).mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.get(...A), 'DATABASE_ERROR')
      lookup.findConnection.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.get(...A), 'DATABASE_ERROR')
      repo.findConfig.mockResolvedValueOnce(ok(metaConfig))
      lookup.findWhatsAppTemplate.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.get(...A), 'DATABASE_ERROR')
      repo.subscriberCandidates.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.get(...A), 'DATABASE_ERROR')
      repo.optedOut.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.get(...A), 'DATABASE_ERROR')
    })
  })

  describe('update', () => {
    it('saves, records the legal basis declaration and audits', async () => {
      repo.findConfig.mockResolvedValueOnce(ok(null))
      const dto = expectOk(
        await Service.update(
          ...A,
          {
            enabled: true,
            connectionId: 'c2',
            templateId: 't1',
            variables: metaConfig.variables as never,
            legalBasis: 'LEGITIMATE_INTEREST',
            confirmLegalBasis: true,
          },
          NOW,
        ),
      )
      expect(loadNewsletterScope).toHaveBeenCalledWith(
        'u1',
        'ws1',
        'nl1',
        'EDIT',
      )
      expect(repo.upsertConfig).toHaveBeenCalledWith(
        'is1',
        'ws1',
        expect.objectContaining({
          enabled: true,
          connectionId: 'c2',
          templateId: 't1',
          legalBasis: 'LEGITIMATE_INTEREST',
          consentConfirmedAt: NOW,
          consentConfirmedById: 'u1',
          updatedById: 'u1',
        }),
      )
      expect(dto.enabled).toBe(true)
      expect(auditMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'crm_newsletter_issue_whatsapp',
          action: 'update',
          targetId: 'is1',
        }),
      )
    })

    it('keeps the current values, clears variables and resets the declaration', async () => {
      expectOk(
        await Service.update(
          ...A,
          { variables: null, text: 'Leia {link}' },
          NOW,
        ),
      )
      expect(repo.upsertConfig).toHaveBeenLastCalledWith(
        'is1',
        'ws1',
        expect.objectContaining({
          enabled: true,
          connectionId: 'c1',
          legalBasis: 'CONSENT',
          text: 'Leia {link}',
          consentConfirmedAt: NOW,
        }),
      )
      const data = repo.upsertConfig.mock.lastCall?.[2] as {
        variables: unknown
      }
      expect(String(data.variables)).toContain('DbNull')

      expectOk(await Service.update(...A, { legalBasis: 'CONTRACT' }, NOW))
      expect(repo.upsertConfig).toHaveBeenLastCalledWith(
        'is1',
        'ws1',
        expect.objectContaining({ consentConfirmedAt: null }),
      )
      expectOk(await Service.update(...A, { confirmLegalBasis: false }, NOW))
      expect(repo.upsertConfig).toHaveBeenLastCalledWith(
        'is1',
        'ws1',
        expect.objectContaining({ consentConfirmedById: null }),
      )
      expectOk(await Service.update(...A, { enabled: false }, NOW))
      expect(assertModuleEnabled).toHaveBeenCalledTimes(4 + 3)
    })

    it('refuses locked issues, a disabled module and foreign ids', async () => {
      vi.mocked(loadIssue).mockResolvedValueOnce(
        ok(createFakeNewsletterIssue({ status: 'SENDING' })),
      )
      expectErr(
        await Service.update(...A, { enabled: true }, NOW),
        'CRM_NEWSLETTER_ISSUE_LOCKED',
      )
      vi.mocked(assertModuleEnabled).mockResolvedValueOnce(
        err(moduleDisabled()),
      )
      expectErr(
        await Service.update(...A, { enabled: true }, NOW),
        'CRM_NEWSLETTER_WHATSAPP_UNAVAILABLE',
      )
      vi.mocked(assertModuleEnabled).mockResolvedValueOnce(err(databaseError()))
      expectErr(
        await Service.update(...A, { enabled: true }, NOW),
        'DATABASE_ERROR',
      )
      expectErr(
        await Service.update(...A, { connectionId: 'gone' }, NOW),
        'VALIDATION_ERROR',
      )
      lookup.findWhatsAppTemplate.mockResolvedValueOnce(ok(null))
      expectErr(
        await Service.update(
          ...A,
          { connectionId: 'c2', templateId: 'x' },
          NOW,
        ),
        'VALIDATION_ERROR',
      )
      expect(repo.upsertConfig).not.toHaveBeenCalled()
    })

    it('propagates errors', async () => {
      vi.mocked(loadNewsletterScope).mockResolvedValueOnce(err(forbidden()))
      expectErr(await Service.update(...A, {}, NOW), 'FORBIDDEN')
      vi.mocked(loadIssue).mockResolvedValueOnce(
        err(crmNewsletterIssueNotFound()),
      )
      expectErr(
        await Service.update(...A, {}, NOW),
        'CRM_NEWSLETTER_ISSUE_NOT_FOUND',
      )
      repo.findConfig.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.update(...A, {}, NOW), 'DATABASE_ERROR')
      lookup.findConnection.mockResolvedValueOnce(err(databaseError()))
      expectErr(
        await Service.update(...A, { connectionId: 'c1' }, NOW),
        'DATABASE_ERROR',
      )
      lookup.findWhatsAppTemplate.mockResolvedValueOnce(err(databaseError()))
      expectErr(
        await Service.update(
          ...A,
          { connectionId: 'c2', templateId: 't1' },
          NOW,
        ),
        'DATABASE_ERROR',
      )
      repo.upsertConfig.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.update(...A, {}, NOW), 'DATABASE_ERROR')
    })
  })

  describe('preSendCheck', () => {
    const issue = createFakeNewsletterIssue()

    it('passes when off or ready, refuses with the first problem', async () => {
      repo.findConfig.mockResolvedValueOnce(ok(null))
      expectOk(await Service.preSendCheck(issue, newsletter))
      expectOk(await Service.preSendCheck(issue, newsletter))
      repo.findConfig.mockResolvedValueOnce(
        ok(createFakeIssueWhatsApp({ legalBasis: null })),
      )
      const error = expectErr(
        await Service.preSendCheck(issue, newsletter),
        'CRM_NEWSLETTER_WHATSAPP_UNAVAILABLE',
      )
      expect(error.message).toBe(
        'WhatsApp: Declare a base legal do envio no WhatsApp. Corrija ou desligue o envio no WhatsApp.',
      )
      repo.findConfig.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.preSendCheck(issue, newsletter), 'DATABASE_ERROR')
      lookup.findConnection.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.preSendCheck(issue, newsletter), 'DATABASE_ERROR')
    })
  })

  describe('startForIssue', () => {
    it('snapshots the linked numbers once and queues the dispatch', async () => {
      repo.optedOut.mockResolvedValueOnce(ok(new Set(['5521988887777'])))
      await Service.startForIssue('is1', NOW)
      expect(repo.markStarted).toHaveBeenCalledWith('is1', NOW)
      expect(repo.createRecipients).toHaveBeenCalledWith('is1', 'ws1', [
        expect.objectContaining({ waId: '5511999990000', status: 'PENDING' }),
        expect.objectContaining({
          waId: '5521988887777',
          status: 'SKIPPED',
          skipReason: 'OPTED_OUT',
        }),
      ])
      expect(add).toHaveBeenCalledWith(
        'whatsapp-dispatch',
        { issueId: 'is1' },
        expect.objectContaining({ delay: 0 }),
      )
    })

    it('does nothing when off, lost, or on errors (never throws)', async () => {
      repo.findConfig.mockResolvedValueOnce(
        ok(createFakeIssueWhatsApp({ enabled: false })),
      )
      await Service.startForIssue('is1', NOW)
      repo.markStarted.mockResolvedValueOnce(ok(false))
      await Service.startForIssue('is1', NOW)
      expect(repo.issueCandidates).not.toHaveBeenCalled()
      for (const fail of [
        () => repo.findConfig.mockResolvedValueOnce(err(databaseError())),
        () => repo.markStarted.mockResolvedValueOnce(err(databaseError())),
        () => repo.issueCandidates.mockResolvedValueOnce(err(databaseError())),
        () => repo.optedOut.mockResolvedValueOnce(err(databaseError())),
        () => repo.createRecipients.mockResolvedValueOnce(err(databaseError())),
        () => add.mockRejectedValueOnce(new Error('redis down')),
        () => add.mockRejectedValueOnce('boom'),
      ]) {
        fail()
        await expect(Service.startForIssue('is1', NOW)).resolves.toBeUndefined()
      }
    })
  })

  describe('dispatch', () => {
    const started = createFakeIssueWhatsApp({ startedAt: NOW })
    beforeEach(() => {
      repo.findConfig.mockResolvedValue(ok(started))
    })

    it('ignores missing issues and versions not started', async () => {
      vi.mocked(
        CrmNewsletterIssueRepository.findByIdUnscoped,
      ).mockResolvedValueOnce(ok(null))
      expect(expectOk(await Service.dispatch('is1', NOW))).toEqual({
        status: 'missing',
      })
      repo.findConfig.mockResolvedValueOnce(ok(createFakeIssueWhatsApp()))
      expect(expectOk(await Service.dispatch('is1', NOW))).toEqual({
        status: 'inactive',
      })
    })

    it('stops with the e-mail and waits for the web version', async () => {
      vi.mocked(
        CrmNewsletterIssueRepository.findByIdUnscoped,
      ).mockResolvedValueOnce(ok(sentIssue({ status: 'CANCELED' }) as never))
      expect(expectOk(await Service.dispatch('is1', NOW))).toEqual({
        status: 'stopped',
        skipped: 3,
      })
      expect(repo.skipPending).toHaveBeenCalledWith('is1', 'STOPPED')

      vi.mocked(
        CrmNewsletterIssueRepository.findByIdUnscoped,
      ).mockResolvedValueOnce(
        ok(sentIssue({ status: 'SENDING', sentAt: null }) as never),
      )
      const waiting = expectOk(await Service.dispatch('is1', NOW))
      expect(waiting).toEqual({
        status: 'waiting',
        retryAt: new Date(NOW.getTime() + 60_000).toISOString(),
      })

      vi.mocked(
        CrmNewsletterIssueRepository.findByIdUnscoped,
      ).mockResolvedValueOnce(ok(sentIssue({ sentAt: NOW }) as never))
      expect(expectOk(await Service.dispatch('is1', NOW))).toEqual({
        status: 'waiting',
        retryAt: new Date(NOW.getTime() + WEB_VERSION_GRACE_MS).toISOString(),
      })
      expect(add).toHaveBeenLastCalledWith(
        'whatsapp-dispatch',
        { issueId: 'is1' },
        expect.objectContaining({ delay: WEB_VERSION_GRACE_MS }),
      )
    })

    it('sends a Z-API batch with the issue link and summary', async () => {
      const outcome = expectOk(await Service.dispatch('is1', NOW))
      expect(outcome).toEqual({
        status: 'sent',
        sent: 1,
        failed: 0,
        skipped: 0,
        more: true,
      })
      expect(send.text).toHaveBeenCalledWith(
        zapi,
        {
          to: '5511999990000',
          text: expect.stringMatching(
            /^Oi Ana! Novidades de outubro: Resumo da edição https?:\/\/\S+\/n\/acme\/novidades\/novidades-de-outubro$/,
          ),
        },
        { cost: { source: 'CRM_CAMPAIGN' } },
      )
      expect(repo.markSent).toHaveBeenCalledWith('w1', 'wamid.1', NOW)
      expect(add).toHaveBeenCalledWith(
        'whatsapp-dispatch',
        { issueId: 'is1' },
        expect.objectContaining({ delay: 4000 }),
      )
    })

    it('sends Meta templates within the 24 h tier', async () => {
      repo.findConfig.mockResolvedValue(ok({ ...metaConfig, startedAt: NOW }))
      repo.claimBatch.mockResolvedValueOnce(
        ok([
          createFakeWhatsAppRecipient(),
          createFakeWhatsAppRecipient({ id: 'w2', waId: '5521988887777' }),
        ]),
      )
      const outcome = expectOk(await Service.dispatch('is1', NOW))
      expect(outcome).toMatchObject({ status: 'sent', sent: 2, more: false })
      expect(repo.claimBatch).toHaveBeenCalledWith('is1', 10)
      const [, payload, options] = send.template.mock.calls[0]
      expect(payload).toMatchObject({
        to: '5511999990000',
        templateName: 'nova_edicao',
        language: 'pt_BR',
      })
      expect(JSON.stringify(payload.components)).toContain('Resumo da edição')
      expect(JSON.stringify(payload.components)).toContain(
        '/n/acme/novidades/novidades-de-outubro',
      )
      expect(options).toEqual({
        cost: { source: 'CRM_CAMPAIGN', templateCategory: 'MARKETING' },
      })

      vi.mocked(
        CrmCampaignRecipientRepository.countWhatsAppSentSince,
      ).mockResolvedValueOnce(ok(600))
      repo.countSentSince.mockResolvedValueOnce(ok(400))
      expect(expectOk(await Service.dispatch('is1', NOW))).toMatchObject({
        status: 'waiting',
      })
    })

    it('skips everything when the version became unavailable', async () => {
      lookup.findConnection.mockResolvedValueOnce(ok(null))
      expect(expectOk(await Service.dispatch('is1', NOW))).toEqual({
        status: 'unavailable',
        skipped: 3,
      })
      expect(repo.skipPending).toHaveBeenCalledWith('is1', 'UNAVAILABLE')
      repo.findConfig.mockResolvedValueOnce(
        ok({ ...started, connectionId: null }),
      )
      expect(expectOk(await Service.dispatch('is1', NOW)).status).toBe(
        'unavailable',
      )
    })

    it('handles opt-outs, failures, the monthly limit and rate limits', async () => {
      repo.claimBatch.mockResolvedValueOnce(ok([]))
      expect(expectOk(await Service.dispatch('is1', NOW))).toEqual({
        status: 'drained',
      })

      repo.optedOut.mockResolvedValueOnce(ok(new Set(['5511999990000'])))
      expect(expectOk(await Service.dispatch('is1', NOW))).toMatchObject({
        skipped: 1,
        sent: 0,
      })
      expect(repo.markSkipped).toHaveBeenCalledWith(['w1'], 'OPTED_OUT')

      send.text.mockResolvedValueOnce(
        err(whatsappProviderError('número inválido')),
      )
      expect(expectOk(await Service.dispatch('is1', NOW))).toMatchObject({
        failed: 1,
      })
      expect(repo.markFailed).toHaveBeenCalledWith('w1', 'número inválido')

      send.text.mockResolvedValueOnce(
        err(whatsappMessageLimitReached(1000, 1000)),
      )
      expect(expectOk(await Service.dispatch('is1', NOW))).toEqual({
        status: 'limit_reached',
        skipped: 4,
      })
      expect(repo.markSkipped).toHaveBeenCalledWith(['w1'], 'LIMIT_REACHED')

      send.text.mockResolvedValueOnce(err(rateLimited(5)))
      expect(expectOk(await Service.dispatch('is1', NOW))).toMatchObject({
        status: 'waiting',
      })
      expect(repo.release).toHaveBeenCalledWith(['w1'])

      repo.markSent.mockResolvedValueOnce(err(databaseError()))
      expect(expectOk(await Service.dispatch('is1', NOW))).toMatchObject({
        sent: 1,
      })
    })

    it('propagates database errors', async () => {
      const cases = [
        () =>
          vi
            .mocked(CrmNewsletterIssueRepository.findByIdUnscoped)
            .mockResolvedValueOnce(err(databaseError())),
        () => repo.findConfig.mockResolvedValueOnce(err(databaseError())),
        () => repo.releaseStuck.mockResolvedValueOnce(err(databaseError())),
        () =>
          vi
            .mocked(assertModuleEnabled)
            .mockResolvedValueOnce(err(databaseError())),
        () => repo.claimBatch.mockResolvedValueOnce(err(databaseError())),
        () => repo.optedOut.mockResolvedValueOnce(err(databaseError())),
        () => {
          repo.optedOut.mockResolvedValueOnce(ok(new Set(['5511999990000'])))
          repo.markSkipped.mockResolvedValueOnce(err(databaseError()))
        },
        () => {
          send.text.mockResolvedValueOnce(err(whatsappProviderError('x')))
          repo.markFailed.mockResolvedValueOnce(err(databaseError()))
        },
        () => {
          send.text.mockResolvedValueOnce(
            err(whatsappMessageLimitReached(1000, 1000)),
          )
          repo.markSkipped.mockResolvedValueOnce(err(databaseError()))
        },
        () => {
          send.text.mockResolvedValueOnce(
            err(whatsappMessageLimitReached(1000, 1000)),
          )
          repo.skipPending.mockResolvedValueOnce(err(databaseError()))
        },
      ]
      for (const arrange of cases) {
        arrange()
        expectErr(await Service.dispatch('is1', NOW), 'DATABASE_ERROR')
      }
      vi.mocked(
        CrmNewsletterIssueRepository.findByIdUnscoped,
      ).mockResolvedValueOnce(ok(sentIssue({ status: 'FAILED' }) as never))
      repo.skipPending.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.dispatch('is1', NOW), 'DATABASE_ERROR')
      lookup.findConnection.mockResolvedValueOnce(ok(null))
      repo.skipPending.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.dispatch('is1', NOW), 'DATABASE_ERROR')
      repo.findConfig.mockResolvedValue(ok({ ...metaConfig, startedAt: NOW }))
      repo.countSentSince.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.dispatch('is1', NOW), 'DATABASE_ERROR')
      vi.mocked(
        CrmCampaignRecipientRepository.countWhatsAppSentSince,
      ).mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.dispatch('is1', NOW), 'DATABASE_ERROR')
    })
  })

  describe('sendIssueWhatsApp', () => {
    it('refuses a Meta send without an approved template', async () => {
      expectErr(
        await sendIssueWhatsApp({
          connection: meta,
          template: { ...template, status: 'PAUSED' } as never,
          config: { variables: null, text: null },
          content: { summary: '', subject: '' },
          to: { waId: '1', name: 'A', link: 'l', linkCode: 'c' },
        }),
        'CRM_NEWSLETTER_WHATSAPP_UNAVAILABLE',
      )
      expectOk(
        await sendIssueWhatsApp({
          connection: zapi,
          template: null,
          config: { variables: null, text: null },
          content: { summary: '', subject: '' },
          to: { waId: '1', name: 'A', link: 'l', linkCode: 'c' },
        }),
      )
      expect(send.text).toHaveBeenCalledWith(
        zapi,
        { to: '1', text: '' },
        expect.anything(),
      )
    })
  })

  describe('report', () => {
    it('returns the totals and a page of numbers', async () => {
      const report = expectOk(
        await Service.report(...A, { page: 1, pageSize: 25 }),
      )
      expect(report).toMatchObject({
        enabled: true,
        provider: 'ZAPI',
        stats: { total: 2, sent: 1 },
        total: 1,
        items: [{ id: 'w1', phone: '+5511999990000', status: 'SENT' }],
      })
      repo.findConfig.mockResolvedValueOnce(ok(null))
      expect(
        expectOk(await Service.report(...A, { page: 1, pageSize: 25 })),
      ).toMatchObject({ enabled: false, provider: null })
      repo.findConfig.mockResolvedValueOnce(
        ok(createFakeIssueWhatsApp({ connectionId: 'gone' })),
      )
      expect(
        expectOk(await Service.report(...A, { page: 1, pageSize: 25 }))
          .provider,
      ).toBeNull()
    })

    it('propagates errors', async () => {
      const q = { page: 1, pageSize: 25 }
      vi.mocked(loadNewsletterScope).mockResolvedValueOnce(err(forbidden()))
      expectErr(await Service.report(...A, q), 'FORBIDDEN')
      vi.mocked(loadIssue).mockResolvedValueOnce(
        err(crmNewsletterIssueNotFound()),
      )
      expectErr(await Service.report(...A, q), 'CRM_NEWSLETTER_ISSUE_NOT_FOUND')
      repo.findConfig.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.report(...A, q), 'DATABASE_ERROR')
      repo.stats.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.report(...A, q), 'DATABASE_ERROR')
      repo.listRecipients.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.report(...A, q), 'DATABASE_ERROR')
      lookup.findConnection.mockResolvedValueOnce(err(databaseError()))
      expectErr(await Service.report(...A, q), 'DATABASE_ERROR')
    })
  })
})
