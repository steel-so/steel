import type { Job } from 'bullmq'
import { describe, expect, it, vi } from 'vitest'

const { sendMock, tickMock, loggerMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  tickMock: vi.fn(),
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/src/services/whatsapp-broadcast.service', () => ({
  WhatsAppBroadcastService: {
    sendToRecipient: sendMock,
    enqueueDueScheduledRecipients: tickMock,
  },
}))
vi.mock('@/lib/axiom/logger', () => ({ logger: loggerMock }))

import { processWhatsappBroadcast } from '@/src/lib/queue/processors/whatsapp-broadcast'

function sendJob(): Job {
  return {
    id: 'job-1',
    name: 'send-broadcast-message',
    data: { broadcastListId: 'list1', recipientId: 'r1' },
  } as unknown as Job
}

describe('processWhatsappBroadcast', () => {
  it('delegates a send to WhatsAppBroadcastService.sendToRecipient', async () => {
    sendMock.mockResolvedValue({
      ok: true,
      value: { status: 'sent', providerMessageId: 'wamid' },
    })

    await processWhatsappBroadcast(sendJob())

    expect(sendMock).toHaveBeenCalledWith('list1', 'r1')
    expect(loggerMock.info).toHaveBeenCalledWith(
      'queue.whatsapp_broadcast.processed',
      expect.objectContaining({ ok: true }),
    )
  })

  it('logs LGPD opt-out skips', async () => {
    sendMock.mockResolvedValue({
      ok: true,
      value: { status: 'skipped', reason: 'opted_out' },
    })

    await processWhatsappBroadcast(sendJob())

    expect(loggerMock.info).toHaveBeenCalledWith(
      'queue.whatsapp_broadcast.skipped_opted_out',
      expect.anything(),
    )
  })

  it('logs failed sends without throwing', async () => {
    sendMock.mockResolvedValue({
      ok: true,
      value: { status: 'failed', reason: 'WHATSAPP_PROVIDER_ERROR' },
    })

    await expect(processWhatsappBroadcast(sendJob())).resolves.toBeUndefined()
    expect(loggerMock.info).toHaveBeenCalledWith(
      'queue.whatsapp_broadcast.processed',
      expect.objectContaining({ ok: false }),
    )
  })

  it('throws on database errors so BullMQ retries', async () => {
    sendMock.mockResolvedValue({
      ok: false,
      error: { code: 'DATABASE_ERROR', message: 'down' },
    })

    await expect(processWhatsappBroadcast(sendJob())).rejects.toThrow(
      'DATABASE_ERROR',
    )
  })

  it('runs the schedule tick through the service', async () => {
    tickMock.mockResolvedValue({ ok: true, value: { due: 2 } })

    await processWhatsappBroadcast({
      id: 'job-2',
      name: 'run-schedule-tick',
      data: {},
    } as unknown as Job)

    expect(tickMock).toHaveBeenCalledWith(expect.any(Date))
    expect(loggerMock.info).toHaveBeenCalledWith(
      'queue.whatsapp_broadcast.tick_completed',
      expect.objectContaining({ due: 2 }),
    )
  })

  it('rejects unknown job names', async () => {
    await expect(
      processWhatsappBroadcast({ id: 'x', name: 'nope' } as unknown as Job),
    ).rejects.toThrow('Unknown whatsapp-broadcast job')
  })

  it('warns when the recipient no longer exists', async () => {
    sendMock.mockResolvedValue({
      ok: true,
      value: { status: 'skipped', reason: 'recipient_missing' },
    })

    await processWhatsappBroadcast(sendJob())

    expect(loggerMock.warn).toHaveBeenCalledWith(
      'queue.whatsapp_broadcast.recipient_missing',
      expect.anything(),
    )
  })

  it('silently ignores other skip reasons (e.g. already processed)', async () => {
    loggerMock.info.mockClear()
    loggerMock.warn.mockClear()
    sendMock.mockResolvedValue({
      ok: true,
      value: { status: 'skipped', reason: 'already_processed' },
    })

    await expect(processWhatsappBroadcast(sendJob())).resolves.toBeUndefined()
    expect(loggerMock.info).not.toHaveBeenCalled()
    expect(loggerMock.warn).not.toHaveBeenCalled()
  })

  it('throws when the schedule tick cannot list due recipients', async () => {
    tickMock.mockResolvedValue({
      ok: false,
      error: { code: 'DATABASE_ERROR', message: 'down' },
    })

    await expect(
      processWhatsappBroadcast({
        id: 't1',
        name: 'run-schedule-tick',
      } as unknown as Job),
    ).rejects.toThrow(
      'Failed to list due scheduled broadcast recipients: DATABASE_ERROR',
    )
  })

  it('reports an unknown id for unknown jobs without an id', async () => {
    await expect(
      processWhatsappBroadcast({ name: 'nope' } as unknown as Job),
    ).rejects.toThrow('Unknown whatsapp-broadcast job: nope (id=unknown)')
  })
})
