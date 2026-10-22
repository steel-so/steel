import type { Job } from 'bullmq'
import { describe, expect, it, vi } from 'vitest'

const { closeInactiveMock, scanDueMock, loggerMock } = vi.hoisted(() => ({
  closeInactiveMock: vi.fn(),
  scanDueMock: vi.fn(),
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/src/services/whatsapp-conversation.service', () => ({
  WhatsAppConversationService: { closeInactive: closeInactiveMock },
}))
vi.mock('@/src/services/whatsapp-sla-engine.service', () => ({
  WhatsAppSlaEngineService: { scanDue: scanDueMock },
}))
vi.mock('@/lib/axiom/logger', () => ({ logger: loggerMock }))

import { processWhatsappConversationLifecycle } from '@/src/lib/queue/processors/whatsapp-conversation-lifecycle'

function fakeJob(name = 'auto-close-inactive'): Job {
  return { id: 'job-1', name, data: {} } as unknown as Job
}

describe('processWhatsappConversationLifecycle', () => {
  it('delegates to WhatsAppConversationService.closeInactive', async () => {
    closeInactiveMock.mockResolvedValue({ ok: true, value: { closed: 3 } })

    const result = await processWhatsappConversationLifecycle(fakeJob())

    expect(result).toEqual({ closed: 3 })
    expect(closeInactiveMock).toHaveBeenCalledWith(expect.any(Date))
    expect(loggerMock.info).toHaveBeenCalledWith(
      'queue.whatsapp_conversation_lifecycle.auto_close_completed',
      expect.objectContaining({ closed: 3 }),
    )
  })

  it('throws on failure so BullMQ retries', async () => {
    closeInactiveMock.mockResolvedValue({
      ok: false,
      error: { code: 'DATABASE_ERROR', message: 'down' },
    })

    await expect(
      processWhatsappConversationLifecycle(fakeJob()),
    ).rejects.toThrow('DATABASE_ERROR')
  })

  it('runs the SLA scan on the sla-tick job and logs only when something happened', async () => {
    scanDueMock.mockResolvedValue({
      ok: true,
      value: { warned: 2, breached: 1 },
    })

    const result = await processWhatsappConversationLifecycle(
      fakeJob('sla-tick'),
    )

    expect(result).toEqual({ warned: 2, breached: 1 })
    expect(scanDueMock).toHaveBeenCalledWith(expect.any(Date))
    expect(loggerMock.info).toHaveBeenCalledWith(
      'queue.whatsapp_conversation_lifecycle.sla_tick_completed',
      expect.objectContaining({ warned: 2, breached: 1 }),
    )

    loggerMock.info.mockClear()
    scanDueMock.mockResolvedValue({
      ok: true,
      value: { warned: 0, breached: 0 },
    })
    await processWhatsappConversationLifecycle(fakeJob('sla-tick'))
    expect(loggerMock.info).not.toHaveBeenCalled()
  })

  it('throws when the SLA scan fails so BullMQ retries', async () => {
    scanDueMock.mockResolvedValue({
      ok: false,
      error: { code: 'DATABASE_ERROR', message: 'down' },
    })

    await expect(
      processWhatsappConversationLifecycle(fakeJob('sla-tick')),
    ).rejects.toThrow('Falha ao varrer o SLA do WhatsApp: DATABASE_ERROR')
  })

  it('rejects unknown job names', async () => {
    await expect(
      processWhatsappConversationLifecycle(fakeJob('nope')),
    ).rejects.toThrow('Unknown whatsapp-conversation-lifecycle job')
  })

  it('falls back to an unknown id in the error when the job has none', async () => {
    await expect(
      processWhatsappConversationLifecycle({
        name: 'nope',
        data: {},
      } as unknown as Job),
    ).rejects.toThrow(
      'Unknown whatsapp-conversation-lifecycle job: nope (id=unknown)',
    )
  })
})
