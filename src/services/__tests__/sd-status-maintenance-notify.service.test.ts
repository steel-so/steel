import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeSdStatusPage,
  createFakeSdStatusSubscriber,
} from '@/src/__tests__/factories/nov-s2-major-incident.factory'
import { createFakeSdStatusMaintenance } from '@/src/__tests__/factories/nov-sd-followups.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/sd-status-maintenance.repository')
vi.mock('@/src/repositories/sd-status-page.repository')
vi.mock('@/src/lib/mail/servicedesk/send-sd-status-update', () => ({
  sendSdStatusMaintenanceEmail: vi.fn(),
}))
vi.mock('@/src/lib/whatsapp/send', () => ({
  WhatsAppSend: { text: vi.fn() },
}))
vi.mock('../sd-notification.service', () => ({
  activeWhatsappConnection: vi.fn(),
}))

import { sendSdStatusMaintenanceEmail } from '@/src/lib/mail/servicedesk/send-sd-status-update'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { SdStatusMaintenanceRepository } from '@/src/repositories/sd-status-maintenance.repository'
import { SdStatusPageRepository } from '@/src/repositories/sd-status-page.repository'
import { activeWhatsappConnection } from '../sd-notification.service'
import { SdStatusMaintenanceNotifyService } from '../sd-status-maintenance-notify.service'

const windows = vi.mocked(SdStatusMaintenanceRepository)
const pages = vi.mocked(SdStatusPageRepository)

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
  windows.findByIdAny.mockResolvedValue(ok(createFakeSdStatusMaintenance()))
  windows.claimNotice.mockResolvedValue(ok(true))
  windows.finishNotice.mockResolvedValue(ok(true))
  pages.findManyByIds.mockResolvedValue(
    ok([
      createFakeSdStatusPage({ id: 'p1', timeZone: 'America/Sao_Paulo' }),
      createFakeSdStatusPage({ id: 'p2', published: false }),
    ]),
  )
  pages.listConfirmedForPages.mockResolvedValue(ok([email, phone]))
  pages.findWorkspaceName.mockResolvedValue(ok('Stratus'))
  vi.mocked(activeWhatsappConnection).mockResolvedValue({ id: 'c' } as never)
  vi.mocked(WhatsAppSend.text).mockResolvedValue(ok({} as never))
  vi.mocked(sendSdStatusMaintenanceEmail).mockResolvedValue({ id: 'm' })
})

