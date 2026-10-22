import type {
  CrmCampaign,
  WhatsAppConnection,
  WhatsAppTemplate,
} from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeCrmCampaign,
  createFakeCrmCampaignRecipient,
} from '@/src/__tests__/factories/crm-campaign.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, rateLimited, whatsappProviderError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit')
vi.mock('@/src/repositories/crm-campaign.repository')
vi.mock('@/src/repositories/crm-campaign-audience.repository')
vi.mock('@/src/repositories/crm-campaign-lookup.repository')
vi.mock('@/src/services/crm-notifications')
vi.mock('@/src/lib/crm-campaign/email-renderer', () => ({
  renderCampaignEmail: vi.fn(),
}))
vi.mock('@/src/lib/mail/send', () => ({ sendEmail: vi.fn() }))
vi.mock('@/src/lib/whatsapp/send', () => ({
  WhatsAppSend: {
    text: vi.fn(),
    media: vi.fn(),
    template: vi.fn(),
    buttons: vi.fn(),
  },
}))
const add = vi.fn()
const addBulk = vi.fn()
vi.mock('@/src/lib/queue/queues', () => ({
  getCrmCampaignsQueue: () => ({ add, addBulk }),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { renderCampaignEmail } from '@/src/lib/crm-campaign/email-renderer'
import { sendEmail } from '@/src/lib/mail/send'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import {
  type CampaignFunnelCounts,
  CrmCampaignRecipientRepository,
  CrmCampaignRepository,
} from '@/src/repositories/crm-campaign.repository'
import { CrmCampaignAudienceRepository } from '@/src/repositories/crm-campaign-audience.repository'
import { CrmCampaignLookupRepository } from '@/src/repositories/crm-campaign-lookup.repository'
import {
  buildCampaignEmail,
  CrmCampaignSendService,
  channelStartAt,
  DISPATCH_BATCH,
  SEND_INTERVAL_MS,
  sendCampaignWhatsApp,
} from '../crm-campaign-send.service'
import { notifyCrmMultichannelCampaignFinished } from '../crm-notifications'

const campaigns = vi.mocked(CrmCampaignRepository)
const recipients = vi.mocked(CrmCampaignRecipientRepository)
const audience = vi.mocked(CrmCampaignAudienceRepository)
const lookup = vi.mocked(CrmCampaignLookupRepository)
const wa = vi.mocked(WhatsAppSend)

// Friday 10:00 in São Paulo.
const NOW = new Date('2026-10-09T13:00:00.000Z')

function campaign(overrides?: Partial<CrmCampaign>): CrmCampaign {
  return createFakeCrmCampaign({
    id: 'c1',
    workspaceId: 'ws1',
    status: 'SENDING',
    destinationType: 'FORM',
    formId: 'f1',
    emailFrom: 'crm@example.com',
    emailSubject: 'Oferta',
    emailTemplateId: 't1',
    startAt: NOW,
    launchedAt: NOW,
    ...overrides,
  })
}

function connection(overrides?: Partial<WhatsAppConnection>) {
  return {
    id: 'conn1',
    provider: 'ZAPI',
    status: 'CONNECTED',
    workspaceId: 'ws1',
    ...overrides,
  } as WhatsAppConnection
}

const metaTemplate = {
  id: 'wt1',
  name: 'promo',
  language: 'pt_BR',
  status: 'APPROVED',
  components: [
    { type: 'BODY', text: 'Oi {{1}}' },
    {
      type: 'BUTTONS',
      buttons: [{ type: 'URL', text: 'Ver', url: 'https://x/{{1}}' }],
    },
  ],
} as unknown as WhatsAppTemplate

function counts(over?: {
  emailSent?: number
  emailFailed?: number
  waSent?: number
  waFailed?: number
}): CampaignFunnelCounts {
  const s = { NONE: 0, PENDING: 0, SENDING: 0, SENT: 0, FAILED: 0, SKIPPED: 0 }
  return {
    recipients: 1,
    email: {
      ...s,
      SENT: over?.emailSent ?? 1,
      FAILED: over?.emailFailed ?? 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
      bounced: 0,
      unsubscribed: 0,
    },
    whatsapp: {
      ...s,
      SENT: over?.waSent ?? 0,
      FAILED: over?.waFailed ?? 0,
      delivered: 0,
      read: 0,
      clicked: 0,
      replied: 0,
    },
    conversions: 0,
  }
}

beforeEach(() => {
  add.mockReset()
  addBulk.mockReset()
  campaigns.findByIdUnscoped.mockResolvedValue(ok(campaign()))
  campaigns.transition.mockImplementation(async (_id, _from, data) =>
    ok(campaign(data as Partial<CrmCampaign>)),
  )
  campaigns.funnel.mockResolvedValue(ok(new Map([['c1', counts()]])))
  recipients.countOpen.mockResolvedValue(ok(0))
  recipients.claim.mockResolvedValue(ok(true))
  recipients.markSent.mockResolvedValue(ok(undefined))
  recipients.markFailed.mockResolvedValue(ok(undefined))
  recipients.markSkipped.mockResolvedValue(ok(undefined))
  recipients.release.mockResolvedValue(ok(undefined))
  recipients.countWhatsAppSentSince.mockResolvedValue(ok(0))
  audience.isEmailOptedOut.mockResolvedValue(ok(false))
  audience.isWhatsAppOptedOut.mockResolvedValue(ok(false))
  lookup.findConnection.mockResolvedValue(ok(connection()))
  lookup.findWhatsAppTemplate.mockResolvedValue(ok(metaTemplate))
  vi.mocked(renderCampaignEmail).mockResolvedValue(
    ok({
      subject: 'Tpl',
      html: '<html><body><p>Oi</p></body></html>',
      text: 'Oi',
    }),
  )
  vi.mocked(sendEmail).mockResolvedValue({ id: 'resend-1' } as never)
  wa.text.mockResolvedValue(ok({ providerMessageId: 'wa-1' }))
  wa.media.mockResolvedValue(ok({ providerMessageId: 'wa-2' }))
  wa.template.mockResolvedValue(ok({ providerMessageId: 'wa-3' }))
})

describe('channelStartAt()', () => {
  it('should delay WhatsApp by the configured hours', () => {
    const c = campaign({ whatsappDelayHours: 2 })
    expect(channelStartAt(c, 'EMAIL')).toEqual(NOW)
    expect(channelStartAt(c, 'WHATSAPP')).toEqual(
      new Date(NOW.getTime() + 7_200_000),
    )
    expect(
      channelStartAt(campaign({ startAt: null, launchedAt: null }), 'EMAIL'),
    ).toEqual(new Date(0))
    expect(channelStartAt(campaign({ startAt: null }), 'EMAIL')).toEqual(NOW)
  })
})

describe('enqueueDispatch()', () => {
  it('should queue one delayed dispatch per active channel', async () => {
    await CrmCampaignSendService.enqueueDispatch(
      campaign({ whatsappEnabled: true, whatsappDelayHours: 1 }),
      NOW,
    )
    expect(add).toHaveBeenCalledTimes(2)
    expect(add.mock.calls[0][1]).toEqual({ campaignId: 'c1', channel: 'EMAIL' })
    expect(add.mock.calls[0][2].delay).toBe(0)
    expect(add.mock.calls[1][2].delay).toBe(3_600_000)
    expect(add.mock.calls[1][2].jobId).toMatch(
      /^crm-campaign-dispatch-c1-WHATSAPP-/,
    )

    add.mockReset()
    await CrmCampaignSendService.enqueueDispatch(
      campaign({ startAt: new Date(NOW.getTime() - 60_000) }),
      NOW,
    )
    expect(add).toHaveBeenCalledTimes(1)
    expect(add.mock.calls[0][2].delay).toBe(0)
  })
})

describe('dispatch()', () => {
  it('should queue a staggered batch of sends', async () => {
    recipients.listPendingIds.mockResolvedValue(ok(['r1', 'r2']))
    const outcome = expectOk(
      await CrmCampaignSendService.dispatch('c1', 'EMAIL', NOW),
    )
    expect(outcome).toEqual({ status: 'queued', count: 2 })
    const jobs = addBulk.mock.calls[0][0]
    expect(jobs[1]).toMatchObject({
      name: 'send',
      data: { campaignId: 'c1', recipientId: 'r2', channel: 'EMAIL' },
      opts: { delay: SEND_INTERVAL_MS.EMAIL },
    })
    expect(add).not.toHaveBeenCalled()
  })

  it('should pace WhatsApp per provider and chain full batches', async () => {
    const full = Array.from({ length: DISPATCH_BATCH }, (_, i) => `r${i}`)
    recipients.listPendingIds.mockResolvedValue(ok(full))
    campaigns.findByIdUnscoped.mockResolvedValue(
      ok(campaign({ whatsappEnabled: true, whatsappConnectionId: 'conn1' })),
    )
    expectOk(await CrmCampaignSendService.dispatch('c1', 'WHATSAPP', NOW))
    expect(addBulk.mock.calls[0][0][1].opts.delay).toBe(SEND_INTERVAL_MS.ZAPI)
    expect(add.mock.calls[0][2].delay).toBe(
      DISPATCH_BATCH * SEND_INTERVAL_MS.ZAPI,
    )

    lookup.findConnection.mockResolvedValue(
      ok(connection({ provider: 'META' })),
    )
    recipients.listPendingIds.mockResolvedValue(ok(['r1', 'r2']))
    expectOk(await CrmCampaignSendService.dispatch('c1', 'WHATSAPP', NOW))
    expect(addBulk.mock.calls[1][0][1].opts.delay).toBe(SEND_INTERVAL_MS.META)

    lookup.findConnection.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await CrmCampaignSendService.dispatch('c1', 'WHATSAPP', NOW),
      'DATABASE_ERROR',
    )
  })

  it('should start a due scheduled campaign', async () => {
    campaigns.findByIdUnscoped.mockResolvedValue(
      ok(campaign({ status: 'SCHEDULED', startAt: NOW })),
    )
    recipients.listPendingIds.mockResolvedValue(ok(['r1']))
    expect(
      expectOk(await CrmCampaignSendService.dispatch('c1', 'EMAIL', NOW))
        .status,
    ).toBe('queued')
    expect(campaigns.transition).toHaveBeenCalledWith('c1', ['SCHEDULED'], {
      status: 'SENDING',
    })

    // Lost the race: keeps the loaded (scheduled) row → inactive.
    campaigns.transition.mockResolvedValueOnce(ok(null))
    expect(
      expectOk(await CrmCampaignSendService.dispatch('c1', 'EMAIL', NOW))
        .status,
    ).toBe('inactive')

    campaigns.transition.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await CrmCampaignSendService.dispatch('c1', 'EMAIL', NOW),
      'DATABASE_ERROR',
    )
  })

  it('should not send for missing, paused or not-yet-due channels', async () => {
    campaigns.findByIdUnscoped.mockResolvedValueOnce(ok(null))
    expect(
      expectOk(await CrmCampaignSendService.dispatch('c1', 'EMAIL', NOW)),
    ).toEqual({
      status: 'missing',
    })
    campaigns.findByIdUnscoped.mockResolvedValueOnce(
      ok(campaign({ status: 'PAUSED' })),
    )
    expect(
      expectOk(await CrmCampaignSendService.dispatch('c1', 'EMAIL', NOW))
        .status,
    ).toBe('inactive')
    campaigns.findByIdUnscoped.mockResolvedValueOnce(
      ok(
        campaign({
          status: 'SCHEDULED',
          startAt: new Date(NOW.getTime() + 1000),
        }),
      ),
    )
    expect(
      expectOk(await CrmCampaignSendService.dispatch('c1', 'EMAIL', NOW))
        .status,
    ).toBe('inactive')

    campaigns.findByIdUnscoped.mockResolvedValueOnce(
      ok(campaign({ whatsappEnabled: true, whatsappDelayHours: 3 })),
    )
    const notDue = expectOk(
      await CrmCampaignSendService.dispatch('c1', 'WHATSAPP', NOW),
    )
    expect(notDue.status).toBe('not_due')
    expect(add.mock.calls[0][2].delay).toBe(3 * 3_600_000)

    campaigns.findByIdUnscoped.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await CrmCampaignSendService.dispatch('c1', 'EMAIL', NOW),
      'DATABASE_ERROR',
    )
  })

  it('should wait for the send window', async () => {
    campaigns.findByIdUnscoped.mockResolvedValue(
      ok(campaign({ sendWindowStartHour: 14, sendWindowEndHour: 18 })),
    )
    const outcome = expectOk(
      await CrmCampaignSendService.dispatch('c1', 'EMAIL', NOW),
    )
    expect(outcome).toEqual({
      status: 'outside_window',
      retryAt: new Date('2026-10-09T17:00:00.000Z'),
    })
    expect(add.mock.calls[0][2].delay).toBe(4 * 3_600_000)
  })

  it('should close a drained channel', async () => {
    recipients.listPendingIds.mockResolvedValue(ok([]))
    expect(
      expectOk(await CrmCampaignSendService.dispatch('c1', 'EMAIL', NOW))
        .status,
    ).toBe('drained')
    expect(campaigns.transition).toHaveBeenCalledWith(
      'c1',
      ['SENDING'],
      expect.objectContaining({ status: 'COMPLETED' }),
    )
    recipients.listPendingIds.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await CrmCampaignSendService.dispatch('c1', 'EMAIL', NOW),
      'DATABASE_ERROR',
    )
  })
})

