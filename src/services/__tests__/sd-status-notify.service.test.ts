import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeSdMajorIncident,
  createFakeSdStatusPage,
  createFakeSdStatusSubscriber,
} from '@/src/__tests__/factories/nov-s2-major-incident.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/sd-major-incident.repository')
vi.mock('@/src/repositories/sd-status-page.repository')
vi.mock('@/src/lib/mail/servicedesk/send-sd-status-update', () => ({
  sendSdStatusUpdateEmail: vi.fn(),
}))
vi.mock('@/src/lib/whatsapp/send', () => ({
  WhatsAppSend: { text: vi.fn() },
}))
vi.mock('../sd-notification.service', () => ({
  activeWhatsappConnection: vi.fn(),
}))

import { sendSdStatusUpdateEmail } from '@/src/lib/mail/servicedesk/send-sd-status-update'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { SdMajorIncidentRepository } from '@/src/repositories/sd-major-incident.repository'
import { SdStatusPageRepository } from '@/src/repositories/sd-status-page.repository'
import { activeWhatsappConnection } from '../sd-notification.service'
import { SdStatusNotifyService } from '../sd-status-notify.service'

const repo = vi.mocked(SdMajorIncidentRepository)
const pages = vi.mocked(SdStatusPageRepository)
const full = createFakeSdMajorIncident({ id: 'i1', impact: 'MAJOR_OUTAGE' })
const found = {
  update: full.updates[0],
  incident: {
    id: 'i1',
    workspaceId: 'ws1',
    title: 'Telefonia',
    pageIds: ['p1'],
  },
}
const email = {
  ...createFakeSdStatusSubscriber(),
  pageName: 'Acme',
  pageSlug: 'acme',
}
const phone = {
  ...createFakeSdStatusSubscriber({
    id: 'sub2',
    channel: 'WHATSAPP',
    address: '5511999990000',
  }),
  pageName: 'Acme',
  pageSlug: 'acme',
}

beforeEach(() => {
  vi.clearAllMocks()
  repo.findUpdate.mockResolvedValue(ok(found))
  repo.claimNotification.mockResolvedValue(ok(true))
  repo.finishNotification.mockResolvedValue(ok(true))
  repo.findById.mockResolvedValue(ok(full))
  pages.findManyByIds.mockResolvedValue(
    ok([
      createFakeSdStatusPage({ id: 'p1' }),
      createFakeSdStatusPage({ id: 'p2', published: false }),
    ]),
  )
  pages.listConfirmedForPages.mockResolvedValue(ok([email, phone]))
  pages.findWorkspaceName.mockResolvedValue(ok('Stratus'))
  vi.mocked(activeWhatsappConnection).mockResolvedValue({ id: 'c' } as never)
  vi.mocked(WhatsAppSend.text).mockResolvedValue(ok({} as never))
  vi.mocked(sendSdStatusUpdateEmail).mockResolvedValue({ id: 'm' })
})

describe('SdStatusNotifyService.deliver', () => {
  it('sends e-mail and WhatsApp to the confirmed subscribers and stores the counts', async () => {
    const out = expectOk(await SdStatusNotifyService.deliver('u1'))
    expect(out).toEqual({ skipped: null, total: 2, sent: 2, failed: 0 })
    expect(sendSdStatusUpdateEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'ana@acme.com.br',
        workspaceName: 'Stratus',
        statusLabel: 'Investigando',
        resolved: false,
      }),
    )
    expect(WhatsAppSend.text).toHaveBeenCalledWith(
      { id: 'c' },
      expect.objectContaining({ to: '5511999990000' }),
    )
    expect(pages.listConfirmedForPages).toHaveBeenCalledWith(['p1'], 2000)
    expect(repo.finishNotification).toHaveBeenCalledWith('u1', {
      total: 2,
      sent: 2,
      failed: 0,
    })
  })

  it('counts failures per subscriber and keeps going', async () => {
    vi.mocked(sendSdStatusUpdateEmail).mockRejectedValue(new Error('x'))
    vi.mocked(WhatsAppSend.text).mockResolvedValue(err(databaseError()))
    expect(expectOk(await SdStatusNotifyService.deliver('u1'))).toMatchObject({
      sent: 0,
      failed: 2,
    })
    vi.mocked(sendSdStatusUpdateEmail).mockRejectedValue('plain')
    expectOk(await SdStatusNotifyService.deliver('u1'))
  })

  it('counts WhatsApp subscribers as failed without a connection', async () => {
    vi.mocked(activeWhatsappConnection).mockResolvedValue(null)
    expect(expectOk(await SdStatusNotifyService.deliver('u1'))).toMatchObject({
      sent: 1,
      failed: 1,
    })
  })

  it('skips the WhatsApp lookup without WhatsApp subscribers and tolerates lookup failures', async () => {
    pages.listConfirmedForPages.mockResolvedValue(ok([email]))
    pages.findWorkspaceName.mockResolvedValue(err(databaseError()))
    repo.findById.mockResolvedValue(err(databaseError()))
    repo.finishNotification.mockResolvedValue(err(databaseError()))
    expectOk(await SdStatusNotifyService.deliver('u1'))
    expect(activeWhatsappConnection).not.toHaveBeenCalled()
    expect(sendSdStatusUpdateEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceName: '',
        impactLabel: 'Indisponibilidade parcial',
      }),
    )
    pages.findWorkspaceName.mockResolvedValue(ok(null))
    expectOk(await SdStatusNotifyService.deliver('u1'))
  })

  it('marks the final update as resolved', async () => {
    repo.findUpdate.mockResolvedValue(
      ok({ ...found, update: { ...found.update, status: 'RESOLVED' } }),
    )
    await SdStatusNotifyService.deliver('u1')
    expect(sendSdStatusUpdateEmail).toHaveBeenCalledWith(
      expect.objectContaining({ resolved: true }),
    )
  })

  it('skips missing, unpublished and already sent updates', async () => {
    repo.findUpdate.mockResolvedValue(ok(null))
    expect(expectOk(await SdStatusNotifyService.deliver('u1')).skipped).toBe(
      'not_found',
    )
    repo.findUpdate.mockResolvedValue(
      ok({ ...found, update: { ...found.update, publish: false } }),
    )
    expect(expectOk(await SdStatusNotifyService.deliver('u1')).skipped).toBe(
      'not_published',
    )
    repo.findUpdate.mockResolvedValue(ok(found))
    repo.claimNotification.mockResolvedValue(ok(false))
    expect(expectOk(await SdStatusNotifyService.deliver('u1')).skipped).toBe(
      'already_sent',
    )
    expect(sendSdStatusUpdateEmail).not.toHaveBeenCalled()
  })

  it('propagates repository errors', async () => {
    repo.findUpdate.mockResolvedValue(err(databaseError()))
    expectErr(await SdStatusNotifyService.deliver('u1'), 'DATABASE_ERROR')
    repo.findUpdate.mockResolvedValue(ok(found))
    repo.claimNotification.mockResolvedValue(err(databaseError()))
    expectErr(await SdStatusNotifyService.deliver('u1'), 'DATABASE_ERROR')
    repo.claimNotification.mockResolvedValue(ok(true))
    pages.findManyByIds.mockResolvedValue(err(databaseError()))
    expectErr(await SdStatusNotifyService.deliver('u1'), 'DATABASE_ERROR')
    pages.findManyByIds.mockResolvedValue(ok([]))
    pages.listConfirmedForPages.mockResolvedValue(err(databaseError()))
    expectErr(await SdStatusNotifyService.deliver('u1'), 'DATABASE_ERROR')
  })
})