describe('SdStatusMaintenanceNotifyService.deliver', () => {
  it('sends the announcement by e-mail and WhatsApp in the page time zone', async () => {
    const out = expectOk(
      await SdStatusMaintenanceNotifyService.deliver('mw1', 'scheduled'),
    )
    expect(out).toEqual({ skipped: null, total: 2, sent: 2, failed: 0 })
    expect(windows.claimNotice).toHaveBeenCalledWith(
      'mw1',
      'scheduled',
      expect.any(Date),
    )
    expect(sendSdStatusMaintenanceEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'ana@acme.com.br',
        workspaceName: 'Stratus',
        headline: 'Manutenção programada',
        whenText: '10/11/2026 19:00 até 10/11/2026 23:00',
        canceled: false,
      }),
    )
    expect(WhatsAppSend.text).toHaveBeenCalledWith(
      { id: 'c' },
      expect.objectContaining({
        to: '5511999990000',
        text: expect.stringContaining('Manutenção programada'),
      }),
    )
    expect(pages.listConfirmedForPages).toHaveBeenCalledWith(['p1'], 2000)
    expect(windows.finishNotice).toHaveBeenCalledWith('mw1', {
      total: 2,
      sent: 2,
      failed: 0,
    })
  })

  it('words a rescheduled window and a cancellation', async () => {
    await SdStatusMaintenanceNotifyService.deliver('mw1', 'rescheduled')
    expect(sendSdStatusMaintenanceEmail).toHaveBeenLastCalledWith(
      expect.objectContaining({ headline: 'Manutenção reagendada' }),
    )
    expect(windows.claimNotice).toHaveBeenLastCalledWith(
      'mw1',
      'scheduled',
      expect.any(Date),
    )
    await SdStatusMaintenanceNotifyService.deliver('mw1', 'canceled')
    expect(sendSdStatusMaintenanceEmail).toHaveBeenLastCalledWith(
      expect.objectContaining({
        headline: 'Manutenção cancelada',
        canceled: true,
      }),
    )
    expect(windows.claimNotice).toHaveBeenLastCalledWith(
      'mw1',
      'canceled',
      expect.any(Date),
    )
  })

  it('skips an unknown window, a window with notices off and an already sent notice', async () => {
    windows.findByIdAny.mockResolvedValue(ok(null))
    expect(
      expectOk(await SdStatusMaintenanceNotifyService.deliver('x', 'scheduled'))
        .skipped,
    ).toBe('not_found')
    windows.findByIdAny.mockResolvedValue(
      ok(createFakeSdStatusMaintenance({ notifySubscribers: false })),
    )
    expect(
      expectOk(
        await SdStatusMaintenanceNotifyService.deliver('mw1', 'scheduled'),
      ).skipped,
    ).toBe('disabled')
    windows.findByIdAny.mockResolvedValue(ok(createFakeSdStatusMaintenance()))
    windows.claimNotice.mockResolvedValue(ok(false))
    expect(
      expectOk(
        await SdStatusMaintenanceNotifyService.deliver('mw1', 'scheduled'),
      ).skipped,
    ).toBe('already_sent')
    expect(sendSdStatusMaintenanceEmail).not.toHaveBeenCalled()
  })

  it('counts failures per subscriber and keeps going', async () => {
    vi.mocked(sendSdStatusMaintenanceEmail).mockRejectedValue(new Error('x'))
    vi.mocked(WhatsAppSend.text).mockResolvedValue(err(databaseError()))
    expect(
      expectOk(
        await SdStatusMaintenanceNotifyService.deliver('mw1', 'scheduled'),
      ),
    ).toMatchObject({ sent: 0, failed: 2 })
    vi.mocked(sendSdStatusMaintenanceEmail).mockRejectedValue('plain')
    expectOk(await SdStatusMaintenanceNotifyService.deliver('mw1', 'scheduled'))
  })

  it('counts WhatsApp subscribers as failed without a connection', async () => {
    vi.mocked(activeWhatsappConnection).mockResolvedValue(null)
    expect(
      expectOk(
        await SdStatusMaintenanceNotifyService.deliver('mw1', 'scheduled'),
      ),
    ).toMatchObject({ sent: 1, failed: 1 })
  })

  it('skips the WhatsApp lookup without WhatsApp subscribers and tolerates lookup failures', async () => {
    pages.listConfirmedForPages.mockResolvedValue(ok([email]))
    pages.findWorkspaceName.mockResolvedValue(err(databaseError()))
    windows.finishNotice.mockResolvedValue(err(databaseError()))
    expectOk(await SdStatusMaintenanceNotifyService.deliver('mw1', 'scheduled'))
    expect(activeWhatsappConnection).not.toHaveBeenCalled()
    expect(sendSdStatusMaintenanceEmail).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceName: '' }),
    )
    pages.findWorkspaceName.mockResolvedValue(ok(null))
    expectOk(await SdStatusMaintenanceNotifyService.deliver('mw1', 'scheduled'))
  })

  it('falls back to Sao Paulo when the page of the subscriber is not published any more', async () => {
    pages.listConfirmedForPages.mockResolvedValue(
      ok([{ ...email, pageId: 'gone' }]),
    )
    expectOk(await SdStatusMaintenanceNotifyService.deliver('mw1', 'scheduled'))
    expect(sendSdStatusMaintenanceEmail).toHaveBeenCalledWith(
      expect.objectContaining({ whenText: expect.stringContaining('19:00') }),
    )
  })

  it('propagates repository errors', async () => {
    windows.findByIdAny.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdStatusMaintenanceNotifyService.deliver('mw1', 'scheduled'),
      'DATABASE_ERROR',
    )
    windows.findByIdAny.mockResolvedValue(ok(createFakeSdStatusMaintenance()))
    windows.claimNotice.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdStatusMaintenanceNotifyService.deliver('mw1', 'scheduled'),
      'DATABASE_ERROR',
    )
    windows.claimNotice.mockResolvedValue(ok(true))
    pages.findManyByIds.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdStatusMaintenanceNotifyService.deliver('mw1', 'scheduled'),
      'DATABASE_ERROR',
    )
    pages.findManyByIds.mockResolvedValue(ok([createFakeSdStatusPage()]))
    pages.listConfirmedForPages.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdStatusMaintenanceNotifyService.deliver('mw1', 'scheduled'),
      'DATABASE_ERROR',
    )
  })
})