describe('send() — e-mail', () => {
  beforeEach(() => {
    recipients.findWithCampaign.mockResolvedValue(
      ok({
        ...createFakeCrmCampaignRecipient({
          id: 'r1',
          campaignId: 'c1',
          name: 'Ana',
          email: 'ana@example.com',
          personId: 'p1',
        }),
        campaign: campaign({ emailPreheader: 'Só hoje' }),
      }),
    )
  })

  it('should claim, send with tracking and LGPD footer, and record', async () => {
    const outcome = expectOk(
      await CrmCampaignSendService.send('c1', 'r1', 'EMAIL', NOW),
    )
    expect(outcome).toEqual({ status: 'sent', providerMessageId: 'resend-1' })
    expect(recipients.claim).toHaveBeenCalledWith('r1', 'EMAIL')
    const email = vi.mocked(sendEmail).mock.calls[0][0]
    expect(email).toMatchObject({
      from: 'crm@example.com',
      to: 'ana@example.com',
      subject: 'Oferta',
    })
    expect(email.html).toContain('Só hoje')
    expect(email.html).toContain('/api/crm/campaigns/o/r1-e.')
    expect(email.headers).toHaveProperty('List-Unsubscribe')
    const contact = vi.mocked(renderCampaignEmail).mock.calls[0][1]
    expect(contact.campaignLink).toContain('/api/crm/campaigns/c/r1-e.')
    // The builder adds the LGPD footer with this recipient's unsubscribe page.
    expect(contact.unsubscribeUrl).toContain('/unsubscribe/r1.')
    expect(contact.workspaceId).toBe('ws1')
    // Per-recipient rendering: the CRM person fills the profile variables.
    expect(contact.personId).toBe('p1')
    expect(recipients.markSent).toHaveBeenCalledWith(
      'r1',
      'EMAIL',
      'resend-1',
      NOW,
    )
    // Drained → completed and the owner is told.
    expect(notifyCrmMultichannelCampaignFinished).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'COMPLETED', emailSent: 1 }),
    )
    expect(auditMutation).toHaveBeenCalled()
  })

  it('should never send twice (claim lost)', async () => {
    recipients.claim.mockResolvedValue(ok(false))
    expect(
      expectOk(await CrmCampaignSendService.send('c1', 'r1', 'EMAIL', NOW)),
    ).toEqual({
      status: 'skipped',
      reason: 'not_pending',
    })
    expect(sendEmail).not.toHaveBeenCalled()
    recipients.claim.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await CrmCampaignSendService.send('c1', 'r1', 'EMAIL', NOW),
      'DATABASE_ERROR',
    )
  })

  it('should skip opted-out contacts (LGPD) at send time', async () => {
    audience.isEmailOptedOut.mockResolvedValue(ok(true))
    expect(
      expectOk(await CrmCampaignSendService.send('c1', 'r1', 'EMAIL', NOW)),
    ).toEqual({
      status: 'skipped',
      reason: 'opted_out',
    })
    expect(recipients.markSkipped).toHaveBeenCalledWith(
      'r1',
      'EMAIL',
      'opted_out',
    )
    expect(sendEmail).not.toHaveBeenCalled()

    recipients.markSkipped.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await CrmCampaignSendService.send('c1', 'r1', 'EMAIL', NOW),
      'DATABASE_ERROR',
    )

    audience.isEmailOptedOut.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await CrmCampaignSendService.send('c1', 'r1', 'EMAIL', NOW),
      'DATABASE_ERROR',
    )
    expect(recipients.release).toHaveBeenCalledWith('r1', 'EMAIL')
  })

  it('should release and retry when rate limited', async () => {
    vi.mocked(sendEmail).mockRejectedValue(
      new Error('Email rate limited for x'),
    )
    expect(
      expectOk(await CrmCampaignSendService.send('c1', 'r1', 'EMAIL', NOW))
        .status,
    ).toBe('retry')
    expect(recipients.release).toHaveBeenCalledWith('r1', 'EMAIL')
    expect(recipients.markFailed).not.toHaveBeenCalled()
  })

  it('should mark failures and close as FAILED when nothing went out', async () => {
    vi.mocked(sendEmail).mockRejectedValue('bad')
    campaigns.funnel.mockResolvedValue(
      ok(new Map([['c1', counts({ emailSent: 0, emailFailed: 1 })]])),
    )
    expect(
      expectOk(await CrmCampaignSendService.send('c1', 'r1', 'EMAIL', NOW)),
    ).toEqual({
      status: 'failed',
      reason: 'Falha ao enviar',
    })
    expect(campaigns.transition).toHaveBeenCalledWith(
      'c1',
      ['SENDING'],
      expect.objectContaining({ status: 'FAILED' }),
    )
    recipients.markFailed.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await CrmCampaignSendService.send('c1', 'r1', 'EMAIL', NOW),
      'DATABASE_ERROR',
    )
  })

  it('should fail when the template cannot be rendered', async () => {
    vi.mocked(renderCampaignEmail).mockResolvedValue(
      err(databaseError('render')),
    )
    expect(
      expectOk(await CrmCampaignSendService.send('c1', 'r1', 'EMAIL', NOW)),
    ).toEqual({
      status: 'failed',
      reason: 'render',
    })
  })

  it('should not report an error once the message left', async () => {
    recipients.markSent.mockResolvedValue(err(databaseError('x')))
    expect(
      expectOk(await CrmCampaignSendService.send('c1', 'r1', 'EMAIL', NOW))
        .status,
    ).toBe('sent')
  })

  it('should skip missing rows, other campaigns, paused campaigns and closed windows', async () => {
    recipients.findWithCampaign.mockResolvedValueOnce(ok(null))
    expect(
      expectOk(await CrmCampaignSendService.send('c1', 'r1', 'EMAIL', NOW)),
    ).toEqual({ status: 'skipped', reason: 'missing' })
    expect(
      expectOk(await CrmCampaignSendService.send('other', 'r1', 'EMAIL', NOW)),
    ).toEqual({ status: 'skipped', reason: 'missing' })

    recipients.findWithCampaign.mockResolvedValueOnce(
      ok({
        ...createFakeCrmCampaignRecipient({ id: 'r1', campaignId: 'c1' }),
        campaign: campaign({ status: 'PAUSED' }),
      }),
    )
    expect(
      expectOk(await CrmCampaignSendService.send('c1', 'r1', 'EMAIL', NOW))
        .status,
    ).toBe('skipped')

    recipients.findWithCampaign.mockResolvedValueOnce(
      ok({
        ...createFakeCrmCampaignRecipient({ id: 'r1', campaignId: 'c1' }),
        campaign: campaign({ deletedAt: NOW }),
      }),
    )
    expect(
      expectOk(await CrmCampaignSendService.send('c1', 'r1', 'EMAIL', NOW)),
    ).toEqual({
      status: 'skipped',
      reason: 'inactive',
    })

    recipients.findWithCampaign.mockResolvedValueOnce(
      ok({
        ...createFakeCrmCampaignRecipient({ id: 'r1', campaignId: 'c1' }),
        campaign: campaign({ sendWeekdaysOnly: true }),
      }),
    )
    const saturday = new Date('2026-10-10T13:00:00.000Z')
    expect(
      expectOk(
        await CrmCampaignSendService.send('c1', 'r1', 'EMAIL', saturday),
      ),
    ).toEqual({ status: 'skipped', reason: 'outside_window' })
    expect(recipients.claim).not.toHaveBeenCalled()

    recipients.findWithCampaign.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await CrmCampaignSendService.send('c1', 'r1', 'EMAIL', NOW),
      'DATABASE_ERROR',
    )
  })
})

