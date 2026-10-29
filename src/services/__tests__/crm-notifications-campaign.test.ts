import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../notification-emitter', () => ({
  emitNotification: vi.fn(),
}))

import {
  notifyCrmCampaignSenderBlocked,
  notifyCrmMultichannelCampaignFinished,
} from '../crm-notifications'
import { emitNotification } from '../notification-emitter'

const mockedEmit = vi.mocked(emitNotification)
const lastCall = () => mockedEmit.mock.calls.at(-1)?.[0]
const campaign = { id: 'c1', name: 'Black Friday', createdById: 'u1' }

beforeEach(() => {
  mockedEmit.mockResolvedValue(1)
})

describe('notifyCrmMultichannelCampaignFinished', () => {
  it('summarizes both channels for the owner', async () => {
    await notifyCrmMultichannelCampaignFinished({
      workspaceId: 'ws1',
      campaign,
      status: 'COMPLETED',
      emailSent: 10,
      whatsappSent: 4,
      failed: 2,
    })
    expect(lastCall()).toEqual(
      expect.objectContaining({
        recipients: ['u1'],
        kind: 'CRM_CAMPAIGN_FINISHED',
        title: 'Campanha concluída: Black Friday',
        body: '10 e-mail(s) e 4 WhatsApp enviado(s), 2 com falha.',
        path: '/crm/campaigns/c1',
      }),
    )
  })

  it('handles nothing sent and failures', async () => {
    await notifyCrmMultichannelCampaignFinished({
      workspaceId: 'ws1',
      campaign,
      status: 'COMPLETED',
      emailSent: 0,
      whatsappSent: 0,
      failed: 0,
    })
    expect(lastCall()?.body).toBe('Nenhuma mensagem enviada.')
    await notifyCrmMultichannelCampaignFinished({
      workspaceId: 'ws1',
      campaign,
      status: 'FAILED',
      emailSent: 0,
      whatsappSent: 0,
      failed: 3,
    })
    expect(lastCall()).toEqual(
      expect.objectContaining({
        title: 'Falha no envio da campanha: Black Friday',
        body: 'Nenhuma mensagem da campanha pôde ser enviada.',
      }),
    )
  })
})

describe('notifyCrmCampaignSenderBlocked', () => {
  it('tells the owner why the e-mails did not go out, once per campaign', async () => {
    await notifyCrmCampaignSenderBlocked({
      workspaceId: 'ws1',
      campaign: { id: 'c1', title: 'Black Friday', createdById: 'u1' },
      type: 'MULTICHANNEL',
      fromEmail: 'mkt@acme.com',
    })
    expect(lastCall()).toEqual(
      expect.objectContaining({
        recipients: ['u1'],
        actorId: null,
        kind: 'CRM_CAMPAIGN_FINISHED',
        title: 'E-mails da campanha bloqueados: Black Friday',
        body: expect.stringContaining('mkt@acme.com'),
        path: '/crm/campaigns/c1',
        dedupeKey: 'crm-campaign-sender-blocked:c1',
      }),
    )
    await notifyCrmCampaignSenderBlocked({
      workspaceId: 'ws1',
      campaign: { id: 'e1', title: 'Oferta', createdById: 'u1' },
      type: 'EMAIL',
      fromEmail: 'mkt@acme.com',
    })
    expect(lastCall()?.path).toBe('/crm/email-campaigns?record=e1')
  })
})
