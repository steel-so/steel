import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/src/services/notification-emitter', () => ({
  emitNotification: vi.fn(async () => 1),
}))

import {
  notifyDigestReady,
  notifyDigestSkipped,
} from '../crm-newsletter-digest-notifications'
import { emitNotification } from '../notification-emitter'

const emit = vi.mocked(emitNotification)

beforeEach(() => vi.clearAllMocks())

describe('digest notices', () => {
  it('ready: links the draft, singular and plural', async () => {
    await notifyDigestReady({
      workspaceId: 'ws1',
      newsletterId: 'nl1',
      newsletterName: 'Novidades',
      issueId: 'is1',
      recipientId: 'u1',
      items: 1,
    })
    expect(emit).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      recipients: ['u1'],
      kind: 'CRM_NEWSLETTER_DIGEST_READY',
      title: 'Resumo pronto para revisar: Novidades',
      body: '1 post novo entrou no rascunho. Revise e envie quando quiser.',
      path: '/crm/newsletters/nl1/issues/is1',
      dedupeKey: 'crm-newsletter-digest:is1:ready',
    })
    await notifyDigestReady({
      workspaceId: 'ws1',
      newsletterId: 'nl1',
      newsletterName: 'Novidades',
      issueId: 'is1',
      recipientId: 'u1',
      items: 3,
    })
    expect(emit.mock.calls[1][0].body).toContain('3 posts novos entraram')
  })

  it('skipped: with and without a draft left behind', async () => {
    await notifyDigestSkipped({
      workspaceId: 'ws1',
      newsletterId: 'nl1',
      newsletterName: 'Novidades',
      recipientId: 'u1',
      reason: 'Nenhum post novo.',
      issueId: null,
      runKey: 'dg1:1',
    })
    expect(emit.mock.calls[0][0]).toMatchObject({
      kind: 'CRM_NEWSLETTER_DIGEST_SKIPPED',
      title: 'Resumo pulado: Novidades',
      body: 'Nenhum post novo.',
      path: '/crm/newsletters/nl1?aba=resumo',
      dedupeKey: 'crm-newsletter-digest:dg1:1:skipped',
    })
    await notifyDigestSkipped({
      workspaceId: 'ws1',
      newsletterId: 'nl1',
      newsletterName: 'Novidades',
      recipientId: 'u1',
      reason: 'Limite atingido.',
      issueId: 'is9',
      runKey: 'dg1:2',
    })
    expect(emit.mock.calls[1][0]).toMatchObject({
      title: 'Resumo não enviado: Novidades',
      body: 'Limite atingido. O rascunho ficou salvo para você revisar.',
      path: '/crm/newsletters/nl1/issues/is9',
    })
  })
})