describe('send() — WhatsApp', () => {
  function withCampaign(overrides?: Partial<CrmCampaign>) {
    recipients.findWithCampaign.mockResolvedValue(
      ok({
        ...createFakeCrmCampaignRecipient({
          id: 'r1',
          campaignId: 'c1',
          name: 'Ana Souza',
          waId: '5511999990000',
          whatsappStatus: 'PENDING',
        }),
        campaign: campaign({
          whatsappEnabled: true,
          whatsappConnectionId: 'conn1',
          whatsappText: 'Oi {primeiro_nome}: {link}',
          ...overrides,
        }),
      }),
    )
  }

  it('should send Z-API text with the tracked link', async () => {
    withCampaign()
    expect(
      expectOk(await CrmCampaignSendService.send('c1', 'r1', 'WHATSAPP', NOW)),
    ).toEqual({ status: 'sent', providerMessageId: 'wa-1' })
    const text = wa.text.mock.calls[0][1]
    expect(text.to).toBe('5511999990000')
    expect(text.text).toMatch(/^Oi Ana: http.*\/api\/crm\/campaigns\/c\/r1-w\./)
    expect(audience.isWhatsAppOptedOut).toHaveBeenCalledWith(
      'ws1',
      '5511999990000',
    )
  })

  it('should send Z-API media with caption (and audio as text)', async () => {
    withCampaign({ whatsappMediaUrl: 'https://cdn.test/promo.jpg' })
    expectOk(await CrmCampaignSendService.send('c1', 'r1', 'WHATSAPP', NOW))
    expect(wa.media.mock.calls[0][1]).toMatchObject({
      type: 'image',
      mediaUrl: 'https://cdn.test/promo.jpg',
    })

    withCampaign({ whatsappMediaUrl: 'https://cdn.test/a.mp3' })
    expectOk(await CrmCampaignSendService.send('c1', 'r1', 'WHATSAPP', NOW))
    expect(wa.text).toHaveBeenCalled()

    withCampaign({ whatsappMediaUrl: 'https://cdn.test/noext' })
    expectOk(await CrmCampaignSendService.send('c1', 'r1', 'WHATSAPP', NOW))
    expect(wa.media.mock.calls[1][1].type).toBe('image')
  })

  it('should send the approved Meta template with mapped variables', async () => {
    lookup.findConnection.mockResolvedValue(
      ok(connection({ provider: 'META' })),
    )
    withCampaign({
      whatsappTemplateId: 'wt1',
      whatsappVariables: {
        header: {},
        body: { '1': { source: 'first_name' } },
        buttons: { '0': { source: 'link_code' } },
      },
    })
    expect(
      expectOk(await CrmCampaignSendService.send('c1', 'r1', 'WHATSAPP', NOW)),
    ).toEqual({ status: 'sent', providerMessageId: 'wa-3' })
    const sent = wa.template.mock.calls[0][1]
    expect(sent).toMatchObject({ templateName: 'promo', language: 'pt_BR' })
    expect(sent.components).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: 'Ana' }] },
      {
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: expect.stringMatching(/^r1-w\./) }],
      },
    ])
  })

  it('should respect the Meta daily tier cap', async () => {
    lookup.findConnection.mockResolvedValue(
      ok(connection({ provider: 'META' })),
    )
    withCampaign({ whatsappTemplateId: 'wt1' })
    recipients.countWhatsAppSentSince.mockResolvedValue(ok(1000))
    expect(
      expectOk(await CrmCampaignSendService.send('c1', 'r1', 'WHATSAPP', NOW)),
    ).toEqual({ status: 'skipped', reason: 'tier_limit' })
    expect(recipients.claim).not.toHaveBeenCalled()

    recipients.countWhatsAppSentSince.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await CrmCampaignSendService.send('c1', 'r1', 'WHATSAPP', NOW),
      'DATABASE_ERROR',
    )
    lookup.findConnection.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await CrmCampaignSendService.send('c1', 'r1', 'WHATSAPP', NOW),
      'DATABASE_ERROR',
    )
  })

  it('should fail on unusable connection or template and retry rate limits', async () => {
    withCampaign()
    wa.text.mockResolvedValueOnce(err(rateLimited(5)))
    expect(
      expectOk(await CrmCampaignSendService.send('c1', 'r1', 'WHATSAPP', NOW))
        .status,
    ).toBe('retry')
    wa.text.mockResolvedValueOnce(err(whatsappProviderError('nope')))
    expect(
      expectOk(await CrmCampaignSendService.send('c1', 'r1', 'WHATSAPP', NOW)),
    ).toEqual({ status: 'failed', reason: 'nope' })

    audience.isWhatsAppOptedOut.mockResolvedValueOnce(ok(true))
    expect(
      expectOk(await CrmCampaignSendService.send('c1', 'r1', 'WHATSAPP', NOW))
        .status,
    ).toBe('skipped')
  })
})

