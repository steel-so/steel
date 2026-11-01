import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeSchedAppointmentFull,
  createFakeSchedulingSettings,
} from '@/src/__tests__/factories/whatsapp-scheduling.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppContactWithoutCount } from '@/src/__tests__/factories/whatsapp-contact.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/lib/whatsapp/send', () => ({ WhatsAppSend: { text: vi.fn() } }))
vi.mock('../whatsapp-automation-send.service', () => ({
  recordOutboundMessage: vi.fn(async () => ({ ok: true, value: undefined })),
}))
vi.mock('@/src/repositories/whatsapp-scheduling.repository')

import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import {
  WhatsAppSchedAppointmentRepository,
  WhatsAppSchedulingSettingsRepository,
} from '@/src/repositories/whatsapp-scheduling.repository'
import { recordOutboundMessage } from '../whatsapp-automation-send.service'
import { WhatsAppSchedulingReplyService } from '../whatsapp-scheduling-reply.service'

const settingsRepo = vi.mocked(WhatsAppSchedulingSettingsRepository)
const apptRepo = vi.mocked(WhatsAppSchedAppointmentRepository)
const sendText = vi.mocked(WhatsAppSend.text)

const dbErr = () => err(databaseError('x'))
const now = new Date('2026-11-04T12:00:00Z')
const contact = createFakeWhatsAppContactWithoutCount({
  id: 'ct1',
  waId: '55119',
})
const appointment = createFakeSchedAppointmentFull({
  status: 'PENDING',
  startsAt: new Date('2026-11-05T17:00:00Z'),
})

const input = (text: string) => ({
  workspaceId: 'ws1',
  connection: createFakeWhatsAppConnection(),
  contact,
  conversationId: 'cv1',
  text,
  now,
})

beforeEach(() => {
  vi.clearAllMocks()
  settingsRepo.findByWorkspace.mockResolvedValue(
    ok(createFakeSchedulingSettings()),
  )
  apptRepo.findNextNotified.mockResolvedValue(ok(appointment))
  apptRepo.update.mockResolvedValue(ok(appointment))
  sendText.mockResolvedValue(ok({ providerMessageId: 'wamid.ack' }))
})

describe('WhatsAppSchedulingReplyService.handleInbound', () => {
  it('ignores messages that are not an answer, before touching the database', async () => {
    expect(
      expectOk(
        await WhatsAppSchedulingReplyService.handleInbound(
          input('olá, tudo bem?'),
        ),
      ),
    ).toEqual({
      handled: false,
    })
    expect(settingsRepo.findByWorkspace).not.toHaveBeenCalled()
  })

  it('confirms a pending appointment and answers in the open window', async () => {
    expect(
      expectOk(
        await WhatsAppSchedulingReplyService.handleInbound(input('CONFIRMAR')),
      ),
    ).toEqual({
      handled: true,
    })
    expect(apptRepo.update).toHaveBeenCalledWith(appointment.id, {
      status: 'CONFIRMED',
      confirmedAt: now,
    })
    expect(sendText.mock.calls[0][1].text).toContain('Presença confirmada')
    expect(recordOutboundMessage).toHaveBeenCalled()
  })

  it('does not touch an already confirmed appointment', async () => {
    apptRepo.findNextNotified.mockResolvedValue(
      ok({ ...appointment, status: 'CONFIRMED' }),
    )
    expectOk(await WhatsAppSchedulingReplyService.handleInbound(input('sim')))
    expect(apptRepo.update).not.toHaveBeenCalled()
  })

  it('cancels on CANCELAR', async () => {
    expectOk(
      await WhatsAppSchedulingReplyService.handleInbound(input('cancelar')),
    )
    expect(apptRepo.update).toHaveBeenCalledWith(
      appointment.id,
      expect.objectContaining({
        status: 'CANCELED',
        cancelReason: 'Cancelado pelo cliente',
      }),
    )
    expect(sendText.mock.calls[0][1].text).toContain('Agendamento cancelado')
  })

  it('leaves the message alone when the agenda is off or nothing is waiting', async () => {
    settingsRepo.findByWorkspace.mockResolvedValue(ok(null))
    expect(
      expectOk(await WhatsAppSchedulingReplyService.handleInbound(input('sim')))
        .handled,
    ).toBe(false)
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(createFakeSchedulingSettings({ enabled: false })),
    )
    expect(
      expectOk(await WhatsAppSchedulingReplyService.handleInbound(input('sim')))
        .handled,
    ).toBe(false)
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(createFakeSchedulingSettings()),
    )
    apptRepo.findNextNotified.mockResolvedValue(ok(null))
    expect(
      expectOk(await WhatsAppSchedulingReplyService.handleInbound(input('sim')))
        .handled,
    ).toBe(false)
  })

  it('propagates database failures', async () => {
    settingsRepo.findByWorkspace.mockResolvedValue(dbErr())
    expectErr(await WhatsAppSchedulingReplyService.handleInbound(input('sim')))
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok(createFakeSchedulingSettings()),
    )
    apptRepo.findNextNotified.mockResolvedValue(dbErr())
    expectErr(await WhatsAppSchedulingReplyService.handleInbound(input('sim')))
    apptRepo.findNextNotified.mockResolvedValue(ok(appointment))
    apptRepo.update.mockResolvedValue(dbErr())
    expectErr(await WhatsAppSchedulingReplyService.handleInbound(input('sim')))
    expectErr(
      await WhatsAppSchedulingReplyService.handleInbound(input('cancelar')),
    )
  })

  it('still counts as handled when the acknowledgement cannot be sent', async () => {
    sendText.mockResolvedValue(
      err({ code: 'WHATSAPP_PROVIDER_ERROR', message: 'x' } as never),
    )
    expect(
      expectOk(
        await WhatsAppSchedulingReplyService.handleInbound(input('sim')),
      ),
    ).toEqual({
      handled: true,
    })
    expect(recordOutboundMessage).not.toHaveBeenCalled()
  })

  it('uses the current time when none is given', async () => {
    apptRepo.findNextNotified.mockResolvedValue(ok(null))
    const { now: _ignored, ...rest } = input('sim')
    expectOk(await WhatsAppSchedulingReplyService.handleInbound(rest))
    expect(apptRepo.findNextNotified.mock.calls[0][2]).toBeInstanceOf(Date)
  })
})