describe('sendCampaignWhatsApp()', () => {
  const to = { waId: '5511', name: 'Ana', link: 'https://l', linkCode: 'c' }

  it('should refuse without a usable connection or template', async () => {
    expect(
      expectErr(
        await sendCampaignWhatsApp(
          campaign({ whatsappConnectionId: null }),
          to,
        ),
      ).code,
    ).toBe('CRM_CAMPAIGN_WHATSAPP_UNAVAILABLE')

    const c = campaign({ whatsappConnectionId: 'conn1' })
    lookup.findConnection.mockResolvedValueOnce(ok(null))
    expectErr(
      await sendCampaignWhatsApp(c, to),
      'CRM_CAMPAIGN_WHATSAPP_UNAVAILABLE',
    )
    lookup.findConnection.mockResolvedValueOnce(
      ok(connection({ status: 'ERROR' })),
    )
    expectErr(
      await sendCampaignWhatsApp(c, to),
      'CRM_CAMPAIGN_WHATSAPP_UNAVAILABLE',
    )
    lookup.findConnection.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await sendCampaignWhatsApp(c, to), 'DATABASE_ERROR')

    lookup.findConnection.mockResolvedValue(
      ok(connection({ provider: 'META' })),
    )
    expectErr(
      await sendCampaignWhatsApp(c, to),
      'CRM_CAMPAIGN_WHATSAPP_UNAVAILABLE',
    )
    lookup.findWhatsAppTemplate.mockResolvedValueOnce(
      ok({ ...metaTemplate, status: 'PENDING' }),
    )
    expectErr(
      await sendCampaignWhatsApp({ ...c, whatsappTemplateId: 'wt1' }, to),
      'CRM_CAMPAIGN_WHATSAPP_UNAVAILABLE',
    )
    lookup.findWhatsAppTemplate.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await sendCampaignWhatsApp({ ...c, whatsappTemplateId: 'wt1' }, to),
      'DATABASE_ERROR',
    )
    // Unmapped variables still send (validated before launch).
    expectOk(
      await sendCampaignWhatsApp({ ...c, whatsappTemplateId: 'wt1' }, to),
    )
  })

  it('should send empty Z-API text when unset', async () => {
    expectOk(
      await sendCampaignWhatsApp(
        campaign({ whatsappConnectionId: 'conn1', whatsappText: null }),
        to,
      ),
    )
    expect(wa.text.mock.calls[0][1].text).toBe('')
  })
})

describe('sendCampaignWhatsApp() — Z-API quick reply', () => {
  const to = {
    waId: '5511',
    name: 'Ana',
    link: 'https://app.test/api/crm/campaigns/c/r1-w.sig',
    linkCode: 'r1-w.sig',
  }
  const c = (overrides?: Partial<CrmCampaign>) =>
    campaign({
      whatsappConnectionId: 'conn1',
      whatsappText: 'Oi {nome}',
      whatsappQuickReplyId: 'qr1',
      ...overrides,
    })
  const reply = (overrides?: Record<string, unknown>) =>
    ok({
      id: 'qr1',
      workspaceId: 'ws1',
      shortcut: 'promo',
      title: 'Promo',
      body: 'Oi',
      mediaUrl: null,
      buttons: [
        {
          id: 'b1',
          type: 'REPLY',
          label: 'Quero',
          actions: [{ kind: 'REPLY', text: 'Oba' }],
        },
        { id: 'b2', type: 'URL', label: 'Ver', url: 'https://x.test/{link}' },
      ],
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    } as never)

  beforeEach(() => {
    lookup.findConnection.mockResolvedValue(ok(connection()))
    wa.buttons.mockResolvedValue(ok({ providerMessageId: 'wa-b' }))
  })

  it('should send the buttons: reply payload keeps actions, URL gets the link', async () => {
    lookup.findQuickReply.mockResolvedValueOnce(reply())
    expect(expectOk(await sendCampaignWhatsApp(c(), to))).toEqual({
      providerMessageId: 'wa-b',
    })
    const sent = wa.buttons.mock.calls[0][1]
    expect(sent.text).toBe('Oi Ana')
    expect(sent.buttons[0]).toMatchObject({ type: 'REPLY', label: 'Quero' })
    expect((sent.buttons[0] as { id: string }).id).toContain('qr1')
    expect(sent.buttons[1]).toEqual({
      type: 'URL',
      id: 'b2',
      label: 'Ver',
      url: `https://x.test/${to.link}`,
    })
    expect(sent).not.toHaveProperty('media')
  })

  it('should put an image in the button message and send other media first', async () => {
    lookup.findQuickReply.mockResolvedValueOnce(
      reply({ mediaUrl: 'https://cdn.test/a.png' }),
    )
    expectOk(await sendCampaignWhatsApp(c(), to))
    expect(wa.buttons.mock.calls[0][1].media).toEqual({
      url: 'https://cdn.test/a.png',
      type: 'image',
    })

    wa.media.mockResolvedValue(ok({ providerMessageId: 'wa-m' }))
    lookup.findQuickReply.mockResolvedValueOnce(reply())
    expectOk(
      await sendCampaignWhatsApp(
        c({ whatsappMediaUrl: 'https://cdn.test/doc.pdf' }),
        to,
      ),
    )
    expect(wa.media).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'document',
        mediaUrl: 'https://cdn.test/doc.pdf',
      }),
      { cost: { source: 'CRM_CAMPAIGN' } },
    )
    expect(wa.buttons.mock.calls[1][1]).not.toHaveProperty('media')

    wa.media.mockResolvedValueOnce(err(whatsappProviderError('down')))
    lookup.findQuickReply.mockResolvedValueOnce(reply())
    expectErr(
      await sendCampaignWhatsApp(
        c({ whatsappMediaUrl: 'https://cdn.test/v.mp4' }),
        to,
      ),
    )
  })

  it('should fall back to text/media when the quick reply has no buttons', async () => {
    wa.media.mockResolvedValue(ok({ providerMessageId: 'wa-m' }))
    lookup.findQuickReply.mockResolvedValueOnce(
      reply({ buttons: null, mediaUrl: 'https://cdn.test/a.png' }),
    )
    expectOk(await sendCampaignWhatsApp(c(), to))
    expect(wa.buttons).not.toHaveBeenCalled()
    expect(wa.media).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        mediaUrl: 'https://cdn.test/a.png',
        caption: 'Oi Ana',
      }),
      { cost: { source: 'CRM_CAMPAIGN' } },
    )
  })

  it('should fail when the quick reply is gone or unreadable', async () => {
    lookup.findQuickReply.mockResolvedValueOnce(ok(null))
    expectErr(
      await sendCampaignWhatsApp(c(), to),
      'CRM_CAMPAIGN_WHATSAPP_UNAVAILABLE',
    )
    lookup.findQuickReply.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await sendCampaignWhatsApp(c(), to), 'DATABASE_ERROR')
  })
})

describe('buildCampaignEmail()', () => {
  const contact = {
    name: 'Ana',
    email: 'ana@example.com',
    link: 'https://l',
    openPixelUrl: null,
    unsubscribePageUrl: null,
  }

  it('should inject preheader and pixel even without a body tag', async () => {
    vi.mocked(renderCampaignEmail).mockResolvedValue(
      ok({ subject: 'Tpl', html: '<p>Oi</p>', text: 'Oi' }),
    )
    const email = expectOk(
      await buildCampaignEmail(
        campaign({ emailPreheader: 'Pre <b>', emailSubject: null }),
        {
          ...contact,
          openPixelUrl: 'https://px',
        },
      ),
    )
    expect(email.subject).toBe('Tpl')
    expect(email.html.startsWith('<div style="display:none')).toBe(true)
    expect(email.html).toContain('Pre &lt;b&gt;')
    expect(
      email.html.endsWith(
        'style="display:block;border:0;width:1px;height:1px" />',
      ),
    ).toBe(true)
  })

  it('should leave the template untouched for a plain test', async () => {
    vi.mocked(renderCampaignEmail).mockResolvedValue(
      ok({ subject: 'Tpl', html: '<p>Oi</p>', text: 'Oi' }),
    )
    expect(expectOk(await buildCampaignEmail(campaign(), contact)).html).toBe(
      '<p>Oi</p>',
    )
  })
})

describe('completeIfDrained()', () => {
  it('should wait while rows are open and on read failures', async () => {
    recipients.countOpen
      .mockResolvedValueOnce(ok(0))
      .mockResolvedValueOnce(ok(3))
    await CrmCampaignSendService.completeIfDrained('c1', NOW)
    recipients.countOpen.mockResolvedValueOnce(err(databaseError('x')))
    await CrmCampaignSendService.completeIfDrained('c1', NOW)
    campaigns.funnel.mockResolvedValueOnce(err(databaseError('x')))
    await CrmCampaignSendService.completeIfDrained('c1', NOW)
    campaigns.funnel.mockResolvedValueOnce(ok(new Map()))
    await CrmCampaignSendService.completeIfDrained('c1', NOW)
    campaigns.transition.mockResolvedValueOnce(ok(null))
    await CrmCampaignSendService.completeIfDrained('c1', NOW)
    expect(notifyCrmMultichannelCampaignFinished).not.toHaveBeenCalled()
  })
})

describe('tick()', () => {
  it('should release stuck rows and dispatch every runnable channel', async () => {
    recipients.releaseStuck.mockResolvedValue(ok(2))
    campaigns.listRunnable.mockResolvedValue(
      ok([campaign({ whatsappEnabled: true }), campaign({ id: 'c2' })]),
    )
    const dispatch = vi
      .spyOn(CrmCampaignSendService, 'dispatch')
      .mockResolvedValueOnce(ok({ status: 'drained' }))
      .mockResolvedValueOnce(err(databaseError('x')))
      .mockResolvedValueOnce(ok({ status: 'queued', count: 1 }))
    expect(expectOk(await CrmCampaignSendService.tick(NOW))).toEqual({
      campaigns: 2,
      released: 2,
    })
    expect(dispatch).toHaveBeenCalledTimes(3)
    expect(recipients.releaseStuck).toHaveBeenCalledWith(
      new Date(NOW.getTime() - 15 * 60 * 1000),
    )
  })

  it('should propagate failures', async () => {
    recipients.releaseStuck.mockResolvedValue(err(databaseError('x')))
    expectErr(await CrmCampaignSendService.tick(NOW), 'DATABASE_ERROR')
    recipients.releaseStuck.mockResolvedValue(ok(0))
    campaigns.listRunnable.mockResolvedValue(err(databaseError('x')))
    expectErr(await CrmCampaignSendService.tick(NOW), 'DATABASE_ERROR')
  })
})
